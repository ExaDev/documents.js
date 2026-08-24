import { encodePackage as encodeOdfPackage } from "odf.js";
import { encodePackage as encodeOoxmlPackage } from "ooxml.js";
import { describe, expect, it } from "vitest";
import { extractSourceFonts } from "../fonts/registry";
import {
  embeddedFontDocxPackage,
  embeddedFontOdtPackage,
  embeddedFontPptxPackage,
} from "../test-support/fonts";
import {
  extractSourceFontsForFormat,
  UnsupportedFontSourceFormatError,
} from "./document-fonts";

// Proves the DocumentFormat-dispatch itself, not the underlying face extraction (already covered end to end by src/fonts/ooxml.test.ts/odf.test.ts) -- each case asserts extractSourceFontsForFormat(format, bytes) produces exactly what extractSourceFonts({kind, package}) already produces for the identical package, so a regression in the dispatch (wrong codec picked, wrong FontSourcePackage discriminant) surfaces as a real mismatch rather than a false pass.

describe("extractSourceFontsForFormat", () => {
  it('docx: dispatches through ooxml.js decodePackage to the "docx" discriminant', () => {
    const bytes = encodeOoxmlPackage(embeddedFontDocxPackage());
    const viaFormat = extractSourceFontsForFormat("docx", bytes);
    const viaPackage = extractSourceFonts({
      kind: "docx",
      package: embeddedFontDocxPackage(),
    });
    expect(viaFormat).toEqual(viaPackage);
    expect(viaFormat.length).toBeGreaterThan(0);
  });

  it('pptx: dispatches through ooxml.js decodePackage to the "pptx" discriminant', () => {
    const bytes = encodeOoxmlPackage(embeddedFontPptxPackage());
    const viaFormat = extractSourceFontsForFormat("pptx", bytes);
    const viaPackage = extractSourceFonts({
      kind: "pptx",
      package: embeddedFontPptxPackage(),
    });
    expect(viaFormat).toEqual(viaPackage);
    expect(viaFormat.length).toBeGreaterThan(0);
  });

  it('odt: dispatches through odf.js decodePackage to the "odf" discriminant', () => {
    const bytes = encodeOdfPackage(embeddedFontOdtPackage());
    const viaFormat = extractSourceFontsForFormat("odt", bytes);
    const viaPackage = extractSourceFonts({
      kind: "odf",
      package: embeddedFontOdtPackage(),
    });
    expect(viaFormat).toEqual(viaPackage);
    expect(viaFormat.length).toBeGreaterThan(0);
  });

  it("throws UnsupportedFontSourceFormatError, naming the six supported formats, for a format that carries no source-embedded fonts", () => {
    for (const format of ["pdf", "xlsx", "markdown", "odf"] as const) {
      expect(() =>
        extractSourceFontsForFormat(format, new Uint8Array()),
      ).toThrow(UnsupportedFontSourceFormatError);
      expect(() =>
        extractSourceFontsForFormat(format, new Uint8Array()),
      ).toThrow(/docx, pptx, odt, odp, ods, odg/);
    }
  });

  it("carries the rejected format on the error itself, not only in its message", () => {
    let caught: unknown;
    try {
      extractSourceFontsForFormat("xlsx", new Uint8Array());
    } catch (error) {
      caught = error;
    }
    if (!(caught instanceof UnsupportedFontSourceFormatError)) {
      throw new Error(
        "expected extractSourceFontsForFormat to throw UnsupportedFontSourceFormatError for xlsx",
      );
    }
    expect(caught.format).toBe("xlsx");
  });
});
