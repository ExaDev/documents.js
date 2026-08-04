import type { CallToolResult, McpServer } from '@modelcontextprotocol/server';
import { DocumentFormatSchema, type MetadataOverrides, readDocumentMetadata, setDocumentMetadata } from 'documents.js';
import { z } from 'zod';
import { DocumentInputSchema, resolveDocumentInput } from '../io/document-input';
import { DocumentOutputSchema, resolveDocumentOutput } from '../io/document-output';

// Wraps a thrown error into an isError CallToolResult, carrying the thrown message verbatim. documents.js's own setDocumentMetadata throws precisely-worded rejections (an unsupported odf source or target, a source/target format mismatch) that a caller needs to see exactly as thrown, not paraphrased or re-summarised.
function toErrorResult(error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: 'text', text: message }], isError: true };
}

export function registerMetadataTools(server: McpServer): void {
  server.registerTool(
    'metadata_read',
    {
      title: 'Read document metadata',
      description:
        "Reads a document's own title/author/subject/keywords/creator/producer/created-and-modified-timestamp metadata. Works across every supported format, including xlsx (read via a throwaway xlsx-to-pdf preview, since documents.js has no dedicated xlsx metadata reader of its own) and odf (a standalone formula document).",
      inputSchema: z.object({
        source: DocumentInputSchema.describe('The document to read metadata from.'),
      }),
    },
    async ({ source }) => {
      try {
        const { bytes, format } = await resolveDocumentInput(source);
        const metadata = readDocumentMetadata(format, bytes);
        return { content: [{ type: 'text', text: JSON.stringify(metadata) }], structuredContent: metadata };
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );

  server.registerTool(
    'metadata_write',
    {
      title: 'Write document metadata',
      description:
        "Patches a document's own title/author/subject/keywords, leaving every other field and every other flag as-is. Does not convert format -- the source document's own format and targetFormat must match (or both be 'pdf'); odf (a standalone formula document) is rejected outright as either a source or a target, since it has no write path back out at all. Convert the document to a different format first (e.g. with a documents.js conversion tool) if metadata needs to be set on the result of a format change.",
      inputSchema: z.object({
        source: DocumentInputSchema.describe('The document to patch metadata on.'),
        targetFormat: DocumentFormatSchema.describe(
          "The format to write the patched document back out as -- must match the source document's own format (or both be 'pdf'). metadata_write never converts format.",
        ),
        output: DocumentOutputSchema.optional().describe('Where to write the patched document. Omit entirely to receive the bytes inline, base64-encoded.'),
        setTitle: z.string().optional().describe('Set the title field. Omit to leave it exactly as the source document already has it.'),
        setAuthor: z.string().optional().describe('Set the author field. Omit to leave it exactly as the source document already has it.'),
        setSubject: z.string().optional().describe('Set the subject field. Omit to leave it exactly as the source document already has it.'),
        setKeywords: z.array(z.string()).optional().describe('Set the keywords field. Omit to leave it exactly as the source document already has it.'),
      }),
    },
    async ({ source, targetFormat, output, setTitle, setAuthor, setSubject, setKeywords }) => {
      try {
        const { bytes, format } = await resolveDocumentInput(source);
        const overrides: MetadataOverrides = { title: setTitle, author: setAuthor, subject: setSubject, keywords: setKeywords };
        const patched = setDocumentMetadata(format, targetFormat, bytes, overrides);
        const resolvedOutput = await resolveDocumentOutput(patched, output ?? {});
        return { content: [{ type: 'text', text: JSON.stringify(resolvedOutput) }], structuredContent: resolvedOutput };
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );
}
