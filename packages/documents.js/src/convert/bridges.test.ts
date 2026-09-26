import { flattenTree, type DocumentTree } from "document-schema.js";
import { decodePackage as decodeOdfPackage } from "odf.js";
import { decodePackage as decodeOoxmlPackage } from "ooxml.js";
import { describe, expect, it, vi } from "vitest";
import { createDocx } from "../edit/docx/editor";
import { createOdp } from "../edit/odp/editor";
import { createOdt } from "../edit/odt/editor";
import { createPptx } from "../edit/pptx/editor";
import * as engineModule from "../layout/engine";
import * as slidesModule from "../layout/slides";
import { readDocxContent } from "../ooxml/docx/read";
import { readPptxContent } from "../ooxml/pptx/read";
import { readOdpContent } from "../odf/odp/read";
import { readOdtContent } from "../odf/odt/read";
import { minimalOdpBytes } from "../test-support/odp";
import { minimalOdtBytes } from "../test-support/odt";
import { docxToOdt, odpToPptx, odtToDocx, pptxToOdp } from "./convert";
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

function pptxContentOf(bytes: Uint8Array<ArrayBuffer>) {
  const content = readPptxContent(decodeOoxmlPackage(bytes));
  if (content.kind !== "presentation") {
    throw new Error("expected a presentation ContentDocument");
  }
  return content;
}

function odpContentOf(bytes: Uint8Array<ArrayBuffer>) {
  const content = readOdpContent(decodeOdfPackage(bytes));
  if (content.kind !== "presentation") {
    throw new Error("expected a presentation ContentDocument");
  }
  return content;
}

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
function buildRichOdt(): Uint8Array<ArrayBuffer> {
  const editor = createOdt();
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

  const list = editor.body.appendList();
  const listItem1 = list.addItem();
  listItem1.appendParagraph().appendRun({ text: "First item" });
  const listItem2 = list.addItem();
  listItem2.appendParagraph().appendRun({ text: "Second item" });
  const nestedList = listItem2.addNestedList();
  nestedList.addItem().appendParagraph().appendRun({ text: "Nested item" });
  const listItem3 = list.addItem();
  listItem3.appendParagraph().appendRun({ text: "Third top-level item" });

  const table = editor.body.appendTable({
    rows: 2,
    columns: 2,
    columnWidthsPt: [150, 150],
  });
  const rows = table.rows();
  rows[0]!.cells()[0]!.paragraphs()[0]!.appendRun({ text: "A1" });
  rows[0]!.cells()[1]!.paragraphs()[0]!.appendRun({ text: "B1" });
  rows[1]!.cells()[0]!.paragraphs()[0]!.appendRun({ text: "A2" });
  rows[1]!.cells()[1]!.paragraphs()[0]!.appendRun({ text: "B2" });

  return editor.toBytes();
}

function paragraphTexts(content: ReturnType<typeof docxContentOf>): string[] {
  return content.sections[0]!.blocks.filter((b) => b.kind === "paragraph").map(
    (b) => b.runs.map((r) => r.text).join(""),
  );
}

describe("onDocument (DocumentTree side channel)", () => {
  // A bridge never runs a layout engine (see convert.ts's own DocumentBridgeOptions comment), so its DocumentTree always carries content only, with no pages array and no node frames — unlike the PDF-pivot conversions, which populate both (see convert.test.ts's own docxToPdf onDocument test).
  it("calls onDocument with content populated and pages left undefined", () => {
    let captured: DocumentTree | undefined;
    const docxBytes = odtToDocx(minimalOdtBytes(), {
      onDocument: (pkg) => {
        captured = pkg;
      },
    });
    expect(docxBytes.length).toBeGreaterThan(0);

    expect(captured).toBeDefined();
    const pkg = captured!;
    expect(pkg.kind).toBe("wordprocessing");
    expect(flattenTree(pkg).kind).toBe("wordprocessing");
    expect(pkg.pages).toBeUndefined();
  });
});

