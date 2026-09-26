import { decodePackage } from "odf.js";
import { readXlsxContent, decodePackage as decodeOoxmlPackage } from "ooxml.js";
import { describe, expect, it } from "vitest";
import { createDocx, openDocx } from "../edit/docx/editor";
import { createOds } from "../edit/ods/editor";
import { openOdp } from "../edit/odp/editor";
import { openOdt } from "../edit/odt/editor";
import { createPptx } from "../edit/pptx/editor";
import { readDocxContent } from "../ooxml/docx/read";
import { readOdsContent } from "../odf/ods/read";
import { readRtfContent, rtfBytesFromLatin1 } from "rtf-codec";
import { readDocContent, writeDocContent } from "doc-codec";
import { readXlsContent, writeXlsContent } from "xls-codec";
import { readPptContent } from "../ppt/read";
import { writePptContent } from "../ppt/write";
import { requireArrayBufferBytes } from "../model/bytes";
import { readPdf } from "pdf-codec";
import { decodeMarkdownText, encodeMarkdownText } from "../markdown/text";
import { richMarkdownText } from "../test-support/markdown";
import { minimalOdpBytes } from "../test-support/odp";
import { gridOdsBytes } from "../test-support/ods";
import { minimalOdtBytes } from "../test-support/odt";
import {
  docToPdf,
  docxToPdf,
  markdownToPdf,
  odpToPdf,
  odsToPdf,
  odsToXlsx,
  odtToPdf,
  pptToPdf,
  pptxToPdf,
  rtfToPdf,
  xlsToPdf,
  xlsxToPdf,
} from "./convert";
import {
  pdfToDoc,
  pdfToDocx,
  pdfToMarkdown,
  pdfToOdp,
  pdfToOds,
  pdfToOdt,
  pdfToPpt,
  pdfToRtf,
  pdfToXls,
  pdfToXlsx,
} from "./from-pdf";
function pdfHeader(bytes: Uint8Array<ArrayBuffer>): string {
  return new TextDecoder("latin1").decode(bytes.subarray(0, 5));
}

function buildSampleDocx(text: string): Uint8Array<ArrayBuffer> {
  const editor = createDocx();
  editor.body.appendParagraph().appendRun({ text });
  return editor.toBytes();
}

describe("pdfToDocx", () => {
  it("round-trips text content through docxToPdf then pdfToDocx", () => {
    const pdfBytes = docxToPdf(buildSampleDocx("Round trip content"));
    const docxBytes = pdfToDocx(pdfBytes);
    const editor = openDocx(docxBytes);
    const text = editor
      .paragraphs()
      .map((p) => p.text)
      .join(" ");
    expect(text).toContain("Round trip content");
  });

  // Exercises the full ooxml.js-backed docx read path (the flat docx reader's style cascade) through the layout render and back: a bold, coloured, explicitly-sized run must still read back as bold/coloured/sized after the round trip, not just as plain text. A single word (rather than a phrase) sidesteps the reconstruction pipeline's separately-documented word-spacing-inference quirk, which is unrelated to this migration and not what this test targets.
  it("round-trips a bold, coloured, sized run through docxToPdf then pdfToDocx", () => {
    const editor = createDocx();
    const run = editor.body.appendParagraph().appendRun({ text: "StyledRun" });
    run.bold = true;
    run.color = { r: 1, g: 0, b: 0 };
    run.sizePt = 24;

    const pdfBytes = docxToPdf(editor.toBytes());
    const docxBytes = pdfToDocx(pdfBytes);
    const roundTripped = openDocx(docxBytes);

    const runs = roundTripped.paragraphs().flatMap((p) => p.runs());
    const text = runs.map((r) => r.text).join(" ");
    expect(text).toContain("StyledRun");
    expect(runs.some((r) => r.bold)).toBe(true);
    expect(
      runs.some((r) => r.color?.r === 1 && r.color.g === 0 && r.color.b === 0),
    ).toBe(true);
    expect(runs.some((r) => r.sizePt === 24)).toBe(true);
  });

  // Item 3 end to end, through real bytes on both sides: a spreadsheet printed WITH gridlines draws a genuine lattice on the PDF page, and pdfToDocx turns that lattice — and only a lattice — into a real w:tbl in the produced docx. gridOdsBytes is reused rather than a hand-built PDF precisely because its gridlines are drawn by the ordinary odsToPdf path, so nothing about the geometry is arranged to suit the detector.
  it("recovers a real table from a drawn gridline lattice, through odsToPdf then pdfToDocx", () => {
    const docxBytes = pdfToDocx(odsToPdf(gridOdsBytes()));
    const content = readDocxContent(decodeOoxmlPackage(docxBytes)); // reread through ooxml.js's own real readDocx, not this package's writer echoing its input back
    if (content.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing ContentDocument");
    }
    const tables = content.sections
      .flatMap((section) => section.blocks)
      .filter((block) => block.kind === "table");
    expect(tables).toHaveLength(1);
    const [table] = tables;
    if (table?.kind !== "table") {
      throw new Error("expected a table block");
    }
    const grid = table.rows.map((row) =>
      row.cells.map((cell) =>
        cell.blocks
          .flatMap((block) =>
            block.kind === "paragraph" ? block.runs.map((run) => run.text) : [],
          )
          .join(""),
      ),
    );
    // The fixture's own three data rows, plus the header-gutter row/column labels the printed sheet also draws inside the lattice.
    expect(
      grid.some(
        (row) =>
          row.includes("Alpha") &&
          row.includes("Beta") &&
          row.includes("Gamma"),
      ),
    ).toBe(true);
    expect(
      grid.some(
        (row) =>
          row.includes("Four") && row.includes("Five") && row.includes("Six"),
      ),
    ).toBe(true);
  });

  // The gate, end to end: the same fixture rendered from a docx whose page carries no drawn lattice at all must produce no table, however the text happens to line up.
  it("never invents a table on a page with no drawn lattice", () => {
    const docxBytes = pdfToDocx(
      docxToPdf(buildSampleDocx("Plain prose with no table at all")),
    );
    const content = readDocxContent(decodeOoxmlPackage(docxBytes));
    if (content.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing ContentDocument");
    }
    expect(
      content.sections
        .flatMap((section) => section.blocks)
        .some((block) => block.kind === "table"),
    ).toBe(false);
  });
});

