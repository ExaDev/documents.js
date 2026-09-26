import {
  flattenTree,
  type ContentDocument,
  type DocumentTree,
} from "document-schema.js";
import {
  childrenWithTag,
  decodeOdfText,
  decodePackage as decodeOdfPackage,
  elementsWithTag,
} from "odf.js";
import { attr } from "ooxml.js";
import {
  buildXlsxPackageFromContent,
  decodePackage as decodeOoxmlPackage,
  encodePackage as encodeOoxmlPackage,
  readXlsxContent,
} from "ooxml.js";
import { describe, expect, it, vi } from "vitest";
import { createDocx } from "../edit/docx/editor";
import * as engineModule from "../layout/engine";
import { readDocxContent } from "../ooxml/docx/read";
import { readPptxContent } from "../ooxml/pptx/read";
import { readOdsContent } from "../odf/ods/read";
import { readOdtContent } from "../odf/odt/read";
import { richOdsBytes } from "../test-support/ods";
import { decodeMarkdownText, encodeMarkdownText } from "../markdown/text";
import { richMarkdownText } from "../test-support/markdown";
import {
  docxToMarkdown,
  docxToPptx,
  markdownToDocx,
  markdownToOdt,
  odsToXlsx,
  odtToMarkdown,
  pptxToDocx,
  xlsxToOds,
} from "./convert";
function docxContentOf(bytes: Uint8Array<ArrayBuffer>) {
  const content = readDocxContent(decodeOoxmlPackage(bytes));
  if (content.kind !== "wordprocessing") {
    throw new Error("expected a wordprocessing ContentDocument");
  }
  return content;
}

function odtContentOf(bytes: Uint8Array<ArrayBuffer>) {
  const content = readOdtContent(decodeOdfPackage(bytes));
  if (content.kind !== "wordprocessing") {
    throw new Error("expected a wordprocessing ContentDocument");
  }
  return content;
}

function odsContentOf(bytes: Uint8Array<ArrayBuffer>) {
  const content = readOdsContent(decodeOdfPackage(bytes));
  if (content.kind !== "spreadsheet") {
    throw new Error("expected a spreadsheet ContentDocument");
  }
  return content;
}

function xlsxContentOf(bytes: Uint8Array<ArrayBuffer>) {
  const content = readXlsxContent(decodeOoxmlPackage(bytes));
  if (content.kind !== "spreadsheet") {
    throw new Error("expected a spreadsheet ContentDocument");
  }
  return content;
}

// --- odt <-> docx ----------------------------------------------------------------------------------------------

// Multiple paragraphs, a styleId string (Heading1), a bold+italic+coloured run, a two-level list, and a 2x2 table — the content shapes the task explicitly names.
function buildRichDocx(): Uint8Array<ArrayBuffer> {
  const editor = createDocx();
  editor.body
    .appendParagraph({ styleId: "Heading1" })
    .appendRun({ text: "Report Title" });

  const styled = editor.body.appendParagraph();
  const styledRun = styled.appendRun({ text: "Bold italic coloured text" });
  styledRun.bold = true;
  styledRun.italic = true;
  styledRun.strike = true;
  styledRun.color = { r: 0.8, g: 0, b: 0 };

  editor.body
    .appendParagraph()
    .appendRun({ text: "A second, plain paragraph." });

  const item1 = editor.body.appendParagraph();
  item1.list = { numId: "1", level: 0 };
  item1.appendRun({ text: "First item" });
  const item2 = editor.body.appendParagraph();
  item2.list = { numId: "1", level: 0 };
  item2.appendRun({ text: "Second item" });
  const item3 = editor.body.appendParagraph();
  item3.list = { numId: "1", level: 1 };
  item3.appendRun({ text: "Nested item" });
  const item4 = editor.body.appendParagraph();
  item4.list = { numId: "1", level: 0 };
  item4.appendRun({ text: "Third top-level item" });

  const table = editor.body.appendTable({
    rows: 2,
    columns: 2,
    columnWidthsTwips: [3000, 3000],
  });
  const rows = table.rows();
  rows[0]!.cells()[0]!.paragraphs()[0]!.appendRun({ text: "A1" });
  rows[0]!.cells()[1]!.paragraphs()[0]!.appendRun({ text: "B1" });
  rows[1]!.cells()[0]!.paragraphs()[0]!.appendRun({ text: "A2" });
  rows[1]!.cells()[1]!.paragraphs()[0]!.appendRun({ text: "B2" });

  return editor.toBytes();
}

