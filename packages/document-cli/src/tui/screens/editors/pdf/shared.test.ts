import { describe, expect, it } from "vitest";
import type {
  CsvOpenDocument,
  OpenDocument,
  PdfOpenDocument,
} from "../../../state/types.js";
import {
  defaultTriangleLayoutSubpaths,
  formatColor,
  formatPt,
  formatSize,
  formatStroke,
  inferImageFormat,
  isEditablePdfDocument,
  parseFontStyle,
  parseFontWeight,
  parseOptionalNumberField,
  parseRequiredColorField,
  requirePdfDocument,
} from "./shared";

function pdfDoc(): PdfOpenDocument {
  return {
    format: "pdf",
    editor: {} as never,
    layout: {} as never,
    path: undefined,
  };
}

function csvDoc(): CsvOpenDocument {
  return {
    format: "csv",
    layout: {} as never,
    bytes: new Uint8Array(),
    path: "x",
  };
}

describe("requirePdfDocument", () => {
  it("returns a real pdf document", () => {
    const doc = pdfDoc();
    expect(requirePdfDocument(doc)).toBe(doc);
  });

  it("returns each preview format this screen group also serves", () => {
    for (const format of [
      "xlsx",
      "csv",
      "svg",
      "rtf",
      "wpd",
      "epub",
    ] as const) {
      const doc: OpenDocument = {
        format,
        layout: {} as never,
        bytes: new Uint8Array(),
        path: "x",
      };
      expect(requirePdfDocument(doc)).toBe(doc);
    }
  });

  it("throws for a document of a format this screen group never serves", () => {
    const doc: OpenDocument = {
      format: "docx",
      editor: {} as never,
      path: undefined,
    };
    expect(() => requirePdfDocument(doc)).toThrow(
      /A PDF inspection screen rendered without an open PDF/,
    );
  });

  it("throws for undefined", () => {
    expect(() => requirePdfDocument(undefined)).toThrow(
      /A PDF inspection screen rendered without an open PDF/,
    );
  });
});

describe("isEditablePdfDocument", () => {
  it("is true only for a genuine pdf document", () => {
    expect(isEditablePdfDocument(pdfDoc())).toBe(true);
  });

  it("is false for a read-only preview format", () => {
    expect(isEditablePdfDocument(csvDoc())).toBe(false);
  });
});

describe("formatSize", () => {
  it("formats width and height rounded to whole points with a × separator", () => {
    expect(formatSize(612.4, 792.6)).toBe("612×793pt");
  });
});

describe("formatPt", () => {
  it("formats a value to one decimal place", () => {
    expect(formatPt(12.34)).toBe("12.3");
    expect(formatPt(12)).toBe("12.0");
  });
});

describe("formatColor", () => {
  it("renders a colour as a 6-digit hex string", () => {
    expect(formatColor({ r: 1, g: 0, b: 0.5 })).toBe("#ff0080");
  });

  it("pads a single-digit byte with a leading zero", () => {
    expect(formatColor({ r: 1 / 255, g: 0, b: 0 })).toBe("#010000");
  });
});

describe("formatStroke", () => {
  it("combines the colour and width with an @ separator", () => {
    expect(formatStroke({ color: { r: 1, g: 1, b: 1 }, widthPt: 2 })).toBe(
      "#ffffff @ 2.0pt",
    );
  });
});

describe("parseRequiredColorField", () => {
  it("parses a valid colour string", () => {
    expect(
      parseRequiredColorField("0.1 0.2 0.3", { r: 0, g: 0, b: 0 }),
    ).toEqual({
      r: 0.1,
      g: 0.2,
      b: 0.3,
    });
  });

  it("falls back to the given colour for invalid input", () => {
    const fallback = { r: 1, g: 1, b: 1 };
    expect(parseRequiredColorField("not a color", fallback)).toBe(fallback);
  });
});

describe("parseFontWeight", () => {
  it("recognises 'bold', case-insensitively and trimmed", () => {
    expect(parseFontWeight(" Bold ")).toBe("bold");
    expect(parseFontWeight("BOLD")).toBe("bold");
  });

  it("treats anything else as normal", () => {
    expect(parseFontWeight("regular")).toBe("normal");
    expect(parseFontWeight("")).toBe("normal");
  });
});

describe("parseFontStyle", () => {
  it("recognises 'italic', case-insensitively and trimmed", () => {
    expect(parseFontStyle(" Italic ")).toBe("italic");
  });

  it("treats anything else as normal", () => {
    expect(parseFontStyle("regular")).toBe("normal");
  });
});

describe("parseOptionalNumberField", () => {
  it("returns undefined for blank input", () => {
    expect(parseOptionalNumberField("")).toBeUndefined();
    expect(parseOptionalNumberField("   ")).toBeUndefined();
  });

  it("parses a finite number", () => {
    expect(parseOptionalNumberField("42.5")).toBe(42.5);
  });

  it("returns undefined for a non-finite or non-numeric value", () => {
    expect(parseOptionalNumberField("abc")).toBeUndefined();
    expect(parseOptionalNumberField("Infinity")).toBeUndefined();
  });

  it("accepts zero and negative numbers", () => {
    expect(parseOptionalNumberField("0")).toBe(0);
    expect(parseOptionalNumberField("-5")).toBe(-5);
  });
});

describe("defaultTriangleLayoutSubpaths", () => {
  it("builds a flat-shape closed triangle spanning the given frame", () => {
    expect(defaultTriangleLayoutSubpaths(100, 50)).toEqual([
      {
        startXPt: 0,
        startYPt: 50,
        segments: [
          { kind: "line", xPt: 50, yPt: 0 },
          { kind: "line", xPt: 100, yPt: 50 },
        ],
        closed: true,
      },
    ]);
  });
});

describe("inferImageFormat", () => {
  it("recognises .png", () => {
    expect(inferImageFormat("a.png")).toBe("png");
    expect(inferImageFormat("A.PNG")).toBe("png");
  });

  it("recognises .jpg and .jpeg", () => {
    expect(inferImageFormat("a.jpg")).toBe("jpeg");
    expect(inferImageFormat("a.jpeg")).toBe("jpeg");
  });

  it("returns undefined for anything else", () => {
    expect(inferImageFormat("a.gif")).toBeUndefined();
    expect(inferImageFormat("a")).toBeUndefined();
  });
});
