import type {
  ContentDocument,
  ContentSheet,
  ContentSheetCell,
  ContentSheetPrintSettings,
} from "document-schema.js";
import { PAGE_SIZE_LETTER } from "document-schema.js";
import { describe, expect, it } from "vitest";
import type { XlsContentDocument } from "xls-codec";
import { odsToXlsx } from "../convert/convert";
import { readOdfFormulaContent } from "../odf/formula/read";
import { FRACTION_FORMULA, odfFormulaBytes } from "../test-support/odf";
import { minimalDocxBytes } from "../test-support/docx";
import { minimalOdgBytes } from "../test-support/odg";
import { minimalOdpBytes } from "../test-support/odp";
import { minimalOdsBytes, richOdsBytes } from "../test-support/ods";
import { minimalOdtBytes } from "../test-support/odt";
import { minimalPptxBytes } from "../test-support/pptx";
import { encodeMarkdownText } from "../markdown/text";
import { richMarkdownText } from "../test-support/markdown";
import { decodeDocumentPackage } from "../package-codec";
import { DOCUMENT_FORMAT_CODECS } from "./registry";

// Proves each DOCUMENT_FORMAT_CODECS entry's own read/write pair is wired correctly on its own terms -- not merely that readDocumentMetadata/setDocumentMetadata/buildDocumentBytes happen to still work after being refactored onto this registry (their own test files cover that). Every format with both a content.read and a content.write is exercised as a genuine read -> write -> read round trip: the content a fresh read produces after writing back out must equal the content that went in.

function requireContentCodec(
  format:
    | "docx"
    | "pptx"
    | "odt"
    | "odp"
    | "ods"
    | "odg"
    | "markdown"
    | "xlsx"
    | "csv"
    | "rtf"
    | "doc"
    | "xls"
    | "ppt",
) {
  const content = DOCUMENT_FORMAT_CODECS[format].content;
  if (!content?.write) {
    throw new Error(
      `expected DOCUMENT_FORMAT_CODECS.${format}.content.write to be defined`,
    );
  }
  return content;
}

// Every buildXPackage function mints a fresh createdIso/modifiedIso when the source ContentDocument carries none (a real, pre-existing property of those builders, independent of this registry) -- normalized out here so the round-trip assertion below is checking wiring correctness, not re-asserting that unrelated, already-covered behavior.
function withReferenceTimestamps(
  rebuilt: ContentDocument,
  reference: ContentDocument,
): ContentDocument {
  return {
    ...rebuilt,
    metadata: {
      ...rebuilt.metadata,
      createdIso: reference.metadata.createdIso,
      modifiedIso: reference.metadata.modifiedIso,
    },
  };
}

// A handful of formats' own buildXPackage carries other pre-existing, already-documented lossiness beyond timestamps (a shape's own `name` synthesized fresh on rebuild for pptx/odp, page geometry reset to a US Letter default for odt, an extra blank table row inserted for odp) -- none of it introduced by this registry, all of it a property of builders this task did not touch and that already have their own dedicated fidelity tests elsewhere. For these formats a black-box substantive-text check is the right-scoped proof of wiring: if content.read/content.write were wired to the wrong underlying functions, the round-tripped ContentDocument would not contain this exact source text at all.
function containsText(content: ContentDocument, expected: string): boolean {
  return JSON.stringify(content).includes(expected);
}

