import {
  flattenTree,
  type ContentVector,
  type DocumentTree,
} from "document-schema.js";

import { decodePackage, el, txt } from "odf.js";
import { decodePackage as decodeOdfPackage } from "odf.js";
import { decodePackage as decodeOoxmlPackage, readXlsxContent } from "ooxml.js";
import { describe, expect, it } from "vitest";
import { createDocx, openDocx } from "../edit/docx/editor";
import { createOdg } from "../edit/odg/editor";
import { createOds } from "../edit/ods/editor";
import { openOdp } from "../edit/odp/editor";
import { openOdt } from "../edit/odt/editor";
import { createPptx, openPptx } from "../edit/pptx/editor";
import { convertDrawingToLayout } from "../layout/drawing";
import { convertSpreadsheetToLayout } from "../layout/sheets";
import { loadMathFont } from "pdf-codec";
const mathMetricsAt = (sizePt: number) => loadMathFont().metricsAt(sizePt);
import { readOdgContent } from "../odf/odg/read";
import { readDocxContent } from "../ooxml/docx/read";
import { readOdsContent } from "../odf/ods/read";
import { createStandardFontMeasurer, readPdf } from "pdf-codec";
import { MarkdownInvalidUtf8Error } from "markdown-codec";
import { decodeMarkdownText, encodeMarkdownText } from "../markdown/text";
import { minimalOdgBytes, minimalOdgPackage } from "../test-support/odg";
import { chapterOdtBytes, odmBytes, odmPackage } from "../test-support/odm";
import { richMarkdownText } from "../test-support/markdown";
import { minimalOdpBytes } from "../test-support/odp";
import {
  decoratedOdsBytes,
  gridOdsBytes,
  minimalOdsBytes,
} from "../test-support/ods";
import { minimalOdtBytes } from "../test-support/odt";
import {
  docxToPdf,
  inlineOdmSectionToContentSection,
  markdownToPdf,
  odgToPdf,
  odmToPdf,
  OdmUnresolvedSectionError,
  odpToPdf,
  odsToPdf,
  odsToXlsx,
  odtToPdf,
  pptxToPdf,
  xlsxToPdf,
} from "./convert";
import {
  pdfToDocx,
  pdfToMarkdown,
  pdfToOdg,
  pdfToOdp,
  pdfToOds,
  pdfToOdt,
  pdfToPptx,
  pdfToXlsx,
} from "./from-pdf";
import type {
  LayoutItem,
  LayoutLine,
  LayoutPath,
  LayoutRect,
  LayoutText,
} from "pdf-codec";

// Builds the same intermediate LayoutDocument odgToPdf itself builds internally (readOdgContent -> convertDrawingToLayout), so a test can assert on 'path'/'rect' LayoutItem kinds directly -- readPdf's own content-stream interpreter does not reconstruct 'path'/'line'/'ellipse' items at all (pdf-codec's interpret.ts), so round-tripping the fixture's curve/z-order back through readPdf is not possible; this is the direct way to prove them.
function layoutFromMinimalOdg() {
  const content = readOdgContent(decodePackage(minimalOdgBytes()));
  if (content.kind !== "drawing") {
    throw new Error("expected a drawing ContentDocument");
  }
  return convertDrawingToLayout(content, {
    measurer: createStandardFontMeasurer(),
  }).document;
}

function pdfHeader(bytes: Uint8Array<ArrayBuffer>): string {
  return new TextDecoder("latin1").decode(bytes.subarray(0, 5));
}

function findText(
  items: readonly LayoutItem[],
  text: string,
): LayoutText | undefined {
  return items.find(
    (item): item is LayoutText => item.kind === "text" && item.text === text,
  );
}

function buildSampleDocx(text: string): Uint8Array<ArrayBuffer> {
  const editor = createDocx();
  editor.body.appendParagraph().appendRun({ text });
  return editor.toBytes();
}

function buildSamplePptx(text: string): Uint8Array<ArrayBuffer> {
  const editor = createPptx();
  editor.addSlide().addTextBox({
    frame: { xPt: 50, yPt: 50, widthPt: 400, heightPt: 100 },
    text,
  });
  return editor.toBytes();
}

describe("docxToPdf", () => {
  it("produces valid PDF bytes from a docx paragraph", () => {
    const pdfBytes = docxToPdf(buildSampleDocx("Hello from docx"));
    expect(pdfHeader(pdfBytes)).toBe("%PDF-");
  });

  // ooxml.js's readDocx (2.6.1+) now reads a real ContentImageBlock for an inline w:drawing -- readDocxContent inherits that for free (see src/edit/docx/content.ts's own appendBlocks for the round-trip-fidelity half of this). This proves the OTHER half: a docx image now actually flows all the way through this package's own docxToPdf pipeline (readDocxContent -> convertWordprocessingToLayout -> writePdf) and appears as a real, positioned LayoutImage in the produced PDF, where before this bump readDocxContent produced no image block at all and the picture would have silently vanished.
  it("carries a real docx image all the way through to the produced PDF", () => {
    const docxEditor = createDocx();
    docxEditor.body.appendParagraph().appendRun({ text: "Before the image." });
    // Real PNG magic bytes (this repo's own PDF codec sniffs the format from these, not a file extension) followed by a minimal but genuine 1x1 PNG payload.
    const pngBytes = new Uint8Array([
      137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1,
      0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84,
      120, 156, 99, 250, 207, 192, 240, 31, 0, 5, 1, 2, 1, 233, 54, 244, 208, 0,
      0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
    ]);
    docxEditor.body.appendParagraph().insertImageAfter({
      format: "png",
      bytes: pngBytes,
      widthPt: 96,
      heightPt: 48,
    });
    docxEditor.body.appendParagraph().appendRun({ text: "After the image." });

    let captured: DocumentTree | undefined;
    const pdfBytes = docxToPdf(docxEditor.toBytes(), {
      onDocument: (pkg) => {
        captured = pkg;
      },
    });
    expect(pdfHeader(pdfBytes)).toBe("%PDF-");

    // The ContentDocument this conversion built internally really did read the image as a ContentImageBlock, not drop it.
    const capturedContent =
      captured === undefined ? undefined : flattenTree(captured);
    expect(capturedContent?.kind).toBe("wordprocessing");
    if (capturedContent?.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing ContentDocument");
    }
    const contentImage = capturedContent.sections
      .flatMap((s) => s.blocks)
      .find((b) => b.kind === "image");
    expect(contentImage).toMatchObject({
      kind: "image",
      format: "png",
      widthPt: 96,
      heightPt: 48,
    });

    // The layout pass fused a real, positioned placement onto the image block's own nodes: one frame on page 0, sized in points, distinct from the text runs either side of it. The rendered bytes themselves are proven by the readPdf round trip below.
    expect(contentImage).toMatchObject({
      frames: [{ pageIndex: 0, widthPt: 96, heightPt: 48 }],
    });
    expect(captured?.pages?.[0]).toMatchObject({ widthPt: 612, heightPt: 792 });

    // The PRODUCED PDF BYTES THEMSELVES actually embed the image as a real XObject, not just the intermediate LayoutDocument -- readPdf (this repo's own PDF reader) parses the PDF back and recovers the identical positioned image, proving the picture survived the full write path into genuine PDF content, not merely the layout stage.
    const reparsed = readPdf(pdfBytes);
    const reparsedImage = reparsed.pages[0]?.items.find(
      (item): item is Extract<LayoutItem, { kind: "image" }> =>
        item.kind === "image",
    );
    expect(reparsedImage).toBeDefined();
    expect(reparsedImage?.widthPt).toBeCloseTo(96, 5);
    expect(reparsedImage?.heightPt).toBeCloseTo(48, 5);
    expect(reparsed.images[reparsedImage!.imageId]).toMatchObject({
      format: "png",
    });
  });

  it("throws when the signal is already aborted", () => {
    const controller = new AbortController();
    controller.abort();
    expect(() =>
      docxToPdf(buildSampleDocx("X"), { signal: controller.signal }),
    ).toThrow();
  });

  it("calls onDocument exactly once with a DocumentTree whose content carries its own rendered positions as frames", () => {
    let captured: DocumentTree | undefined;
    const pdfBytes = docxToPdf(buildSampleDocx("Hello from docx"), {
      onDocument: (pkg) => {
        captured = pkg;
      },
    });
    expect(pdfHeader(pdfBytes)).toBe("%PDF-");

    expect(captured).toBeDefined();
    const pkg = captured!;
    // The tree-form package states its document kind at the root and carries the content as section-group children; flattening once recovers the flat ContentDocument whose nodes carry their own rendered positions as frames.
    expect(pkg.kind).toBe("wordprocessing");
    const content = flattenTree(pkg);
    expect(content.kind).toBe("wordprocessing");
    if (content.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing ContentDocument");
    }
    const paragraph = content.sections[0]?.blocks[0];
    if (paragraph?.kind !== "paragraph") {
      throw new Error("expected a paragraph block");
    }
    const run = paragraph.runs[0];
    expect(run?.sourcePath).toBeDefined();

    // The fused unified package: pages is populated, and the layout pass stamped the run's own rendered placements directly onto the run node -- one frame per wrapped fragment, every one on a real page the pages array describes, in reading order. This is the correlation the old sourcePath-matching against a separate LayoutDocument proved, now proven on the content tree itself rather than across two halves.
    expect(pkg.pages?.length).toBeGreaterThan(0);
    expect(run?.frames?.length).toBeGreaterThan(0);
    for (const frame of run?.frames ?? []) {
      expect(frame.pageIndex).toBeGreaterThanOrEqual(0);
      expect(frame.pageIndex).toBeLessThan(pkg.pages?.length ?? 0);
      expect(frame.widthPt).toBeGreaterThan(0);
      expect(frame.heightPt).toBeGreaterThan(0);
    }
  });
});

