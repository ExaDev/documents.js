import type { McpServer } from "@modelcontextprotocol/server";
import { readPdf, type LayoutImageAsset, type LayoutItem } from "documents.js";
import { z } from "zod";
import {
  DocumentInputSchema,
  resolveDocumentInput,
} from "../io/document-input";

// Ported from document-cli's src/commands/pdf-inspect.ts -- counts each LayoutItem's own `kind` across a page's items, for the summary mode's per-page histogram.
function buildItemKindHistogram(
  items: readonly LayoutItem[],
): Map<LayoutItem["kind"], number> {
  const histogram = new Map<LayoutItem["kind"], number>();
  for (const item of items) {
    histogram.set(item.kind, (histogram.get(item.kind) ?? 0) + 1);
  }
  return histogram;
}

// Ported from document-cli's src/commands/pdf-inspect.ts -- counts each embedded image asset's own `format` across the whole LayoutDocument.images record, for the summary mode's imagesByFormat count.
function countImagesByFormat(
  images: Readonly<Record<string, LayoutImageAsset>>,
): Map<LayoutImageAsset["format"], number> {
  const counts = new Map<LayoutImageAsset["format"], number>();
  for (const asset of Object.values(images)) {
    counts.set(asset.format, (counts.get(asset.format) ?? 0) + 1);
  }
  return counts;
}

export function registerPdfInspectTools(server: McpServer): void {
  server.registerTool(
    "pdf_inspect",
    {
      title: "Inspect PDF",
      description:
        "Parses a PDF (documents.js's readPdf) and reports a summary: page count, each page's own size and item-kind histogram, document metadata, and embedded image formats. Pass full: true to return the entire parsed LayoutDocument instead of a summary.",
      inputSchema: z.object({
        source: DocumentInputSchema.describe("The PDF document to inspect."),
        full: z
          .boolean()
          .optional()
          .describe(
            "When true, return the entire parsed LayoutDocument instead of a summary. Defaults to false.",
          ),
      }),
    },
    async ({ source, full }, ctx) => {
      const { signal } = ctx.mcpReq;
      const { bytes, format } = await resolveDocumentInput(source, { signal });
      if (format !== "pdf") {
        throw new Error(
          `pdf_inspect requires a PDF document, received a "${format}" document instead.`,
        );
      }
      const layout = readPdf(bytes, { signal });

      if (full === true) {
        // Returned as-is, no $schema tagging: the layout-document schema family moved from document-schema.js to pdf-codec in the schema-4 major (ExaDev/pdf-codec#65), and pdf-codec publishes no .schema.json URI to stamp -- the value's own formatVersion literal (still 1) is its version marker.
        return {
          content: [{ type: "text", text: JSON.stringify(layout) }],
          structuredContent: layout,
        };
      }

      const summary = {
        pageCount: layout.pages.length,
        pages: layout.pages.map((page) => ({
          widthPt: page.widthPt,
          heightPt: page.heightPt,
          itemKinds: Object.fromEntries(buildItemKindHistogram(page.items)),
        })),
        metadata: layout.metadata,
        imagesByFormat: Object.fromEntries(countImagesByFormat(layout.images)),
      };
      return {
        content: [{ type: "text", text: JSON.stringify(summary) }],
        structuredContent: summary,
      };
    },
  );
}
