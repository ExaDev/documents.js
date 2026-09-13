import { describe, expect, it } from "vitest";
import {
  EpubEmptySpineError,
  EpubInvalidContainerError,
  EpubInvalidMimetypeError,
  EpubInvalidOpfError,
  EpubPackageFlattenError,
  EpubParseError,
  EpubUnbalancedConstructMarkersError,
  EpubUnsupportedDocumentKindError,
  EpubWriteError,
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
  it("EpubParseError names itself directly, when constructed rather than through a subclass", () => {
    const error = new EpubParseError("epub/example", "an example message");
    expect(error.name).toBe("EpubParseError");
    expect(error.code).toBe("epub/example");
    expect(error.message).toBe("an example message");
  });

  it("EpubWriteError names itself directly, when constructed rather than through a subclass", () => {
    const error = new EpubWriteError("epub/example", "an example message");
    expect(error.name).toBe("EpubWriteError");
    expect(error.code).toBe("epub/example");
    expect(error.message).toBe("an example message");
  });

  it("EpubInvalidMimetypeError carries a stable code, name, and default message", () => {
    const error = new EpubInvalidMimetypeError();
    expect(error.code).toBe("epub/invalid-mimetype");
    expect(error.name).toBe("EpubInvalidMimetypeError");
    expect(error.message).toBe(
      'the zip\'s first entry is not a stored "mimetype" entry containing exactly "application/epub+zip"',
    );
    expect(error).toBeInstanceOf(Error);
  });

  it("EpubInvalidContainerError carries a stable code, name, and default message", () => {
    const error = new EpubInvalidContainerError();
    expect(error.code).toBe("epub/invalid-container");
    expect(error.name).toBe("EpubInvalidContainerError");
    expect(error.message).toBe(
      "META-INF/container.xml is missing or names no OPF rootfile",
    );
  });

  it("EpubInvalidOpfError carries a stable code, name, and a caller message", () => {
    const error = new EpubInvalidOpfError("no <package> root element");
    expect(error.code).toBe("epub/invalid-opf");
    expect(error.name).toBe("EpubInvalidOpfError");
    expect(error.message).toBe("no <package> root element");
  });

  it("EpubEmptySpineError carries a stable code, name, and default message", () => {
    const error = new EpubEmptySpineError();
    expect(error.code).toBe("epub/empty-spine");
    expect(error.name).toBe("EpubEmptySpineError");
    expect(error.message).toBe(
      "the spine names no resolvable, readable content",
    );
  });

  it("EpubUnsupportedDocumentKindError names the offending kind", () => {
    const error = new EpubUnsupportedDocumentKindError("spreadsheet");
    expect(error.code).toBe("epub/write-side-not-wordprocessing");
    expect(error.name).toBe("EpubUnsupportedDocumentKindError");
    expect(error.kind).toBe("spreadsheet");
    expect(error.message).toBe(
      "writeEpubContent only supports a 'wordprocessing' ContentDocument, got 'spreadsheet'",
    );
  });

  it("EpubUnbalancedConstructMarkersError describes an unmatchedEnd", () => {
    const error = new EpubUnbalancedConstructMarkersError("unmatchedEnd", 3);
    expect(error.code).toBe("epub/unbalanced-construct-markers");
    expect(error.name).toBe("EpubUnbalancedConstructMarkersError");
    expect(error.imbalanceKind).toBe("unmatchedEnd");
    expect(error.blockIndex).toBe(3);
    expect(error.message).toContain(
      "a constructEnd marker closes no open construct",
    );
    expect(error.message).toContain("index 3");
  });

  it("EpubUnbalancedConstructMarkersError describes an unclosedStart", () => {
    const error = new EpubUnbalancedConstructMarkersError("unclosedStart", 0);
    expect(error.message).toContain("a constructStart marker is never closed");
  });

  it("EpubPackageFlattenError wraps a thrown cause's message", () => {
    const error = new EpubPackageFlattenError(new Error("no such style ref"));
    expect(error.code).toBe("epub/package-flatten-failed");
    expect(error.name).toBe("EpubPackageFlattenError");
    expect(error.message).toContain("no such style ref");
  });

  it("EpubPackageFlattenError stringifies a non-Error cause", () => {
    const error = new EpubPackageFlattenError("plain string cause");
    expect(error.message).toContain("plain string cause");
  });
});
