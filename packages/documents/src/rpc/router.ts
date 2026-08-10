import { os } from '@orpc/server';
import {
  ContentDocumentSchema,
  createLocalDocumentConverter,
  describeFontFace,
  DocumentFormatSchema,
  DOCUMENT_FORMATS,
  extractSourceFontsForFormat,
  LayoutDocumentSchema,
  readDocumentMetadata,
  readPdf,
  setDocumentMetadata,
} from 'documents.js';
import type { ContentBlock, ContentDocument, ContentParagraph, LayoutImageAsset } from 'documents.js';
import { CODE_BLOCK_STYLE_ID, HORIZONTAL_RULE_STYLE_ID, parseHeadingStyleId, parseListNumId, QUOTE_STYLE_ID } from 'markdown-codec';
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

// `content` carries ConversionResult's own DocumentPackage.content -- createLocalDocumentConverter().convert() already computes this on every call via its internal onDocument callback, so surfacing it here costs nothing extra. Used by the Convert tool's markdown/spreadsheet previews (src/ui/MarkdownPreview.tsx, src/ui/SheetPreview.tsx) to render natively rather than round-tripping every format through PDF -- LayoutDocument is deliberately still omitted, since no tool needs it across the RPC boundary yet.
const ConversionResultSchema = z.object({
  document: DocumentPayloadSchema,
  diagnostics: z.array(DiagnosticSchema),
  content: ContentDocumentSchema.optional(),
});

// markdown-codec marks a heading paragraph with its own private styleId convention ("Heading1".."Heading6") and a list paragraph's ordered-vs-bullet distinction is encoded inside its own numId string ("md{n}:bullet|ordered@start", via parseListNumId) -- neither is part of document-schema.js's own schema, both are markdown-codec's internal vocabulary. Rewritten here, worker-side (the only place allowed to import markdown-codec), into a small convention this app documents and owns itself, so MarkdownPreview.tsx never needs to depend on markdown-codec's internal string formats -- only on what this router promises to hand it. Only ever applied to a markdown-sourced ContentDocument (see the convert handler's own call site below); a docx/odt-sourced document's styleId/numId values are untouched, since MarkdownPreview only ever renders a markdown source/target's own preview.
function normalizeMarkdownStyling(document: ContentDocument): ContentDocument {
  if (document.kind !== 'wordprocessing') return document;
  return { ...document, sections: document.sections.map((section) => ({ ...section, blocks: section.blocks.map(normalizeMarkdownBlock) })) };
}

function normalizeMarkdownBlock(block: ContentBlock): ContentBlock {
  if (block.kind === 'paragraph') return normalizeMarkdownParagraph(block);
  if (block.kind === 'table') {
    return {
      ...block,
      rows: block.rows.map((row) => ({
        ...row,
        cells: row.cells.map((cell) => ({ ...cell, blocks: cell.blocks.map(normalizeMarkdownBlock) })),
      })),
    };
  }
  return block;
}

function normalizeMarkdownParagraph(paragraph: ContentParagraph): ContentParagraph {
  const headingLevel = paragraph.styleId === undefined ? undefined : parseHeadingStyleId(paragraph.styleId);
  const styleId =
    headingLevel !== undefined
      ? `heading-${headingLevel}`
      : paragraph.styleId === QUOTE_STYLE_ID
        ? 'quote'
        : paragraph.styleId === CODE_BLOCK_STYLE_ID
          ? 'code-block'
          : paragraph.styleId === HORIZONTAL_RULE_STYLE_ID
            ? 'horizontal-rule'
            : paragraph.styleId;
  // Preserves the original numId as a suffix (not just the ordered/bullet type alone) so MarkdownPreview can still tell where one list ends and the next begins -- markdown-codec mints a fresh numId per list instance, so two adjacent same-type lists must not collapse into one <ul>/<ol>.
  const list =
    paragraph.list === undefined
      ? undefined
      : { ...paragraph.list, numId: `${parseListNumId(paragraph.list.numId)?.type ?? 'bullet'}:${paragraph.list.numId}` };
  return { ...paragraph, styleId, list };
}