// The odt-editor-built mirror of buildRichDocx above: same content shapes (paragraphs, a styleId, a bold+italic+coloured run, a two-level list, a 2x2 table), built through the odt live-view editor instead.
function paragraphTexts(content: ReturnType<typeof docxContentOf>): string[] {
  return content.sections[0]!.blocks.filter((b) => b.kind === "paragraph").map(
    (b) => b.runs.map((r) => r.text).join(""),
  );
}

const COLUMN_WIDTH_TOLERANCE_PT = 1;

function cellAt(
  sheet: ReturnType<typeof odsContentOf>["sheets"][number],
  row: number,
  column: number,
) {
  return sheet.cells.find((c) => c.row === row && c.column === column);
}

describe("ods <-> xlsx: ods -> xlsx (one hop, the character-width-unit conversion under scrutiny)", () => {
  it("carries every ODS cell-value kind, the merge, the verbatim formula, and column widths within tolerance", () => {
    const original = odsContentOf(richOdsBytes());
    const originalSheet = original.sheets[0]!;

    // The source ODS fixture's own header row and every cell's rendered displayText: buildRichFixturePackage (test-support/ods.ts) writes a distinct text:p run for every cell alongside its office:value, and none of it is exercised by any assertion below (those check only the CONVERTED xlsx side's `.value`) — so a header cell silently losing its label, or a cell's displayText silently losing its rendered text, would go undetected without checking the source fixture directly.
    expect(cellAt(originalSheet, 0, 0)?.displayText).toBe("Name");
    expect(cellAt(originalSheet, 0, 1)?.displayText).toBe("Amount");
    expect(cellAt(originalSheet, 0, 2)?.displayText).toBe("Active");
    expect(cellAt(originalSheet, 1, 0)?.displayText).toBe("Widget");
    expect(cellAt(originalSheet, 1, 1)?.displayText).toBe("42.5");
    expect(cellAt(originalSheet, 1, 2)?.displayText).toBe("TRUE");
    expect(cellAt(originalSheet, 2, 0)?.displayText).toBe("15%");
    expect(cellAt(originalSheet, 2, 1)?.displayText).toBe("$9.99");
    expect(cellAt(originalSheet, 2, 2)?.displayText).toBe("2026-01-15");
    expect(cellAt(originalSheet, 3, 0)?.displayText).toBe("14:30");
    expect(cellAt(originalSheet, 3, 1)?.displayText).toBe("85");
    expect(cellAt(originalSheet, 4, 0)?.displayText).toBe("Merged Cell");

    const xlsxBytes = odsToXlsx(richOdsBytes());
    const xlsx = xlsxContentOf(xlsxBytes);
    const sheet = xlsx.sheets[0]!;

    expect(cellAt(sheet, 0, 0)?.value).toEqual({
      kind: "string",
      value: "Name",
    });
    expect(cellAt(sheet, 0, 1)?.value).toEqual({
      kind: "string",
      value: "Amount",
    });
    expect(cellAt(sheet, 0, 2)?.value).toEqual({
      kind: "string",
      value: "Active",
    });
    expect(cellAt(sheet, 1, 0)?.value).toEqual({
      kind: "string",
      value: "Widget",
    });
    expect(cellAt(sheet, 1, 1)?.value).toEqual({ kind: "number", value: 42.5 });
    expect(cellAt(sheet, 1, 2)?.value).toEqual({
      kind: "boolean",
      value: true,
    });

    // ooxml.js's xlsx writer/readXlsxContent (2.6.1+) now carry a full xlsx number-format engine: a percentage cell writes a real "0%"-family numFmt and reads back as genuine 'percentage', and a currency cell writes a real "[$USD]#,##0.00"-family numFmt (the ISO currency code embedded in the format code itself, not a separate cell attribute — xlsx has no dedicated currency cell type) and reads back as genuine 'currency' with that code recovered. Both are a real fidelity improvement over the previous "downgrades to plain number" behaviour — the semantic kind now survives, not just the numeric value.
    expect(cellAt(sheet, 2, 0)?.value).toEqual({
      kind: "percentage",
      value: 0.15,
    });
    expect(cellAt(sheet, 2, 1)?.value).toEqual({
      kind: "currency",
      value: 9.99,
      currency: "USD",
    });
    // The same number-format engine now reads a date-only numFmt back as genuine 'date' rather than the previous catch-all 'dateTime' — xlsx still has only the one combined date/time serial wire type, but the reader can now tell a date-only format code from one that also carries a time component.
    expect(cellAt(sheet, 2, 2)?.value).toEqual({
      kind: "date",
      value: "2026-01-15",
    });

    // A source ODS 'time' cell has no numeric serial to write at all — its own ContentCellValue carries an ISO-8601 duration STRING ("PT14H30M00S"), not a fractional-day number, so the xlsx writer cannot express it as an xlsx date/time serial and writes it as a plain string cell instead. The value string still survives byte-for-byte, just honestly labelled as text rather than mislabelled as a date/time.
    expect(cellAt(sheet, 3, 0)?.value).toEqual({
      kind: "string",
      value: "PT14H30M00S",
    });

    // Formula: written verbatim into <f>, never parsed, translated, or evaluated — the exact OpenFormula-syntax string ODS carried survives byte-for-byte, even though it is not valid Excel A1 syntax (a real Excel opening this file would show a formula error; this bridge makes no claim about cross-application formula semantics, only about byte preservation).
    const formulaCell = cellAt(sheet, 3, 1);
    expect(formulaCell?.formula).toBe("of:=[.B2]*2");
    expect(formulaCell?.value).toEqual({ kind: "number", value: 85 });

    // Merge: colSpan survives on the anchor cell.
    const mergedCell = cellAt(sheet, 4, 0);
    expect(mergedCell?.colSpan).toBe(2);
    expect(mergedCell?.value).toEqual({ kind: "string", value: "Merged Cell" });

    // Column widths: within COLUMN_WIDTH_TOLERANCE_PT of the source ODS's own widths (3cm/4cm/2cm), not exact equality — see this describe block's own top comment for why.
    expect(sheet.columns).toHaveLength(3);
    originalSheet.columns.forEach((originalColumn, index) => {
      const xlsxColumn = sheet.columns.find((c) => c.index === index);
      expect(xlsxColumn).toBeDefined();
      expect(
        Math.abs((xlsxColumn?.widthPt ?? 0) - (originalColumn.widthPt ?? 0)),
      ).toBeLessThanOrEqual(COLUMN_WIDTH_TOLERANCE_PT);
    });
  });

  it("throws when the signal is already aborted", () => {
    const controller = new AbortController();
    controller.abort();
    expect(() =>
      odsToXlsx(richOdsBytes(), { signal: controller.signal }),
    ).toThrow();
  });
});

