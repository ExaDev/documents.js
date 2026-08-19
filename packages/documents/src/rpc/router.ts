import { os } from '@orpc/server';
import { assemblePackage, flattenPackage } from 'document-schema.js';
import {
  ContentDocumentSchema,
  createLocalDocumentConverter,
  decodeDocumentPackage,
  describeFontFace,
  DocumentFormatSchema,
  DocumentPackageSchema,
  documentPackageWithSchema,
  DOCUMENT_FORMATS,
  extractSourceFontsForFormat,
  LayoutDocumentSchema,
  readCsvContent,
  readDocxContent,
  readDocxExtras,
  readDocumentMetadata,
  readOdfFormulaContent,
  readOdgContent,
  readOdpContent,
  readOdsContent,
  readOdtContent,
  readMarkdownContent,
  readPptxContent,
  readPdf,
  readSvgContent,
  readXlsxContent,
  setDocumentMetadata,
} from 'documents.js';
import type { ContentBlock, ContentDocument, ContentParagraph, DocumentFormat, LayoutImageAsset } from 'documents.js';
import { CODE_BLOCK_STYLE_ID, HORIZONTAL_RULE_STYLE_ID, parseListNumId, QUOTE_STYLE_ID } from 'markdown-codec';
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

// `content` carries the conversion's own intermediate document, flattened from the tree at this boundary: documents.js 3 surfaces ConversionResult.package as the tree-form DocumentPackage (structure, layout, and content fused, document-schema.js 4), and flattenPackage materialises the flat codec-exchange ContentDocument the preview components consume -- one walk, refs resolved, user-visible behaviour identical to the old pkg.content read. createLocalDocumentConverter().convert() already computes the package on every call via its internal onDocument callback, so surfacing it here costs nothing extra.
const ConversionResultSchema = z.object({
  document: DocumentPayloadSchema,
  diagnostics: z.array(DiagnosticSchema),
  content: ContentDocumentSchema.optional(),
});

// The tree-form DocumentPackage in the shape a dump carries it: stamped with its release-pinned $schema URI, which since document-schema.js 4 IS the artefact's version (the hand-kept formatVersion integer is gone). DocumentPackageSchema is a discriminated union and has no .extend, so the stamp rides in as an intersection -- the union validates the tree, the object validates the envelope's one extra key.
const DocumentPackageJsonSchema = DocumentPackageSchema.and(z.object({ $schema: z.string() }));

// markdown-codec carries a heading paragraph's level in the schema's own ContentParagraph.headingLevel field, so headings need no vocabulary rewrite -- only the residual private conventions are translated here: quote/code-block/horizontal-rule styleIds and a list paragraph's ordered-vs-bullet distinction encoded inside its numId string ("md{n}:bullet|ordered@start", via parseListNumId). Rewritten worker-side (the only place allowed to import markdown-codec) into a small convention this app documents and owns itself, so MarkdownPreview.tsx never needs to depend on markdown-codec's internal string formats -- only on what this router promises to hand it. Only ever applied to a markdown-sourced ContentDocument (see the convert handler's own call site below).
function normalizeMarkdownStyling(document: ContentDocument): ContentDocument {
  if (document.kind !== 'wordprocessing') return document;
  return { ...document, sections: document.sections.map((section) => ({ ...section, blocks: section.blocks.map(normalizeMarkdownBlock) })) };
}

// docx and odt heading paragraphs are identified primarily by the schema's ContentParagraph.headingLevel (docx: ooxml.js resolves w:outlineLvl through the style chain; odt: odf.js reads text:outline-level), with the "Heading1".."Heading6" styleId pattern as a fallback because the two signals have different coverage: a style NAMED "Heading3" can carry no outline level (caught only by the pattern), and a custom style can inherit an outline level while having a non-Heading name (caught only by the field). Rewritten here into the same "heading-{N}" convention normalizeMarkdownStyling produces. Blockquote and code-block styleIds are detected by heuristic name matching (docx: "Quote"/"IntenseQuote"; odt: "Quotations"; both: any styleId containing "Code"/"Source"/"Preformatted"), rewritten into the same "quote"/"code-block" convention markdown-codec uses.
const WORDPROCESSING_HEADING_PATTERN = /^Heading([1-6])$/;

