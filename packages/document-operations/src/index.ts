export type { DocumentOperation, DocumentOperationContext } from "./operation";
export {
  defineOperation,
  defineOperationWithoutOutputSchema,
} from "./operation";
export { DOCUMENT_OPERATIONS } from "./registry";

export {
  DocumentInputSchema,
  inferFormatFromExtension,
  resolveDocumentInput,
  type DocumentInput,
  type ResolvedDocumentInput,
} from "./io/document-input";
export {
  DocumentOutputSchema,
  LARGE_RESULT_THRESHOLD_BYTES,
  resolveDocumentOutput,
  type DocumentOutput,
  type InlineDocumentOutput,
  type ResolvedDocumentOutput,
  type WrittenDocumentOutput,
} from "./io/document-output";

export {
  ComputeFormulaOutputSchema,
  computeFormulaOperation,
} from "./operations/compute-formula";
export {
  ConvertDocumentOutputSchema,
  FontInputSchema,
  ListDocumentConversionsOutputSchema,
  convertDocumentOperation,
  listDocumentConversionsOperation,
} from "./operations/convert";
export { docxExtrasOperation } from "./operations/docx-extras";
export {
  documentAppendParagraphsOperation,
  documentCreateOperation,
} from "./operations/editor";
export { describeFontFileOperation, fontsOperation } from "./operations/fonts";
export { fromPackageOperation } from "./operations/from-package";
export {
  metadataReadOperation,
  metadataWriteOperation,
} from "./operations/metadata";
export {
  odbFormsOperation,
  odbQueryOperation,
  odbReportsOperation,
  odbTablesOperation,
  odbToCsvOperation,
  odbToXlsxOperation,
  resolveOdbBytes,
} from "./operations/odb";
export {
  OdbRenderReportOutputSchema,
  odbRenderReportOperation,
} from "./operations/odb-render-report";
export { OdmToPdfOutputSchema, odmToPdfOperation } from "./operations/odm";
export { outlineDocumentOperation } from "./operations/outline";
export { pdfInspectOperation } from "./operations/pdf-inspect";
