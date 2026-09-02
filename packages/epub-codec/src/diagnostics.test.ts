import { describe, expect, it } from "vitest";
import {
  EpubEmptySpineError,
  EpubInvalidContainerError,
  EpubInvalidMimetypeError,
  EpubInvalidOpfError,
  EpubPackageFlattenError,
  EpubUnbalancedConstructMarkersError,
  EpubUnsupportedDocumentKindError,
  NOOP_EPUB_DIAGNOSTIC_SINK,
} from "./diagnostics";

describe("NOOP_EPUB_DIAGNOSTIC_SINK", () => {
  it("discards a diagnostic without throwing", () => {
    expect(() => {
      NOOP_EPUB_DIAGNOSTIC_SINK({
        code: "epub/example",
        severity: "info",
        message: "example",
      });
    }).not.toThrow();
  });
});

describe("error classes", () => {
  it("EpubInvalidMimetypeError carries a stable code and default message", () => {
    const error = new EpubInvalidMimetypeError();
    expect(error.code).toBe("epub/invalid-mimetype");
    expect(error.name).toBe("EpubInvalidMimetypeError");
    expect(error).toBeInstanceOf(Error);
  });

  it("EpubInvalidContainerError carries a stable code", () => {
    expect(new EpubInvalidContainerError().code).toBe("epub/invalid-container");
  });

  it("EpubInvalidOpfError carries a stable code and a caller message", () => {
    const error = new EpubInvalidOpfError("no <package> root element");
    expect(error.code).toBe("epub/invalid-opf");
    expect(error.message).toBe("no <package> root element");
  });

  it("EpubEmptySpineError carries a stable code", () => {
    expect(new EpubEmptySpineError().code).toBe("epub/empty-spine");
  });

  it("EpubUnsupportedDocumentKindError names the offending kind", () => {
    const error = new EpubUnsupportedDocumentKindError("spreadsheet");
    expect(error.code).toBe("epub/write-side-not-wordprocessing");
    expect(error.kind).toBe("spreadsheet");
  });

  it("EpubUnbalancedConstructMarkersError describes an unmatchedEnd", () => {
    const error = new EpubUnbalancedConstructMarkersError("unmatchedEnd", 3);
    expect(error.code).toBe("epub/unbalanced-construct-markers");
    expect(error.imbalanceKind).toBe("unmatchedEnd");
    expect(error.blockIndex).toBe(3);
    expect(error.message).toContain("index 3");
  });

  it("EpubUnbalancedConstructMarkersError describes an unclosedStart", () => {
    const error = new EpubUnbalancedConstructMarkersError("unclosedStart", 0);
    expect(error.message).toContain("never closed");
  });

  it("EpubPackageFlattenError wraps a thrown cause's message", () => {
    const error = new EpubPackageFlattenError(new Error("no such style ref"));
    expect(error.code).toBe("epub/package-flatten-failed");
    expect(error.message).toContain("no such style ref");
  });

  it("EpubPackageFlattenError stringifies a non-Error cause", () => {
    const error = new EpubPackageFlattenError("plain string cause");
    expect(error.message).toContain("plain string cause");
  });
});
