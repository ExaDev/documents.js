import { os } from "@orpc/server";
import { assembleTree, flattenTree } from "document-schema.js";
import {
  ContentDocumentSchema,
  createLocalDocumentConverter,
  decodeDocumentPackage,
  describeFontFace,
  DocumentFormatSchema,
  DocumentTreeSchema,
  documentTreeWithSchema,
  DOCUMENT_FORMATS,
  extractSourceFontsForFormat,
  LayoutDocumentSchema,
  readCsvContent,
  readDocContent,
  readDocxContent,
  readDocxExtras,
  readDocumentMetadata,
  readEpubContent,
  readOdfFormulaContent,
  readOdgContent,
  readOdpContent,
  readOdsContent,
  readOdtContent,
  readMarkdownContent,
  readPptContent,
  readPptxContent,
  readPdf,
  readRtfContent,
  readSvgContent,
  readWpdContent,
  readXlsContent,
  readXlsxContent,
  setDocumentMetadata,
} from "documents.js";
import {
  buildDocumentBytes,
  decodeMarkdownText,
  encodeMarkdownText,
  odbTablesToSpreadsheetDocument,
  odmToPdf,
  OdmUnresolvedSectionError,
  openDoc,
  openDocx,
  openMarkdown,
  openOdt,
  parsePackage,
  readOdbInventory,
  readOdbTables,
} from "documents.js";
import type {
  ContentBlock,
  ContentDocument,
  ContentParagraph,
  DocEditor,
  DocxEditor,
  DocumentFormat,
  LayoutImageAsset,
  MarkdownEditor,
  OdtEditor,
} from "documents.js";
import {
  CODE_BLOCK_STYLE_ID,
  HORIZONTAL_RULE_STYLE_ID,
  parseListNumId,
  QUOTE_STYLE_ID,
} from "markdown-codec";
import { z } from "zod";

// This module runs only inside src/workers/documents.worker.ts. It is the one place in the app allowed to call documents.js's real conversion/metadata functions -- everything on the main thread reaches it only through the oRPC client in src/rpc/client.ts.

const BytesSchema = z.instanceof(Uint8Array);

const DocumentPayloadSchema = z.object({
  format: DocumentFormatSchema,
  bytes: BytesSchema,
});

const DiagnosticSchema = z.object({
  severity: z.enum(["info", "warning"]),
  code: z.string(),
  message: z.string(),
  pageIndex: z.number().int().nonnegative().optional(),
});

// `content` carries the conversion's own intermediate document, flattened from the tree at this boundary: documents.js 3 surfaces ConversionResult.package as the tree-form DocumentTree (structure, layout, and content fused, document-schema.js 4), and flattenTree materialises the flat codec-exchange ContentDocument the preview components consume -- one walk, refs resolved, user-visible behaviour identical to the old pkg.content read. createLocalDocumentConverter().convert() already computes the package on every call via its internal onDocument callback, so surfacing it here costs nothing extra.
const ConversionResultSchema = z.object({
  document: DocumentPayloadSchema,
  diagnostics: z.array(DiagnosticSchema),
  content: ContentDocumentSchema.optional(),
});

// The tree-form DocumentTree in the shape a dump carries it: stamped with its release-pinned $schema URI, which since document-schema.js 4 IS the artefact's version (the hand-kept formatVersion integer is gone). DocumentTreeSchema is a discriminated union and has no .extend, so the stamp rides in as an intersection -- the union validates the tree, the object validates the envelope's one extra key.
const DocumentTreeJsonSchema = DocumentTreeSchema.and(
  z.object({ $schema: z.string() }),
);

// markdown-codec carries a heading paragraph's level in the schema's own ContentParagraph.headingLevel field, so headings need no vocabulary rewrite -- only the residual private conventions are translated here: quote/code-block/horizontal-rule styleIds and a list paragraph's ordered-vs-bullet distinction encoded inside its numId string ("md{n}:bullet|ordered@start", via parseListNumId). Rewritten worker-side (the only place allowed to import markdown-codec) into a small convention this app documents and owns itself, so MarkdownPreview.tsx never needs to depend on markdown-codec's internal string formats -- only on what this router promises to hand it. Only ever applied to a markdown-sourced ContentDocument (see the convert handler's own call site below).
function normalizeMarkdownStyling(document: ContentDocument): ContentDocument {
  if (document.kind !== "wordprocessing") return document;
  return {
    ...document,
    sections: document.sections.map((section) => ({
      ...section,
      blocks: section.blocks.map(normalizeMarkdownBlock),
    })),
  };
}