// Regression guard for the newly-composed xlsx<->PDF pair (convert.ts's own xlsxToPdf/pdfToXlsx, built by composing the ods<->xlsx bridge with the ods<->pdf layout edge): confirms that adding that composed route did NOT change docxToOdt/odtToDocx or pptxToOdp/odpToPptx to route through a PDF pivot instead of their own existing direct bridge functions. convertWordprocessingToLayout (src/layout/engine.ts) and convertPresentationToLayout (src/layout/slides.ts) are the one and only entry points every PDF-pivot conversion in this file (docxToPdf/odtToPdf/pptxToPdf/odpToPdf, and their reverses via reconstructWordprocessing/reconstructPresentation) must pass through to reach a LayoutDocument at all — so spying on them and asserting zero calls during a bridge conversion is a direct, mechanical proof that no PDF pivot ran, not an inference from timing or byte size.
describe("docxToOdt/odtToDocx and pptxToOdp/odpToPptx never invoke the layout engine (no PDF-pivot regression)", () => {
  it("docxToOdt does not call convertWordprocessingToLayout or convertPresentationToLayout", () => {
    const engineSpy = vi.spyOn(engineModule, "convertWordprocessingToLayout");
    const slidesSpy = vi.spyOn(slidesModule, "convertPresentationToLayout");
    const docxBytes = odtToDocx(minimalOdtBytes());
    engineSpy.mockClear();
    slidesSpy.mockClear();

    docxToOdt(docxBytes);

    expect(engineSpy).not.toHaveBeenCalled();
    expect(slidesSpy).not.toHaveBeenCalled();
  });

  it("odtToDocx does not call convertWordprocessingToLayout or convertPresentationToLayout", () => {
    const engineSpy = vi.spyOn(engineModule, "convertWordprocessingToLayout");
    const slidesSpy = vi.spyOn(slidesModule, "convertPresentationToLayout");

    odtToDocx(minimalOdtBytes());

    expect(engineSpy).not.toHaveBeenCalled();
    expect(slidesSpy).not.toHaveBeenCalled();
  });

  it("pptxToOdp does not call convertPresentationToLayout or convertWordprocessingToLayout", () => {
    const engineSpy = vi.spyOn(engineModule, "convertWordprocessingToLayout");
    const slidesSpy = vi.spyOn(slidesModule, "convertPresentationToLayout");
    const pptxBytes = odpToPptx(minimalOdpBytes());
    engineSpy.mockClear();
    slidesSpy.mockClear();

    pptxToOdp(pptxBytes);

    expect(engineSpy).not.toHaveBeenCalled();
    expect(slidesSpy).not.toHaveBeenCalled();
  });

  it("odpToPptx does not call convertPresentationToLayout or convertWordprocessingToLayout", () => {
    const engineSpy = vi.spyOn(engineModule, "convertWordprocessingToLayout");
    const slidesSpy = vi.spyOn(slidesModule, "convertPresentationToLayout");

    odpToPptx(minimalOdpBytes());

    expect(engineSpy).not.toHaveBeenCalled();
    expect(slidesSpy).not.toHaveBeenCalled();
  });
});

describe("odt <-> docx: docx -> odt -> docx", () => {
  it("carries text, styleId, run styling, list membership, and table structure through both hops", () => {
    const originalBytes = buildRichDocx();
    const original = docxContentOf(originalBytes);

    const odtBytes = docxToOdt(originalBytes);
    const roundTrippedBytes = odtToDocx(odtBytes);
    const roundTripped = docxContentOf(roundTrippedBytes);

    expect(paragraphTexts(roundTripped)).toEqual(paragraphTexts(original));

    const heading = roundTripped.sections[0]!.blocks[0];
    expect(heading?.kind).toBe("paragraph");
    expect(heading?.kind === "paragraph" ? heading.styleId : undefined).toBe(
      "Heading1",
    );

    const styledBlock = roundTripped.sections[0]!.blocks[1];
    expect(styledBlock?.kind).toBe("paragraph");
    const styledRun =
      styledBlock?.kind === "paragraph" ? styledBlock.runs[0] : undefined;
    expect(styledRun?.bold).toBe(true);
    expect(styledRun?.italic).toBe(true);
    expect(styledRun?.strike).toBe(true);
    expect(styledRun?.color?.r).toBeCloseTo(0.8, 5);
    expect(styledRun?.color?.g).toBeCloseTo(0, 5);
    expect(styledRun?.color?.b).toBeCloseTo(0, 5);

    // List membership: four consecutive list paragraphs at blocks[3..6], levels 0,0,1,0 — the exact shape appendListRun (src/edit/odt/content.ts) is built to reconstruct from odt's structural text:list/text:list-item tree.
    const listBlocks = roundTripped.sections[0]!.blocks.slice(3, 7);
    const listLevels = listBlocks.map((b) =>
      b.kind === "paragraph" ? b.list?.level : undefined,
    );
    expect(listLevels).toEqual([0, 0, 1, 0]);
    // Every list paragraph shares the same numId once round-tripped through one odt text:list (a single top-level list, never split into several).
    const numIds = new Set(
      listBlocks.map((b) =>
        b.kind === "paragraph" ? b.list?.numId : undefined,
      ),
    );
    expect(numIds.size).toBe(1);
    expect(numIds.has(undefined)).toBe(false);

    const tableBlock = roundTripped.sections[0]!.blocks[7];
    expect(tableBlock?.kind).toBe("table");
    if (tableBlock?.kind === "table") {
      expect(tableBlock.rows).toHaveLength(2);
      expect(tableBlock.rows[0]?.cells).toHaveLength(2);
      const cellText = (row: number, col: number) => {
        const cell = tableBlock.rows[row]?.cells[col];
        const firstBlock = cell?.blocks[0];
        return firstBlock?.kind === "paragraph"
          ? firstBlock.runs.map((r) => r.text).join("")
          : undefined;
      };
      expect(cellText(0, 0)).toBe("A1");
      expect(cellText(0, 1)).toBe("B1");
      expect(cellText(1, 0)).toBe("A2");
      expect(cellText(1, 1)).toBe("B2");
    }
  });

  it("throws when the signal is already aborted, on both hops", () => {
    const controller = new AbortController();
    controller.abort();
    const docxBytes = buildRichDocx();
    expect(() => docxToOdt(docxBytes, { signal: controller.signal })).toThrow();
    const odtBytes = docxToOdt(docxBytes);
    expect(() => odtToDocx(odtBytes, { signal: controller.signal })).toThrow();
  });
});

