import { describe, expect, it } from "vitest";
import { z } from "zod";
import { decodePackage as decodeOoxmlPackage, readXlsxContent } from "ooxml.js";
import { decodeMarkdownText } from "../markdown/text";
import { gridOdsBytes } from "../test-support/ods";
import { createLocalDocumentConverter } from "./local";
import { xlsxMarkdownCodec } from "./codec";
import { markdownToXlsx, odsToXlsx, xlsxToMarkdown } from "./convert";

// xlsx <-> markdown is the one pair whose two formats share no ContentDocument variant (spreadsheet vs wordprocessing), so it routes through PDF internally -- the same composed-edge shape xlsxToPdf/pdfToXlsx use. These tests prove the single-call functions exist and round-trip (the issue's core ask: a caller no longer has to chain xlsxToPdf -> pdfToMarkdown by hand), that the codec wraps them, and that the DocumentConverter port now routes the pair instead of rejecting it with UnsupportedConversionError.

const xlsxBytes = (): Uint8Array<ArrayBuffer> => odsToXlsx(gridOdsBytes());

describe("xlsx <-> markdown composed bridge", () => {
  it("xlsxToMarkdown produces markdown carrying the rendered cell text", () => {
    const markdown = decodeMarkdownText(xlsxToMarkdown(xlsxBytes()));
    // The grid fixture's cells (header Alpha/Beta/Gamma, then One/Two/Three, Four/Five/Six) survive the xlsx -> pdf render and the pdf -> markdown reconstruction as text -- the whole point of the composed edge.
    expect(markdown).toContain("Alpha");
    expect(markdown).toContain("Beta");
    expect(markdown).toContain("Gamma");
  });

  it("markdownToXlsx produces a spreadsheet ContentDocument readXlsxContent can decode", () => {
    const markdownBytes = xlsxToMarkdown(xlsxBytes());
    const roundTripped = markdownToXlsx(markdownBytes);
    const content = readXlsxContent(decodeOoxmlPackage(roundTripped));
    // readXlsxContent's declared return type is the full ContentDocument union even though it always produces the spreadsheet variant -- narrow it the same way every other test in this package does.
    if (content.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    expect(content.sheets.length).toBeGreaterThanOrEqual(1);
  });

  it("xlsxMarkdownCodec round-trips xlsx -> markdown -> xlsx under two-way schema validation", () => {
    const markdownBytes = z.decode(xlsxMarkdownCodec, xlsxBytes());
    expect(() => decodeMarkdownText(markdownBytes)).not.toThrow();
    const roundTrippedXlsx = z.encode(xlsxMarkdownCodec, markdownBytes);
    const content = readXlsxContent(decodeOoxmlPackage(roundTrippedXlsx));
    expect(content.kind).toBe("spreadsheet");
  });

  it("the DocumentConverter port routes xlsx -> markdown rather than rejecting it", async () => {
    const converter = createLocalDocumentConverter();
    const result = await converter.convert(
      {
        source: { format: "xlsx", bytes: xlsxBytes() },
        targetFormat: "markdown",
      },
      { signal: new AbortController().signal },
    );
    expect(result.document.format).toBe("markdown");
    expect(() => decodeMarkdownText(result.document.bytes)).not.toThrow();
  });
});