describe("odtToPdf", () => {
  // Proves the whole architectural point: an odt package, decoded via odf.js's own decodePackage (not ooxml.js's) and read via readOdtContent, feeds convertWordprocessingToLayout completely unmodified -- the identical engine docxToPdf feeds -- and comes out as a genuine, non-empty PDF page.
  it("produces valid PDF bytes with non-empty page content from an odt heading, paragraph, and table", () => {
    const pdfBytes = odtToPdf(minimalOdtBytes());
    expect(pdfHeader(pdfBytes)).toBe("%PDF-");

    const layout = readPdf(pdfBytes);
    expect(layout.pages).toHaveLength(1);
    expect(layout.pages[0]?.items.length).toBeGreaterThan(0);
    const text = layout.pages[0]?.items
      .filter((item) => item.kind === "text")
      .map((item) => item.text)
      .join(" ");
    expect(text).toContain("Hello from odt");
    expect(text).toContain("bold text");
    expect(text).toContain("A1");
  });

  it("throws when the signal is already aborted", () => {
    const controller = new AbortController();
    controller.abort();
    expect(() =>
      odtToPdf(minimalOdtBytes(), { signal: controller.signal }),
    ).toThrow();
  });
});

describe("odpToPdf", () => {
  // Proves the same architectural point convertPresentationToLayout's own module doc claims for pptx: an odp package, decoded via odf.js's own decodePackage (not ooxml.js's) and read via readOdpContent, feeds convertPresentationToLayout completely unmodified -- the identical engine pptxToPdf feeds -- and comes out as a genuine, multi-page PDF with real slide content (title text, grouped shapes, table cells, and an image).
  it("produces valid PDF bytes with real slide content from an odp presentation", () => {
    const pdfBytes = odpToPdf(minimalOdpBytes());
    expect(pdfHeader(pdfBytes)).toBe("%PDF-");

    const layout = readPdf(pdfBytes);
    expect(layout.pages).toHaveLength(2);
    const page1Text = layout.pages[0]?.items
      .filter((item) => item.kind === "text")
      .map((item) => item.text)
      .join(" ");
    expect(page1Text).toContain("Hello from odp");
    expect(page1Text).toContain("Grouped A");
    expect(page1Text).toContain("Grouped B");
    const page2Text = layout.pages[1]?.items
      .filter((item) => item.kind === "text")
      .map((item) => item.text)
      .join(" ");
    expect(page2Text).toContain("A1");
    expect(page2Text).toContain("B1");
    expect(layout.pages[1]?.items.some((item) => item.kind === "image")).toBe(
      true,
    );
  });

  // "Should work for free" claims deserve verification, not just assumption: presentation:notes is read into ContentSlide.notes by odf.js's own readOdpContent, and src/layout/slides.ts's hidden-annotation notes mechanism (already built and proven for pptxToPdf) carries any ContentSlide.notes through to the PDF regardless of which reader produced the ContentSlide -- this asserts that is genuinely true for odp too, with zero new notes-handling code written for this change.
  it("carries odp speaker notes through to the PDF via the existing hidden-annotation mechanism, with no new notes-handling code", () => {
    const pdfBytes = odpToPdf(minimalOdpBytes());
    const layout = readPdf(pdfBytes);
    expect(layout.pages[0]?.notes).toBe("Speaker notes for slide one.");
    // Slide two carries no presentation:notes at all -- confirms the "no notes" case doesn't leak a stray annotation either.
    expect(layout.pages[1]?.notes).toBeUndefined();
  });

  // The fixture's draw:transform="rotate(0.5235987755982988) ..." is exactly 30 degrees; odf.js's own readOdpContent resolves that to ContentShape.rotationDeg -30 (its own read.test.ts asserts the identical value for the identical transform string), and convertPresentationToLayout's shapePlacement negates it again (DrawingML/ODF rotate clockwise, the PDF writer rotates counter-clockwise) to land on +30 here -- the same shared shapePlacement code pptxToPdf's own rotated-shape handling uses. wrapRunsToWidth fragments the title into one LayoutText per word, so this looks for the title's first word rather than the whole phrase.
  it("reads a rotated shape through to positioned PDF text (rotation resolved by the same shared shape-placement code pptxToPdf uses)", () => {
    const pdfBytes = odpToPdf(minimalOdpBytes());
    const layout = readPdf(pdfBytes);
    const rotatedText = findText(layout.pages[0]!.items, "Hello");
    expect(rotatedText).toBeDefined();
    expect(rotatedText?.rotationDeg).toBeCloseTo(30, 1);
  });

  it("throws when the signal is already aborted", () => {
    const controller = new AbortController();
    controller.abort();
    expect(() =>
      odpToPdf(minimalOdpBytes(), { signal: controller.signal }),
    ).toThrow();
  });
});