describe("ods <-> xlsx: ods -> xlsx -> ods (double hop, starting from ods)", () => {
  it("carries string/number/boolean values, the verbatim formula, and the merge through both hops", () => {
    const xlsxBytes = odsToXlsx(richOdsBytes());
    const roundTrippedBytes = xlsxToOds(xlsxBytes);
    const sheet = odsContentOf(roundTrippedBytes).sheets[0]!;

    expect(cellAt(sheet, 0, 0)?.value).toEqual({
      kind: "string",
      value: "Name",
    });
    expect(cellAt(sheet, 1, 1)?.value).toEqual({ kind: "number", value: 42.5 });
    expect(cellAt(sheet, 1, 2)?.value).toEqual({
      kind: "boolean",
      value: true,
    });
    expect(cellAt(sheet, 3, 1)?.formula).toBe("of:=[.B2]*2");
    expect(cellAt(sheet, 3, 1)?.value).toEqual({ kind: "number", value: 85 });
    expect(cellAt(sheet, 4, 0)?.colSpan).toBe(2);
    expect(cellAt(sheet, 4, 0)?.value).toEqual({
      kind: "string",
      value: "Merged Cell",
    });
  });

  it("documents the real, known loss of a full double-hop cycle: time collapses into a plain string, but percentage/currency now survive with kind intact and column widths survive within tolerance", () => {
    const original = odsContentOf(richOdsBytes());
    const originalSheet = original.sheets[0]!;

    const xlsxBytes = odsToXlsx(richOdsBytes());
    const roundTrippedBytes = xlsxToOds(xlsxBytes);
    const sheet = odsContentOf(roundTrippedBytes).sheets[0]!;

    // Percentage/currency: both the VALUE and the semantic kind now survive the full double hop — ooxml.js's number-format engine (see the one-hop describe block above) recovers 'percentage'/'currency' on the first hop, and buildOdsPackage's own OdsCell.value setter writes whatever kind it is given back out on the second, so nothing is lost in either direction any more.
    expect(cellAt(sheet, 2, 0)?.value).toEqual({
      kind: "percentage",
      value: 0.15,
    });
    expect(cellAt(sheet, 2, 1)?.value).toEqual({
      kind: "currency",
      value: 9.99,
      currency: "USD",
    });

    // Time: collapses into a plain 'string' on the first hop (xlsx has no serial representation for an ISO-8601 duration, see the one-hop describe block above) and STAYS 'string' on the second, since buildOdsPackage's own OdsCell.value setter writes whatever kind it is given — there is no way back to 'time' once the first hop has already thrown that distinction away.
    expect(cellAt(sheet, 3, 0)?.value).toEqual({
      kind: "string",
      value: "PT14H30M00S",
    });

    // Column widths: buildOdsPackage (src/edit/ods/content.ts) now writes ContentSheetColumn.widthPt for real via OdsSheet.setColumnWidth (src/edit/ods/column-row.ts) — a fix made while composing xlsxToPdf, since an unstyled column previously read back at widthPt 0 there too, and src/layout/sheets.ts's own resolveAxis treats that explicit zero as authoritative rather than falling back to a default (see column-row.ts's own top-of-file note). The tolerance here is COLUMN_WIDTH_TOLERANCE_PT stacked twice, not once — this is a genuine double hop through the SAME lossy xlsx character-width-unit conversion the one-hop test above already documents (ods pt -> xlsx character-width units on the first hop, xlsx character-width units -> ods pt again on the second), so the accumulated drift can be up to twice the one-hop test's own single-hop bound.
    expect(sheet.columns).toHaveLength(3);
    originalSheet.columns.forEach((originalColumn, index) => {
      const roundTrippedColumn = sheet.columns.find((c) => c.index === index);
      expect(roundTrippedColumn).toBeDefined();
      expect(
        Math.abs(
          (roundTrippedColumn?.widthPt ?? 0) - (originalColumn.widthPt ?? 0),
        ),
      ).toBeLessThanOrEqual(COLUMN_WIDTH_TOLERANCE_PT * 2);
    });
  });

  it("throws when the signal is already aborted", () => {
    const controller = new AbortController();
    controller.abort();
    const xlsxBytes = odsToXlsx(richOdsBytes());
    expect(() => xlsxToOds(xlsxBytes, { signal: controller.signal })).toThrow();
  });
});