function normalizeWordprocessingSemantics(document: ContentDocument): ContentDocument {
  if (document.kind !== 'wordprocessing') return document;
  return { ...document, sections: document.sections.map((section) => ({ ...section, blocks: section.blocks.map(normalizeWordprocessingBlock) })) };
}

function normalizeWordprocessingBlock(block: ContentBlock): ContentBlock {
  if (block.kind === 'paragraph') {
    if (block.headingLevel !== undefined) return { ...block, styleId: `heading-${block.headingLevel}` };
    if (block.styleId !== undefined) {
      const headingMatch = WORDPROCESSING_HEADING_PATTERN.exec(block.styleId);
      if (headingMatch !== null) return { ...block, styleId: `heading-${headingMatch[1]}` };
      if (block.styleId.includes('Quote')) return { ...block, styleId: 'quote' };
      if (block.styleId.includes('Code') || block.styleId.includes('Source') || block.styleId.includes('Preformatted')) {
        return { ...block, styleId: 'code-block' };
      }
    }
    return block;
  }
  if (block.kind === 'table') {
    return {
      ...block,
      rows: block.rows.map((row) => ({
        ...row,
        cells: row.cells.map((cell) => ({ ...cell, blocks: cell.blocks.map(normalizeWordprocessingBlock) })),
      })),
    };
  }
  return block;
}

// docx list numIds are opaque w:numId values; the real ordered-vs-bullet info lives in NumberingDefinitions (readDocxExtras), keyed by the same numId. Resolved here into the "ordered:"/"bullet:" prefix convention markdown-codec and odf.js already use, so buildListForest can render <ol>/<ul> for every source.
function normalizeDocxListKinds(document: ContentDocument, bytes: Uint8Array<ArrayBuffer>): ContentDocument {
  if (document.kind !== 'wordprocessing') return document;
  const extras = readDocxExtras(decodeDocumentPackage('docx', bytes));
  const resolve = (numId: string, level: number): string => {
    const format = extras.numbering[numId]?.levels[String(level)]?.format;
    return format === 'bullet' || format === 'none' ? `bullet:${numId}` : `ordered:${numId}`;
  };
  const walkBlock = (block: ContentBlock): ContentBlock => {
    if (block.kind === 'paragraph' && block.list !== undefined) {
      // An absent numId means the source carried only a depth (ContentListMembership's own field comment -- no numbering definition exists to look up), so the membership passes through untouched rather than resolving against a fabricated identity.
      if (block.list.numId === undefined) return block;
      return { ...block, list: { ...block.list, numId: resolve(block.list.numId, block.list.level) } };
    }
    if (block.kind === 'table') {
      return { ...block, rows: block.rows.map((row) => ({ ...row, cells: row.cells.map((cell) => ({ ...cell, blocks: cell.blocks.map(walkBlock) })) })) };
    }
    return block;
  };
  return { ...document, sections: document.sections.map((section) => ({ ...section, blocks: section.blocks.map(walkBlock) })) };
}