// docx and odt heading paragraphs are identified primarily by the schema's ContentParagraph.headingLevel (docx: ooxml.js resolves w:outlineLvl through the style chain; odt: odf.js reads text:outline-level), with the "Heading1".."Heading6" styleId pattern as a fallback because the two signals have different coverage: a style NAMED "Heading3" can carry no outline level (caught only by the pattern), and a custom style can inherit an outline level while having a non-Heading name (caught only by the field). Rewritten here into the same "heading-{N}" convention normalizeMarkdownStyling produces. Blockquote and code-block styleIds are detected by heuristic name matching (docx: "Quote"/"IntenseQuote"; odt: "Quotations"; both: any styleId containing "Code"/"Source"/"Preformatted"), rewritten into the same "quote"/"code-block" convention markdown-codec uses. Horizontal rule is detected two different ways for the two formats, since they build the construct two different ways: odt matches LibreOffice/OpenOffice's built-in "Horizontal Line" paragraph style by its raw ODF style:name "Horizontal_20_Line" (ODF's predefined-style space-escaping convention, the same "_20_" Preformatted_20_Text/Heading_20_1 already use, matched heuristically here as any styleId containing both "Horizontal" and "Line" in case a producer spells it slightly differently); docx has no equivalent named style to match against at all -- Word's own AutoCorrect-inserted rule ("---" then Enter) is direct paragraph border formatting with no named style involved, so isBorderOnlyHorizontalRule below matches the SHAPE instead: an otherwise-empty paragraph whose only border formatting is a bottom edge (ExaDev/documents.js#1082's own ContentParagraph.borders field, added for exactly this). This shape match is generic across formats, so a border-only odt paragraph -- LibreOffice can produce one without going through the named "Horizontal Line" style too -- is caught the same way once odf.js's own reader populates ContentParagraph.borders from fo:border-* (ExaDev/documents.js#1086).
const WORDPROCESSING_HEADING_PATTERN = /^Heading([1-6])$/;

// The shape Word's own AutoCorrect produces for "---" + Enter: a paragraph with no visible text and a bottom border but no top/left/right border. Text is checked via the joined, trimmed run text rather than an empty runs array, since a real AutoCorrect-produced rule still carries the run(s) the "---" itself was typed into before AutoCorrect replaced the pilcrow's own formatting -- Word clears the text on replacement, but a producer that preserves a lone space or similar near-empty remnant should still read as a rule, not as accidental body text.
function isBorderOnlyHorizontalRule(paragraph: ContentParagraph): boolean {
  const borders = paragraph.borders;
  if (borders?.bottom === undefined) return false;
  if (borders.top !== undefined) return false;
  if (borders.left !== undefined) return false;
  if (borders.right !== undefined) return false;
  return (
    paragraph.runs
      .map((run) => run.text)
      .join("")
      .trim().length === 0
  );
}

function normalizeWordprocessingSemantics(
  document: ContentDocument,
): ContentDocument {
  if (document.kind !== "wordprocessing") return document;
  return {
    ...document,
    sections: document.sections.map((section) => ({
      ...section,
      blocks: section.blocks.map(normalizeWordprocessingBlock),
    })),
  };
}

function normalizeWordprocessingBlock(block: ContentBlock): ContentBlock {
  if (block.kind === "paragraph") {
    if (block.headingLevel !== undefined)
      return { ...block, styleId: `heading-${block.headingLevel}` };
    if (block.styleId !== undefined) {
      const headingMatch = WORDPROCESSING_HEADING_PATTERN.exec(block.styleId);
      if (headingMatch !== null)
        return { ...block, styleId: `heading-${headingMatch[1]}` };
      if (
        block.styleId.includes("Quote") ||
        block.styleId.includes("Quotation")
      ) {
        return { ...block, styleId: "quote" };
      }
      if (
        block.styleId.includes("Code") ||
        block.styleId.includes("Source") ||
        block.styleId.includes("Preformatted")
      ) {
        return { ...block, styleId: "code-block" };
      }
      if (
        block.styleId.includes("Horizontal") &&
        block.styleId.includes("Line")
      ) {
        return { ...block, styleId: "horizontal-rule" };
      }
    }
    if (isBorderOnlyHorizontalRule(block)) {
      return { ...block, styleId: "horizontal-rule" };
    }
    return block;
  }
  if (block.kind === "table") {
    return {
      ...block,
      rows: block.rows.map((row) => ({
        ...row,
        cells: row.cells.map((cell) => ({
          ...cell,
          blocks: cell.blocks.map(normalizeWordprocessingBlock),
        })),
      })),
    };
  }
  return block;
}