// A genuinely independent xlsx starting point — built directly via ooxml.js's own buildXlsxPackageFromContent + encodePackage, NOT via odsToXlsx — so this describe block's own round trip doesn't merely re-exercise odsToXlsx's own output. Includes an 'error' cell, the one ContentCellValue kind ODS structurally cannot ever produce on read (OdsCell.value's own getter, src/edit/ods/cell.ts: "Reading it back can never reproduce kind:'error' — no writer ... can put that value-type on the wire — and that is a property of the format, not a gap in this editor"), since xlsx's own t="e" cell type is a genuine ECMA-376 wire format ODS has no equivalent for.
function buildXlsxNativeContentDocument(): ContentDocument {
  return {
    kind: "spreadsheet",
    metadata: {},
    sheets: [
      {
        name: "Sheet1",
        images: [],
        columns: [],
        rows: [],
        printSettings: {
          pageSize: { widthPt: 595, heightPt: 842 },
          margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
          gridlines: false,
          headers: false,
          pageOrder: "downThenOver",
        },
        cells: [
          {
            row: 0,
            column: 0,
            value: { kind: "error", value: "#DIV/0!" },
            displayText: "#DIV/0!",
          },
          {
            row: 0,
            column: 1,
            value: { kind: "number", value: 10 },
            formula: "A1*2",
            displayText: "10",
          },
          {
            row: 1,
            column: 0,
            value: { kind: "string", value: "plain text" },
            displayText: "plain text",
          },
        ],
      },
    ],
  };
}

