import {
  createDocx,
  createMarkdownEditor,
  createOdg,
  createOdp,
  createOds,
  createOdt,
  createPdf,
  createPptx,
  decodeMarkdownText,
  encodeMarkdownText,
  openDocx,
  openMarkdown,
  openOdt,
  rgbHexToColor,
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
import { defineOperation } from "../operation";

const WRITABLE_FORMATS = [
  "docx",
  "pptx",
  "odt",
  "odp",
  "ods",
  "odg",
  "pdf",
  "markdown",
] as const;
const WritableFormatSchema = z.enum(WRITABLE_FORMATS);
type WritableFormat = z.infer<typeof WritableFormatSchema>;

// Every field docx's and odt's own RunInit/ParagraphInit accept (identical shapes in both -- see edit/docx/run.ts and edit/odt/run.ts), plus markdown's own divergent extras (hyperlink, code) validated as unsupported outside markdown below rather than silently dropped. There is deliberately no separate pptx/odp/ods/odg paragraph-append operation here: this first editor surface covers only the wordprocessing paragraph/run family (docx/odt/markdown) -- slide/sheet/drawing editing is real remaining scope, tracked separately.
const RunSchema = z.object({
  text: z.string().optional().describe("The run's own text content."),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  strike: z.boolean().optional(),
  underline: z.boolean().optional().describe("docx/odt only."),
  fontFamily: z.string().optional().describe("docx/odt only."),
  sizePt: z.number().positive().optional().describe("docx/odt only."),
  colorHex: z
    .string()
    .regex(/^#?[0-9a-fA-F]{6}$/)
    .optional()
    .describe(
      "6-digit hex colour (e.g. 'ff0000' or '#ff0000'). docx/odt only.",
    ),
  hyperlink: z.string().optional().describe("markdown only."),
  code: z
    .boolean()
    .optional()
    .describe("markdown only -- renders the run as an inline code span."),
});
type RunInput = z.infer<typeof RunSchema>;

const ParagraphSchema = z.object({
  text: z
    .string()
    .optional()
    .describe(
      "Plain paragraph text, as a single run. Omit and use `runs` instead for mixed formatting within one paragraph.",
    ),
  styleId: z.string().optional(),
  headingLevel: z
    .number()
    .int()
    .min(1)
    .max(6)
    .optional()
    .describe("docx/odt only."),
  alignment: z
    .enum(["left", "center", "right", "justify"])
    .optional()
    .describe("docx/odt only."),
  runs: z
    .array(RunSchema)
    .optional()
    .describe(
      "Runs to append to this paragraph, each with its own formatting. Combine with `text` for a paragraph that opens with plain text before its first formatted run, or omit `text` entirely for a paragraph built purely from runs.",
    ),
});
type ParagraphInput = z.infer<typeof ParagraphSchema>;

// Fields present on `input` that `unsupported` names as not valid for the current target format -- reported together in one error rather than one at a time, so a caller sees every field to remove in a single round trip instead of fixing them one rejection at a time.
function unsupportedFieldNames(
  input: Record<string, unknown>,
  unsupported: readonly string[],
): string[] {
  return unsupported.filter((key) => input[key] !== undefined);
}

function rejectUnsupportedFields(
  input: Record<string, unknown>,
  unsupported: readonly string[],
  formatLabel: string,
  context: string,
): void {
  const present = unsupportedFieldNames(input, unsupported);
  if (present.length > 0) {
    throw new Error(
      `${context} does not support ${present.join(", ")} for ${formatLabel} -- remove ${present.length === 1 ? "it" : "them"} or target docx/odt instead.`,
    );
  }
}

const DOCX_ODT_UNSUPPORTED_RUN_FIELDS: readonly (keyof RunInput)[] = [
  "hyperlink",
  "code",
];
const MARKDOWN_UNSUPPORTED_RUN_FIELDS: readonly (keyof RunInput)[] = [
  "underline",
  "fontFamily",
  "sizePt",
  "colorHex",
];
const MARKDOWN_UNSUPPORTED_PARAGRAPH_FIELDS: readonly (keyof ParagraphInput)[] =
  ["headingLevel", "alignment"];

interface WordprocessingParagraph {
  appendRun(init: {
    readonly text?: string;
    readonly bold?: boolean;
    readonly italic?: boolean;
    readonly underline?: boolean;
    readonly strike?: boolean;
    readonly fontFamily?: string;
    readonly sizePt?: number;
    readonly color?: ReturnType<typeof rgbHexToColor>;
  }): unknown;
}

interface WordprocessingBody {
  appendParagraph(init: {
    readonly text?: string;
    readonly styleId?: string;
    readonly headingLevel?: number;
    readonly alignment?: "left" | "center" | "right" | "justify";
  }): WordprocessingParagraph;
}

function appendDocxOdtRun(
  paragraph: WordprocessingParagraph,
  run: RunInput,
): void {
  rejectUnsupportedFields(
    run,
    DOCX_ODT_UNSUPPORTED_RUN_FIELDS,
    "docx/odt",
    "A run",
  );
  paragraph.appendRun({
    text: run.text,
    bold: run.bold,
    italic: run.italic,
    underline: run.underline,
    strike: run.strike,
    fontFamily: run.fontFamily,
    sizePt: run.sizePt,
    color: run.colorHex === undefined ? undefined : rgbHexToColor(run.colorHex),
  });
}

function appendDocxOdtParagraphs(
  body: WordprocessingBody,
  paragraphs: readonly ParagraphInput[],
): void {
  for (const paragraph of paragraphs) {
    const built = body.appendParagraph({
      text: paragraph.text,
      styleId: paragraph.styleId,
      headingLevel: paragraph.headingLevel,
      alignment: paragraph.alignment,
    });
    for (const run of paragraph.runs ?? []) {
      appendDocxOdtRun(built, run);
    }
  }
}

interface MarkdownWordprocessingParagraph {
  appendRun(init: {
    readonly text?: string;
    readonly bold?: boolean;
    readonly italic?: boolean;
    readonly strike?: boolean;
    readonly hyperlink?: string;
    readonly code?: boolean;
  }): unknown;
}

interface MarkdownWordprocessingBody {
  appendParagraph(init: {
    readonly text?: string;
    readonly styleId?: string;
  }): MarkdownWordprocessingParagraph;
}

function appendMarkdownParagraphs(
  body: MarkdownWordprocessingBody,
  paragraphs: readonly ParagraphInput[],
): void {
  for (const paragraph of paragraphs) {
    rejectUnsupportedFields(
      paragraph,
      MARKDOWN_UNSUPPORTED_PARAGRAPH_FIELDS,
      "markdown",
      "A paragraph",
    );
    const built = body.appendParagraph({
      text: paragraph.text,
      styleId: paragraph.styleId,
    });
    for (const run of paragraph.runs ?? []) {
      rejectUnsupportedFields(
        run,
        MARKDOWN_UNSUPPORTED_RUN_FIELDS,
        "markdown",
        "A run",
      );
      built.appendRun({
        text: run.text,
        bold: run.bold,
        italic: run.italic,
        strike: run.strike,
        hyperlink: run.hyperlink,
        code: run.code,
      });
    }
  }
}

function createDocumentBytes(format: WritableFormat): Uint8Array<ArrayBuffer> {
  switch (format) {
    case "docx":
      return createDocx().toBytes();
    case "pptx":
      return createPptx().toBytes();
    case "odt":
      return createOdt().toBytes();
    case "odp":
      return createOdp().toBytes();
    case "ods":
      return createOds().toBytes();
    case "odg":
      return createOdg().toBytes();
    case "pdf":
      return createPdf().toBytes();
    case "markdown":
      return encodeMarkdownText(createMarkdownEditor().toMarkdownText());
  }
}

const ResolvedDocumentOutputSchema = z.union([
  z.object({ path: z.string(), byteLength: z.number() }),
  z.object({
    bytesBase64: z.string(),
    byteLength: z.number(),
    large: z.literal(true).optional(),
  }),
]);

const DocumentCreateInputSchema = z.object({
  format: WritableFormatSchema.describe("The format of document to create."),
  output: DocumentOutputSchema.optional().describe(
    "Where to write the created document. Omit entirely to receive the bytes inline, base64-encoded.",
  ),
});

export const documentCreateOperation = defineOperation({
  name: "document_create",
  title: "Create a blank document",
  description:
    "Creates a fresh, blank document in the given format via documents.js's own live-view editors (createDocx/createOdt/createMarkdownEditor/...), the same construction document_append_paragraphs's own edit calls build on. Returns an empty document with no content -- follow with document_append_paragraphs (docx/odt/markdown) to add text.",
  inputSchema: DocumentCreateInputSchema,
  outputSchema: ResolvedDocumentOutputSchema,
  async run({ format, output }) {
    const bytes = createDocumentBytes(format);
    return resolveDocumentOutput(bytes, output ?? {});
  },
});

const DocumentAppendParagraphsInputSchema = z.object({
  source: DocumentInputSchema.describe("The document to append paragraphs to."),
  targetFormat: z
    .enum(["docx", "odt", "markdown"])
    .describe(
      "Must match the source document's own format. document_append_paragraphs never converts format.",
    ),
  paragraphs: z
    .array(ParagraphSchema)
    .min(1)
    .describe("The paragraphs to append, in order."),
  output: DocumentOutputSchema.optional().describe(
    "Where to write the edited document. Omit entirely to receive the bytes inline, base64-encoded.",
  ),
});

export const documentAppendParagraphsOperation = defineOperation({
  name: "document_append_paragraphs",
  title: "Append paragraphs to a wordprocessing document",
  description:
    "Appends one or more paragraphs -- each optionally built from several independently-formatted runs -- to the end of a docx, odt, or markdown document, through documents.js's own live-view editors (the same DocxBody.appendParagraph/OdtBody.appendParagraph/MarkdownBody.appendParagraph document-cli's own TUI uses). Does not convert format -- the source document's own format and targetFormat must match. docx and odt share an identical field set (underline, fontFamily, sizePt, colorHex, headingLevel, alignment all supported); markdown supports a different, smaller set (hyperlink, code) and rejects the docx/odt-only fields outright rather than silently dropping them. This covers wordprocessing paragraph/run editing only -- slides, sheets, drawings, tables, lists, and images are a separate, larger editing surface not exposed here yet.",
  inputSchema: DocumentAppendParagraphsInputSchema,
  outputSchema: ResolvedDocumentOutputSchema,
  async run({ source, targetFormat, paragraphs, output }) {
    const { bytes, format } = await resolveDocumentInput(source);
    if (format !== targetFormat) {
      throw new Error(
        `source document is "${format}", but targetFormat is "${targetFormat}" -- document_append_paragraphs never converts format, so the two must match.`,
      );
    }
    let resultBytes: Uint8Array<ArrayBuffer>;
    if (targetFormat === "markdown") {
      const editor = openMarkdown(decodeMarkdownText(bytes));
      appendMarkdownParagraphs(editor.body, paragraphs);
      resultBytes = encodeMarkdownText(editor.toMarkdownText());
    } else {
      const editor = targetFormat === "docx" ? openDocx(bytes) : openOdt(bytes);
      appendDocxOdtParagraphs(editor.body, paragraphs);
      resultBytes = editor.toBytes();
    }
    return resolveDocumentOutput(resultBytes, output ?? {});
  },
});
