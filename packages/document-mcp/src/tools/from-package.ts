import { readFile } from 'node:fs/promises';
import type { CallToolResult, McpServer } from '@modelcontextprotocol/server';
import { base64ToBytes, buildDocumentBytes, documentFromJson, DocumentFormatSchema, documentSchemaKindOf, UnrecognizedDocumentSchemaError } from 'documents.js';
import { z } from 'zod';
import { DocumentInputSchema, type DocumentInput } from '../io/document-input';
import { DocumentOutputSchema, resolveDocumentOutput } from '../io/document-output';

// The read side of the DocumentPackage round trip documents.js's own onDocument callback (and the CLI's --dump-package flag) produce: reads a DocumentPackage previously serialised to JSON and rebuilds real document bytes from it. Ported from document-cli's own src/commands/from-package.ts, adapted to an isError CallToolResult in place of that command's stderr-line-plus-exit-code convention.

// `source` here is a DocumentPackage JSON file, not a document -- resolveDocumentInput's own format inference (io/document-input.ts) has no '.json' entry and would throw for the ordinary 'path' shape a caller most naturally reaches for (e.g. a file written by a --dump-package-equivalent step). This reads the hybrid DocumentInput's raw bytes directly instead, so no document format is ever inferred from -- the 'bytesBase64' shape's own `format` field stays part of the schema only so `source` keeps the identical hybrid shape every other tool's document input accepts, and goes unused here.
async function readSourceBytes(source: DocumentInput): Promise<Uint8Array<ArrayBuffer>> {
  if ('path' in source) {
    const buffer = await readFile(source.path);
    return new Uint8Array(buffer);
  }
  return base64ToBytes(source.bytesBase64);
}

function errorResult(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// documentFromJson recognises a DocumentPackage $schema URI from any document-schema.js release (the URI pattern matches the version segment), so a pre-documents.js-2.0.0 dump is routed into DocumentPackageSchema.parse and dies there on formatVersion -- without this check the tool would surface the raw Zod issue list, which names neither the shape change nor the remedy. Either signal marks the old shape: package formatVersion 1, or a 'layout' half on a dump that is not formatVersion 2 (the fused shape has no such field, so anything still carrying one alongside a missing or older formatVersion was dumped before the fusion).
function isLegacyPackageDump(value: unknown): boolean {
  if (!isRecord(value) || documentSchemaKindOf(value) !== 'DocumentPackage') return false;
  return value.formatVersion === 1 || ('layout' in value && value.formatVersion !== 2);
}

export function registerFromPackageTools(server: McpServer): void {
  server.registerTool(
    'from_package',
    {
      title: 'Build document from package',
      description:
        "Rebuilds real document bytes in a target format from a DocumentPackage previously serialised to JSON (e.g. by a caller's own --dump-package-equivalent step) -- the read side of the DocumentPackage round trip a conversion's onDocument callback produces.",
      inputSchema: z.object({
        source: DocumentInputSchema.describe(
          "The DocumentPackage JSON to read. 'path' points at a JSON file on disk -- its extension is never used to infer a document format, since the file holds a DocumentPackage, not a document. 'bytesBase64' carries the JSON inline; its 'format' field is required by the shared hybrid input shape but unused by this tool.",
        ),
        targetFormat: DocumentFormatSchema.describe('The document format to build from the DocumentPackage.'),
        output: DocumentOutputSchema.optional().describe('Where to write the resulting document. Omit entirely (or omit outputPath within it) to receive the bytes inline instead.'),
      }),
    },
    async ({ source, targetFormat, output }) => {
      // Declared outside the try so the catch can inspect what was read -- the legacy-dump and schema-validation diagnoses below key off the parsed value's own fields, not off the thrown error alone.
      let parsed: unknown;
      try {
        const bytes = await readSourceBytes(source);
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);

        try {
          parsed = JSON.parse(text);
        } catch (error) {
          return errorResult(`'source' is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
        }

        const result = documentFromJson(parsed);
        if (result.kind !== 'DocumentPackage') {
          return errorResult(
            `'source' is a ${result.kind}, not a DocumentPackage -- only a file carrying a real DocumentPackage (e.g. written by a caller's own --dump-package-equivalent step) can be read back by this tool`,
          );
        }

        const documentBytes = buildDocumentBytes(result.value, targetFormat);
        const resolvedOutput = await resolveDocumentOutput(documentBytes, output ?? {});
        return { content: [{ type: 'text', text: JSON.stringify(resolvedOutput) }], structuredContent: resolvedOutput };
      } catch (error) {
        if (error instanceof UnrecognizedDocumentSchemaError) {
          return errorResult(
            "'source' has no recognised $schema -- only a file carrying a real DocumentPackage (e.g. written by a caller's own --dump-package-equivalent step) can be read back by this tool",
          );
        }
        if (error instanceof z.ZodError && isLegacyPackageDump(parsed)) {
          return errorResult(
            "'source' is a DocumentPackage dump in the old formatVersion 1 shape: a 'layout' half beside 'content'. documents.js 2.0.0 fused the two into formatVersion 2 ('content' + 'pages', with per-node 'frames' carrying the layout positions) and no longer parses the old shape -- regenerate the dump with a current documents.js (e.g. re-run the conversion whose package dump produced it) and read that back instead",
          );
        }
        if (error instanceof z.ZodError) {
          return errorResult(`'source' failed ${documentSchemaKindOf(parsed) ?? 'document schema'} validation: ${error.message}`);
        }
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  );
}