describe("ods <-> xlsx: xlsx -> ods -> xlsx (double hop, starting from a genuine xlsx source)", () => {
  it("carries the formula and plain-text cell verbatim, and documents the error-kind -> string-kind loss unique to routing through ods", () => {
    const originalXlsxBytes = encodeOoxmlPackage(
      buildXlsxPackageFromContent(buildXlsxNativeContentDocument()),
    );

    const odsBytes = xlsxToOds(originalXlsxBytes);
    const roundTrippedBytes = odsToXlsx(odsBytes);
    const sheet = xlsxContentOf(roundTrippedBytes).sheets[0]!;

    // Formula and plain string cells survive completely.
    expect(cellAt(sheet, 0, 1)?.formula).toBe("A1*2");
    expect(cellAt(sheet, 0, 1)?.value).toEqual({ kind: "number", value: 10 });
    expect(cellAt(sheet, 1, 0)?.value).toEqual({
      kind: "string",
      value: "plain text",
    });

    // ODS has no 'error' value-type on the wire at all (see this describe block's own top comment) — OdsCell.value's own write-side choice for 'error' is to write it as a genuine, non-empty office:string-value carrying the error's own text, so the round trip through ods turns the ORIGINAL xlsx error cell into a plain string cell carrying the identical text. The message survives; the 'error' semantic does not.
    expect(cellAt(sheet, 0, 0)?.value).toEqual({
      kind: "string",
      value: "#DIV/0!",
    });
  });

  it("throws when the signal is already aborted", () => {
    const controller = new AbortController();
    controller.abort();
    const xlsxBytes = encodeOoxmlPackage(
      buildXlsxPackageFromContent(buildXlsxNativeContentDocument()),
    );
    expect(() => xlsxToOds(xlsxBytes, { signal: controller.signal })).toThrow();
  });
});

// --- markdown <-> docx, markdown <-> odt --------------------------------------------------------------------------
//
// markdownToDocx/docxToMarkdown and markdownToOdt/odtToMarkdown are hand-written bridge functions — the composition engine's pathfinder (resolveCompositionPlan in composition.ts) routes them as same-variant bridge hops, and convertDocument's bridge executor runs the identical decode/read/build/encode sequence these functions already hard-code.

describe("markdownToDocx/docxToMarkdown and markdownToOdt/odtToMarkdown never invoke the layout engine (no PDF-pivot regression)", () => {
  it("markdownToDocx does not call convertWordprocessingToLayout", () => {
    const engineSpy = vi.spyOn(engineModule, "convertWordprocessingToLayout");
    markdownToDocx(encodeMarkdownText(richMarkdownText()));
    expect(engineSpy).not.toHaveBeenCalled();
  });

  it("docxToMarkdown does not call convertWordprocessingToLayout", () => {
    const docxBytes = markdownToDocx(encodeMarkdownText(richMarkdownText()));
    const engineSpy = vi.spyOn(engineModule, "convertWordprocessingToLayout");
    docxToMarkdown(docxBytes);
    expect(engineSpy).not.toHaveBeenCalled();
  });

  it("markdownToOdt does not call convertWordprocessingToLayout", () => {
    const engineSpy = vi.spyOn(engineModule, "convertWordprocessingToLayout");
    markdownToOdt(encodeMarkdownText(richMarkdownText()));
    expect(engineSpy).not.toHaveBeenCalled();
  });

  it("odtToMarkdown does not call convertWordprocessingToLayout", () => {
    const odtBytes = markdownToOdt(encodeMarkdownText(richMarkdownText()));
    const engineSpy = vi.spyOn(engineModule, "convertWordprocessingToLayout");
    odtToMarkdown(odtBytes);
    expect(engineSpy).not.toHaveBeenCalled();
  });
});

describe("onDocument (DocumentTree side channel): markdown bridges", () => {
  it("markdownToDocx calls onDocument with content populated and pages left undefined", () => {
    let captured: DocumentTree | undefined;
    const docxBytes = markdownToDocx(encodeMarkdownText(richMarkdownText()), {
      onDocument: (pkg) => {
        captured = pkg;
      },
    });
    expect(docxBytes.length).toBeGreaterThan(0);
    expect(captured).toBeDefined();
    expect(flattenTree(captured!).kind).toBe("wordprocessing");
    expect(captured!.pages).toBeUndefined();
  });
});