describe("odt <-> docx: odt -> docx -> odt", () => {
  it("carries text, styleId, run styling, list membership, and table structure through both hops", () => {
    const originalBytes = buildRichOdt();
    const original = odtContentOf(originalBytes);

    const docxBytes = odtToDocx(originalBytes);
    const roundTrippedBytes = docxToOdt(docxBytes);
    const roundTripped = odtContentOf(roundTrippedBytes);

    expect(paragraphTexts(roundTripped)).toEqual(paragraphTexts(original));

    const heading = roundTripped.sections[0]!.blocks[0];
    expect(heading?.kind === "paragraph" ? heading.styleId : undefined).toBe(
      "Heading1",
    );

    const styledBlock = roundTripped.sections[0]!.blocks[1];
    const styledRun =
      styledBlock?.kind === "paragraph" ? styledBlock.runs[0] : undefined;
    expect(styledRun?.bold).toBe(true);
    expect(styledRun?.italic).toBe(true);
    expect(styledRun?.strike).toBe(true);
    expect(styledRun?.color?.r).toBeCloseTo(0.8, 5);

    const listBlocks = roundTripped.sections[0]!.blocks.slice(3, 7);
    const listLevels = listBlocks.map((b) =>
      b.kind === "paragraph" ? b.list?.level : undefined,
    );
    expect(listLevels).toEqual([0, 0, 1, 0]);

    const tableBlock = roundTripped.sections[0]!.blocks[7];
    expect(tableBlock?.kind).toBe("table");
    if (tableBlock?.kind === "table") {
      expect(tableBlock.rows).toHaveLength(2);
      const cellText = (row: number, col: number) => {
        const cell = tableBlock.rows[row]?.cells[col];
        const firstBlock = cell?.blocks[0];
        return firstBlock?.kind === "paragraph"
          ? firstBlock.runs.map((r) => r.text).join("")
          : undefined;
      };
      expect(cellText(0, 0)).toBe("A1");
      expect(cellText(1, 1)).toBe("B2");
    }
  });

  it("throws when the signal is already aborted, on both hops", () => {
    const controller = new AbortController();
    controller.abort();
    const odtBytes = buildRichOdt();
    expect(() => odtToDocx(odtBytes, { signal: controller.signal })).toThrow();
    const docxBytes = odtToDocx(odtBytes);
    expect(() => docxToOdt(docxBytes, { signal: controller.signal })).toThrow();
  });
});

// --- odp <-> pptx ------------------------------------------------------------------------------------------------

