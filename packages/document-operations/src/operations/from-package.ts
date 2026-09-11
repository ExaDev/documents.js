import { readFile } from "node:fs/promises";
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
import { defineOperation } from "../operation";

// The read side of the DocumentTree round trip documents.js's own onDocument callback (and document-cli's --dump-package flag) produce: reads a DocumentTree previously serialised to JSON and rebuilds real document bytes from it. Ported from document-cli's own src/commands/from-package.ts.

// `source` here is a DocumentTree JSON file, not a document -- resolveDocumentInput's own format inference (io/document-input.ts) has no '.json' entry and would throw for the ordinary 'path' shape a caller most naturally reaches for (e.g. a file written by a --dump-package-equivalent step). This reads the hybrid DocumentInput's raw bytes directly instead, so no document format is ever inferred from -- the 'bytesBase64' shape's own `format` field stays part of the schema only so `source` keeps the identical hybrid shape every other operation's document input accepts, and goes unused here.
async function readSourceBytes(
  source: DocumentInput,
): Promise<Uint8Array<ArrayBuffer>> {
  if ("path" in source) {
    const buffer = await readFile(source.path);
    return new Uint8Array(buffer);
  }
  return base64ToBytes(source.bytesBase64);
}

const FromPackageInputSchema = z.object({
  source: DocumentInputSchema.describe(
    "The DocumentTree JSON to read. 'path' points at a JSON file on disk -- its extension is never used to infer a document format, since the file holds a DocumentTree, not a document. 'bytesBase64' carries the JSON inline; its 'format' field is required by the shared hybrid input shape but unused by this operation.",
  ),
  targetFormat: DocumentFormatSchema.describe(
    "The document format to build from the DocumentTree.",
  ),
  output: DocumentOutputSchema.optional().describe(
    "Where to write the resulting document. Omit entirely (or omit outputPath within it) to receive the bytes inline instead.",
  ),
});

const ResolvedDocumentOutputSchema = z.union([
  z.object({ path: z.string(), byteLength: z.number() }),
  z.object({
    bytesBase64: z.string(),
    byteLength: z.number(),
    large: z.literal(true).optional(),
  }),
]);

export const fromPackageOperation = defineOperation({
  name: "from_package",
  title: "Build document from package",
  description:
    "Rebuilds real document bytes in a target format from a DocumentTree previously serialised to JSON (e.g. by a caller's own --dump-package-equivalent step) -- the read side of the DocumentTree round trip a conversion's onDocument callback produces.",
  inputSchema: FromPackageInputSchema,
  outputSchema: ResolvedDocumentOutputSchema,
  async run({ source, targetFormat, output }) {
    const bytes = await readSourceBytes(source);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new Error(
        `'source' is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }

    // The pre-tree shapes (document-schema.js 3.x and earlier), a layout-document dump (moved to pdf-codec in the schema-4 major), and the document-package-stemmed rename tombstone (ExaDev/documents.js#661) each throw their own named error, whose message already says exactly what changed and the remedy -- surfaced verbatim by letting them propagate rather than paraphrasing them here. Only UnrecognizedDocumentSchemaError (a value with no recognisable $schema at all) and z.ZodError (a value that declares a real $schema but fails validation against it) get a friendlier, task-specific message.
    let result: ReturnType<typeof documentFromJson>;
    try {
      result = documentFromJson(parsed);
    } catch (error) {
      if (error instanceof UnrecognizedDocumentSchemaError) {
        throw new Error(
          "'source' has no recognised $schema -- only a file carrying a real DocumentTree (e.g. written by a caller's own --dump-package-equivalent step) can be read back by this operation",
          { cause: error },
        );
      }
      if (error instanceof z.ZodError) {
        throw new Error(
          `'source' failed ${documentSchemaKindOf(parsed) ?? "document schema"} validation: ${error.message}`,
          { cause: error },
        );
      }
      throw error;
    }

    if (result.kind !== "DocumentTree") {
      throw new Error(
        `'source' is a ${result.kind}, not a DocumentTree -- only a file carrying a real DocumentTree (e.g. written by a caller's own --dump-package-equivalent step) can be read back by this operation`,
      );
    }

    const documentBytes = buildDocumentBytes(result.value, targetFormat);
    return resolveDocumentOutput(documentBytes, output ?? {});
  },
});
