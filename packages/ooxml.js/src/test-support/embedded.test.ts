import { describe, expect, it } from "vitest";
import { unzipPackage } from "../zip";
import {
  minimalDocxBytes,
  minimalPptxBytes,
  minimalXlsxBytes,
} from "./embedded";

// Direct structural coverage for this file's own fixture-building strings (never published, but real code Stryker mutates all the same): every builder is unzipped and its content-types override and root relationship target are decoded back to text and compared against the exact markup expected, rather than merely checking that the functions "don't throw" — a mutant collapsing any of these to an empty string still zips, and still gets read by every consuming suite's fallback-tolerant assertions, without this.
const dec = (bytes: Uint8Array<ArrayBuffer>): string =>
  new TextDecoder().decode(bytes);

describe("minimalXlsxBytes", () => {
  it("carries the xlsx content-type overrides and a root relationship pointing at xl/workbook.xml", () => {
    const entries = unzipPackage(minimalXlsxBytes());
    const contentTypes = dec(
      entries["[Content_Types].xml"] ?? new Uint8Array(0),
    );
    expect(contentTypes).toContain('PartName="/xl/workbook.xml"');
    expect(contentTypes).toContain(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
    );
    expect(contentTypes).toContain('PartName="/xl/worksheets/sheet1.xml"');

    const rootRels = dec(entries["_rels/.rels"] ?? new Uint8Array(0));
    expect(rootRels).toContain('Target="xl/workbook.xml"');
  });
});

describe("minimalDocxBytes", () => {
  it("carries the docx content-type override and a root relationship pointing at word/document.xml", () => {
    const entries = unzipPackage(minimalDocxBytes());
    const contentTypes = dec(
      entries["[Content_Types].xml"] ?? new Uint8Array(0),
    );
    expect(contentTypes).toContain('PartName="/word/document.xml"');
    expect(contentTypes).toContain(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
    );

    const rootRels = dec(entries["_rels/.rels"] ?? new Uint8Array(0));
    expect(rootRels).toContain('Target="word/document.xml"');
  });
});

describe("minimalPptxBytes", () => {
  it("carries the pptx content-type overrides and a root relationship pointing at ppt/presentation.xml", () => {
    const entries = unzipPackage(minimalPptxBytes());
    const contentTypes = dec(
      entries["[Content_Types].xml"] ?? new Uint8Array(0),
    );
    expect(contentTypes).toContain('PartName="/ppt/presentation.xml"');
    expect(contentTypes).toContain(
      "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
    );
    expect(contentTypes).toContain('PartName="/ppt/slides/slide1.xml"');

    const rootRels = dec(entries["_rels/.rels"] ?? new Uint8Array(0));
    expect(rootRels).toContain('Target="ppt/presentation.xml"');
  });
});
