import { readFile } from "node:fs/promises";
import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import {
  base64ToBytes,
  buildDocumentBytes,
  documentFromJson,
  DocumentFormatSchema,
  documentSchemaKindOf,
  UnrecognizedDocumentSchemaError,
} from "documents.js";
import { z } from "zod";
import { DocumentInputSchema, type DocumentInput } from "../io/document-input";
import {
  DocumentOutputSchema,
  resolveDocumentOutput,
} from "../io/document-output";

// The read side of the DocumentTree round trip documents.js's own onDocument callback (and the CLI's --dump-package flag) produce: reads a DocumentTree previously serialised to JSON and rebuilds real document bytes from it. Ported from document-cli's own src/commands/from-package.ts, adapted to an isError CallToolResult in place of that command's stderr-line-plus-exit-code convention.

// `source` here is a DocumentTree JSON file, not a document -- resolveDocumentInput's own format inference (io/document-input.ts) has no '.json' entry and would throw for the ordinary 'path' shape a caller most naturally reaches for (e.g. a file written by a --dump-package-equivalent step). This reads the hybrid DocumentInput's raw bytes directly instead, so no document format is ever inferred from -- the 'bytesBase64' shape's own `format` field stays part of the schema only so `source` keeps the identical hybrid shape every other tool's document input accepts, and goes unused here.
async function readSourceBytes(
  source: DocumentInput,
): Promise<Uint8Array<ArrayBuffer>> {
  if ("path" in source) {
    const buffer = await readFile(source.path);
    return new Uint8Array(buffer);
  }
  return base64ToBytes(source.bytesBase64);
}

function errorResult(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

// Narrowed by name, not instanceof: document-schema.js 4's documentFromJson throws SchemaVersionMismatchError, LayoutSchemaDemotedError, and DocumentPackageRenamedError (the ExaDev/documents.js#661 rename tombstone), but documents.js re-exports only UnrecognizedDocumentSchemaError of the four -- and a name check is robust even against the class anyway (a duplicate documents.js/document-schema.js install would break instanceof while both sides still set error.name). Each class pins its own name literal at construction, so the name is the contract.
function isNamedError(
  error: unknown,
  name:
    | "SchemaVersionMismatchError"
    | "LayoutSchemaDemotedError"
    | "DocumentPackageRenamedError",
): error is Error {
  return error instanceof Error && error.name === name;
}

export function registerFromPackageTools(server: McpServer): void {
  server.registerTool(
    "from_package",
    {
      title: "Build document from package",
      description:
        "Rebuilds real document bytes in a target format from a DocumentTree previously serialised to JSON (e.g. by a caller's own --dump-package-equivalent step) -- the read side of the DocumentTree round trip a conversion's onDocument callback produces.",
      inputSchema: z.object({
        source: DocumentInputSchema.describe(
          "The DocumentTree JSON to read. 'path' points at a JSON file on disk -- its extension is never used to infer a document format, since the file holds a DocumentTree, not a document. 'bytesBase64' carries the JSON inline; its 'format' field is required by the shared hybrid input shape but unused by this tool.",
        ),
        targetFormat: DocumentFormatSchema.describe(
          "The document format to build from the DocumentTree.",
        ),
        output: DocumentOutputSchema.optional().describe(
          "Where to write the resulting document. Omit entirely (or omit outputPath within it) to receive the bytes inline instead.",
        ),
      }),
    },
    async ({ source, targetFormat, output }) => {
      // Declared outside the try so the catch can name the schema kind in the validation diagnosis below, keyed off the parsed value's own $schema rather than the thrown error alone.
      let parsed: unknown;
      try {
        const bytes = await readSourceBytes(source);
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);

        try {
          parsed = JSON.parse(text);
        } catch (error) {
          return errorResult(
            `'source' is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
          );
        }

        const result = documentFromJson(parsed);
        if (result.kind !== "DocumentTree") {
          return errorResult(
            `'source' is a ${result.kind}, not a DocumentTree -- only a file carrying a real DocumentTree (e.g. written by a caller's own --dump-package-equivalent step) can be read back by this tool`,
          );
        }

        const documentBytes = buildDocumentBytes(result.value, targetFormat);
        const resolvedOutput = await resolveDocumentOutput(
          documentBytes,
          output ?? {},
        );
        return {
          content: [{ type: "text", text: JSON.stringify(resolvedOutput) }],
          structuredContent: resolvedOutput,
        };
      } catch (error) {
        if (error instanceof UnrecognizedDocumentSchemaError) {
          return errorResult(
            "'source' has no recognised $schema -- only a file carrying a real DocumentTree (e.g. written by a caller's own --dump-package-equivalent step) can be read back by this tool",
          );
        }
        // The pre-tree shapes (document-schema.js 3.x and earlier: package formatVersion 1 with a separate layout half, or formatVersion 2's flat content+pages) never reach schema validation any more -- documentFromJson's version gate refuses a dump whose $schema pins another major, throwing the named error whose message says exactly what changed (the tree-form DocumentTree, DocumentPackage before ExaDev/documents.js#661's rename) and the remedy (re-dump with a current release), so it is surfaced verbatim rather than paraphrased.
        if (isNamedError(error, "SchemaVersionMismatchError")) {
          return errorResult(error.message);
        }
        // A layout-document dump is likewise named by its own error -- LayoutDocument moved to pdf-codec in the schema-4 major, and the message points there instead of implying the value is unreadable garbage.
        if (isNamedError(error, "LayoutSchemaDemotedError")) {
          return errorResult(error.message);
        }
        // The rename tombstone: a document-package-stemmed dump, from any release, is refused by name alone -- ExaDev/documents.js#661 renamed DocumentPackage to DocumentTree, and the message names the rename and the remedy (re-dump with a current release) rather than this tool paraphrasing it.
        if (isNamedError(error, "DocumentPackageRenamedError")) {
          return errorResult(error.message);
        }
        if (error instanceof z.ZodError) {
          return errorResult(
            `'source' failed ${documentSchemaKindOf(parsed) ?? "document schema"} validation: ${error.message}`,
          );
        }
        return errorResult(
          error instanceof Error ? error.message : String(error),
        );
      }
    },
  );
}