describe("markdown <-> docx: markdown -> docx -> markdown", () => {
  it("carries the heading, bold run, list, and table through both hops", () => {
    const docxBytes = markdownToDocx(encodeMarkdownText(richMarkdownText()));
    const roundTrippedBytes = docxToMarkdown(docxBytes);
    const text = decodeMarkdownText(roundTrippedBytes);

    expect(text).toContain("Report Title");
    expect(text).toContain("bold");
    expect(text).toContain("First item");
    expect(text).toContain("A1");
  });

  it("carries a Heading1 styleId and list levels through docx as real ContentDocument structure, not just surviving text", () => {
    const docxBytes = markdownToDocx(encodeMarkdownText(richMarkdownText()));
    const content = docxContentOf(docxBytes);

    const heading = content.sections[0]!.blocks[0];
    expect(heading?.kind).toBe("paragraph");
    expect(heading?.kind === "paragraph" ? heading.styleId : undefined).toBe(
      "Heading1",
    );

    const listBlocks = content.sections[0]!.blocks.filter(
      (b) => b.kind === "paragraph" && b.list !== undefined,
    );
    const levels = listBlocks.map((b) =>
      b.kind === "paragraph" ? b.list?.level : undefined,
    );
    expect(levels).toEqual([0, 0, 1, 0]);
  });

  it("throws when the signal is already aborted, on both hops", () => {
    const controller = new AbortController();
    controller.abort();
    const markdownBytes = encodeMarkdownText(richMarkdownText());
    expect(() =>
      markdownToDocx(markdownBytes, { signal: controller.signal }),
    ).toThrow();
    const docxBytes = markdownToDocx(markdownBytes);
    expect(() =>
      docxToMarkdown(docxBytes, { signal: controller.signal }),
    ).toThrow();
  });
});

describe("markdown <-> odt: markdown -> odt -> markdown", () => {
  it("carries the heading, bold run, list, and table through both hops", () => {
    const odtBytes = markdownToOdt(encodeMarkdownText(richMarkdownText()));
    const roundTrippedBytes = odtToMarkdown(odtBytes);
    const text = decodeMarkdownText(roundTrippedBytes);

    expect(text).toContain("Report Title");
    expect(text).toContain("bold");
    expect(text).toContain("First item");
    expect(text).toContain("A1");
  });

  it("carries a Heading1 styleId through odt as real ContentDocument structure, not just surviving text", () => {
    const odtBytes = markdownToOdt(encodeMarkdownText(richMarkdownText()));
    const content = odtContentOf(odtBytes);

    const heading = content.sections[0]!.blocks[0];
    expect(heading?.kind === "paragraph" ? heading.styleId : undefined).toBe(
      "Heading1",
    );
  });

  // The odt bytes themselves carry the heading as real ODF structure — a text:h element with text:outline-level and the Heading_20_1 style spelling — so a consumer outside this package (LibreOffice's outline, TOC fields, any ODF toolkit) sees a heading, not a plain paragraph styled with a name nothing resolves. The styleId-only assertions above pass even when the heading is written as a text:p carrying the synthetic "Heading1" string verbatim; this one cannot.
  it("writes the markdown heading as a real text:h in the odt bytes, with outline level and the ODF style spelling", () => {
    const odtBytes = markdownToOdt(encodeMarkdownText(richMarkdownText()));
    const pkg = decodeOdfPackage(odtBytes);
    const part = pkg.parts["content.xml"];
    const officeText =
      part?.kind === "xml"
        ? elementsWithTag(part.nodes, "office:text")[0]
        : undefined;
    expect(officeText).toBeDefined();
    const headings = childrenWithTag(officeText!, "text:h");
    expect(headings).toHaveLength(1);
    expect(attr(headings[0]!, "text:outline-level")).toBe("1");
    expect(attr(headings[0]!, "text:style-name")).toBe("Heading_20_1");
    expect(decodeOdfText(headings[0]!)).toBe("Report Title");
  });

  it("throws when the signal is already aborted, on both hops", () => {
    const controller = new AbortController();
    controller.abort();
    const markdownBytes = encodeMarkdownText(richMarkdownText());
    expect(() =>
      markdownToOdt(markdownBytes, { signal: controller.signal }),
    ).toThrow();
    const odtBytes = markdownToOdt(markdownBytes);
    expect(() =>
      odtToMarkdown(odtBytes, { signal: controller.signal }),
    ).toThrow();
  });
});

