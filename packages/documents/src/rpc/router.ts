import { os } from '@orpc/server';
import {
  createLocalDocumentConverter,
  describeFontFace,
  DocumentFormatSchema,
  DOCUMENT_FORMATS,
  readDocumentMetadata,
  setDocumentMetadata,
} from 'documents.js';
import { z } from 'zod';

// This module runs only inside src/workers/documents.worker.ts. It is the one place in the app allowed to call documents.js's real conversion/metadata functions -- everything on the main thread reaches it only through the oRPC client in src/rpc/client.ts.

const BytesSchema = z.instanceof(Uint8Array);

const DocumentPayloadSchema = z.object({
  format: DocumentFormatSchema,
  bytes: BytesSchema,
});

const DiagnosticSchema = z.object({
  severity: z.enum(['info', 'warning']),
  code: z.string(),
  message: z.string(),
  pageIndex: z.number().int().nonnegative().optional(),
});

// Deliberately omits ConversionResult's optional `package` field: DocumentPackage carries the full ContentDocument/LayoutDocument tree, which no current tool needs across the RPC boundary yet. Add it here (as its own zod schema, mirroring document-schema.js's) if a future tool needs the intermediate package.
const ConversionResultSchema = z.object({
  document: DocumentPayloadSchema,
  diagnostics: z.array(DiagnosticSchema),
});

const ConversionPairSchema = z.object({ source: DocumentFormatSchema, target: DocumentFormatSchema });

const MetadataSchema = z.object({
  title: z.string().optional(),
  author: z.string().optional(),
  subject: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  createdIso: z.string().optional(),
  modifiedIso: z.string().optional(),
  producer: z.string().optional(),
});

const FontFaceSchema = z.object({
  family: z.string(),
  bold: z.boolean(),
  italic: z.boolean(),
});

export const router = {
  formats: {
    list: os.output(z.array(DocumentFormatSchema)).handler(() => [...DOCUMENT_FORMATS]),
    listConversions: os
      .output(z.array(ConversionPairSchema))
      .handler(() => createLocalDocumentConverter().conversions.map((pair) => ({ ...pair }))),
  },

  convert: os
    .input(
      z.object({
        source: DocumentFormatSchema,
        targetFormat: DocumentFormatSchema,
        bytes: BytesSchema,
      }),
    )
    .output(ConversionResultSchema)
    .handler(async ({ input, signal }) => {
      const converter = createLocalDocumentConverter();
      const result = await converter.convert(
        { source: { format: input.source, bytes: input.bytes }, targetFormat: input.targetFormat },
        { signal: signal ?? new AbortController().signal },
      );
      return {
        document: result.document,
        diagnostics: result.diagnostics.map((diagnostic) => ({ ...diagnostic })),
      };
    }),

  metadata: {
    read: os
      .input(z.object({ format: DocumentFormatSchema, bytes: BytesSchema }))
      .output(MetadataSchema)
      .handler(({ input, signal }) => readDocumentMetadata(input.format, input.bytes, { signal })),

    write: os
      .input(
        z.object({
          sourceFormat: DocumentFormatSchema,
          targetFormat: DocumentFormatSchema,
          bytes: BytesSchema,
          overrides: MetadataSchema.omit({ createdIso: true, modifiedIso: true, producer: true }),
        }),
      )
      .output(BytesSchema)
      .handler(({ input, signal }) =>
        setDocumentMetadata(input.sourceFormat, input.targetFormat, input.bytes, input.overrides, { signal }),
      ),
  },

  fonts: {
    describe: os
      .input(z.object({ bytes: BytesSchema, label: z.string() }))
      .output(FontFaceSchema)
      .handler(({ input }) => describeFontFace(input.bytes, input.label)),
  },
};

export type AppRouter = typeof router;
