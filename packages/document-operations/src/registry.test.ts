import { describe, expect, it } from "vitest";
import { computeFormulaOperation } from "./operations/compute-formula";
import {
  convertDocumentOperation,
  listDocumentConversionsOperation,
} from "./operations/convert";
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
import { DOCUMENT_OPERATIONS } from "./registry";

// Every operation this package defines, independent of registry.ts's own import list, so this test still catches a real omission rather than trivially re-deriving the same list from the same imports.
const EXPECTED_OPERATIONS = [
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

describe("DOCUMENT_OPERATIONS", () => {
  it("lists every operation the package defines exactly once, by identity", () => {
    expect(DOCUMENT_OPERATIONS).toHaveLength(EXPECTED_OPERATIONS.length);
    for (const operation of EXPECTED_OPERATIONS) {
      expect(DOCUMENT_OPERATIONS).toContain(operation);
    }
  });

  it("declares no two operations sharing the same name", () => {
    const names = DOCUMENT_OPERATIONS.map((operation) => operation.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
