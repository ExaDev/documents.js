import { decodePackage, readDocxExtras } from "documents.js";
import { z } from "zod";
import {
  DocumentInputSchema,
  resolveDocumentInput,
} from "../io/document-input";
import { defineOperationWithoutOutputSchema } from "../operation";

const DocxExtrasInputSchema = z.object({
  source: DocumentInputSchema.describe("The docx document to read."),
});

// No outputSchema, matching the original MCP tool registration -- readDocxExtras's own DocxExtras return type is the contract, without an independently-maintained Zod mirror that could drift from it.
export const docxExtrasOperation = defineOperationWithoutOutputSchema<
  typeof DocxExtrasInputSchema,
  ReturnType<typeof readDocxExtras>
>({
  name: "docx_extras",
  title: "Docx extras",
  description:
    "Reads a docx's own comments, footnotes, header/footer parts, and numbering definitions -- data documents.js's ContentDocument pivot cannot carry, so ordinary document-reading operations never see it. Returns the real DocxExtras object (comments/footnotes/headerFooterParts/sectionHeaderFooters/numbering) as structured data.",
  inputSchema: DocxExtrasInputSchema,
  async run({ source }) {
    const { bytes } = await resolveDocumentInput(source);
    const pkg = decodePackage(bytes);
    return readDocxExtras(pkg);
  },
});