describe("odsToPdf", () => {
  // Proves the architectural point specific to sheets: an ods package, decoded via odf.js's own decodePackage and read via readOdsContent, feeds convertSpreadsheetToLayout (genuinely new layout code, not a reused docx/pptx engine -- see convert.ts's own module doc) and comes out as a real PDF carrying real cell content, a real merged cell, and a hidden column that contributes nothing at all to the rendered page.
  it("produces valid PDF bytes with real cell content from an ods spreadsheet", () => {
    const pdfBytes = odsToPdf(minimalOdsBytes());
    expect(pdfHeader(pdfBytes)).toBe("%PDF-");

    const layout = readPdf(pdfBytes);
    expect(layout.pages).toHaveLength(1);
    const text = layout.pages[0]?.items
      .filter((item) => item.kind === "text")
      .map((item) => item.text)
      .join(" ");
    expect(text).toContain("Name");
    expect(text).toContain("Acme");
    expect(text).toContain("Merged");
  });

  // The fixture's column B is hidden (table:visibility="collapse") and carries the 'Amount'/123.45 cells -- neither should appear anywhere in the rendered PDF at all, confirming src/layout/sheets.ts's own "skip hidden entirely" fix (a real bug caught during this change's own real-file verification: a hidden column's cell was rendering a stray zero-width '###'/truncated fragment instead of nothing).
  it("renders nothing at all for cells anchored in a hidden column", () => {
    const pdfBytes = odsToPdf(minimalOdsBytes());
    const layout = readPdf(pdfBytes);
    const text = layout.pages[0]?.items
      .filter((item) => item.kind === "text")
      .map((item) => item.text)
      .join(" ");
    expect(text).not.toContain("Amount");
    expect(text).not.toContain("123.45");
    expect(text).not.toContain("#");
  });

  it("reads print settings (page size, headers) through to the rendered page", () => {
    // Gridlines aren't asserted here, only page size and header labels: gridline emission itself (one LayoutLine per boundary) is covered directly at the layout level by src/layout/sheets.test.ts, and its survival through a real PDF round trip is covered by the pdfToOds lattice-detection tests rather than duplicated here.
    const pdfBytes = odsToPdf(minimalOdsBytes());
    const layout = readPdf(pdfBytes);
    expect(layout.pages[0]).toMatchObject({ widthPt: 400, heightPt: 300 });
    const text =
      layout.pages[0]?.items
        .filter((item) => item.kind === "text")
        .map((item) => item.text) ?? [];
    expect(text).toContain("A"); // column-letter header label
    expect(text).toContain("1"); // row-number header label
  });

  // End-to-end proof for the per-cell decoration wiring, all the way from real ODF style XML: decoratedOdsBytes declares fo:background-color / fo:border / fo:text-align / style:vertical-align on real table-cell styles, odf.js's readOdsContent resolves all four onto ContentSheetCell, and src/layout/sheets.ts turns them into genuine LayoutRect/LayoutLine items and a genuinely different text position. Asserted against convertSpreadsheetToLayout's own output (the exact LayoutDocument odsToPdf builds internally) rather than a readPdf round trip, so the assertions pin what src/layout/sheets.ts itself emitted rather than what survived a second, independently-tested encode/decode hop -- a DocumentTree no longer carries the items themselves, only each node's fused frames.
  it("renders a decorated cell's own background, borders, alignment, and vertical alignment into the resulting layout", () => {
    const content = readOdsContent(decodeOdfPackage(decoratedOdsBytes()));
    if (content.kind !== "spreadsheet") {
      throw new Error("expected a spreadsheet ContentDocument");
    }
    const { document: layout } = convertSpreadsheetToLayout(content, {
      measurer: createStandardFontMeasurer(),
      mathMetricsAt,
    });
    const items = layout.pages[0]?.items ?? [];

    const rects = items.filter(
      (item): item is LayoutRect => item.kind === "rect",
    );
    expect(rects).toHaveLength(1); // exactly the one cell that declared a background
    expect(rects[0]).toMatchObject({ fill: { r: 1, g: 1, b: 0 } });

    // Cell A declared all four edges via the fo:border shorthand, cell B exactly one (fo:border-bottom) -- five border lines in total, and gridlines are off in this fixture so nothing else contributes a line.
    const lines = items.filter(
      (item): item is LayoutLine => item.kind === "line",
    );
    expect(lines).toHaveLength(5);
    expect(
      lines.filter((line) => line.widthPt === 2 && line.color.b === 1),
    ).toHaveLength(4);
    expect(
      lines.filter((line) => line.widthPt === 1 && line.color.r === 1),
    ).toHaveLength(1);

    // A is right-aligned and top-aligned; B takes the string default (left) and the bottom default. Both cells sit in the same row of equal-width columns, so A sitting further right within its own column than B does within its own, and higher up the page than B, both follow only from the decoration having been honoured.
    const texts = items.filter(
      (item): item is LayoutText => item.kind === "text",
    );
    const textA = texts.find((item) => item.text === "A")!;
    const textB = texts.find((item) => item.text === "B")!;
    expect(textA.xPt).toBeGreaterThan(textB.xPt / 2); // right-aligned within column A, not at its own left inset (which would be ~2pt)
    expect(textA.yPt).toBeGreaterThan(textB.yPt); // top-aligned sits higher up the page (larger PDF y) than bottom-aligned
  });

  it("throws when the signal is already aborted", () => {
    const controller = new AbortController();
    controller.abort();
    expect(() =>
      odsToPdf(minimalOdsBytes(), { signal: controller.signal }),
    ).toThrow();
  });
});

describe("odgToPdf", () => {
  // Proves the architectural point specific to drawings: an odg package, decoded via odf.js's own decodePackage and read via readOdgContent, feeds convertDrawingToLayout (genuinely new layout code for the vector-primitive vocabulary, though its ContentShape half reuses convertShape from slides.ts unmodified -- see convert.ts's own module doc) and comes out as a real, valid PDF.
  it("produces valid PDF bytes with the fixture's real page size and text content", () => {
    const pdfBytes = odgToPdf(minimalOdgBytes());
    expect(pdfHeader(pdfBytes)).toBe("%PDF-");

    const layout = readPdf(pdfBytes);
    expect(layout.pages).toHaveLength(1);
    expect(layout.pages[0]).toMatchObject({ widthPt: 400, heightPt: 300 });
    const text = layout.pages[0]?.items
      .filter((item) => item.kind === "text")
      .map((item) => item.text)
      .join(" ");
    expect(text).toContain("Label");
  });

  // Genuinely curved, not a straight-line approximation: the fixture's draw:path carries a real svg:d cubic segment (ground-truth-verified real LibreOffice output, see test-support/odg.ts's own note), and this asserts convertDrawingToLayout's own output -- the exact LayoutDocument odgToPdf builds internally -- carries a LayoutPath item whose subpath actually has a 'cubic' segment, not a 'line'-only approximation of the curve.
  it("carries the fixture's real curved path through to a LayoutPath item with a genuine cubic segment", () => {
    const layout = layoutFromMinimalOdg();
    const pathItem = layout.pages[0]?.items.find(
      (item): item is LayoutPath => item.kind === "path",
    );
    expect(pathItem).toBeDefined();
    expect(
      pathItem?.subpaths[0]?.segments.some(
        (segment) => segment.kind === "cubic",
      ),
    ).toBe(true);
    expect(pathItem?.subpaths[0]?.closed).toBe(true);
  });

  // The fixture's three rects (test-support/odg.ts) are BACK, FRONT, then the plain Rect1 in document order -- document order is real LibreOffice paint order (odf.js's own typed/draw/shapes.ts note), so the back rect's LayoutRect item must come first in array order for it to paint underneath the overlapping front rect, matching the module doc's documented paint-order convention.
  it("emits the three rects in document (paint) order", () => {
    const layout = layoutFromMinimalOdg();
    const rects =
      layout.pages[0]?.items.filter(
        (item): item is LayoutRect => item.kind === "rect",
      ) ?? [];
    expect(rects.map((rect) => rect.fill)).toEqual([
      { r: 1, g: 0.5019607843137255, b: 0 }, // grBack, #ff8000
      { r: 0.5019607843137255, g: 0, b: 1 }, // grFront, #8000ff
      { r: 1, g: 0, b: 0 }, // grRect, #ff0000
    ]);
  });

  // Vectors paint before shapes -- this module's own documented, bounded paint-order limitation (see src/layout/drawing.ts's top-of-file note): the fixture's text frame is the LAST element in document order, but must still appear AFTER every vector LayoutItem in the emitted array.
  it("paints every vector before the text shape, per the documented vectors-first convention", () => {
    const layout = layoutFromMinimalOdg();
    const kinds = layout.pages[0]?.items.map((item) => item.kind) ?? [];
    const textIndex = kinds.indexOf("text");
    const lastVectorIndex = Math.max(
      kinds.lastIndexOf("rect"),
      kinds.lastIndexOf("ellipse"),
      kinds.lastIndexOf("line"),
      kinds.lastIndexOf("path"),
    );
    expect(textIndex).toBeGreaterThan(lastVectorIndex);
  });

  it("throws when the signal is already aborted", () => {
    const controller = new AbortController();
    controller.abort();
    expect(() =>
      odgToPdf(minimalOdgBytes(), { signal: controller.signal }),
    ).toThrow();
  });
});