// Two slides, a styled run, and speaker notes on slide 1 only — the content shapes the task explicitly names, including notes.
function buildRichPptx(): Uint8Array<ArrayBuffer> {
  const editor = createPptx();
  const slide1 = editor.addSlide();
  const titleShape = slide1.addTextBox({
    frame: { xPt: 50, yPt: 50, widthPt: 400, heightPt: 80 },
    text: "Slide One Title",
  });
  titleShape.setParagraphs([
    {
      runs: [
        { text: "Slide One Title", bold: true, color: { r: 0, g: 0, b: 0.8 } },
      ],
    },
  ]);
  slide1.notes = "Speaker notes for slide one.";

  const slide2 = editor.addSlide();
  slide2.addTextBox({
    frame: { xPt: 50, yPt: 50, widthPt: 400, heightPt: 80 },
    text: "Slide Two Body",
  });

  return editor.toBytes();
}

function buildRichOdp(): Uint8Array<ArrayBuffer> {
  const editor = createOdp();
  const slide1 = editor.addSlide();
  const titleShape = slide1.addTextBox({
    frame: { xPt: 50, yPt: 50, widthPt: 400, heightPt: 80 },
    text: "placeholder",
  });
  const placeholder = titleShape.paragraphs()[0];
  placeholder?.remove();
  const titleRun = titleShape
    .appendParagraph()
    .appendRun({ text: "Slide One Title" });
  titleRun.bold = true;
  titleRun.color = { r: 0, g: 0, b: 0.8 };
  slide1.notes = "Speaker notes for slide one.";

  const slide2 = editor.addSlide();
  slide2.addTextBox({
    frame: { xPt: 50, yPt: 50, widthPt: 400, heightPt: 80 },
    text: "Slide Two Body",
  });

  return editor.toBytes();
}

function slideText(
  slide: ReturnType<typeof pptxContentOf>["slides"][number],
  shapeIndex: number,
): string {
  const block = slide.shapes[shapeIndex]?.blocks[0];
  return block?.kind === "paragraph"
    ? block.runs.map((r) => r.text).join("")
    : "";
}

describe("odp <-> pptx: pptx -> odp -> pptx", () => {
  it("carries slide text, run styling, and speaker notes through both hops", () => {
    const originalBytes = buildRichPptx();
    const odpBytes = pptxToOdp(originalBytes);
    const roundTrippedBytes = odpToPptx(odpBytes);
    const roundTripped = pptxContentOf(roundTrippedBytes);

    expect(roundTripped.slides).toHaveLength(2);
    expect(slideText(roundTripped.slides[0]!, 0)).toBe("Slide One Title");
    expect(slideText(roundTripped.slides[1]!, 0)).toBe("Slide Two Body");

    const titleRun = roundTripped.slides[0]!.shapes[0]?.blocks[0];
    expect(titleRun?.kind).toBe("paragraph");
    if (titleRun?.kind === "paragraph") {
      expect(titleRun.runs[0]?.bold).toBe(true);
      expect(titleRun.runs[0]?.color?.b).toBeCloseTo(0.8, 5);
    }

    expect(roundTripped.slides[0]!.notes).toBe("Speaker notes for slide one.");
    expect(roundTripped.slides[1]!.notes).toBe("");
  });

  it("throws when the signal is already aborted, on both hops", () => {
    const controller = new AbortController();
    controller.abort();
    const pptxBytes = buildRichPptx();
    expect(() => pptxToOdp(pptxBytes, { signal: controller.signal })).toThrow();
    const odpBytes = pptxToOdp(pptxBytes);
    expect(() => odpToPptx(odpBytes, { signal: controller.signal })).toThrow();
  });
});

describe("odp <-> pptx: odp -> pptx -> odp", () => {
  it("carries slide text, run styling, and speaker notes through both hops", () => {
    const originalBytes = buildRichOdp();
    const pptxBytes = odpToPptx(originalBytes);
    const roundTrippedBytes = pptxToOdp(pptxBytes);
    const roundTripped = odpContentOf(roundTrippedBytes);

    expect(roundTripped.slides).toHaveLength(2);
    expect(slideText(roundTripped.slides[0]!, 0)).toBe("Slide One Title");
    expect(slideText(roundTripped.slides[1]!, 0)).toBe("Slide Two Body");

    const titleRun = roundTripped.slides[0]!.shapes[0]?.blocks[0];
    expect(titleRun?.kind).toBe("paragraph");
    if (titleRun?.kind === "paragraph") {
      expect(titleRun.runs[0]?.bold).toBe(true);
      expect(titleRun.runs[0]?.color?.b).toBeCloseTo(0.8, 5);
    }

    expect(roundTripped.slides[0]!.notes).toBe("Speaker notes for slide one.");
    expect(roundTripped.slides[1]!.notes).toBe("");
  });

  it("throws when the signal is already aborted, on both hops", () => {
    const controller = new AbortController();
    controller.abort();
    const odpBytes = buildRichOdp();
    expect(() => odpToPptx(odpBytes, { signal: controller.signal })).toThrow();
    const pptxBytes = odpToPptx(odpBytes);
    expect(() => pptxToOdp(pptxBytes, { signal: controller.signal })).toThrow();
  });
});