// docxToMarkdown/odtToMarkdown starting from a rich, editor-built docx/odt — proving text, bold+italic styling, and list membership survive the ContentDocument -> markdown direction too, not just markdown -> ContentDocument.
describe("docx <-> markdown: docx -> markdown -> docx", () => {
  it("carries text, bold/italic styling, and list membership through both hops", () => {
    const originalBytes = buildRichDocx();
    const markdownBytes = docxToMarkdown(originalBytes);
    const roundTrippedBytes = markdownToDocx(markdownBytes);
    const roundTripped = docxContentOf(roundTrippedBytes);

    expect(paragraphTexts(roundTripped).join(" ")).toContain(
      "Bold italic coloured text",
    );

    const styledBlock = roundTripped.sections[0]!.blocks.find(
      (b) => b.kind === "paragraph" && b.runs.some((r) => r.bold === true),
    );
    expect(styledBlock?.kind).toBe("paragraph");
    const styledRun =
      styledBlock?.kind === "paragraph"
        ? styledBlock.runs.find((r) => r.bold === true)
        : undefined;
    expect(styledRun?.bold).toBe(true);
    expect(styledRun?.italic).toBe(true);
    expect(styledRun?.strike).toBe(true);
    // Colour has no markdown source construct at all — the docxToMarkdown hop drops it, matching writeMarkdownContent's own documented CommonMark-vocabulary narrowing.
    expect(styledRun?.color).toBeUndefined();
  });
});

// Cross-variant content bridges: wordprocessing <-> presentation (docx <-> pptx, odt <-> odp). Unlike the same-variant bridges above (direct ContentDocument copy), these cross a variant boundary via a semantic transform (src/convert/variant-bridges.ts) — a flow document's blocks are split into slides, and a deck's blocks are concatenated into a flow. Both directions are approximations, but the blocks themselves (paragraphs, run styling, tables, images) survive intact.
describe("cross-variant bridge: docx <-> pptx", () => {
  it("splits a docx with headings into slides, and concatenates back", () => {
    const editor = createDocx();
    editor.body
      .appendParagraph({ styleId: "Heading1" })
      .appendRun({ text: "First heading" });
    editor.body
      .appendParagraph()
      .appendRun({ text: "Content under first heading" });
    editor.body
      .appendParagraph({ styleId: "Heading2" })
      .appendRun({ text: "Second heading" });
    editor.body
      .appendParagraph()
      .appendRun({ text: "Content under second heading" });
    const docxBytes = editor.toBytes();

    // docx -> pptx: two headings produce two slides, each carrying its own content.
    const pptxBytes = docxToPptx(docxBytes);
    const pptxContent = readPptxContent(decodeOoxmlPackage(pptxBytes));
    if (pptxContent.kind !== "presentation") {
      throw new Error("expected a presentation ContentDocument");
    }
    expect(pptxContent.slides.length).toBe(2);
    // Each slide has one shape with the accumulated blocks.
    expect(pptxContent.slides[0]?.shapes[0]?.blocks.length).toBe(2);
    expect(pptxContent.slides[1]?.shapes[0]?.blocks.length).toBe(2);

    // pptx -> docx: all slides concatenated into one flow document.
    const docxBack = pptxToDocx(pptxBytes);
    const docxBackContent = docxContentOf(docxBack);
    // 4 paragraphs survived (2 headings + 2 content) across 2 slides.
    const paragraphs =
      docxBackContent.sections[0]?.blocks.filter(
        (b) => b.kind === "paragraph",
      ) ?? [];
    expect(paragraphs.length).toBe(4);
  });

  it("a docx with no headings produces a single slide carrying everything", () => {
    const editor = createDocx();
    editor.body.appendParagraph().appendRun({ text: "Just one paragraph" });
    editor.body.appendParagraph().appendRun({ text: "And another" });
    const pptxBytes = docxToPptx(editor.toBytes());
    const pptxContent = readPptxContent(decodeOoxmlPackage(pptxBytes));
    if (pptxContent.kind !== "presentation") {
      throw new Error("expected a presentation ContentDocument");
    }
    expect(pptxContent.slides.length).toBe(1);
    expect(pptxContent.slides[0]?.shapes[0]?.blocks.length).toBe(2);
  });

  it("the layout engine was never called (the bridge bypasses PDF entirely)", () => {
    const editor = createDocx();
    editor.body.appendParagraph().appendRun({ text: "test" });
    const engineSpy = vi.spyOn(engineModule, "convertWordprocessingToLayout");
    docxToPptx(editor.toBytes());
    expect(engineSpy).not.toHaveBeenCalled();
    engineSpy.mockRestore();
  });
});