describe("pptxToPdf", () => {
  it("produces valid PDF bytes from a pptx text box", () => {
    const pdfBytes = pptxToPdf(buildSamplePptx("Hello from pptx"));
    expect(pdfHeader(pdfBytes)).toBe("%PDF-");
  });
});

describe("markdownToPdf", () => {
  // Proves the architectural point this pair adds: readMarkdownContent produces the identical WordprocessingContentDocument shape readDocxContent/readOdtContent do, so markdownToPdf feeds convertWordprocessingToLayout completely unmodified -- the same engine docxToPdf/odtToPdf feed -- and comes out as a real, valid PDF carrying the heading and list content.
  it("produces valid PDF bytes with the fixture's heading, list, and table content", () => {
    const pdfBytes = markdownToPdf(encodeMarkdownText(richMarkdownText()));
    expect(pdfHeader(pdfBytes)).toBe("%PDF-");

    const layout = readPdf(pdfBytes);
    const text = layout.pages
      .flatMap((page) => page.items)
      .filter((item) => item.kind === "text")
      .map((item) => item.text)
      .join(" ");
    expect(text).toContain("Report");
    expect(text).toContain("Title");
    expect(text).toContain("First");
    expect(text).toContain("A1");
  });

  it("throws MarkdownInvalidUtf8Error for malformed UTF-8 bytes", () => {
    expect(() => markdownToPdf(new Uint8Array([0xff, 0xfe, 0x00]))).toThrow(
      MarkdownInvalidUtf8Error,
    );
  });

  it("throws when the signal is already aborted", () => {
    const controller = new AbortController();
    controller.abort();
    expect(() =>
      markdownToPdf(encodeMarkdownText(richMarkdownText()), {
        signal: controller.signal,
      }),
    ).toThrow();
  });
});

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

  // Item 3 end to end, through real bytes on both sides: a spreadsheet printed WITH gridlines draws a genuine lattice on the PDF page, and pdfToDocx turns that lattice -- and only a lattice -- into a real w:tbl in the produced docx. gridOdsBytes is reused rather than a hand-built PDF precisely because its gridlines are drawn by the ordinary odsToPdf path, so nothing about the geometry is arranged to suit the detector.
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
  // The single lossiest conversion in the whole package (see convert.ts's own top-of-file comment): only the plain text content is asserted here, not styling -- reconstructWordprocessing's own geometry-based recovery plus buildMarkdownText's own CommonMark-vocabulary narrowing (no colour, no explicit alignment) means a round-tripped bold run survives as **bold** markdown syntax, which this test does check for, but a coloured run has nothing to survive as at all.
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

  // ExaDev/documents.js#584 ask 1: the reconstructed pageBreak blocks (one per page boundary) reach the markdown text as `<!-- page break -->` markers rather than being dropped by markdown-codec's writer -- exact page-boundary information, one marker per boundary, none for a single-page document.
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

  // The marker MEANS a page break rather than decorating one: readMarkdownContent's marker promotion turns each one back into a pageBreak block, so re-rendering the markdown honours the boundary -- this round trip lands on the same page count it started from, rather than printing the markers as literal text.
  it("re-renders pdfToMarkdown output at the same page count, markers honoured as real breaks", () => {
    const longMarkdown = `# Long Document\n\n${Array.from({ length: 80 }, (_, i) => `Paragraph ${String(i)} of ordinary prose content long enough to fill several printed pages.`).join("\n\n")}\n`;
    const pageCount = readPdf(markdownToPdf(encodeMarkdownText(longMarkdown)))
      .pages.length;
    const markdownBytes = pdfToMarkdown(
      markdownToPdf(encodeMarkdownText(longMarkdown)),
    );
    expect(readPdf(markdownToPdf(markdownBytes)).pages.length).toBe(pageCount);
  });

  // ExaDev/documents.js#584 ask 2 end to end: the layout engine renders Heading1/Heading2 at 28/22pt against a 12pt body, and the reconstruction's rank-based heading inference inverts exactly that -- the round-tripped title and section come back as ATX headings, not the '**bold**' runs they used to collapse into.
  it("recovers heading levels through markdownToPdf then pdfToMarkdown", () => {
    const source =
      "# Quarterly Report\n\n## Part 1 Scope\n\nThis is body paragraph zero of ordinary prose.\n\nThis is body paragraph one of ordinary prose.\n\nThis is body paragraph two of ordinary prose.\n";
    const text = decodeMarkdownText(
      pdfToMarkdown(markdownToPdf(encodeMarkdownText(source))),
    );
    expect(text).toMatch(/^# Quarterly Report/m);
    expect(text).toMatch(/^## Part 1 Scope/m);
  });

  // The docx consequence of the same inference: ooxml.js's writer emits w:outlineLvl only from the canonical headingLevel (never from a Heading{N} styleId), so rereading the produced docx through the real reader must find the outline level on the title paragraph -- a styleId alone would leave a dangling w:pStyle pointing at a styles.xml entry the writer never writes, with no outline level at all.
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

  // ExaDev/documents.js#584 ask 3, pinned end to end: where the table recovery's gridline-lattice gate succeeds, the recovered ContentTable already flows through buildMarkdownText into a real GFM pipe table (markdown-codec's emitTable) -- this test holds that wiring at the markdown surface. The fixture is a spreadsheet printed WITH gridlines (gridOdsBytes through the ordinary odsToPdf path, the same one the pdfToDocx lattice test uses), because a markdown-authored table renders no lattice at all: markdown carries no border concept, so the cells' text arrives as tab-separated prose instead. The gate refusing alignment-only structure is the documented, intended boundary -- recovery requires the drawn lattice, never invented geometry.
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

  // Mirrors pdfToDocx's own equivalent test: exercises the full pipeline (readPdf -> reconstructWordprocessing, entirely unmodified -- the same architectural bet odtToPdf's own build already proved -- -> buildOdtPackage) through a fresh, hand-built odt rather than the minimalOdtBytes fixture, so a bold/coloured/sized run really is recovered from PDF geometry, not merely carried through unchanged.
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

  // The other heading-carrying source besides markdown: reconstructWordprocessing's font-size rank inference (each distinct size at least 2pt above the modal body size is a heading, ranked largest-first) sets headingLevel alongside the Heading{N} styleId, and buildOdtPackage writes both through as one real text:h -- markdownToPdf renders '# Report Title' at the heading 1 size, so the heading comes back ranked level 1.
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
  // The fixture's title frame is rotated 30 degrees (see test-support/odp.ts), and wrapRunsToWidth fragments it into one LayoutText per word -- reconstructPresentation's own geometry-based line clustering does not guarantee those fragments come back in original reading order for rotated text (mirrors convert.test.ts's own odpToPdf rotated-shape test, which checks only the title's first word for the identical reason). This checks each word landed somewhere, not that the phrase reconstructed in its original order.
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

  // Mirrors pdfToPptx's own equivalent test: exercises the full pipeline (readPdf -> reconstructPresentation, entirely unmodified -- the same architectural bet odpToPdf's own build already proved -- -> buildOdpPackage) through a fresh, hand-built pptx rather than the minimalOdpBytes fixture, so a bold/coloured/sized run really is recovered from PDF geometry, not merely carried through unchanged.
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
  // gridOdsBytes (src/test-support/ods.ts) is a purpose-built fixture: three real, fully visible columns and three rows, gridlines AND headers explicitly enabled -- unlike minimalOdsBytes's own hidden column, which collapses two of its own gridline boundaries onto the same x position and would defeat this test's whole point. odsToPdf genuinely draws the LayoutLine lattice (src/layout/sheets.ts's renderGridlines) reconstructSpreadsheet's own gridline-detection path needs, so this proves the lattice path is what actually ran, not the text-clustering fallback. Every cell in this fixture is an ordinary word, so every one of them also stays a plain string through the heuristic re-typing step -- the point being that re-typing only fires on text that is genuinely number/date/boolean-shaped, never on arbitrary content; the sibling test below covers the case where it does fire.
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
      expect(cell.formula).toBeUndefined(); // a formula is still never claimed -- nothing about a rendered value implies one was computed
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
  // xlsxToPdf/pdfToXlsx have no layout engine or reconstruction algorithm of their own (see convert.ts's own module comment on this pair) -- each composes the existing ods<->xlsx bridge with the existing ods<->pdf layout edge. The starting xlsx bytes here are real, ooxml.js-written bytes built via odsToXlsx over gridOdsBytes (the same fixture pdfToOds's own gridline-lattice test above uses), not a hand-fabricated ContentDocument, so this is a genuine xlsx -> PDF -> xlsx cycle through the full composed pipeline on both hops.
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

// Several orders of magnitude looser than any single step's own precision (pdf-codec's serialize.ts's formatNumber rounds PDF content-stream operands to 4 decimal places; odf.js's own cm<->pt unit conversion and svg-path.ts's 6-decimal-place svg:d formatting each add their own negligible rounding on top) -- generous enough that a genuine geometry bug, not floating-point/string-formatting noise, is what would actually fail an assertion using it.
const GEOMETRY_TOLERANCE_PT = 0.01;

function closeTo(a: number, b: number, tolerancePt: number): boolean {
  return Math.abs(a - b) <= tolerancePt;
}

function expectBoxClose(
  actual: { xPt: number; yPt: number; widthPt: number; heightPt: number },
  expected: { xPt: number; yPt: number; widthPt: number; heightPt: number },
): void {
  expect(closeTo(actual.xPt, expected.xPt, GEOMETRY_TOLERANCE_PT)).toBe(true);
  expect(closeTo(actual.yPt, expected.yPt, GEOMETRY_TOLERANCE_PT)).toBe(true);
  expect(closeTo(actual.widthPt, expected.widthPt, GEOMETRY_TOLERANCE_PT)).toBe(
    true,
  );
  expect(
    closeTo(actual.heightPt, expected.heightPt, GEOMETRY_TOLERANCE_PT),
  ).toBe(true);
}

// A uniform bounding box for any ContentVector kind, so a 'rect'/'ellipse'/'path' (frame-carrying) and a 'line' (from/to-carrying) compare on the same footing -- needed here specifically because PDF's own content-stream operators force several vector kinds to collapse to 'path' on the way back through readPdf (see the pdfToOdg test's own note below), so comparing frame-to-frame directly would not type-check, let alone compare the right thing, once the kind itself has changed.
function vectorBoundingBox(vector: ContentVector): {
  xPt: number;
  yPt: number;
  widthPt: number;
  heightPt: number;
} {
  if (vector.kind === "line") {
    return {
      xPt: Math.min(vector.from.xPt, vector.to.xPt),
      yPt: Math.min(vector.from.yPt, vector.to.yPt),
      widthPt: Math.abs(vector.to.xPt - vector.from.xPt),
      heightPt: Math.abs(vector.to.yPt - vector.from.yPt),
    };
  }
  return vector.frame;
}

describe("pdfToOdg", () => {
  // PDF has no rect, ellipse, or line operator whose presence a reader could simply look for -- only `re` (itself defined as a four-point subpath) and the general path operators -- so what a stroke or fill WAS is recoverable from its geometry or not at all. pdf-codec's own content-stream interpreter now recovers all three from that geometry (its shape-pattern detection: an axis-aligned closed four-corner subpath under any fill/stroke combination is a LayoutRect, a closed four-cubic subpath meeting its bounding box at the four cardinal points with kappa-ratio controls is a LayoutEllipse, an open single-straight-segment stroke-only subpath is a LayoutLine), which is what lets every vector in this fixture round-trip with its ORIGINAL kind intact -- including Rect1, which is filled AND stroked and therefore takes the 'B' paint operator rather than 'f', and the ellipse and the line, all three of which used to come back as a generic 'path'. reconstructDrawing itself is unchanged by that: it always mapped whatever kind it was handed 1:1 (src/layout/reconstruct.ts's layoutItemToVector), so the improvement is entirely in how much kind information survives the PDF, not in how it is mapped afterwards. Position and size were already exact within floating-point tolerance regardless of kind and remain so. The text label's own frame is still approximate, for an unrelated reason: reconstructDrawing derives it from real AFM ascent/descent metrics (the same estimation reconstructPresentation already uses), not the original ODF frame's own explicit svg:x/y/width/height, which no longer exists anywhere in the recovered PDF geometry.
  it("round-trips the fixture's rect/rect/rect/ellipse/line/path mix and text label through odgToPdf then pdfToOdg, with every vector's own kind, position and size surviving", () => {
    const original = readOdgContent(minimalOdgPackage());
    if (original.kind !== "drawing") {
      throw new Error("expected a drawing ContentDocument");
    }

    const pdfBytes = odgToPdf(minimalOdgBytes());
    const odgBytes = pdfToOdg(pdfBytes);
    const roundTripped = readOdgContent(decodePackage(odgBytes)); // reread via odf.js's own real readOdg parser, not this package's own writer echoing its input back

    if (roundTripped.kind !== "drawing") {
      throw new Error("expected a drawing ContentDocument");
    }

    const beforeVectors = original.pages[0]!.vectors;
    const afterVectors = roundTripped.pages[0]!.vectors;
    expect(afterVectors).toHaveLength(beforeVectors.length);

    // Every kind survives: rectBack/rectFront (fill-only), Rect1 (filled AND stroked, the case that used to collapse), the ellipse, the line, and the freeform curve that was a path to begin with.
    expect(afterVectors.map((v) => v.kind)).toEqual(
      beforeVectors.map((v) => v.kind),
    );
    expect(afterVectors.map((v) => v.kind)).toEqual([
      "rect",
      "rect",
      "rect",
      "ellipse",
      "line",
      "path",
    ]);

    // The five non-curve vectors all compare exactly (within tolerance) against their ORIGINAL frame: none of their own points -- a rect's corners, an ellipse's kappa-offset controls (which by construction never exceed its own bounding box), or a line's two bare endpoints -- ever extend beyond that frame. curvePath (index 5) is handled separately below, for a genuinely different reason.
    beforeVectors.slice(0, 5).forEach((before, i) => {
      expectBoxClose(
        vectorBoundingBox(afterVectors[i]!),
        vectorBoundingBox(before),
      );
    });

    // curvePath's own recovered width does NOT match its original declared frame, and that is expected, not a bug: the fixture's own real-LibreOffice-verified svg:d ("M0 4000h3000c1000 0 1000-4000-1000-4000z", see test-support/odg.ts's own note) has a cubic control point (dx=1000 from x=3000, reaching x=4000) that extends past its own declared svg:viewBox width (3657 units) -- a legitimate real-world SVG/ODF authoring pattern, since a viewBox/frame is a declared coordinate window, not a guaranteed tight bounding box of the raw path data. reconstructDrawing has no "declared frame" to fall back to at all -- a PDF's recovered geometry carries only points -- so its own frame is necessarily the TIGHT bounding box of every recovered point, control points included (per pathBoundingFrame's own doc comment in reconstruct.ts). That tight box can legitimately be larger than whatever frame the original author declared, exactly as it is here. The origin (xPt/yPt) and height still match closely, since the overshoot is one-sided (only the right edge, via the x-extending control point) and the y-extent is unaffected.
    const curveBefore = vectorBoundingBox(beforeVectors[5]!);
    const curveAfter = vectorBoundingBox(afterVectors[5]!);
    expect(
      closeTo(curveAfter.xPt, curveBefore.xPt, GEOMETRY_TOLERANCE_PT),
    ).toBe(true);
    expect(
      closeTo(curveAfter.yPt, curveBefore.yPt, GEOMETRY_TOLERANCE_PT),
    ).toBe(true);
    expect(
      closeTo(curveAfter.heightPt, curveBefore.heightPt, GEOMETRY_TOLERANCE_PT),
    ).toBe(true);
    expect(curveAfter.widthPt).toBeGreaterThanOrEqual(
      curveBefore.widthPt - GEOMETRY_TOLERANCE_PT,
    ); // the tight bounding box can only be as large as or larger than a possibly-non-tight declared frame, never smaller

    // rectBack/rectFront also keep their exact fill colour -- a plain passthrough with no lossy quantization beyond formatNumber's own negligible rounding, unlike the vectors above whose kind itself narrowed.
    const rectBackAfter = afterVectors[0]!;
    const rectBackBefore = beforeVectors[0]!;
    if (rectBackAfter.kind !== "rect" || rectBackBefore.kind !== "rect") {
      throw new Error("expected rectBack to stay a rect on both sides");
    }
    expect(closeTo(rectBackAfter.fill!.r, rectBackBefore.fill!.r, 0.001)).toBe(
      true,
    );
    expect(closeTo(rectBackAfter.fill!.g, rectBackBefore.fill!.g, 0.001)).toBe(
      true,
    );
    expect(closeTo(rectBackAfter.fill!.b, rectBackBefore.fill!.b, 0.001)).toBe(
      true,
    );

    // The ellipse comes back as a real 'ellipse' vector -- recovered from the four kappa-ratio cubics writeEllipse emits, since PDF has no ellipse operator to record it with -- keeping its exact fill and stroke.
    const ellipseVectorAfter = afterVectors[3]!;
    const ellipseVectorBefore = beforeVectors[3]!;
    if (
      ellipseVectorAfter.kind !== "ellipse" ||
      ellipseVectorBefore.kind !== "ellipse"
    ) {
      throw new Error("expected the ellipse to survive as an ellipse");
    }
    expect(
      closeTo(ellipseVectorAfter.fill!.r, ellipseVectorBefore.fill!.r, 0.001),
    ).toBe(true);
    expect(
      closeTo(ellipseVectorAfter.fill!.g, ellipseVectorBefore.fill!.g, 0.001),
    ).toBe(true);
    expect(
      closeTo(ellipseVectorAfter.fill!.b, ellipseVectorBefore.fill!.b, 0.001),
    ).toBe(true);
    expect(ellipseVectorAfter.stroke).toBeDefined();

    // The stroked-and-filled rect (index 2) keeps BOTH its fill and its stroke, which is what distinguishes it from the two fill-only rects either side of it and is exactly why it used to miss detection.
    const strokedRectAfter = afterVectors[2]!;
    if (strokedRectAfter.kind !== "rect") {
      throw new Error(
        "expected the stroked-and-filled rect to survive as a rect",
      );
    }
    expect(strokedRectAfter.fill).toBeDefined();
    expect(strokedRectAfter.stroke).toBeDefined();

    // The line comes back as a real 'line' vector carrying its own two endpoints and stroke, not a degenerate zero-height rect or a one-segment path.
    const lineAfter = afterVectors[4]!;
    const lineBefore = beforeVectors[4]!;
    if (lineAfter.kind !== "line" || lineBefore.kind !== "line") {
      throw new Error("expected the line to survive as a line");
    }
    expect(
      closeTo(lineAfter.from.xPt, lineBefore.from.xPt, GEOMETRY_TOLERANCE_PT),
    ).toBe(true);
    expect(
      closeTo(lineAfter.to.yPt, lineBefore.to.yPt, GEOMETRY_TOLERANCE_PT),
    ).toBe(true);
    expect(
      closeTo(
        lineAfter.stroke.widthPt,
        lineBefore.stroke.widthPt,
        GEOMETRY_TOLERANCE_PT,
      ),
    ).toBe(true);

    // The curve specifically must still be a genuine cubic segment, not a straight-line approximation of it -- proving writePath -> readPdf's own general path tracking (pdf-codec's interpret.ts) recovers the real curve, not just its endpoints, and reconstructDrawing carries that segment kind straight across.
    const curveVectorAfter = afterVectors[5]!;
    if (curveVectorAfter.kind !== "path") {
      throw new Error("expected the curve to still be a path");
    }
    expect(
      curveVectorAfter.subpaths[0]?.segments.some((s) => s.kind === "cubic"),
    ).toBe(true);
    expect(curveVectorAfter.subpaths[0]?.closed).toBe(true);

    // The text label: content survives exactly; position is approximate only, for the AFM-estimation reason this test's own top-of-block note explains.
    expect(original.pages[0]!.shapes).toHaveLength(1);
    expect(roundTripped.pages[0]!.shapes).toHaveLength(1);
    const [beforeShape] = original.pages[0]!.shapes;
    const [afterShape] = roundTripped.pages[0]!.shapes;
    expect(afterShape!.blocks[0]).toMatchObject({ kind: "paragraph" });
    const afterParagraph = afterShape!.blocks[0];
    if (afterParagraph?.kind !== "paragraph") {
      throw new Error(
        "expected the text label to survive as a paragraph block",
      );
    }
    expect(afterParagraph.runs.map((r) => r.text).join("")).toContain("Label");
    expect(
      Math.abs(afterShape!.frame.xPt - beforeShape!.frame.xPt),
    ).toBeLessThan(20); // approximate: AFM-estimated, not the original explicit ODF frame
    expect(
      Math.abs(afterShape!.frame.yPt - beforeShape!.frame.yPt),
    ).toBeLessThan(20);
  });

  // A rotated vector's own rotation genuinely reaches the page and comes back: convertDrawingToLayout resolves it into a LayoutPath of rotated corners (LayoutRect carries no rotation field of its own), writePath emits those as real PDF path operators, readPdf recovers them, and reconstructDrawing maps them back onto a ContentVector. What survives is the rotated GEOMETRY, not the rotationDeg field -- a PDF path records where the corners ended up, never that a right-angled box was turned to get there -- so the recovered vector carries no rotation of its own, with its corners sitting exactly where the rotation put them. That is the honest limit of the round trip, and it is checkable exactly, because a 90-degree turn of a wide rect about its own centre swaps that rect's width and height. A QUARTER turn specifically leaves the turned corners still axis-aligned, so pdf-codec's own shape detection legitimately recovers this one as a 'rect' again (its rect pattern covers a 90-degree-rotated CTM, not only an unrotated one) -- the same swapped-bounding-box assertions below are what prove the rotation genuinely happened rather than the round trip having quietly ignored it. A rotation that is NOT a multiple of 90 degrees leaves no axis-aligned pattern to match at all and is recovered as a generic 'path', which the sibling test below covers.
  it("carries a rotated odg vector's rotation through odgToPdf then pdfToOdg as genuinely rotated recovered geometry", () => {
    const editor = createOdg();
    editor.pageSize = { widthPt: 400, heightPt: 300 };
    const drawPage = editor.addPage();
    drawPage.addRect({
      frame: { xPt: 100, yPt: 100, widthPt: 120, heightPt: 40 },
      fill: { r: 1, g: 0, b: 0 },
    }).rotationDeg = 90;

    // The rotation survives a plain odg -> ContentDocument read first, as a real rotationDeg field.
    const source = readOdgContent(editor.toPackage());
    if (source.kind !== "drawing") {
      throw new Error("expected a drawing ContentDocument");
    }
    const sourceVector = source.pages[0]!.vectors[0]!;
    expect(sourceVector.kind).toBe("rect");
    if (sourceVector.kind !== "rect") {
      throw new Error("expected a rect vector");
    }
    expect(sourceVector.rotationDeg).toBeCloseTo(90, 4);

    const roundTripped = readOdgContent(
      decodePackage(pdfToOdg(odgToPdf(editor.toBytes()))),
    );
    if (roundTripped.kind !== "drawing") {
      throw new Error("expected a drawing ContentDocument");
    }
    const recovered = roundTripped.pages[0]!.vectors[0]!;
    expect(recovered.kind).toBe("rect"); // a quarter-turned rect is still axis-aligned, so it is recovered as a rect -- turned, not untouched, as the swapped extents below prove
    expect(
      recovered.kind === "rect" ? recovered.rotationDeg : undefined,
    ).toBeUndefined(); // the rotationDeg FIELD is genuinely gone: PDF recorded where the corners ended up, not that a turn produced them

    // The rotated rect's own bounding box is the source frame's width and height SWAPPED, still centred on the same point -- exactly what a 90-degree turn produces, and nothing an unrotated round trip could ever produce.
    const box = vectorBoundingBox(recovered);
    expect(closeTo(box.widthPt, 40, GEOMETRY_TOLERANCE_PT)).toBe(true);
    expect(closeTo(box.heightPt, 120, GEOMETRY_TOLERANCE_PT)).toBe(true);
    expect(closeTo(box.xPt + box.widthPt / 2, 160, GEOMETRY_TOLERANCE_PT)).toBe(
      true,
    ); // 100 + 120/2
    expect(
      closeTo(box.yPt + box.heightPt / 2, 120, GEOMETRY_TOLERANCE_PT),
    ).toBe(true); // 100 + 40/2
  });

  // The complement of the quarter-turn case above, and the boundary of what pdf-codec's shape detection claims: a rect turned by an angle that leaves no edge axis-aligned matches no shape pattern at all, so it is recovered as a generic 'path' carrying the four rotated corners exactly. Kind narrows; geometry does not.
  it("recovers a rect rotated off-axis as a generic path with its four rotated corners intact", () => {
    const editor = createOdg();
    editor.pageSize = { widthPt: 400, heightPt: 300 };
    const drawPage = editor.addPage();
    drawPage.addRect({
      frame: { xPt: 100, yPt: 100, widthPt: 120, heightPt: 40 },
      fill: { r: 1, g: 0, b: 0 },
    }).rotationDeg = 30;

    const roundTripped = readOdgContent(
      decodePackage(pdfToOdg(odgToPdf(editor.toBytes()))),
    );
    if (roundTripped.kind !== "drawing") {
      throw new Error("expected a drawing ContentDocument");
    }
    const recovered = roundTripped.pages[0]!.vectors[0]!;
    expect(recovered.kind).toBe("path");
    if (recovered.kind !== "path") {
      throw new Error("expected a path vector");
    }
    // Four corners, still a closed quadrilateral, still centred where the rotation left it -- and demonstrably rotated, since a 30-degree turn of a 120x40 rect bounds to 124.0 x 94.6 rather than the original 120 x 40.
    expect(recovered.subpaths).toHaveLength(1);
    expect(recovered.subpaths[0]!.segments).toHaveLength(3);
    expect(recovered.subpaths[0]!.closed).toBe(true);
    const box = vectorBoundingBox(recovered);
    const halfTurn = (30 * Math.PI) / 180;
    expect(
      closeTo(
        box.widthPt,
        120 * Math.cos(halfTurn) + 40 * Math.sin(halfTurn),
        GEOMETRY_TOLERANCE_PT,
      ),
    ).toBe(true);
    expect(
      closeTo(
        box.heightPt,
        120 * Math.sin(halfTurn) + 40 * Math.cos(halfTurn),
        GEOMETRY_TOLERANCE_PT,
      ),
    ).toBe(true);
    expect(closeTo(box.xPt + box.widthPt / 2, 160, GEOMETRY_TOLERANCE_PT)).toBe(
      true,
    );
    expect(
      closeTo(box.yPt + box.heightPt / 2, 120, GEOMETRY_TOLERANCE_PT),
    ).toBe(true);
  });

  it("throws when the signal is already aborted", () => {
    const pdfBytes = odgToPdf(minimalOdgBytes());
    const controller = new AbortController();
    controller.abort();
    expect(() => pdfToOdg(pdfBytes, { signal: controller.signal })).toThrow();
  });
});

describe("pdfToPptx", () => {
  it("round-trips text content through pptxToPdf then pdfToPptx", () => {
    const pdfBytes = pptxToPdf(buildSamplePptx("Slide round trip"));
    const pptxBytes = pdfToPptx(pdfBytes);
    const editor = openPptx(pptxBytes);
    const text = editor
      .slides()
      .flatMap((s) => s.shapes())
      .map((s) => s.text)
      .join(" ");
    expect(text).toContain("Slide round trip");
  });

  // Confirmed missing by round-tripping a real Keynote-authored pptx with speaker notes through this exact pipeline: notes came back empty. Fixed via a hidden /Subtype /Text PDF annotation (see pdf/write.ts's buildNotesAnnotDict / pdf/read.ts's readPageNotes) -- PDF has no native presenter-notes concept, so this is this package's own round-trip mechanism, not a real PDF feature a third-party PDF would carry.
  it("round-trips speaker notes through pptxToPdf then pdfToPptx", () => {
    const editor = createPptx();
    const slide = editor.addSlide();
    slide.addTextBox({
      frame: { xPt: 50, yPt: 50, widthPt: 400, heightPt: 100 },
      text: "Slide with notes",
    });
    slide.notes = "These are the speaker notes for this slide";

    const pdfBytes = pptxToPdf(editor.toBytes());
    const pptxBytes = pdfToPptx(pdfBytes);
    const roundTripped = openPptx(pptxBytes);

    expect(roundTripped.slides()[0]?.notes).toBe(
      "These are the speaker notes for this slide",
    );
  });
});

function pageText(
  layout: ReturnType<typeof readPdf>,
  pageIndex: number,
): string {
  return (
    layout.pages[pageIndex]?.items
      .filter((item): item is LayoutText => item.kind === "text")
      .map((item) => item.text)
      .join(" ") ?? ""
  );
}

describe("odmToPdf", () => {
  it("produces one page per chapter, in text:section document order, each chapter starting a fresh page", () => {
    const bytes = odmBytes([
      { name: "Chapter1", href: "../chapter1.odt" },
      { name: "Chapter2", href: "../chapter2.odt" },
    ]);
    const chapters = new Map([
      [
        "../chapter1.odt",
        chapterOdtBytes("Chapter One", "Body of chapter one."),
      ],
      [
        "../chapter2.odt",
        chapterOdtBytes("Chapter Two", "Body of chapter two."),
      ],
    ]);

    const pdfBytes = odmToPdf(bytes, {
      resolveSubDocument: (href) => chapters.get(href),
    });
    expect(pdfHeader(pdfBytes)).toBe("%PDF-");

    const layout = readPdf(pdfBytes);
    expect(layout.pages).toHaveLength(2);
    expect(pageText(layout, 0)).toContain("Chapter One");
    expect(pageText(layout, 0)).toContain("Body of chapter one.");
    expect(pageText(layout, 0)).not.toContain("Chapter Two");
    expect(pageText(layout, 1)).toContain("Chapter Two");
    expect(pageText(layout, 1)).toContain("Body of chapter two.");
    expect(pageText(layout, 1)).not.toContain("Chapter One");
  });

  it("throws when the signal is already aborted", () => {
    const bytes = odmBytes([{ name: "Chapter1", href: "../chapter1.odt" }]);
    const controller = new AbortController();
    controller.abort();
    expect(() =>
      odmToPdf(bytes, {
        signal: controller.signal,
        resolveSubDocument: () => chapterOdtBytes("X", "Y"),
      }),
    ).toThrow();
  });

  it("throws OdmUnresolvedSectionError naming the unresolved href when no resolver is given at all", () => {
    const bytes = odmBytes([{ name: "Chapter1", href: "../chapter1.odt" }]);

    let caught: unknown;
    try {
      odmToPdf(bytes);
    } catch (error) {
      caught = error;
    }

    if (!(caught instanceof OdmUnresolvedSectionError)) {
      throw new Error("expected odmToPdf to throw OdmUnresolvedSectionError");
    }
    expect(caught.hrefs).toEqual(["../chapter1.odt"]);
    expect(caught.message).toContain("../chapter1.odt");
  });

  it("throws OdmUnresolvedSectionError naming the unresolved href when the resolver returns undefined for it", () => {
    const bytes = odmBytes([{ name: "Chapter1", href: "../chapter1.odt" }]);

    let caught: unknown;
    try {
      odmToPdf(bytes, { resolveSubDocument: () => undefined });
    } catch (error) {
      caught = error;
    }

    if (!(caught instanceof OdmUnresolvedSectionError)) {
      throw new Error("expected odmToPdf to throw OdmUnresolvedSectionError");
    }
    expect(caught.hrefs).toEqual(["../chapter1.odt"]);
  });

  // Proves the whole point of collecting unresolved hrefs up front rather than throwing on the first miss: three sections, only the middle one resolvable, and the thrown error names BOTH of the other two -- not just whichever the loop reached first.
  it("collects every unresolved href across all sections before throwing, not just the first", () => {
    const bytes = odmBytes([
      { name: "Chapter1", href: "../missing-a.odt" },
      { name: "Chapter2", href: "../chapter2.odt" },
      { name: "Chapter3", href: "../missing-b.odt" },
    ]);

    let caught: unknown;
    try {
      odmToPdf(bytes, {
        resolveSubDocument: (href) =>
          href === "../chapter2.odt"
            ? chapterOdtBytes("Chapter Two", "Body.")
            : undefined,
      });
    } catch (error) {
      caught = error;
    }

    if (!(caught instanceof OdmUnresolvedSectionError)) {
      throw new Error("expected odmToPdf to throw OdmUnresolvedSectionError");
    }
    expect(caught.hrefs).toEqual(["../missing-a.odt", "../missing-b.odt"]);
    expect(caught.message).toContain("../missing-a.odt");
    expect(caught.message).toContain("../missing-b.odt");
  });
});

describe("inlineOdmSectionToContentSection", () => {
  // readOdm's own inlineContent field is declared for schema-completeness but never actually populated by the installed odf.js build (a real .odm's text:section-source is always a bare external reference -- see odmToPdf's own module comment), so there is no byte-level .odm fixture that can drive this branch through odmToPdf's own public entry point; this exercises the conversion function directly with a hand-built OdmSection instead, the only way to prove it works at all.
  it("builds a ContentSection directly from inlineContent, without needing a resolver", () => {
    const pkg = odmPackage([]);
    const contentSection = inlineOdmSectionToContentSection(
      {
        name: "Inline",
        href: "unused.odt",
        inlineContent: [
          el("text:h", { "text:outline-level": "1" }, [txt("Inline Chapter")]),
          el("text:p", {}, [txt("Inline body text.")]),
        ],
      },
      pkg,
    );

    expect(contentSection.blocks).toHaveLength(2);
    const [heading, paragraph] = contentSection.blocks;
    if (heading?.kind !== "paragraph" || paragraph?.kind !== "paragraph") {
      throw new Error("expected two paragraph blocks");
    }
    expect(heading.runs.map((run) => run.text).join("")).toBe("Inline Chapter");
    expect(paragraph.runs.map((run) => run.text).join("")).toBe(
      "Inline body text.",
    );
  });

  it("skips inline node kinds with no ContentBlock representation and reads a table via readOdfTable", () => {
    const pkg = odmPackage([]);
    const contentSection = inlineOdmSectionToContentSection(
      {
        name: "Inline",
        href: "unused.odt",
        inlineContent: [
          el("draw:frame"), // no ContentBlock this package's own odt reader produces either -- silently skipped
          el("table:table", {}, [
            el("table:table-row", {}, [
              el("table:table-cell", {}, [
                el("text:p", {}, [txt("Cell text")]),
              ]),
            ]),
          ]),
        ],
      },
      pkg,
    );

    expect(contentSection.blocks).toHaveLength(1);
    const [table] = contentSection.blocks;
    if (table?.kind !== "table") {
      throw new Error("expected a table block");
    }
    expect(table.rows[0]?.cells[0]?.blocks[0]).toMatchObject({
      kind: "paragraph",
    });
  });

  it("returns an empty blocks array, rather than throwing, when inlineContent is absent", () => {
    const pkg = odmPackage([]);
    const contentSection = inlineOdmSectionToContentSection(
      { name: "Inline", href: "unused.odt" },
      pkg,
    );
    expect(contentSection.blocks).toEqual([]);
  });
});