// Dispatches source-format-specific ContentDocument normalization. Each branch rewrites format-specific styleId vocabulary into the app's own convention; formats with no private vocabulary (pdf, pptx, odp, etc.) pass through unchanged. bytes is needed only for docx list-kind resolution (readDocxExtras); other formats don't use it.
function normalizeContentForSource(content: ContentDocument, source: DocumentFormat, bytes?: Uint8Array<ArrayBuffer>): ContentDocument {
  if (source === 'markdown') return normalizeMarkdownStyling(content);
  if (source === 'docx') {
    const normalized = normalizeWordprocessingSemantics(content);
    return bytes !== undefined ? normalizeDocxListKinds(normalized, bytes) : normalized;
  }
  if (source === 'odt') return normalizeWordprocessingSemantics(content);
  return content;
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
  const styleId =
    paragraph.headingLevel !== undefined
      ? `heading-${paragraph.headingLevel}`
      : paragraph.styleId === QUOTE_STYLE_ID
        ? 'quote'
        : paragraph.styleId === CODE_BLOCK_STYLE_ID
          ? 'code-block'
          : paragraph.styleId === HORIZONTAL_RULE_STYLE_ID
            ? 'horizontal-rule'
            : paragraph.styleId;
  // Preserves the original numId as a suffix (not just the ordered/bullet type alone) so MarkdownPreview can still tell where one list ends and the next begins -- markdown-codec mints a fresh numId per list instance, so two adjacent same-type lists must not collapse into one <ul>/<ol>. A membership with no numId at all carries only a depth (no list instance to identify), so it passes through unrewritten and buildListForest renders it with the neutral marker.
  const list =
    paragraph.list?.numId === undefined
      ? paragraph.list
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

// Reads a ContentDocument directly from bytes, bypassing the conversion engine entirely -- no target build/encode, no PDF layout pass. Every format's standalone content reader is exported from documents.js (xlsx included since documents.js 2.0 -- before that, xlsx had to detour through the xlsx->ods bridge and read .content off the conversion result). markdown, csv, and svg are the plain-text formats: their readers take the decoded string, not a package, so each decodes its bytes up front the way markdown always has.
function readContentForFormat(format: DocumentFormat, bytes: Uint8Array<ArrayBuffer>): ContentDocument {
  if (format === 'markdown') return readMarkdownContent(new TextDecoder().decode(bytes));
  if (format === 'csv') return readCsvContent(new TextDecoder().decode(bytes));
  if (format === 'svg') return readSvgContent(new TextDecoder().decode(bytes));
  if (format === 'pdf') throw new Error('PDF has no standalone content reader');
  const pkg = decodeDocumentPackage(format, bytes);
  switch (format) {
    case 'docx': return readDocxContent(pkg);
    case 'pptx': return readPptxContent(pkg);
    case 'xlsx': return readXlsxContent(pkg);
    case 'odt': return readOdtContent(pkg);
    case 'odp': return readOdpContent(pkg);
    case 'ods': return readOdsContent(pkg);
    case 'odg': return readOdgContent(pkg);
    case 'odf': return readOdfFormulaContent(pkg);
  }
}

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
      const pkg = result.package;
      const content = pkg !== undefined ? flattenPackage(pkg) : undefined;
      return {
        document: result.document,
        diagnostics: result.diagnostics.map((diagnostic) => ({ ...diagnostic })),
        content: content !== undefined ? normalizeContentForSource(content, input.source, input.bytes) : content,
      };
    }),

  content: {
    // Both encodings of the one document cross together: `content` is the flat codec-exchange ContentDocument the preview components render (readContentForFormat's own output, still the form every reader produces), `package` the same document in its artefact form -- assemblePackage decomposes it into the tree and documentPackageWithSchema stamps the $schema URI that names its version. The tree is built from the raw read, not the normalised content below: normalizeContentForSource rewrites styleIds into this app's own preview-rendering conventions, and a dumped artefact must show the document as the reader actually produced it.
    read: os
      .input(z.object({ format: DocumentFormatSchema, bytes: BytesSchema }))
      .output(
        z.object({
          content: ContentDocumentSchema,
          package: DocumentPackageJsonSchema,
        }),
      )
      .handler(({ input }) => {
        const content = readContentForFormat(input.format, input.bytes);
        return {
          content: normalizeContentForSource(content, input.format, input.bytes),
          package: documentPackageWithSchema(assemblePackage(content)),
        };
      }),
  },

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