// docx list numIds are opaque w:numId values; the real ordered-vs-bullet info lives in NumberingDefinitions (readDocxExtras), keyed by the same numId. Resolved here into the "ordered:"/"bullet:" prefix convention markdown-codec and odf.js already use, so buildListForest can render <ol>/<ul> for every source.
function normalizeDocxListKinds(
  document: ContentDocument,
  bytes: Uint8Array<ArrayBuffer>,
): ContentDocument {
  if (document.kind !== "wordprocessing") return document;
  const extras = readDocxExtras(decodeDocumentPackage("docx", bytes));
  const resolve = (numId: string, level: number): string => {
    const format = extras.numbering[numId]?.levels[String(level)]?.format;
    return format === "bullet" || format === "none"
      ? `bullet:${numId}`
      : `ordered:${numId}`;
  };
  const walkBlock = (block: ContentBlock): ContentBlock => {
    if (block.kind === "paragraph" && block.list !== undefined) {
      // An absent numId means the source carried only a depth (ContentListMembership's own field comment -- no numbering definition exists to look up), so the membership passes through untouched rather than resolving against a fabricated identity.
      if (block.list.numId === undefined) return block;
      return {
        ...block,
        list: {
          ...block.list,
          numId: resolve(block.list.numId, block.list.level),
        },
      };
    }
    if (block.kind === "table") {
      return {
        ...block,
        rows: block.rows.map((row) => ({
          ...row,
          cells: row.cells.map((cell) => ({
            ...cell,
            blocks: cell.blocks.map(walkBlock),
          })),
        })),
      };
    }
    return block;
  };
  return {
    ...document,
    sections: document.sections.map((section) => ({
      ...section,
      blocks: section.blocks.map(walkBlock),
    })),
  };
}

// Dispatches source-format-specific ContentDocument normalization. Each branch rewrites format-specific styleId vocabulary into the app's own convention; formats with no private vocabulary (pdf, pptx, odp, etc.) pass through unchanged. bytes is needed only for docx list-kind resolution (readDocxExtras); other formats don't use it. Exported (this module is otherwise router-object-only, per the top-of-file note) purely so router.test.ts can exercise the normalization rules directly against plain ContentDocument fixtures, without round-tripping real docx/odt bytes through the full worker-only conversion path.
export function normalizeContentForSource(
  content: ContentDocument,
  source: DocumentFormat,
  bytes?: Uint8Array<ArrayBuffer>,
): ContentDocument {
  if (source === "markdown") return normalizeMarkdownStyling(content);
  if (source === "docx") {
    const normalized = normalizeWordprocessingSemantics(content);
    return bytes !== undefined
      ? normalizeDocxListKinds(normalized, bytes)
      : normalized;
  }
  if (source === "odt") return normalizeWordprocessingSemantics(content);
  return content;
}

function normalizeMarkdownBlock(block: ContentBlock): ContentBlock {
  if (block.kind === "paragraph") return normalizeMarkdownParagraph(block);
  if (block.kind === "table") {
    return {
      ...block,
      rows: block.rows.map((row) => ({
        ...row,
        cells: row.cells.map((cell) => ({
          ...cell,
          blocks: cell.blocks.map(normalizeMarkdownBlock),
        })),
      })),
    };
  }
  return block;
}

function normalizeMarkdownParagraph(
  paragraph: ContentParagraph,
): ContentParagraph {
  const styleId =
    paragraph.headingLevel !== undefined
      ? `heading-${paragraph.headingLevel}`
      : paragraph.styleId === QUOTE_STYLE_ID
        ? "quote"
        : paragraph.styleId === CODE_BLOCK_STYLE_ID
          ? "code-block"
          : paragraph.styleId === HORIZONTAL_RULE_STYLE_ID
            ? "horizontal-rule"
            : paragraph.styleId;
  // Preserves the original numId as a suffix (not just the ordered/bullet type alone) so MarkdownPreview can still tell where one list ends and the next begins -- markdown-codec mints a fresh numId per list instance, so two adjacent same-type lists must not collapse into one <ul>/<ol>. A membership with no numId at all carries only a depth (no list instance to identify), so it passes through unrewritten and buildListForest renders it with the neutral marker.
  const list =
    paragraph.list?.numId === undefined
      ? paragraph.list
      : {
          ...paragraph.list,
          numId: `${parseListNumId(paragraph.list.numId)?.type ?? "bullet"}:${paragraph.list.numId}`,
        };
  return { ...paragraph, styleId, list };
}