describe("DOCUMENT_FORMAT_CODECS: content read/write round trips", () => {
  it("docx: read -> write -> read round-trips the ContentDocument", () => {
    const codec = requireContentCodec("docx");
    const content = codec.read(minimalDocxBytes());
    const rebuiltBytes = codec.write!(content);
    expect(withReferenceTimestamps(codec.read(rebuiltBytes), content)).toEqual(
      content,
    );
  });

  it("pptx: read -> write -> read carries the source slide text through", () => {
    const codec = requireContentCodec("pptx");
    const content = codec.read(minimalPptxBytes());
    expect(containsText(content, "Slide text")).toBe(true);
    const rebuiltBytes = codec.write!(content);
    const roundTripped = codec.read(rebuiltBytes);
    expect(roundTripped.kind).toBe(content.kind);
    expect(containsText(roundTripped, "Slide text")).toBe(true);
  });

  it("odt: read -> write -> read carries the source paragraph text through", () => {
    const codec = requireContentCodec("odt");
    const content = codec.read(minimalOdtBytes());
    expect(containsText(content, "Hello from odt")).toBe(true);
    const rebuiltBytes = codec.write!(content);
    const roundTripped = codec.read(rebuiltBytes);
    expect(roundTripped.kind).toBe(content.kind);
    expect(containsText(roundTripped, "Hello from odt")).toBe(true);
  });

  it("odp: read -> write -> read carries the source slide text through", () => {
    const codec = requireContentCodec("odp");
    const content = codec.read(minimalOdpBytes());
    expect(containsText(content, "Hello from odp")).toBe(true);
    const rebuiltBytes = codec.write!(content);
    const roundTripped = codec.read(rebuiltBytes);
    expect(roundTripped.kind).toBe(content.kind);
    expect(containsText(roundTripped, "Hello from odp")).toBe(true);
  });

  it("ods: read -> write -> read round-trips the ContentDocument", () => {
    const codec = requireContentCodec("ods");
    const content = codec.read(minimalOdsBytes());
    const rebuiltBytes = codec.write!(content);
    expect(withReferenceTimestamps(codec.read(rebuiltBytes), content)).toEqual(
      content,
    );
  });

  // odg's own round trip is not byte-for-byte exact even setting timestamps aside -- buildOdgPackage/readOdgContent lose a text frame's `name` and carry ordinary floating-point drift through real geometry recomputation (rotation resolution), both pre-existing, documented properties of that pair (see this package's own README gotchas on odg reconstruction), not something this registry wiring could introduce or fix. Structural fields prove the write -> read half is genuinely wired and produced a real, valid drawing.
  it("odg: read -> write -> read round-trips the structural shape of the ContentDocument", () => {
    const codec = requireContentCodec("odg");
    const content = codec.read(minimalOdgBytes());
    const rebuiltBytes = codec.write!(content);
    const roundTripped = codec.read(rebuiltBytes);
    expect(roundTripped.kind).toBe(content.kind);
    expect(roundTripped.metadata.title).toBe(content.metadata.title);
    if (roundTripped.kind === "drawing" && content.kind === "drawing") {
      expect(roundTripped.pages.length).toBe(content.pages.length);
      expect(roundTripped.pages[0]?.shapes.length).toBe(
        content.pages[0]?.shapes.length,
      );
      expect(roundTripped.pages[0]?.vectors.length).toBe(
        content.pages[0]?.vectors.length,
      );
    }
  });

  it("markdown: read -> write -> read round-trips the ContentDocument", () => {
    const codec = requireContentCodec("markdown");
    const content = codec.read(encodeMarkdownText(richMarkdownText()));
    const rebuiltBytes = codec.write!(content);
    expect(codec.read(rebuiltBytes)).toEqual(content);
  });

  // csv's round trip is exact-equality like markdown's, for the same stability reason: write emits each cell's displayText, and read re-types that text heuristically -- but re-typing a cell that already went through inferCellValue once lands on the identical value again (a re-typed number prints back as the same digits, a declined string stays a string), so a second read cannot drift from the first.
  it("csv: read -> write -> read round-trips the ContentDocument", () => {
    const codec = requireContentCodec("csv");
    const csvBytes = new TextEncoder().encode(
      "Name,Amount,Active\nWidget,42.5,TRUE\nGadget,7,\n",
    );
    const content = codec.read(csvBytes);
    const rebuiltBytes = codec.write!(content);
    expect(codec.read(rebuiltBytes)).toEqual(content);
  });

  // xlsx's own column-width unit conversion (ooxml.js's ptToColumnWidthChars/columnWidthCharsToPt, src/typed/xlsx/units.ts) is a best-effort algebraic inverse, not an exact one -- src/convert/bridges.test.ts's own COLUMN_WIDTH_TOLERANCE_PT documents up to ~1pt of drift per pt<->character-width hop. This registry round trip is a second such hop on top of whatever odsToXlsx's own bridge already introduced building the fixture, so widths are checked within tolerance rather than exact equality; every other field (sheet name, cell values/kinds/formula/merges) is checked exactly, since none of those go through a lossy unit conversion.
  it("xlsx: read -> write -> read carries sheet cell values, kinds, formulas, and merges through exactly, and column widths within tolerance", () => {
    const codec = requireContentCodec("xlsx");
    const xlsxBytes = odsToXlsx(richOdsBytes());
    const content = codec.read(xlsxBytes);
    const rebuiltBytes = codec.write!(content);
    const roundTripped = codec.read(rebuiltBytes);

    expect(roundTripped.kind).toBe(content.kind);
    if (content.kind !== "spreadsheet" || roundTripped.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    expect(roundTripped.metadata.title).toBe(content.metadata.title);

    const originalSheet = content.sheets[0]!;
    const sheet = roundTripped.sheets[0]!;
    expect(sheet.name).toBe(originalSheet.name);
    expect(sheet.cells.length).toBe(originalSheet.cells.length);
    for (const cell of originalSheet.cells) {
      const match = sheet.cells.find(
        (c) => c.row === cell.row && c.column === cell.column,
      );
      expect(match).toBeDefined();
      expect(match?.value).toEqual(cell.value);
      expect(match?.displayText).toBe(cell.displayText);
      expect(match?.formula).toBe(cell.formula);
      expect(match?.colSpan).toBe(cell.colSpan);
    }

    const XLSX_COLUMN_WIDTH_TOLERANCE_PT = 1;
    expect(sheet.columns.length).toBe(originalSheet.columns.length);
    for (const originalColumn of originalSheet.columns) {
      const column = sheet.columns.find(
        (c) => c.index === originalColumn.index,
      );
      expect(column).toBeDefined();
      expect(
        Math.abs((column?.widthPt ?? 0) - (originalColumn.widthPt ?? 0)),
      ).toBeLessThanOrEqual(XLSX_COLUMN_WIDTH_TOLERANCE_PT);
    }
  });

  // Hand-authored literal RTF source, matching this suite's own csv/markdown fixtures rather than generating it through writeRtfContent (the very function under test here) -- a heading-styled paragraph, a bold run, and a plain paragraph, exercising the font/colour/heading tables writeRtfContent mints on write. rtf-codec's writer is deterministic and its \info group carries only title/author/subject/keywords (no created/modified timestamps to mint), so -- unlike docx/ods above -- this round trip needs no withReferenceTimestamps normalisation.
  it("rtf: read -> write -> read round-trips the ContentDocument", () => {
    const codec = requireContentCodec("rtf");
    const rtfBytes = new TextEncoder().encode(
      "{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0\\froman Times New Roman;}}" +
        "{\\stylesheet{\\s1\\outlinelevel0 heading 1;}}" +
        "\\pard\\s1\\fs32 Report Title\\par" +
        "\\pard\\fs24 Plain paragraph with {\\b bold text}.\\par}",
    );
    const content = codec.read(rtfBytes);
    expect(containsText(content, "Report Title")).toBe(true);
    expect(containsText(content, "bold text")).toBe(true);
    const rebuiltBytes = codec.write!(content);
    expect(codec.read(rebuiltBytes)).toEqual(content);
  });

  // doc-codec's own writer covers a single wordprocessing section, character/paragraph formatting, and tables (no images -- see that package's README scope note), so this fixture is deliberately plain: one heading paragraph and one bold run, exercising exactly what writeDocContent can express -- a table exercises real content-scope boundaries elsewhere (doc-codec's own write.test.ts), not this registry-wiring round trip. doc-codec always reads back metadata as {} regardless of what was written (readDocContent's own scope note), so -- like rtf above -- no withReferenceTimestamps normalisation is needed, but for the opposite reason: there is no timestamp field for either side to disagree on. readDocContent's own return type is ContentDocument widened by one further field, numbering (doc-codec's own DocContent, read-only list-formatting definitions keyed by listId) -- this fixture declares no lists, so the round trip's own numbering resolves to {} rather than nothing at all.
  it("doc: read -> write -> read round-trips the ContentDocument", () => {
    const codec = requireContentCodec("doc");
    const content: ContentDocument = {
      kind: "wordprocessing",
      metadata: {},
      sections: [
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks: [
            {
              kind: "paragraph",
              runs: [{ text: "Report Title", bold: true }],
            },
            {
              kind: "paragraph",
              runs: [{ text: "A plain paragraph of body text." }],
            },
          ],
        },
      ],
    };
    const rebuiltBytes = codec.write!(content);
    expect(codec.read(rebuiltBytes)).toEqual({ ...content, numbering: {} });
  });

  // Mirrors xls-codec's own write.test.ts fixture shape (its `sheet`/`cell` helpers, restated inline here rather than imported -- that test-support is not part of xls-codec's published surface). writeXlsContent's own scope covers cell values, merges, row/column sizing, and number formats (no formulas/decoration -- see that package's README scope note), so this fixture sticks to plain cell values. A cell written with no explicit number format gains 'General' on the way back (XF 15's own ifmt resolving through the built-in table) -- the same pre-existing, documented stamping xls-codec's own write.test.ts pins, not something this registry wiring introduces -- so the expected content states it explicitly rather than asserting exact equality against the unformatted input.
  it("xls: read -> write -> read round-trips the ContentDocument", () => {
    const codec = requireContentCodec("xls");
    const printSettings: ContentSheetPrintSettings = {
      pageSize: PAGE_SIZE_LETTER,
      margins: { topPt: 54, rightPt: 50.4, bottomPt: 54, leftPt: 50.4 },
      gridlines: false,
      headers: false,
      pageOrder: "downThenOver",
    };
    const cells: ContentSheetCell[] = [
      {
        row: 0,
        column: 0,
        value: { kind: "string", value: "Widget" },
        displayText: "Widget",
      },
      {
        row: 0,
        column: 1,
        value: { kind: "number", value: 42.5 },
        displayText: "42.5",
      },
    ];
    const sheet: ContentSheet = {
      name: "Sheet1",
      cells,
      columns: [],
      rows: [],
      images: [],
      printSettings,
    };
    const content: XlsContentDocument = {
      kind: "spreadsheet",
      metadata: {},
      sheets: [sheet],
    };
    const rebuiltBytes = codec.write!(content);
    const roundTripped = codec.read(rebuiltBytes);
    const expected: XlsContentDocument = {
      ...content,
      sheets: [
        {
          ...sheet,
          cells: cells.map((cell) => ({
            ...cell,
            numberFormatCode: "General",
          })),
        },
      ],
    };
    expect(roundTripped).toEqual(expected);
  });

  // Mirrors ppt-codec's own write.test.ts fixture shape. The writer's own scope is text-box slides only (see that package's README scope note); like pptx/odp above, a black-box substantive-text check is the right-scoped proof of wiring here rather than exact equality -- ppt-codec's own reader always reports PowerPoint's fixed default text insets (0.1in left/right, 0.05in top/bottom) regardless of what a shape actually carries, since it does not yet read a shape's own OfficeArtFOPT inset override (see read.ts's own DEFAULT_INSET_LEFT_RIGHT_PT/DEFAULT_INSET_TOP_BOTTOM_PT comment), a pre-existing, documented gap this registry wiring did not introduce.
  it("ppt: read -> write -> read carries the source slide text through", () => {
    const codec = requireContentCodec("ppt");
    const content: ContentDocument = {
      kind: "presentation",
      metadata: {},
      slides: [
        {
          size: { widthPt: 720, heightPt: 540 },
          notes: "",
          shapes: [
            {
              frame: { xPt: 72, yPt: 36, widthPt: 360, heightPt: 180 },
              insetLeftPt: 0,
              insetTopPt: 0,
              insetRightPt: 0,
              insetBottomPt: 0,
              blocks: [
                {
                  kind: "paragraph",
                  runs: [{ text: "Hello, PowerPoint" }],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(containsText(content, "Hello, PowerPoint")).toBe(true);
    const rebuiltBytes = codec.write!(content);
    const roundTripped = codec.read(rebuiltBytes);
    expect(roundTripped.kind).toBe(content.kind);
    expect(containsText(roundTripped, "Hello, PowerPoint")).toBe(true);
  });
});

describe("DOCUMENT_FORMAT_CODECS: odf has a content.read but genuinely no content.write", () => {
  it("read matches readOdfFormulaContent directly, and write is unset", () => {
    const bytes = odfFormulaBytes(FRACTION_FORMULA);
    const codec = DOCUMENT_FORMAT_CODECS.odf.content;
    expect(codec).toBeDefined();
    expect("write" in codec!).toBe(false);
    expect(codec!.read(bytes)).toEqual(
      readOdfFormulaContent(decodeDocumentPackage("odf", bytes)),
    );
  });
});

describe("DOCUMENT_FORMAT_CODECS: pdf has a layout codec, not a content codec", () => {
  it("pdf has no content entry at all", () => {
    expect(DOCUMENT_FORMAT_CODECS.pdf.content).toBeUndefined();
    expect(DOCUMENT_FORMAT_CODECS.pdf.layout).toBeDefined();
  });
});

describe("DOCUMENT_FORMAT_CODECS: xlsx has a content codec, no layout codec", () => {
  it("xlsx has a content entry and no layout entry", () => {
    expect(DOCUMENT_FORMAT_CODECS.xlsx.content).toBeDefined();
    expect(DOCUMENT_FORMAT_CODECS.xlsx.layout).toBeUndefined();
  });
});

describe("DOCUMENT_FORMAT_CODECS: csv has a content codec, no layout codec", () => {
  it("csv has a content entry and no layout entry", () => {
    expect(DOCUMENT_FORMAT_CODECS.csv.content).toBeDefined();
    expect(DOCUMENT_FORMAT_CODECS.csv.layout).toBeUndefined();
  });
});

describe("DOCUMENT_FORMAT_CODECS: rtf has a content codec, no layout codec", () => {
  it("rtf has a content entry and no layout entry", () => {
    expect(DOCUMENT_FORMAT_CODECS.rtf.content).toBeDefined();
    expect(DOCUMENT_FORMAT_CODECS.rtf.layout).toBeUndefined();
  });
});

describe("DOCUMENT_FORMAT_CODECS: doc has a content codec, no layout codec", () => {
  it("doc has a content entry and no layout entry", () => {
    expect(DOCUMENT_FORMAT_CODECS.doc.content).toBeDefined();
    expect(DOCUMENT_FORMAT_CODECS.doc.layout).toBeUndefined();
  });
});

describe("DOCUMENT_FORMAT_CODECS: xls has a content codec, no layout codec", () => {
  it("xls has a content entry and no layout entry", () => {
    expect(DOCUMENT_FORMAT_CODECS.xls.content).toBeDefined();
    expect(DOCUMENT_FORMAT_CODECS.xls.layout).toBeUndefined();
  });
});

describe("DOCUMENT_FORMAT_CODECS: ppt has a content codec, no layout codec", () => {
  it("ppt has a content entry and no layout entry", () => {
    expect(DOCUMENT_FORMAT_CODECS.ppt.content).toBeDefined();
    expect(DOCUMENT_FORMAT_CODECS.ppt.layout).toBeUndefined();
  });
});
