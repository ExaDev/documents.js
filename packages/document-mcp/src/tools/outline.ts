import type { McpServer } from "@modelcontextprotocol/server";
import {
  buildOutline,
  isOutlineNode,
  outlineLeafText,
  type OutlineChild,
  type OutlineLeaf,
} from "document-outline.js";
import {
  createLocalDocumentConverter,
  type DocumentFormat,
} from "documents.js";
import { z } from "zod";
import {
  DocumentInputSchema,
  resolveDocumentInput,
} from "../io/document-input";

// The outline tool needs the source's own content tree, and documents.js exposes no format-dispatch content reader at its barrel -- the DocumentConverter port is the one generic entry that reads any source format and reports the tree-form DocumentTree on ConversionResult.package. The conversion target is therefore an internal detail, and it must preserve the source's content kind: a projection conversion (docx-to-csv renders a spreadsheet package for a wordprocessing source) would outline the projection, not the document. Each source below gets a deterministic same-content-kind target that also avoids a PDF layout pass wherever the matrix allows one -- the exceptions are structural: odf's only conversion is to pdf (the package is formula-kind, pages populated by the one layout an odf can run); odg also routes to pdf, since documents.js's SVG writer refuses a multi-page document (buildSvgText throws SvgMultiPageNotSpecifiedError past one page) and an odg source is not bounded to one page, so pdf is the only target in the matrix that stays same-content-kind ('drawing') without that ceiling; and a pdf source's content view IS the reconstruction, a read of the layout it already records rather than a new layout pass.
const OUTLINE_PROBE_TARGETS: Record<DocumentFormat, DocumentFormat> = {
  csv: "ods",
  docx: "odt",
  epub: "docx",
  odf: "pdf",
  odg: "pdf",
  odt: "docx",
  odp: "pptx",
  ods: "xlsx",
  markdown: "docx",
  pdf: "docx",
  pptx: "odp",
  svg: "odg",
  xlsx: "ods",
};

// A group the MCP client renders: buildOutline's own OutlineNode label and source level signal, with children already nested (a client must render indentation from the nesting, never from `level`, which rides the source format's own scale -- heading levels are 1-based, list levels 0-based, and the synthetic per-slide/sheet/page groups are level 1).
interface OutlineGroupJson {
  text: string;
  level: number;
  children: OutlineChildJson[];
}

// A leaf the MCP client renders: the payload's own kind plus its text (document-outline.js's outlineLeafText -- the same label extraction the Markdown renderer's TOC uses), with the full content payload dropped -- a TOC entry is a label, and shipping every run, style ref, and frame would price a modest document at the whole tree.
type OutlineChildJson = OutlineGroupJson | { kind: string; text: string };

// A leaf's class label. Most leaves carry the schema's own kind literal, but two do not -- a formula (identified structurally by its mathml payload) and a sheet-anchored embedded object (the standalone ContentEmbeddedObject, not the block-level wrapper that reuses kind 'embeddedObject') -- so the label falls back to structural discrimination, the same idiom document-outline.js's own outlineLeafText uses, and the fallthrough after both checks is exactly the standalone embedded object the union has left.
function leafKind(leaf: OutlineLeaf): string {
  if ("kind" in leaf) return leaf.kind;
  if ("mathml" in leaf) return "formula";
  return "embeddedObject";
}

function toOutlineJson(children: readonly OutlineChild[]): OutlineChildJson[] {
  return children.map((child) =>
    isOutlineNode(child)
      ? {
          text: child.text,
          level: child.level,
          children: toOutlineJson(child.children),
        }
      : { kind: leafKind(child), text: outlineLeafText(child) },
  );
}

export function registerOutlineTools(server: McpServer): void {
  // A fresh DocumentConverter per registration, not per call, sharing convert_document's own reasoning: createLocalDocumentConverter() is a plain stateless dispatch table, and both tools see the identical conversion matrix.
  const converter = createLocalDocumentConverter();

  server.registerTool(
    "outline_document",
    {
      title: "Outline document",
      description:
        "Projects a document's table of contents as a structured outline: reads the source through documents.js's DocumentConverter port, takes the tree-form DocumentTree the conversion reports, and runs document-outline.js's buildOutline over it. Groups carry { text, level, children } (a heading's, list item's, slide's, sheet's, or page's own label plus nested children); leaves carry { kind, text }. The outline is over the source's own content -- the internal conversion target preserves it and is pdf only for odf (the one format that only converts to pdf) and odg (whose alternative, svg, cannot represent more than one page).",
      inputSchema: z.object({
        source: DocumentInputSchema.describe("The document to outline."),
      }),
    },
    async ({ source }, ctx) => {
      const { signal } = ctx.mcpReq;
      const { bytes, format } = await resolveDocumentInput(source, { signal });
      const targetFormat = OUTLINE_PROBE_TARGETS[format];

      const result = await converter.convert(
        { source: { format, bytes }, targetFormat },
        { signal },
      );

      // ConversionResult.package is optional at the type level; every documents.js 3 conversion fires onDocument, so this names a real absence rather than papering over one.
      const pkg = result.package;
      if (pkg === undefined) {
        throw new Error(
          `the ${format}-to-${targetFormat} conversion reported no DocumentTree, so there is no tree to outline`,
        );
      }

      const structuredContent = {
        sourceFormat: format,
        kind: pkg.kind,
        outline: toOutlineJson(buildOutline(pkg)),
      };
      return {
        content: [{ type: "text", text: JSON.stringify(structuredContent) }],
        structuredContent,
      };
    },
  );
}