describe("odp <-> pptx: shape rotation", () => {
  it("a rotated pptx shape survives pptx -> odp -> pptx", () => {
    const editor = createPptx();
    const slide = editor.addSlide();
    const shape = slide.addTextBox({
      frame: { xPt: 50, yPt: 50, widthPt: 200, heightPt: 60 },
      text: "Rotated",
    });
    shape.rotationDeg = 30;
    const pptxBytes = editor.toBytes();

    const odpBytes = pptxToOdp(pptxBytes);
    const roundTrippedBytes = odpToPptx(odpBytes);
    const roundTripped = pptxContentOf(roundTrippedBytes);
    expect(roundTripped.slides[0]?.shapes[0]?.rotationDeg).toBeCloseTo(30, 5);
  });

  it("a rotated odp shape survives odp -> pptx -> odp", () => {
    const editor = createOdp();
    const slide = editor.addSlide();
    const shape = slide.addTextBox({
      frame: { xPt: 50, yPt: 50, widthPt: 200, heightPt: 60 },
      text: "Rotated",
    });
    shape.rotationDeg = 30;
    const odpBytes = editor.toBytes();

    const pptxBytes = odpToPptx(odpBytes);
    const roundTrippedBytes = pptxToOdp(pptxBytes);
    const roundTripped = odpContentOf(roundTrippedBytes);
    expect(roundTripped.slides[0]?.shapes[0]?.rotationDeg).toBeCloseTo(30, 5);
  });
});

// minimalOdpBytes() (test-support/odp.ts) carries a rotated frame, a grouped pair of shapes, an image, and a TABLE SHAPE (a draw:frame whose content is a table:table directly, not inside a text box) — the same real-shape variety odf.js's own readOdpContent fixture verified against genuine LibreOffice 26.2 output. buildOdpPackage/buildPptxPackage's own appendShape (src/edit/odp/content.ts, src/edit/pptx/content.ts) now writes a table block into a real table:table/a:tbl shape via OdpSlide.addTable/PptxSlide.addTable, so the table shape's own content survives this bridge exactly like every other shape kind on this fixture.
describe("odp <-> pptx: a table shape survives odpToPptx", () => {
  it("carries the rotated title, the grouped shapes, the image, the notes, and the table shape's own cell content through odpToPptx", () => {
    const pptxBytes = odpToPptx(minimalOdpBytes());
    const content = pptxContentOf(pptxBytes);
    expect(content.slides).toHaveLength(2);

    // Slide 1: rotated title + two grouped shapes + notes all survive — none of these are the table-in-shape case.
    const slide1Texts = content.slides[0]!.shapes.map((_, index) =>
      slideText(content.slides[0]!, index),
    );
    expect(slide1Texts.some((t) => t.includes("Hello"))).toBe(true);
    expect(slide1Texts).toContain("Grouped A");
    expect(slide1Texts).toContain("Grouped B");
    expect(content.slides[0]!.notes).toBe("Speaker notes for slide one.");

    // Slide 2: the image shape survives (buildPptxPackage's appendShape has a dedicated image branch)...
    const slide2 = content.slides[1]!;
    expect(
      slide2.shapes.some(
        (shape) =>
          shape.blocks.length === 1 && shape.blocks[0]?.kind === "image",
      ),
    ).toBe(true);
    // ...and the table shape's own cell content now survives too, as a real 'table' block.
    const tableShape = slide2.shapes.find(
      (shape) => shape.blocks.length === 1 && shape.blocks[0]?.kind === "table",
    );
    const tableBlock = tableShape?.blocks[0];
    expect(tableBlock?.kind).toBe("table");
    if (tableBlock?.kind === "table") {
      expect(tableBlock.rows).toHaveLength(1);
      expect(tableBlock.rows[0]?.cells).toHaveLength(2);
      const cellText = (row: number, col: number): string => {
        const block = tableBlock.rows[row]?.cells[col]?.blocks[0];
        return block?.kind === "paragraph"
          ? block.runs.map((r) => r.text).join("")
          : "";
      };
      expect(cellText(0, 0)).toBe("A1");
      expect(cellText(0, 1)).toBe("B1");
    }
  });
});