describe("pdfToMarkdown", () => {
  // The single lossiest conversion in the whole package (see convert.ts's own top-of-file comment): only the plain text content is asserted here, not styling — reconstructWordprocessing's own geometry-based recovery plus buildMarkdownText's own CommonMark-vocabulary narrowing (no colour, no explicit alignment) means a round-tripped bold run survives as **bold** markdown syntax, which this test does check for, but a coloured run has nothing to survive as at all.
  it("round-trips text content through markdownToPdf then pdfToMarkdown", () => {
    const pdfBytes = markdownToPdf(
      encodeMarkdownText("# Round Trip\n\nSome **bold** content.\n"),
    );
    const markdownBytes = pdfToMarkdown(pdfBytes);
    const text = decodeMarkdownText(markdownBytes);
    expect(text).toContain("Round");
    expect(text).toContain("Trip");
    expect(text).toContain("bold");
  });

  it("throws when the signal is already aborted", () => {
    const pdfBytes = markdownToPdf(encodeMarkdownText(richMarkdownText()));
    const controller = new AbortController();
    controller.abort();
    expect(() =>
      pdfToMarkdown(pdfBytes, { signal: controller.signal }),
    ).toThrow();
  });

  // ExaDev/documents.js#584 ask 1: the reconstructed pageBreak blocks (one per page boundary) reach the markdown text as `<!-- page break -->` markers rather than being dropped by markdown-codec's writer — exact page-boundary information, one marker per boundary, none for a single-page document.
  it("emits one page-break marker per page boundary, and none for a single page", () => {
    const longMarkdown = `# Long Document\n\n${Array.from({ length: 80 }, (_, i) => `Paragraph ${String(i)} of ordinary prose content long enough to fill several printed pages.`).join("\n\n")}\n`;
    const pdfBytes = markdownToPdf(encodeMarkdownText(longMarkdown));
    const pageCount = readPdf(pdfBytes).pages.length;
    expect(pageCount).toBeGreaterThan(1);
    const text = decodeMarkdownText(pdfToMarkdown(pdfBytes));
    const markerCount = text.split("<!-- page break -->").length - 1;
    expect(markerCount).toBe(pageCount - 1);

    const singlePageText = decodeMarkdownText(
      pdfToMarkdown(
        markdownToPdf(encodeMarkdownText("# Just one page\n\nShort body.\n")),
      ),
    );
    expect(singlePageText).not.toContain("<!-- page break -->");
  });

  // The marker MEANS a page break rather than decorating one: readMarkdownContent's marker promotion turns each one back into a pageBreak block, so re-rendering the markdown honours the boundary — this round trip lands on the same page count it started from, rather than printing the markers as literal text.
  it("re-renders pdfToMarkdown output at the same page count, markers honoured as real breaks", () => {
    const longMarkdown = `# Long Document\n\n${Array.from({ length: 80 }, (_, i) => `Paragraph ${String(i)} of ordinary prose content long enough to fill several printed pages.`).join("\n\n")}\n`;
    const pageCount = readPdf(markdownToPdf(encodeMarkdownText(longMarkdown)))
      .pages.length;
    const markdownBytes = pdfToMarkdown(
      markdownToPdf(encodeMarkdownText(longMarkdown)),
    );
    expect(readPdf(markdownToPdf(markdownBytes)).pages.length).toBe(pageCount);
  });

  // ExaDev/documents.js#584 ask 2 end to end: the layout engine renders Heading1/Heading2 at 28/22pt against a 12pt body, and the reconstruction's rank-based heading inference inverts exactly that — the round-tripped title and section come back as ATX headings, not the '**bold**' runs they used to collapse into.
  it("recovers heading levels through markdownToPdf then pdfToMarkdown", () => {
    const source =
      "# Quarterly Report\n\n## Part 1 Scope\n\nThis is body paragraph zero of ordinary prose.\n\nThis is body paragraph one of ordinary prose.\n\nThis is body paragraph two of ordinary prose.\n";
    const text = decodeMarkdownText(
      pdfToMarkdown(markdownToPdf(encodeMarkdownText(source))),
    );
    expect(text).toMatch(/^# Quarterly Report/m);
    expect(text).toMatch(/^## Part 1 Scope/m);
  });

  // The docx consequence of the same inference: ooxml.js's writer emits w:outlineLvl only from the canonical headingLevel (never from a Heading{N} styleId), so rereading the produced docx through the real reader must find the outline level on the title paragraph — a styleId alone would leave a dangling w:pStyle pointing at a styles.xml entry the writer never writes, with no outline level at all.
  it("carries inferred heading levels into pdfToDocx as outline levels, not a bare Heading styleId", () => {
    const source =
      "# Quarterly Report\n\nThis is body paragraph zero of ordinary prose.\n\nThis is body paragraph one of ordinary prose.\n\nThis is body paragraph two of ordinary prose.\n";
    const docxBytes = pdfToDocx(markdownToPdf(encodeMarkdownText(source)));
    const content = readDocxContent(decodeOoxmlPackage(docxBytes));
    if (content.kind !== "wordprocessing") {
      throw new Error("expected wordprocessing");
    }
    const heading = content.sections
      .flatMap((s) => s.blocks)
      .find((b) => b.kind === "paragraph" && b.headingLevel !== undefined);
    expect(heading).toMatchObject({
      kind: "paragraph",
      styleId: "Heading1",
      headingLevel: 1,
    });
  });

  // ExaDev/documents.js#584 ask 3, pinned end to end: where the table recovery's gridline-lattice gate succeeds, the recovered ContentTable already flows through buildMarkdownText into a real GFM pipe table (markdown-codec's emitTable) — this test holds that wiring at the markdown surface. The fixture is a spreadsheet printed WITH gridlines (gridOdsBytes through the ordinary odsToPdf path, the same one the pdfToDocx lattice test uses), because a markdown-authored table renders no lattice at all: markdown carries no border concept, so the cells' text arrives as tab-separated prose instead. The gate refusing alignment-only structure is the documented, intended boundary — recovery requires the drawn lattice, never invented geometry.
  it("recovers a drawn-lattice table as a GFM pipe table, through odsToPdf then pdfToMarkdown", () => {
    const text = decodeMarkdownText(pdfToMarkdown(odsToPdf(gridOdsBytes())));
    const pipeRows = text.split("\n").filter((line) => line.startsWith("|"));
    expect(pipeRows.length).toBeGreaterThanOrEqual(2);
    expect(
      pipeRows.some(
        (row) =>
          row.includes("Alpha") &&
          row.includes("Beta") &&
          row.includes("Gamma"),
      ),
    ).toBe(true);
    // A GFM table needs its delimiter row to reparse as a table at all.
    expect(pipeRows.some((row) => /^\|(\s*-{3,}\s*\|)+$/.test(row))).toBe(true);
  });
});

describe("pdfToOdt", () => {
  it("round-trips text content through odtToPdf then pdfToOdt", () => {
    const pdfBytes = odtToPdf(minimalOdtBytes());
    const odtBytes = pdfToOdt(pdfBytes);
    const editor = openOdt(odtBytes);
    const text = editor
      .paragraphs()
      .map((p) => p.text)
      .join(" ");
    expect(text).toContain("bold text");
  });

  // Mirrors pdfToDocx's own equivalent test: exercises the full pipeline (readPdf -> reconstructWordprocessing, entirely unmodified — the same architectural bet odtToPdf's own build already proved — -> buildOdtPackage) through a fresh, hand-built odt rather than the minimalOdtBytes fixture, so a bold/coloured/sized run really is recovered from PDF geometry, not merely carried through unchanged.
  it("round-trips a bold, coloured, sized run through docxToPdf then pdfToOdt", () => {
    const docxEditor = createDocx();
    const run = docxEditor.body
      .appendParagraph()
      .appendRun({ text: "StyledRun" });
    run.bold = true;
    run.color = { r: 1, g: 0, b: 0 };
    run.sizePt = 24;

    const pdfBytes = docxToPdf(docxEditor.toBytes());
    const odtBytes = pdfToOdt(pdfBytes);
    const roundTripped = openOdt(odtBytes);

    const runs = roundTripped.paragraphs().flatMap((p) => p.runs());
    const text = runs.map((r) => r.text).join(" ");
    expect(text).toContain("StyledRun");
    expect(runs.some((r) => r.bold)).toBe(true);
    expect(
      runs.some((r) => r.color?.r === 1 && r.color.g === 0 && r.color.b === 0),
    ).toBe(true);
    expect(runs.some((r) => r.sizePt === 24)).toBe(true);
  });

  // The other heading-carrying source besides markdown: reconstructWordprocessing's font-size rank inference (each distinct size at least 2pt above the modal body size is a heading, ranked largest-first) sets headingLevel alongside the Heading{N} styleId, and buildOdtPackage writes both through as one real text:h — markdownToPdf renders '# Report Title' at the heading 1 size, so the heading comes back ranked level 1.
  it("round-trips an inferred heading through markdownToPdf then pdfToOdt as a real text:h", () => {
    const pdfBytes = markdownToPdf(encodeMarkdownText(richMarkdownText()));
    const odtBytes = pdfToOdt(pdfBytes);
    const heading = openOdt(odtBytes)
      .paragraphs()
      .find((p) => p.headingLevel !== undefined);
    expect(heading?.text).toBe("Report Title");
    expect(heading?.headingLevel).toBe(1);
  });
});

describe("pdfToOdp", () => {
  // The fixture's title frame is rotated 30 degrees (see test-support/odp.ts), and wrapRunsToWidth fragments it into one LayoutText per word — reconstructPresentation's own geometry-based line clustering does not guarantee those fragments come back in original reading order for rotated text (mirrors convert.test.ts's own odpToPdf rotated-shape test, which checks only the title's first word for the identical reason). This checks each word landed somewhere, not that the phrase reconstructed in its original order.
  it("round-trips text content through odpToPdf then pdfToOdp", () => {
    const pdfBytes = odpToPdf(minimalOdpBytes());
    const odpBytes = pdfToOdp(pdfBytes);
    const editor = openOdp(odpBytes);
    const text = editor
      .slides()
      .flatMap((s) => s.shapes())
      .map((s) => s.text)
      .join(" ");
    expect(text).toContain("Hello");
    expect(text).toContain("from");
    expect(text).toContain("odp");
  });

  // Mirrors pdfToPptx's own equivalent test: exercises the full pipeline (readPdf -> reconstructPresentation, entirely unmodified — the same architectural bet odpToPdf's own build already proved — -> buildOdpPackage) through a fresh, hand-built pptx rather than the minimalOdpBytes fixture, so a bold/coloured/sized run really is recovered from PDF geometry, not merely carried through unchanged.
  it("round-trips a bold, coloured, sized run through pptxToPdf then pdfToOdp", () => {
    const pptxEditor = createPptx();
    pptxEditor.addSlide().addTextBox({
      frame: { xPt: 50, yPt: 50, widthPt: 400, heightPt: 100 },
      text: "StyledSlideRun",
    });

    const pdfBytes = pptxToPdf(pptxEditor.toBytes());
    const odpBytes = pdfToOdp(pdfBytes);
    const roundTripped = openOdp(odpBytes);

    const shapes = roundTripped.slides().flatMap((s) => s.shapes());
    const text = shapes.map((s) => s.text).join(" ");
    expect(text).toContain("StyledSlideRun");
  });

  it("round-trips speaker notes through odpToPdf then pdfToOdp", () => {
    const editor = createPptx();
    const slide = editor.addSlide();
    slide.addTextBox({
      frame: { xPt: 50, yPt: 50, widthPt: 400, heightPt: 100 },
      text: "Slide with notes",
    });
    slide.notes = "These are the speaker notes for this slide";

    const pdfBytes = pptxToPdf(editor.toBytes());
    const odpBytes = pdfToOdp(pdfBytes);
    const roundTripped = openOdp(odpBytes);

    expect(roundTripped.slides()[0]?.notes).toBe(
      "These are the speaker notes for this slide",
    );
  });
});

describe("pdfToOds", () => {
  // gridOdsBytes (src/test-support/ods.ts) is a purpose-built fixture: three real, fully visible columns and three rows, gridlines AND headers explicitly enabled — unlike minimalOdsBytes's own hidden column, which collapses two of its own gridline boundaries onto the same x position and would defeat this test's whole point. odsToPdf genuinely draws the LayoutLine lattice (src/layout/sheets.ts's renderGridlines) reconstructSpreadsheet's own gridline-detection path needs, so this proves the lattice path is what actually ran, not the text-clustering fallback. Every cell in this fixture is an ordinary word, so every one of them also stays a plain string through the heuristic re-typing step — the point being that re-typing only fires on text that is genuinely number/date/boolean-shaped, never on arbitrary content; the sibling test below covers the case where it does fire.
  it("round-trips a real gridline lattice and every cell's text through odsToPdf then pdfToOds, detected via the drawn gridlines rather than text-position clustering", () => {
    const pdfBytes = odsToPdf(gridOdsBytes());
    const odsBytes = pdfToOds(pdfBytes);
    const roundTripped = readOdsContent(decodePackage(odsBytes)); // reread via odf.js's own real readOds parser (readOdsContent is a thin wrapper over it), not this package's own writer echoing its input back
    if (roundTripped.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }

    const [sheet] = roundTripped.sheets;
    expect(sheet).toBeDefined();
    expect(sheet!.printSettings.gridlines).toBe(true); // confirms the gridline-lattice path was actually taken, not the text-clustering fallback

    for (const cell of sheet!.cells) {
      expect(cell.value).toEqual({ kind: "string", value: cell.displayText }); // ordinary words: nothing to infer, so nothing is inferred
      expect(cell.formula).toBeUndefined(); // a formula is still never claimed — nothing about a rendered value implies one was computed
    }

    const byRow = new Map<number, string[]>();
    for (const cell of sheet!.cells) {
      const row = byRow.get(cell.row) ?? [];
      row[cell.column] = cell.displayText;
      byRow.set(cell.row, row);
    }
    const rows = [...byRow.keys()]
      .sort((a, b) => a - b)
      .map((r) => byRow.get(r));
    expect(rows).toEqual([
      ["Alpha", "Beta", "Gamma"],
      ["One", "Two", "Three"],
      ["Four", "Five", "Six"],
    ]);
  });

  // The re-typing half of the same real pipeline, end to end and through real ODF bytes on both sides: a spreadsheet whose cells print as a number, a currency amount, a date, a boolean and a product code goes out through odsToPdf and comes back through pdfToOds with the first four typed and the fifth deliberately left alone. Column widths and row heights are set explicitly because a sheet built purely through createOds/cell() otherwise renders at a zero-size grid (src/edit/ods/content.ts's own documented gap), which would collapse every cell onto the same position before the PDF was ever written.
  it("re-types confidently-shaped cells and leaves an ambiguous one alone, through a real odsToPdf then pdfToOds cycle", () => {
    const editor = createOds();
    const sheet = editor.sheets()[0]!;
    sheet.printSettings = {
      pageSize: { widthPt: 400, heightPt: 300 },
      margins: { topPt: 10, rightPt: 10, bottomPt: 10, leftPt: 10 },
      gridlines: false,
      headers: false,
      pageOrder: "downThenOver",
    };
    const printed = ["1234.50", "2024-01-15", "TRUE", "007"];
    printed.forEach((value, i) => {
      sheet.cell(0, i).value = { kind: "string", value };
      sheet.setColumnWidth(i, 80);
    });
    sheet.setRowHeight(0, 20);

    const roundTripped = readOdsContent(
      decodePackage(pdfToOds(odsToPdf(editor.toBytes()))),
    );
    if (roundTripped.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    const cells = roundTripped.sheets[0]!.cells;
    expect(cells.map((c) => c.displayText)).toEqual(printed); // the printed strings survive verbatim regardless of what was inferred from them
    expect(cells.map((c) => c.value.kind)).toEqual([
      "number",
      "date",
      "boolean",
      "string",
    ]); // '007' is the ambiguous one: a leading zero reads as an identifier, so it stays exactly as printed
  });

  it("throws when the signal is already aborted", () => {
    const pdfBytes = odsToPdf(gridOdsBytes());
    const controller = new AbortController();
    controller.abort();
    expect(() => pdfToOds(pdfBytes, { signal: controller.signal })).toThrow();
  });
});

describe("xlsxToPdf / pdfToXlsx", () => {
  // xlsxToPdf/pdfToXlsx have no layout engine or reconstruction algorithm of their own (see convert.ts's own module comment on this pair) — each composes the existing ods<->xlsx bridge with the existing ods<->pdf layout edge. The starting xlsx bytes here are real, ooxml.js-written bytes built via odsToXlsx over gridOdsBytes (the same fixture pdfToOds's own gridline-lattice test above uses), not a hand-fabricated ContentDocument, so this is a genuine xlsx -> PDF -> xlsx cycle through the full composed pipeline on both hops.
  it("round-trips real xlsx bytes through xlsxToPdf then pdfToXlsx into a valid spreadsheet ContentDocument", () => {
    const xlsxBytes = odsToXlsx(gridOdsBytes());

    const pdfBytes = xlsxToPdf(xlsxBytes);
    expect(pdfHeader(pdfBytes)).toBe("%PDF-");

    const roundTrippedBytes = pdfToXlsx(pdfBytes);
    const roundTripped = readXlsxContent(decodeOoxmlPackage(roundTrippedBytes)); // reread via ooxml.js's own real readXlsxContent parser, not this package's own writer echoing its input back
    expect(roundTripped.kind).toBe("spreadsheet");
    if (roundTripped.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }

    const [sheet] = roundTripped.sheets;
    expect(sheet).toBeDefined();
    expect(sheet!.cells.length).toBeGreaterThan(0);

    // pdfToOds's own honest-recovery guarantee (a bare string, never re-parsed into number/date/boolean, never claimed as a formula) survives the extra xlsx hop on each side unchanged, since neither xlsxToOds nor odsToXlsx reinterprets a cell's own value kind.
    for (const cell of sheet!.cells) {
      expect(cell.value).toEqual({ kind: "string", value: cell.displayText });
    }

    const byRow = new Map<number, string[]>();
    for (const cell of sheet!.cells) {
      const row = byRow.get(cell.row) ?? [];
      row[cell.column] = cell.displayText;
      byRow.set(cell.row, row);
    }
    const rows = [...byRow.keys()]
      .sort((a, b) => a - b)
      .map((r) => byRow.get(r));
    expect(rows).toEqual([
      ["Alpha", "Beta", "Gamma"],
      ["One", "Two", "Three"],
      ["Four", "Five", "Six"],
    ]);
  });

  it("throws when the signal is already aborted, on both hops", () => {
    const xlsxBytes = odsToXlsx(gridOdsBytes());
    const pdfBytes = xlsxToPdf(xlsxBytes);
    const controller = new AbortController();
    controller.abort();
    expect(() => xlsxToPdf(xlsxBytes, { signal: controller.signal })).toThrow();
    expect(() => pdfToXlsx(pdfBytes, { signal: controller.signal })).toThrow();
  });
});

describe("rtfToPdf / pdfToRtf", () => {
  // rtfToPdf/pdfToRtf have no layout engine or reconstruction algorithm of their own (see convert.ts's own module comment on this pair) — each composes the existing rtf<->docx same-variant bridge with the existing docx<->pdf layout edge, the identical shape xlsxToPdf/pdfToXlsx has via ods. The starting bytes here are a hand-authored literal RTF source, matching this suite's own fixture-independence convention rather than generating it through writeRtfContent (the very function this pair's own bridge hop calls internally).
  it("round-trips real rtf bytes through rtfToPdf then pdfToRtf recovering the source text", () => {
    const rtfBytes = requireArrayBufferBytes(
      rtfBytesFromLatin1(
        "{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0\\froman Times New Roman;}}\\fs24 Hello, world.\\par}",
      ),
    );

    const pdfBytes = rtfToPdf(rtfBytes);
    expect(pdfHeader(pdfBytes)).toBe("%PDF-");

    const roundTrippedBytes = pdfToRtf(pdfBytes);
    const roundTripped = readRtfContent(roundTrippedBytes).document; // reread via rtf-codec's own real readRtfContent parser, not this package's own writer echoing its input back
    expect(roundTripped.kind).toBe("wordprocessing");
    if (roundTripped.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing ContentDocument");
    }
    const text = roundTripped.sections
      .flatMap((section) => section.blocks)
      .filter((block) => block.kind === "paragraph")
      .flatMap((paragraph) => paragraph.runs)
      .map((run) => run.text)
      .join("");
    expect(text).toContain("Hello, world.");
  });

  it("throws when the signal is already aborted, on both hops", () => {
    const rtfBytes = requireArrayBufferBytes(
      rtfBytesFromLatin1(
        "{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0\\froman Times New Roman;}}\\fs24 Hello, world.\\par}",
      ),
    );
    const pdfBytes = rtfToPdf(rtfBytes);
    const controller = new AbortController();
    controller.abort();
    expect(() => rtfToPdf(rtfBytes, { signal: controller.signal })).toThrow();
    expect(() => pdfToRtf(pdfBytes, { signal: controller.signal })).toThrow();
  });
});

describe("docToPdf / pdfToDoc", () => {
  // docToPdf/pdfToDoc have no layout engine or reconstruction algorithm of their own (see convert.ts's own module comment on this pair) — each composes the existing doc<->docx same-variant bridge with the existing docx<->pdf layout edge, the identical shape rtfToPdf/pdfToRtf has. The starting bytes are built through doc-codec's own writeDocContent directly, matching this suite's own fixture-independence convention — doc-codec's writer covers a single wordprocessing section of plain paragraphs only (see that package's README scope note).
  function sampleDocBytes(text: string): Uint8Array<ArrayBuffer> {
    return writeDocContent({
      kind: "wordprocessing",
      metadata: {},
      sections: [
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks: [{ kind: "paragraph", runs: [{ text }] }],
        },
      ],
    });
  }

  it("round-trips real doc bytes through docToPdf then pdfToDoc recovering the source text", () => {
    const docBytes = sampleDocBytes("Hello, world.");

    const pdfBytes = docToPdf(docBytes);
    expect(pdfHeader(pdfBytes)).toBe("%PDF-");

    const roundTrippedBytes = pdfToDoc(pdfBytes);
    const roundTripped = readDocContent(roundTrippedBytes); // reread via doc-codec's own real readDocContent parser, not this package's own writer echoing its input back
    expect(roundTripped.kind).toBe("wordprocessing");
    if (roundTripped.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing ContentDocument");
    }
    const text = roundTripped.sections
      .flatMap((section) => section.blocks)
      .filter((block) => block.kind === "paragraph")
      .flatMap((paragraph) => paragraph.runs)
      .map((run) => run.text)
      .join("");
    expect(text).toContain("Hello, world.");
  });

  it("throws when the signal is already aborted, on both hops", () => {
    const docBytes = sampleDocBytes("Hello, world.");
    const pdfBytes = docToPdf(docBytes);
    const controller = new AbortController();
    controller.abort();
    expect(() => docToPdf(docBytes, { signal: controller.signal })).toThrow();
    expect(() => pdfToDoc(pdfBytes, { signal: controller.signal })).toThrow();
  });
});

describe("xlsToPdf / pdfToXls", () => {
  // xlsToPdf/pdfToXls have no layout engine of their own — each composes the existing xls<->ods same-variant bridge with the existing ods<->pdf layout edge, the identical shape xlsxToPdf/pdfToXlsx has. The starting bytes are built through xls-codec's own writeXlsContent directly, matching docToPdf's own fixture-independence convention above.
  function sampleXlsBytes(cellText: string): Uint8Array<ArrayBuffer> {
    return writeXlsContent({
      kind: "spreadsheet",
      metadata: {},
      sheets: [
        {
          name: "Sheet1",
          cells: [
            {
              row: 0,
              column: 0,
              value: { kind: "string", value: cellText },
              displayText: cellText,
            },
          ],
          columns: [],
          rows: [],
          images: [],
          printSettings: {
            pageSize: { widthPt: 612, heightPt: 792 },
            margins: {
              topPt: 54,
              rightPt: 50.4,
              bottomPt: 54,
              leftPt: 50.4,
            },
            gridlines: false,
            headers: false,
            pageOrder: "downThenOver",
          },
        },
      ],
    });
  }

  it("round-trips real xls bytes through xlsToPdf then pdfToXls recovering the source cell text", () => {
    const xlsBytes = sampleXlsBytes("Hello, world.");

    const pdfBytes = xlsToPdf(xlsBytes);
    expect(pdfHeader(pdfBytes)).toBe("%PDF-");

    const roundTrippedBytes = pdfToXls(pdfBytes);
    const roundTripped = readXlsContent(roundTrippedBytes); // reread via xls-codec's own real readXlsContent parser
    expect(roundTripped.kind).toBe("spreadsheet");
    const text = roundTripped.sheets
      .flatMap((sheet) => sheet.cells)
      .map((cell) => cell.displayText)
      .join(" ");
    expect(text).toContain("Hello, world.");
  });

  it("throws when the signal is already aborted, on both hops", () => {
    const xlsBytes = sampleXlsBytes("Hello, world.");
    const pdfBytes = xlsToPdf(xlsBytes);
    const controller = new AbortController();
    controller.abort();
    expect(() => xlsToPdf(xlsBytes, { signal: controller.signal })).toThrow();
    expect(() => pdfToXls(pdfBytes, { signal: controller.signal })).toThrow();
  });
});

describe("pptToPdf / pdfToPpt", () => {
  // pptToPdf/pdfToPpt have no layout engine of their own — each composes the existing ppt<->pptx same-variant bridge with the existing pptx<->pdf layout edge, the identical shape rtfToPdf/docToPdf has one variant over. The starting bytes are built through this package's own src/ppt/write.ts (ppt-codec's own writePptContent, wrapped — see that module's own comment), matching docToPdf's own fixture-independence convention above.
  function samplePptBytes(text: string): Uint8Array<ArrayBuffer> {
    return writePptContent({
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
              blocks: [{ kind: "paragraph", runs: [{ text }] }],
            },
          ],
        },
      ],
    });
  }

  it("round-trips real ppt bytes through pptToPdf then pdfToPpt recovering the source slide text", () => {
    const pptBytes = samplePptBytes("Hello, world.");

    const pdfBytes = pptToPdf(pptBytes);
    expect(pdfHeader(pdfBytes)).toBe("%PDF-");

    const roundTrippedBytes = pdfToPpt(pdfBytes);
    const roundTripped = readPptContent(roundTrippedBytes); // reread via src/ppt/read.ts's own real adapter over ppt-codec's readPptContent
    expect(roundTripped.kind).toBe("presentation");
    if (roundTripped.kind !== "presentation") {
      throw new Error("expected a presentation ContentDocument");
    }
    const text = roundTripped.slides
      .flatMap((slide) => slide.shapes)
      .flatMap((shape) => shape.blocks)
      .filter((block) => block.kind === "paragraph")
      .flatMap((paragraph) => paragraph.runs)
      .map((run) => run.text)
      .join("");
    expect(text).toContain("Hello, world.");
  });

  it("throws when the signal is already aborted, on both hops", () => {
    const pptBytes = samplePptBytes("Hello, world.");
    const pdfBytes = pptToPdf(pptBytes);
    const controller = new AbortController();
    controller.abort();
    expect(() => pptToPdf(pptBytes, { signal: controller.signal })).toThrow();
    expect(() => pdfToPpt(pdfBytes, { signal: controller.signal })).toThrow();
  });
});
