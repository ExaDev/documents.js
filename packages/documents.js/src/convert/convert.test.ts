import { flattenTree, type DocumentTree } from "document-schema.js";
import { decodePackage, decodePackage as decodeOdfPackage } from "odf.js";
import { describe, expect, it } from "vitest";
import { createDocx } from "../edit/docx/editor";
import { createPptx } from "../edit/pptx/editor";
import { convertDrawingToLayout } from "../layout/drawing";
import { convertSpreadsheetToLayout } from "../layout/sheets";
import { loadMathFont } from "pdf-codec";
const mathMetricsAt = (sizePt: number) => loadMathFont().metricsAt(sizePt);
import { readOdgContent } from "../odf/odg/read";
import { readOdsContent } from "../odf/ods/read";
import { createStandardFontMeasurer, readPdf } from "pdf-codec";
import { MarkdownUndecodableTextError } from "markdown-codec";
import { encodeMarkdownText } from "../markdown/text";
import { minimalOdgBytes } from "../test-support/odg";
import { richMarkdownText } from "../test-support/markdown";
import { minimalOdpBytes } from "../test-support/odp";
import { decoratedOdsBytes, minimalOdsBytes } from "../test-support/ods";
import { minimalOdtBytes } from "../test-support/odt";
import {
  docxToPdf,
  markdownToPdf,
  odgToPdf,
  odpToPdf,
  odsToPdf,
  odtToPdf,
  pptxToPdf,
} from "./convert";
import type {
  LayoutItem,
  LayoutLine,
  LayoutPath,
  LayoutRect,
  LayoutText,
} from "pdf-codec";
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

  // ooxml.js's readDocx (2.6.1+) now reads a real ContentImageBlock for an inline w:drawing — readDocxContent inherits that for free (see src/edit/docx/content.ts's own appendBlocks for the round-trip-fidelity half of this). This proves the OTHER half: a docx image now actually flows all the way through this package's own docxToPdf pipeline (readDocxContent -> convertWordprocessingToLayout -> writePdf) and appears as a real, positioned LayoutImage in the produced PDF, where before this bump readDocxContent produced no image block at all and the picture would have silently vanished.
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

    // The PRODUCED PDF BYTES THEMSELVES actually embed the image as a real XObject, not just the intermediate LayoutDocument — readPdf (this repo's own PDF reader) parses the PDF back and recovers the identical positioned image, proving the picture survived the full write path into genuine PDF content, not merely the layout stage.
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

    // The fused unified package: pages is populated, and the layout pass stamped the run's own rendered placements directly onto the run node — one frame per wrapped fragment, every one on a real page the pages array describes, in reading order. This is the correlation the old sourcePath-matching against a separate LayoutDocument proved, now proven on the content tree itself rather than across two halves.
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
  // Proves the whole architectural point: an odt package, decoded via odf.js's own decodePackage (not ooxml.js's) and read via readOdtContent, feeds convertWordprocessingToLayout completely unmodified — the identical engine docxToPdf feeds — and comes out as a genuine, non-empty PDF page.
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
  // Proves the same architectural point convertPresentationToLayout's own module doc claims for pptx: an odp package, decoded via odf.js's own decodePackage (not ooxml.js's) and read via readOdpContent, feeds convertPresentationToLayout completely unmodified — the identical engine pptxToPdf feeds — and comes out as a genuine, multi-page PDF with real slide content (title text, grouped shapes, table cells, and an image).
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

  // "Should work for free" claims deserve verification, not just assumption: presentation:notes is read into ContentSlide.notes by odf.js's own readOdpContent, and src/layout/slides.ts's hidden-annotation notes mechanism (already built and proven for pptxToPdf) carries any ContentSlide.notes through to the PDF regardless of which reader produced the ContentSlide — this asserts that is genuinely true for odp too, with zero new notes-handling code written for this change.
  it("carries odp speaker notes through to the PDF via the existing hidden-annotation mechanism, with no new notes-handling code", () => {
    const pdfBytes = odpToPdf(minimalOdpBytes());
    const layout = readPdf(pdfBytes);
    expect(layout.pages[0]?.notes).toBe("Speaker notes for slide one.");
    // Slide two carries no presentation:notes at all — confirms the "no notes" case doesn't leak a stray annotation either.
    expect(layout.pages[1]?.notes).toBeUndefined();
  });

  // The fixture's draw:transform="rotate(0.5235987755982988) ..." is exactly 30 degrees; odf.js's own readOdpContent resolves that to ContentShape.rotationDeg -30 (its own read.test.ts asserts the identical value for the identical transform string), and convertPresentationToLayout's shapePlacement negates it again (DrawingML/ODF rotate clockwise, the PDF writer rotates counter-clockwise) to land on +30 here — the same shared shapePlacement code pptxToPdf's own rotated-shape handling uses. wrapRunsToWidth fragments the title into one LayoutText per word, so this looks for the title's first word rather than the whole phrase.
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
  // Proves the architectural point specific to sheets: an ods package, decoded via odf.js's own decodePackage and read via readOdsContent, feeds convertSpreadsheetToLayout (genuinely new layout code, not a reused docx/pptx engine — see convert.ts's own module doc) and comes out as a real PDF carrying real cell content, a real merged cell, and a hidden column that contributes nothing at all to the rendered page.
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

  // The fixture's column B is hidden (table:visibility="collapse") and carries the 'Amount'/123.45 cells — neither should appear anywhere in the rendered PDF at all, confirming src/layout/sheets.ts's own "skip hidden entirely" fix (a real bug caught during this change's own real-file verification: a hidden column's cell was rendering a stray zero-width '###'/truncated fragment instead of nothing).
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

  // End-to-end proof for the per-cell decoration wiring, all the way from real ODF style XML: decoratedOdsBytes declares fo:background-color / fo:border / fo:text-align / style:vertical-align on real table-cell styles, odf.js's readOdsContent resolves all four onto ContentSheetCell, and src/layout/sheets.ts turns them into genuine LayoutRect/LayoutLine items and a genuinely different text position. Asserted against convertSpreadsheetToLayout's own output (the exact LayoutDocument odsToPdf builds internally) rather than a readPdf round trip, so the assertions pin what src/layout/sheets.ts itself emitted rather than what survived a second, independently-tested encode/decode hop — a DocumentTree no longer carries the items themselves, only each node's fused frames.
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

    // Cell A declared all four edges via the fo:border shorthand, cell B exactly one (fo:border-bottom) — five border lines in total, and gridlines are off in this fixture so nothing else contributes a line.
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
  // Proves the architectural point specific to drawings: an odg package, decoded via odf.js's own decodePackage and read via readOdgContent, feeds convertDrawingToLayout (genuinely new layout code for the vector-primitive vocabulary, though its ContentShape half reuses convertShape from slides.ts unmodified — see convert.ts's own module doc) and comes out as a real, valid PDF.
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

  // Genuinely curved, not a straight-line approximation: the fixture's draw:path carries a real svg:d cubic segment (ground-truth-verified real LibreOffice output, see test-support/odg.ts's own note), and this asserts convertDrawingToLayout's own output — the exact LayoutDocument odgToPdf builds internally — carries a LayoutPath item whose subpath actually has a 'cubic' segment, not a 'line'-only approximation of the curve.
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

  // The fixture's three rects (test-support/odg.ts) are BACK, FRONT, then the plain Rect1 in document order — document order is real LibreOffice paint order (odf.js's own typed/draw/shapes.ts note), so the back rect's LayoutRect item must come first in array order for it to paint underneath the overlapping front rect, matching the module doc's documented paint-order convention.
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

  // Vectors paint before shapes — this module's own documented, bounded paint-order limitation (see src/layout/drawing.ts's top-of-file note): the fixture's text frame is the LAST element in document order, but must still appear AFTER every vector LayoutItem in the emitted array.
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
  // Proves the architectural point this pair adds: readMarkdownContent produces the identical WordprocessingContentDocument shape readDocxContent/readOdtContent do, so markdownToPdf feeds convertWordprocessingToLayout completely unmodified — the same engine docxToPdf/odtToPdf feed — and comes out as a real, valid PDF carrying the heading and list content.
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

  it("throws MarkdownUndecodableTextError for bytes that are not text", () => {
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    expect(() => markdownToPdf(png)).toThrow(MarkdownUndecodableTextError);
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