const ConversionPairSchema = z.object({ source: DocumentFormatSchema, target: DocumentFormatSchema });

const MetadataSchema = z.object({
  title: z.string().optional(),
  author: z.string().optional(),
  subject: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  creator: z.string().optional(),
  createdIso: z.string().optional(),
  modifiedIso: z.string().optional(),
  producer: z.string().optional(),
});

const FontFaceSchema = z.object({
  family: z.string(),
  bold: z.boolean(),
  italic: z.boolean(),
});

// LayoutImageAsset.base64 embeds the full re-encoded image, unbounded in size -- never crosses the worker/main-thread boundary. byteLength is estimated from the base64 string's own length (each 4 base64 characters decode to 3 bytes) rather than actually decoding it, since the structural inspector only needs a size hint, not the bytes themselves.
const SanitizedLayoutImageAssetSchema = z.object({
  format: z.enum(['png', 'jpeg']),
  widthPx: z.number().int().positive(),
  heightPx: z.number().int().positive(),
  byteLength: z.number().int().nonnegative(),
});

// Reuses LayoutDocumentSchema wholesale for pages/metadata/formatVersion -- only images is overridden, so the structure tree gets full real fidelity for everything except the one field with an unbounded payload.
const SanitizedLayoutDocumentSchema = LayoutDocumentSchema.extend({
  images: z.record(z.string(), SanitizedLayoutImageAssetSchema),
});

function sanitizeImageAsset(asset: LayoutImageAsset) {
  return {
    format: asset.format,
    widthPx: asset.widthPx,
    heightPx: asset.heightPx,
    byteLength: Math.ceil((asset.base64.length * 3) / 4),
  };
}

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
      const content = result.package?.content;
      return {
        document: result.document,
        diagnostics: result.diagnostics.map((diagnostic) => ({ ...diagnostic })),
        content: content !== undefined && input.source === 'markdown' ? normalizeMarkdownStyling(content) : content,
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
          // creator, like createdIso/modifiedIso/producer, is not an accepted MetadataOverrides field (documents.js's src/metadata/write.ts) -- it's read-only, not something a caller can set.
          overrides: MetadataSchema.omit({ creator: true, createdIso: true, modifiedIso: true, producer: true }),
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

    extractSourceFonts: os
      .input(z.object({ format: DocumentFormatSchema, bytes: BytesSchema }))
      .output(z.array(FontFaceSchema))
      .handler(({ input }) =>
        extractSourceFontsForFormat(input.format, input.bytes).map((font) => ({
          family: font.family,
          bold: font.bold,
          italic: font.italic,
        })),
      ),
  },

  pdf: {
    inspect: os
      .input(z.object({ bytes: BytesSchema }))
      .output(
        z.object({
          pageCount: z.number().int().nonnegative(),
          itemKindCounts: z.record(z.string(), z.number().int().nonnegative()),
          metadata: MetadataSchema,
          layout: SanitizedLayoutDocumentSchema,
        }),
      )
      .handler(({ input, signal }) => {
        const layout = readPdf(input.bytes, { signal });
        const itemKindCounts: Record<string, number> = {};
        for (const page of layout.pages) {
          for (const item of page.items) {
            itemKindCounts[item.kind] = (itemKindCounts[item.kind] ?? 0) + 1;
          }
        }
        const images = Object.fromEntries(Object.entries(layout.images).map(([id, asset]) => [id, sanitizeImageAsset(asset)]));
        return {
          pageCount: layout.pages.length,
          itemKindCounts,
          metadata: layout.metadata,
          layout: { formatVersion: layout.formatVersion, metadata: layout.metadata, pages: layout.pages, images },
        };
      }),
  },
};

export type AppRouter = typeof router;
