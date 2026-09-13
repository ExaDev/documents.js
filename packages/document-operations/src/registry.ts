import type { DocumentOperation } from "./operation";
import {
  convertDocumentOperation,
  listDocumentConversionsOperation,
} from "./operations/convert";
import { computeFormulaOperation } from "./operations/compute-formula";
import { docxExtrasOperation } from "./operations/docx-extras";
import {
  documentAppendParagraphsOperation,
  documentCreateOperation,
} from "./operations/editor";
import { describeFontFileOperation, fontsOperation } from "./operations/fonts";
import { fromPackageOperation } from "./operations/from-package";
import {
  metadataReadOperation,
  metadataWriteOperation,
} from "./operations/metadata";
import {
  odbFormsOperation,
  odbQueryOperation,
  odbReportsOperation,
  odbTablesOperation,
  odbToCsvOperation,
  odbToXlsxOperation,
} from "./operations/odb";
import { odbRenderReportOperation } from "./operations/odb-render-report";
import { odmToPdfOperation } from "./operations/odm";
import { outlineDocumentOperation } from "./operations/outline";
import { pdfInspectOperation } from "./operations/pdf-inspect";

/**
 * Every document operation this package defines, one entry per MCP tool/CLI command/REST route -- "the same registry as the MCP" a consumer that needs to enumerate every operation (rather than importing one by name) reaches for: an MCP server registers each entry as a tool, a REST server adds one route per entry, and a CLI can validate its own parsed flags against an entry's inputSchema before dispatching to its run().
 */
export const DOCUMENT_OPERATIONS: readonly DocumentOperation[] = [
  convertDocumentOperation,
  listDocumentConversionsOperation,
  metadataReadOperation,
  metadataWriteOperation,
  documentCreateOperation,
  documentAppendParagraphsOperation,
  fontsOperation,
  describeFontFileOperation,
  docxExtrasOperation,
  fromPackageOperation,
  outlineDocumentOperation,
  pdfInspectOperation,
  computeFormulaOperation,
  odmToPdfOperation,
  odbTablesOperation,
  odbFormsOperation,
  odbReportsOperation,
  odbQueryOperation,
  odbToCsvOperation,
  odbToXlsxOperation,
  odbRenderReportOperation,
];
