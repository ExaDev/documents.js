import {
  CsvSheetNotFoundError,
  CsvSheetNotSpecifiedError,
  OdbNoEmbeddedDataSourceError,
  OdbReportNotSpecifiedError,
  OdbTableNotFoundError,
  OdbTableNotSpecifiedError,
  OdbUnsupportedFormatError,
  OdmUnresolvedSectionError,
  PdfEncryptedError,
  PdfParseError,
  SvgMultiPageNotSpecifiedError,
  SvgPageNotFoundError,
} from "documents.js";
import { describe, expect, it } from "vitest";
import {
  EXIT_INPUT_ERROR,
  EXIT_INTERRUPTED,
  EXIT_NEEDS_INFO,
  EXIT_TIMEOUT,
  mapErrorToExit,
} from "./exit-codes";

describe("mapErrorToExit", () => {
  it("maps an interrupt abort reason to EXIT_INTERRUPTED regardless of the thrown error", () => {
    expect(mapErrorToExit(new Error("aborted"), "interrupt")).toBe(
      EXIT_INTERRUPTED,
    );
  });

  it("maps a timeout abort reason to EXIT_TIMEOUT regardless of the thrown error", () => {
    expect(mapErrorToExit(new Error("aborted"), "timeout")).toBe(EXIT_TIMEOUT);
  });

  it("prefers the abort reason over a needs-info error class", () => {
    expect(
      mapErrorToExit(
        new OdmUnresolvedSectionError(["../chapter1.odt"]),
        "interrupt",
      ),
    ).toBe(EXIT_INTERRUPTED);
  });

  it("maps OdmUnresolvedSectionError to EXIT_NEEDS_INFO", () => {
    expect(
      mapErrorToExit(
        new OdmUnresolvedSectionError(["../chapter1.odt"]),
        undefined,
      ),
    ).toBe(EXIT_NEEDS_INFO);
  });

  it("maps OdbTableNotSpecifiedError to EXIT_NEEDS_INFO", () => {
    expect(
      mapErrorToExit(
        new OdbTableNotSpecifiedError(["CUSTOMERS", "ORDERS"]),
        undefined,
      ),
    ).toBe(EXIT_NEEDS_INFO);
  });

  it("maps OdbTableNotFoundError to EXIT_NEEDS_INFO", () => {
    expect(
      mapErrorToExit(
        new OdbTableNotFoundError("MISSING", ["CUSTOMERS"]),
        undefined,
      ),
    ).toBe(EXIT_NEEDS_INFO);
  });

  it("maps OdbNoEmbeddedDataSourceError to EXIT_NEEDS_INFO", () => {
    expect(
      mapErrorToExit(
        new OdbNoEmbeddedDataSourceError("jdbc:mysql://example"),
        undefined,
      ),
    ).toBe(EXIT_NEEDS_INFO);
  });

  it("maps OdbUnsupportedFormatError to EXIT_NEEDS_INFO", () => {
    expect(
      mapErrorToExit(
        new OdbUnsupportedFormatError(
          "unrecognised-engine",
          "no known embedded database engine detected",
        ),
        undefined,
      ),
    ).toBe(EXIT_NEEDS_INFO);
  });

  it("maps OdbReportNotSpecifiedError to EXIT_NEEDS_INFO", () => {
    expect(
      mapErrorToExit(
        new OdbReportNotSpecifiedError(["SalesByRegion", "StockByWarehouse"]),
        undefined,
      ),
    ).toBe(EXIT_NEEDS_INFO);
  });

  it("maps CsvSheetNotSpecifiedError to EXIT_NEEDS_INFO", () => {
    expect(
      mapErrorToExit(
        new CsvSheetNotSpecifiedError(["Sheet1", "Sheet2"]),
        undefined,
      ),
    ).toBe(EXIT_NEEDS_INFO);
  });

  it("maps CsvSheetNotFoundError to EXIT_NEEDS_INFO", () => {
    expect(
      mapErrorToExit(
        new CsvSheetNotFoundError("MISSING", ["Sheet1", "Sheet2"]),
        undefined,
      ),
    ).toBe(EXIT_NEEDS_INFO);
  });

  it("maps SvgMultiPageNotSpecifiedError to EXIT_NEEDS_INFO", () => {
    expect(
      mapErrorToExit(new SvgMultiPageNotSpecifiedError(3), undefined),
    ).toBe(EXIT_NEEDS_INFO);
  });

  it("maps SvgPageNotFoundError to EXIT_NEEDS_INFO", () => {
    expect(mapErrorToExit(new SvgPageNotFoundError(7, 3), undefined)).toBe(
      EXIT_NEEDS_INFO,
    );
  });

  it("maps PdfEncryptedError to EXIT_INPUT_ERROR", () => {
    expect(
      mapErrorToExit(new PdfEncryptedError("/Encrypt present"), undefined),
    ).toBe(EXIT_INPUT_ERROR);
  });

  it("maps PdfParseError to EXIT_INPUT_ERROR", () => {
    expect(
      mapErrorToExit(
        new PdfParseError("bad-xref", "malformed cross-reference table"),
        undefined,
      ),
    ).toBe(EXIT_INPUT_ERROR);
  });

  it("falls through to EXIT_INPUT_ERROR for an ordinary error with no abort reason", () => {
    expect(mapErrorToExit(new Error("ENOENT: no such file"), undefined)).toBe(
      EXIT_INPUT_ERROR,
    );
  });

  it("falls through to EXIT_INPUT_ERROR for a non-Error thrown value", () => {
    expect(mapErrorToExit("a string was thrown", undefined)).toBe(
      EXIT_INPUT_ERROR,
    );
  });
});