const ConversionPairSchema = z.object({
  source: DocumentFormatSchema,
  target: DocumentFormatSchema,
});

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
  format: z.enum(["png", "jpeg"]),
  widthPx: z.number().int().positive(),
  heightPx: z.number().int().positive(),
  byteLength: z.number().int().nonnegative(),
});

// Reuses LayoutDocumentSchema wholesale for pages/metadata/formatVersion -- only images is overridden, so the structure tree gets full real fidelity for everything except the one field with an unbounded payload.
const SanitizedLayoutDocumentSchema = LayoutDocumentSchema.extend({
  images: z.record(z.string(), SanitizedLayoutImageAssetSchema),
});

// Reads a ContentDocument directly from bytes, bypassing the conversion engine entirely -- no target build/encode, no PDF layout pass. Every format's standalone content reader is exported from documents.js (xlsx included since documents.js 2.0 -- before that, xlsx had to detour through the xlsx->ods bridge and read .content off the conversion result). markdown, csv, and svg are the plain-text formats: their readers take the decoded string, not a package, so each decodes its bytes up front the way markdown always has. wpd is the one read-only format (READ_ONLY_FORMATS): it has exactly this one direction to offer -- a preview is a genuine use of it, unlike a conversion target -- so it takes bytes directly, the same shape rtf uses. doc/xls/ppt/epub are genuine binary containers too ([MS-CFB] compound files for the first three, a zip archive for epub), not OPC packages, so -- like rtf/wpd -- they take bytes directly rather than going through decodeDocumentPackage below.
function readContentForFormat(
  format: DocumentFormat,
  bytes: Uint8Array<ArrayBuffer>,
): ContentDocument {
  if (format === "markdown")
    return readMarkdownContent(new TextDecoder().decode(bytes));
  if (format === "csv") return readCsvContent(new TextDecoder().decode(bytes));
  if (format === "svg") return readSvgContent(new TextDecoder().decode(bytes));
  if (format === "rtf") return readRtfContent(bytes).document;
  if (format === "wpd") return readWpdContent(bytes);
  if (format === "doc") return readDocContent(bytes);
  if (format === "xls") return readXlsContent(bytes);
  if (format === "ppt") return readPptContent(bytes);
  if (format === "epub") return readEpubContent(bytes);
  if (format === "pdf") throw new Error("PDF has no standalone content reader");
  const pkg = decodeDocumentPackage(format, bytes);
  switch (format) {
    case "docx":
      return readDocxContent(pkg);
    case "pptx":
      return readPptxContent(pkg);
    case "xlsx":
      return readXlsxContent(pkg);
    case "odt":
      return readOdtContent(pkg);
    case "odp":
      return readOdpContent(pkg);
    case "ods":
      return readOdsContent(pkg);
    case "odg":
      return readOdgContent(pkg);
    case "odf":
      return readOdfFormulaContent(pkg);
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

// One live editor session held in this module (the worker side of the oRPC boundary). The union is what the four paragraph-family editors genuinely share: docx/odt reach paragraphs through their body, markdown/doc through the editor itself -- one adapter function each way, no per-format branching inside the mutations.
type EditorSession =
  | { format: "docx"; editor: DocxEditor }
  | { format: "odt"; editor: OdtEditor }
  | { format: "doc"; editor: DocEditor }
  | { format: "markdown"; editor: MarkdownEditor };

const editorSessions = new Map<number, EditorSession>();
let nextEditorSessionId = 1;

const EditorSnapshotSchema = z.object({
  id: z.number().int().positive(),
  paragraphs: z.array(z.string()),
});

export function openEditorSession(
  format: EditorSession["format"],
  bytes: Uint8Array<ArrayBuffer>,
): EditorSession {
  switch (format) {
    case "docx":
      return { format, editor: openDocx(bytes) };
    case "odt":
      return { format, editor: openOdt(bytes) };
    case "doc":
      return { format, editor: openDoc(bytes) };
    case "markdown":
      return { format, editor: openMarkdown(decodeMarkdownText(bytes)) };
  }
}

// The structural slice of the paragraph-family handles the mutations drive. Each editor's own paragraph/run classes carry private state, which makes them mutually unassignable AS CLASS TYPES -- but assignability to this interface only checks its own members, and every one of the four exposes exactly these: run text get/set (DocxRun/OdtRun/MarkdownRun/DocRun all carry both), run remove, paragraph appendRun, paragraph remove, and the text getter.
interface EditorRunHandle {
  text: string;
  remove(): void;
}

interface EditorParagraphHandle {
  readonly text: string;
  runs(): EditorRunHandle[];
  appendRun(init?: { text?: string }): EditorRunHandle;
  remove(): void;
}

// The two access directions of the paragraph-family surface. Every editor class forwards paragraphs() itself; appendParagraph lives on the body for the three package-backed formats (docx/odt/markdown) and on the editor for doc -- each case narrows the session union to ONE class, since calling through a union of distinct classes requires their signatures to unify and the paragraph types deliberately do not.
export function paragraphsOf(session: EditorSession): EditorParagraphHandle[] {
  switch (session.format) {
    case "docx":
      return session.editor.paragraphs();
    case "odt":
      return session.editor.paragraphs();
    case "doc":
      return session.editor.paragraphs();
    case "markdown":
      return session.editor.paragraphs();
  }
}

export function appendParagraphOf(session: EditorSession, text: string): void {
  switch (session.format) {
    case "docx":
      session.editor.body.appendParagraph({ text });
      return;
    case "odt":
      session.editor.body.appendParagraph({ text });
      return;
    case "markdown":
      session.editor.body.appendParagraph({ text });
      return;
    case "doc":
      session.editor.appendParagraph({ text });
      return;
  }
}

export function paragraphTexts(session: EditorSession): string[] {
  return paragraphsOf(session).map((paragraph) => paragraph.text);
}

// The position-preserving text replacement the setParagraphText procedure drives: the first run takes the whole new text and the remaining runs leave the paragraph (run.remove() is the same live-view primitive every editor exposes). A paragraph with no runs at all gets one -- an empty w:p/text:p is legal in both XML formats.
export function setParagraphTextAt(
  session: EditorSession,
  index: number,
  text: string,
): void {
  const paragraph = paragraphsOf(session)[index];
  if (paragraph === undefined) {
    throw new Error(`no paragraph at index ${index}`);
  }
  const runs = paragraph.runs();
  if (runs.length === 0) {
    paragraph.appendRun({ text });
    return;
  }
  runs[0]!.text = text;
  for (const run of runs.slice(1)) {
    run.remove();
  }
}

function requireEditorSession(id: number): EditorSession {
  const session = editorSessions.get(id);
  if (session === undefined) {
    throw new Error(
      "no editor session with that id -- it may belong to a previous page load (sessions live in the worker for the app's lifetime but are not persisted)",
    );
  }
  return session;
}

export const router = {
  formats: {
    list: os
      .output(z.array(DocumentFormatSchema))
      .handler(() => [...DOCUMENT_FORMATS]),
    listConversions: os
      .output(z.array(ConversionPairSchema))
      .handler(() =>
        createLocalDocumentConverter().conversions.map((pair) => ({ ...pair })),
      ),
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
        {
          source: { format: input.source, bytes: input.bytes },
          targetFormat: input.targetFormat,
        },
        { signal: signal ?? new AbortController().signal },
      );
      const pkg = result.package;
      const content = pkg !== undefined ? flattenTree(pkg) : undefined;
      return {
        document: result.document,
        diagnostics: result.diagnostics.map((diagnostic) => ({
          ...diagnostic,
        })),
        content:
          content !== undefined
            ? normalizeContentForSource(content, input.source, input.bytes)
            : content,
      };
    }),

  content: {
    // Both encodings of the one document cross together: `content` is the flat codec-exchange ContentDocument the preview components render (readContentForFormat's own output, still the form every reader produces), `package` the same document in its artefact form -- assembleTree decomposes it into the tree and documentTreeWithSchema stamps the $schema URI that names its version. The tree is built from the raw read, not the normalised content below: normalizeContentForSource rewrites styleIds into this app's own preview-rendering conventions, and a dumped artefact must show the document as the reader actually produced it.
    read: os
      .input(z.object({ format: DocumentFormatSchema, bytes: BytesSchema }))
      .output(
        z.object({
          content: ContentDocumentSchema,
          package: DocumentTreeJsonSchema,
        }),
      )
      .handler(({ input }) => {
        const content = readContentForFormat(input.format, input.bytes);
        return {
          content: normalizeContentForSource(
            content,
            input.format,
            input.bytes,
          ),
          package: documentTreeWithSchema(assembleTree(content)),
        };
      }),

    // The restore half of the Package / JSON tool: a tree-form dump back into real bytes for its own format. The input is the raw edited JSON (z.unknown -- the tree schema lives this side of the worker boundary, where UI code may not import it), parsed and schema-validated here; an absent or edited-away $schema stamp is re-stamped after validation, so the dump's own artefact contract holds regardless of what the editor did to the text. buildDocumentBytes then takes the tree directly.
    restore: os
      .input(
        z.object({
          format: DocumentFormatSchema,
          package: z.unknown(),
        }),
      )
      .output(z.object({ bytes: BytesSchema }))
      .handler(({ input }) => ({
        bytes: buildDocumentBytes(
          documentTreeWithSchema(DocumentTreeSchema.parse(input.package)),
          input.format,
        ),
      })),
  },

  odb: {
    // The .odb browsing tool's one read: odf.js's front-end inventory (connection, table/query/form/report names) alongside the embedded engine's actual table data as a spreadsheet ContentDocument -- readOdbTables dispatches across every storage tier documents.js supports (HSQLDB text script, HSQLDB cached rows, Firebird gbak, HSQLDB binary/compressed scripts), so a caller never needs to know which engine the file used.
    read: os
      .input(z.object({ bytes: BytesSchema }))
      .output(
        z.object({
          inventory: z.object({
            connection: z
              .object({
                type: z.enum(["embedded", "external"]),
                driverClass: z.string().optional(),
                url: z.string().optional(),
              })
              .optional(),
            tables: z.array(z.string()),
            queries: z.array(
              z.object({
                name: z.string(),
                command: z.string(),
                escapeProcessing: z.boolean().optional(),
              }),
            ),
            forms: z.array(
              z.object({
                name: z.string(),
                href: z.string(),
                asTemplate: z.boolean().optional(),
              }),
            ),
            reports: z.array(
              z.object({
                name: z.string(),
                href: z.string(),
                asTemplate: z.boolean().optional(),
              }),
            ),
          }),
          content: ContentDocumentSchema,
        }),
      )
      .handler(({ input }) => {
        // odf.js's own decodePackage, re-exported: an .odb IS an ODF package, the identical parse step documents.js's own odbToXlsx uses.
        const pkg = parsePackage(input.bytes);
        return {
          inventory: readOdbInventory(pkg),
          content: odbTablesToSpreadsheetDocument(readOdbTables(pkg)),
        };
      }),
  },

  metadata: {
    read: os
      .input(z.object({ format: DocumentFormatSchema, bytes: BytesSchema }))
      .output(MetadataSchema)
      .handler(({ input, signal }) =>
        readDocumentMetadata(input.format, input.bytes, { signal }),
      ),

    write: os
      .input(
        z.object({
          sourceFormat: DocumentFormatSchema,
          targetFormat: DocumentFormatSchema,
          bytes: BytesSchema,
          // creator, like createdIso/modifiedIso/producer, is not an accepted MetadataOverrides field (documents.js's src/metadata/write.ts) -- it's read-only, not something a caller can set.
          overrides: MetadataSchema.omit({
            creator: true,
            createdIso: true,
            modifiedIso: true,
            producer: true,
          }),
        }),
      )
      .output(BytesSchema)
      .handler(({ input, signal }) =>
        setDocumentMetadata(
          input.sourceFormat,
          input.targetFormat,
          input.bytes,
          input.overrides,
          { signal },
        ),
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
        const images = Object.fromEntries(
          Object.entries(layout.images).map(([id, asset]) => [
            id,
            sanitizeImageAsset(asset),
          ]),
        );
        return {
          pageCount: layout.pages.length,
          itemKindCounts,
          metadata: layout.metadata,
          layout: {
            formatVersion: layout.formatVersion,
            metadata: layout.metadata,
            pages: layout.pages,
            images,
          },
        };
      }),
  },

  // The .odm rendering tool's one procedure. A master document's chapters are external .odt references by design (odf.js's reader never inlines them -- see odmToPdf's own module comment), so rendering in the browser means the user supplies the chapter files alongside the master. The hrefs a .odm names are relative paths ("../chapter1.odt"); the UI matches them against the picked files' basenames, and this procedure just resolves against whatever it was handed. OdmUnresolvedSectionError is a typed outcome rather than a thrown one: the error names EVERY unresolved href, which is exactly the list the UI needs to show the user ("add these files"), so it crosses the boundary as data.
  odm: {
    render: os
      .input(
        z.object({
          master: BytesSchema,
          chapters: z.array(z.object({ href: z.string(), bytes: BytesSchema })),
        }),
      )
      .output(
        z.union([
          z.object({ ok: z.literal(true), pdf: BytesSchema }),
          z.object({
            ok: z.literal(false),
            unresolved: z.array(z.string()),
          }),
        ]),
      )
      .handler(({ input }) => {
        const byHref = new Map(
          input.chapters.map((chapter) => [chapter.href, chapter.bytes]),
        );
        try {
          const pdf = odmToPdf(input.master, {
            resolveSubDocument: (href) => byHref.get(href),
          });
          return { ok: true as const, pdf };
        } catch (error) {
          if (error instanceof OdmUnresolvedSectionError) {
            return { ok: false as const, unresolved: [...error.hrefs] };
          }
          throw error;
        }
      }),
  },

  // The Editors tool. documents.js's live-view editors are stateful worker-side objects (every mutation edits the document in place -- the live-view contract), so the editing surface is a session: `open` holds the editor in this module's map and answers a paragraph snapshot, each mutation drives the live handles and answers a fresh snapshot (accessors re-read on every call, the same contract document-cli's TUI render loop follows), and `save` re-serialises the whole document through the format's own writer. The v1 surface is deliberately the operations every paragraph-family editor exposes identically -- list, edit text in place, append, remove, save -- so one UI drives docx, odt, doc, and markdown through the same five procedures with no per-format branch beyond opening.
  editor: {
    open: os
      .input(
        z.object({
          format: z.enum(["docx", "odt", "doc", "markdown"]),
          bytes: BytesSchema,
        }),
      )
      .output(EditorSnapshotSchema)
      .handler(({ input }) => {
        const session = openEditorSession(input.format, input.bytes);
        const id = nextEditorSessionId++;
        editorSessions.set(id, session);
        return { id, paragraphs: paragraphTexts(session) };
      }),

    setParagraphText: os
      .input(
        z.object({
          id: z.number().int().positive(),
          index: z.number().int().nonnegative(),
          text: z.string(),
        }),
      )
      .output(EditorSnapshotSchema)
      .handler(({ input }) => {
        const session = requireEditorSession(input.id);
        setParagraphTextAt(session, input.index, input.text);
        return { id: input.id, paragraphs: paragraphTexts(session) };
      }),

    addParagraph: os
      .input(
        z.object({
          id: z.number().int().positive(),
          text: z.string(),
        }),
      )
      .output(EditorSnapshotSchema)
      .handler(({ input }) => {
        const session = requireEditorSession(input.id);
        appendParagraphOf(session, input.text);
        return { id: input.id, paragraphs: paragraphTexts(session) };
      }),

    removeParagraph: os
      .input(
        z.object({
          id: z.number().int().positive(),
          index: z.number().int().nonnegative(),
        }),
      )
      .output(EditorSnapshotSchema)
      .handler(({ input }) => {
        const session = requireEditorSession(input.id);
        const paragraph = paragraphsOf(session)[input.index];
        if (paragraph === undefined) {
          throw new Error(`no paragraph at index ${input.index}`);
        }
        paragraph.remove();
        return { id: input.id, paragraphs: paragraphTexts(session) };
      }),

    save: os
      .input(z.object({ id: z.number().int().positive() }))
      .output(z.object({ bytes: BytesSchema }))
      .handler(({ input }) => {
        const session = requireEditorSession(input.id);
        // markdown's editor has no toBytes (its format is text, not a package) -- the byte boundary is encodeMarkdownText, the same stage every other markdown-consuming path here uses.
        const bytes =
          session.format === "markdown"
            ? encodeMarkdownText(session.editor.toMarkdownText())
            : session.editor.toBytes();
        return { bytes };
      }),
  },
};

export type AppRouter = typeof router;
