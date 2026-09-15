import { describe, expect, it } from "vitest";
import { pdfDict, pdfNum } from "../objects";
import type { AllocatedObject } from "./write-pdf-fixture";
import { assemblePdf } from "./write-pdf-fixture";

// assemblePdf's own byte-level shape is otherwise invisible to every consuming test: this package's real readPdf tolerates a mangled xref table, a missing "trailer"/"startxref"/"%%EOF" marker, or a wrong offset by falling back to a linear object scan, so every existing caller of assemblePdf still round-trips correctly even when this file's own literals or arithmetic are wrong. These tests read the raw produced bytes directly instead, independent of readPdf's own leniency.
function decode(bytes: Uint8Array<ArrayBuffer>): string {
  return new TextDecoder("latin1").decode(bytes);
}

describe("assemblePdf", () => {
  it("writes each object at ascending object number regardless of the order given, not the order inserted", () => {
    const objects: AllocatedObject[] = [
      { num: 3, value: pdfNum(30) },
      { num: 1, value: pdfNum(10) },
      { num: 2, value: pdfNum(20) },
    ];
    const text = decode(assemblePdf(objects, 1));
    const at = (marker: string): number => {
      const index = text.indexOf(marker);
      expect(index).toBeGreaterThanOrEqual(0);
      return index;
    };
    const pos1 = at("1 0 obj\n10\nendobj\n");
    const pos2 = at("2 0 obj\n20\nendobj\n");
    const pos3 = at("3 0 obj\n30\nendobj\n");
    expect(pos1).toBeLessThan(pos2);
    expect(pos2).toBeLessThan(pos3);
  });

  it("starts with the PDF header and writes an endobj/xref/trailer/startxref/%%EOF tail with the exact markers a reader looks for", () => {
    const objects: AllocatedObject[] = [{ num: 1, value: pdfNum(42) }];
    const text = decode(assemblePdf(objects, 1));
    expect(text.startsWith("%PDF-1.7\n")).toBe(true);
    expect(text).toContain("1 0 obj\n42\nendobj\n");
    expect(text).toContain("xref\n");
    expect(text).toContain("trailer\n");
    expect(text).toContain("\nstartxref\n");
    expect(text.endsWith("%%EOF")).toBe(true);
  });

  it("writes an xref subsection header naming exactly one more entry than the highest object number", () => {
    const objects: AllocatedObject[] = [
      { num: 1, value: pdfNum(1) },
      { num: 2, value: pdfNum(2) },
      { num: 3, value: pdfNum(3) },
    ];
    const text = decode(assemblePdf(objects, 1));
    expect(text).toContain("xref\n0 4\n");
    expect(text).toContain("0000000000 65535 f \n");
  });

  it("records each object's xref entry as its own real byte offset into the file, not any other object's", () => {
    const objects: AllocatedObject[] = [
      { num: 1, value: pdfNum(1) },
      { num: 2, value: pdfNum(2) },
    ];
    const bytes = assemblePdf(objects, 1);
    const text = decode(bytes);
    const xrefStart = text.indexOf("xref\n");
    const subsectionHeaderEnd =
      text.indexOf("\n", xrefStart + "xref\n".length) + 1;
    // Skip the free-entry line to reach the first real object's own xref line.
    const firstEntryStart =
      text.indexOf("\n", subsectionHeaderEnd + "0000000000 65535 f ".length) +
      1;
    const firstEntryLine = text.slice(
      firstEntryStart,
      firstEntryStart + "0000000000 00000 n ".length,
    );
    // Each xref entry is fixed-width (ISO 32000-1 7.5.4): a zero-padded 10-digit offset, exactly, not merely a number that happens to parse correctly regardless of its own width.
    expect(firstEntryLine).toMatch(/^\d{10} 00000 n $/);
    const recordedOffset = Number.parseInt(firstEntryLine.split(" ")[0]!, 10);
    expect(text.slice(recordedOffset, recordedOffset + "1 0 obj".length)).toBe(
      "1 0 obj",
    );
  });

  it("writes the trailer dict with /Size one more than the highest object number and /Root pointing at the given root", () => {
    const objects: AllocatedObject[] = [
      { num: 1, value: pdfDict({}) },
      { num: 2, value: pdfNum(0) },
      { num: 3, value: pdfNum(0) },
    ];
    const text = decode(assemblePdf(objects, 1));
    const trailerStart = text.indexOf("trailer\n") + "trailer\n".length;
    const trailerText = text.slice(trailerStart, text.indexOf("startxref") - 1);
    expect(trailerText).toContain("/Size 4");
    expect(trailerText).toContain("/Root 1 0 R");
  });

  it("points startxref at the real byte offset of its own xref keyword", () => {
    const objects: AllocatedObject[] = [{ num: 1, value: pdfNum(1) }];
    const text = decode(assemblePdf(objects, 1));
    const xrefOffset = text.indexOf("xref\n");
    const startxrefMatch = /startxref\n(\d+)\n/.exec(text);
    expect(startxrefMatch).not.toBeNull();
    expect(Number.parseInt(startxrefMatch![1]!, 10)).toBe(xrefOffset);
  });
});
