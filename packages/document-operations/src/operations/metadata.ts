import {
  DocumentFormatSchema,
  type MetadataOverrides,
  readDocumentMetadata,
  setDocumentMetadata,
} from "documents.js";
import { z } from "zod";
import {
  DocumentInputSchema,
  resolveDocumentInput,
} from "../io/document-input";
import {
  DocumentOutputSchema,
  resolveDocumentOutput,
} from "../io/document-output";
import {
  defineOperation,
  defineOperationWithoutOutputSchema,
} from "../operation";

const MetadataReadInputSchema = z.object({
  source: DocumentInputSchema.describe("The document to read metadata from."),
});

// The original MCP tool registration declared no outputSchema for metadata_read at all (readDocumentMetadata's own return shape varies per format -- see that function's own doc comment), so this operation declares none either rather than guessing one and risking rejecting a genuine value the guess did not anticipate. The output type comes straight from readDocumentMetadata's own return type instead.
export const metadataReadOperation = defineOperationWithoutOutputSchema<
  typeof MetadataReadInputSchema,
  ReturnType<typeof readDocumentMetadata>
>({
  name: "metadata_read",
  title: "Read document metadata",
  description:
    "Reads a document's own title/author/subject/keywords/creator/producer/created-and-modified-timestamp metadata. Works across every supported format, including xlsx (read via a throwaway xlsx-to-pdf preview, since documents.js has no dedicated xlsx metadata reader of its own) and odf (a standalone formula document).",
  inputSchema: MetadataReadInputSchema,
  async run({ source }) {
    const { bytes, format } = await resolveDocumentInput(source);
    return readDocumentMetadata(format, bytes);
  },
});

const ResolvedDocumentOutputSchema = z.union([
  z.object({ path: z.string(), byteLength: z.number() }),
  z.object({
    bytesBase64: z.string(),
    byteLength: z.number(),
    large: z.literal(true).optional(),
  }),
]);

const MetadataWriteInputSchema = z.object({
  source: DocumentInputSchema.describe("The document to patch metadata on."),
  targetFormat: DocumentFormatSchema.describe(
    "The format to write the patched document back out as -- must match the source document's own format (or both be 'pdf'). metadata_write never converts format.",
  ),
  output: DocumentOutputSchema.optional().describe(
    "Where to write the patched document. Omit entirely to receive the bytes inline, base64-encoded.",
  ),
  setTitle: z
    .string()
    .optional()
    .describe(
      "Set the title field. Omit to leave it exactly as the source document already has it.",
    ),
  setAuthor: z
    .string()
    .optional()
    .describe(
      "Set the author field. Omit to leave it exactly as the source document already has it.",
    ),
  setSubject: z
    .string()
    .optional()
    .describe(
      "Set the subject field. Omit to leave it exactly as the source document already has it.",
    ),
  setKeywords: z
    .array(z.string())
    .optional()
    .describe(
      "Set the keywords field. Omit to leave it exactly as the source document already has it.",
    ),
});

export const metadataWriteOperation = defineOperation({
  name: "metadata_write",
  title: "Write document metadata",
  description:
    "Patches a document's own title/author/subject/keywords, leaving every other field and every other flag as-is. Does not convert format -- the source document's own format and targetFormat must match (or both be 'pdf'); odf (a standalone formula document) is rejected outright as either a source or a target, since it has no write path back out at all. Convert the document to a different format first (e.g. with a documents.js conversion operation) if metadata needs to be set on the result of a format change.",
  inputSchema: MetadataWriteInputSchema,
  outputSchema: ResolvedDocumentOutputSchema,
  async run({
    source,
    targetFormat,
    output,
    setTitle,
    setAuthor,
    setSubject,
    setKeywords,
  }) {
    const { bytes, format } = await resolveDocumentInput(source);
    const overrides: MetadataOverrides = {
      title: setTitle,
      author: setAuthor,
      subject: setSubject,
      keywords: setKeywords,
    };
    const patched = setDocumentMetadata(format, targetFormat, bytes, overrides);
    return resolveDocumentOutput(patched, output ?? {});
  },
});
