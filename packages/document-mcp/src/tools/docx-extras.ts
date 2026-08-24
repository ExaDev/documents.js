import type { McpServer } from "@modelcontextprotocol/server";
import { decodePackage, readDocxExtras } from "documents.js";
import { z } from "zod";
import {
  DocumentInputSchema,
  resolveDocumentInput,
} from "../io/document-input";

export function registerDocxExtrasTools(server: McpServer): void {
  server.registerTool(
    "docx_extras",
    {
      title: "Docx extras",
      description:
        "Reads a docx's own comments, footnotes, header/footer parts, and numbering definitions -- data documents.js's ContentDocument pivot cannot carry, so ordinary document-reading tools never see it. Returns the real DocxExtras object (comments/footnotes/headerFooterParts/sectionHeaderFooters/numbering) as structured data.",
      inputSchema: z.object({
        source: DocumentInputSchema.describe("The docx document to read."),
      }),
    },
    async ({ source }) => {
      const { bytes } = await resolveDocumentInput(source);
      const pkg = decodePackage(bytes);
      const extras = readDocxExtras(pkg);
      return {
        content: [{ type: "text", text: JSON.stringify(extras) }],
        structuredContent: extras,
      };
    },
  );
}
