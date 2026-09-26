import { type ContentVector } from "document-schema.js";
import { decodePackage, el, txt } from "odf.js";
import { describe, expect, it } from "vitest";
import { createOdg } from "../edit/odg/editor";
import { createPptx, openPptx } from "../edit/pptx/editor";
import { readOdgContent } from "../odf/odg/read";
import { readPdf } from "pdf-codec";
import { minimalOdgBytes, minimalOdgPackage } from "../test-support/odg";
import { chapterOdtBytes, odmBytes, odmPackage } from "../test-support/odm";
import {
  inlineOdmSectionToContentSection,
  odgToPdf,
  odmToPdf,
  OdmUnresolvedSectionError,
  pptxToPdf,
} from "./convert";
import { pdfToOdg, pdfToPptx } from "./from-pdf";
import type { LayoutText } from "pdf-codec";
function pdfHeader(bytes: Uint8Array<ArrayBuffer>): string {
  return new TextDecoder("latin1").decode(bytes.subarray(0, 5));
}

function buildSamplePptx(text: string): Uint8Array<ArrayBuffer> {
  const editor = createPptx();
  editor.addSlide().addTextBox({
    frame: { xPt: 50, yPt: 50, widthPt: 400, heightPt: 100 },
    text,
  });
  return editor.toBytes();
}

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

// A uniform bounding box for any ContentVector kind, so a 'rect'/'ellipse'/'path' (frame-carrying) and a 'line' (from/to-carrying) compare on the same footing — needed here specifically because PDF's own content-stream operators force several vector kinds to collapse to 'path' on the way back through readPdf (see the pdfToOdg test's own note below), so comparing frame-to-frame directly would not type-check, let alone compare the right thing, once the kind itself has changed.
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
  // PDF has no rect, ellipse, or line operator whose presence a reader could simply look for — only `re` (itself defined as a four-point subpath) and the general path operators — so what a stroke or fill WAS is recoverable from its geometry or not at all. pdf-codec's own content-stream interpreter now recovers all three from that geometry (its shape-pattern detection: an axis-aligned closed four-corner subpath under any fill/stroke combination is a LayoutRect, a closed four-cubic subpath meeting its bounding box at the four cardinal points with kappa-ratio controls is a LayoutEllipse, an open single-straight-segment stroke-only subpath is a LayoutLine), which is what lets every vector in this fixture round-trip with its ORIGINAL kind intact — including Rect1, which is filled AND stroked and therefore takes the 'B' paint operator rather than 'f', and the ellipse and the line, all three of which used to come back as a generic 'path'. reconstructDrawing itself is unchanged by that: it always mapped whatever kind it was handed 1:1 (src/layout/reconstruct.ts's layoutItemToVector), so the improvement is entirely in how much kind information survives the PDF, not in how it is mapped afterwards. Position and size were already exact within floating-point tolerance regardless of kind and remain so. The text label's own frame is still approximate, for an unrelated reason: reconstructDrawing derives it from real AFM ascent/descent metrics (the same estimation reconstructPresentation already uses), not the original ODF frame's own explicit svg:x/y/width/height, which no longer exists anywhere in the recovered PDF geometry.
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

    // The five non-curve vectors all compare exactly (within tolerance) against their ORIGINAL frame: none of their own points — a rect's corners, an ellipse's kappa-offset controls (which by construction never exceed its own bounding box), or a line's two bare endpoints — ever extend beyond that frame. curvePath (index 5) is handled separately below, for a genuinely different reason.
    beforeVectors.slice(0, 5).forEach((before, i) => {
      expectBoxClose(
        vectorBoundingBox(afterVectors[i]!),
        vectorBoundingBox(before),
      );
    });

    // curvePath's own recovered width does NOT match its original declared frame, and that is expected, not a bug: the fixture's own real-LibreOffice-verified svg:d ("M0 4000h3000c1000 0 1000-4000-1000-4000z", see test-support/odg.ts's own note) has a cubic control point (dx=1000 from x=3000, reaching x=4000) that extends past its own declared svg:viewBox width (3657 units) — a legitimate real-world SVG/ODF authoring pattern, since a viewBox/frame is a declared coordinate window, not a guaranteed tight bounding box of the raw path data. reconstructDrawing has no "declared frame" to fall back to at all — a PDF's recovered geometry carries only points — so its own frame is necessarily the TIGHT bounding box of every recovered point, control points included (per pathBoundingFrame's own doc comment in reconstruct.ts). That tight box can legitimately be larger than whatever frame the original author declared, exactly as it is here. The origin (xPt/yPt) and height still match closely, since the overshoot is one-sided (only the right edge, via the x-extending control point) and the y-extent is unaffected.
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

    // rectBack/rectFront also keep their exact fill colour — a plain passthrough with no lossy quantization beyond formatNumber's own negligible rounding, unlike the vectors above whose kind itself narrowed.
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

    // The ellipse comes back as a real 'ellipse' vector — recovered from the four kappa-ratio cubics writeEllipse emits, since PDF has no ellipse operator to record it with — keeping its exact fill and stroke.
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

    // The curve specifically must still be a genuine cubic segment, not a straight-line approximation of it — proving writePath -> readPdf's own general path tracking (pdf-codec's interpret.ts) recovers the real curve, not just its endpoints, and reconstructDrawing carries that segment kind straight across.
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

  // A rotated vector's own rotation genuinely reaches the page and comes back: convertDrawingToLayout resolves it into a LayoutPath of rotated corners (LayoutRect carries no rotation field of its own), writePath emits those as real PDF path operators, readPdf recovers them, and reconstructDrawing maps them back onto a ContentVector. What survives is the rotated GEOMETRY, not the rotationDeg field — a PDF path records where the corners ended up, never that a right-angled box was turned to get there — so the recovered vector carries no rotation of its own, with its corners sitting exactly where the rotation put them. That is the honest limit of the round trip, and it is checkable exactly, because a 90-degree turn of a wide rect about its own centre swaps that rect's width and height. A QUARTER turn specifically leaves the turned corners still axis-aligned, so pdf-codec's own shape detection legitimately recovers this one as a 'rect' again (its rect pattern covers a 90-degree-rotated CTM, not only an unrotated one) — the same swapped-bounding-box assertions below are what prove the rotation genuinely happened rather than the round trip having quietly ignored it. A rotation that is NOT a multiple of 90 degrees leaves no axis-aligned pattern to match at all and is recovered as a generic 'path', which the sibling test below covers.
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
    expect(recovered.kind).toBe("rect"); // a quarter-turned rect is still axis-aligned, so it is recovered as a rect — turned, not untouched, as the swapped extents below prove
    expect(
      recovered.kind === "rect" ? recovered.rotationDeg : undefined,
    ).toBeUndefined(); // the rotationDeg FIELD is genuinely gone: PDF recorded where the corners ended up, not that a turn produced them

    // The rotated rect's own bounding box is the source frame's width and height SWAPPED, still centred on the same point — exactly what a 90-degree turn produces, and nothing an unrotated round trip could ever produce.
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
    // Four corners, still a closed quadrilateral, still centred where the rotation left it — and demonstrably rotated, since a 30-degree turn of a 120x40 rect bounds to 124.0 x 94.6 rather than the original 120 x 40.
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

  // Confirmed missing by round-tripping a real Keynote-authored pptx with speaker notes through this exact pipeline: notes came back empty. Fixed via a hidden /Subtype /Text PDF annotation (see pdf/write.ts's buildNotesAnnotDict / pdf/read.ts's readPageNotes) — PDF has no native presenter-notes concept, so this is this package's own round-trip mechanism, not a real PDF feature a third-party PDF would carry.
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

  // Proves the whole point of collecting unresolved hrefs up front rather than throwing on the first miss: three sections, only the middle one resolvable, and the thrown error names BOTH of the other two — not just whichever the loop reached first.
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
  // readOdm's own inlineContent field is declared for schema-completeness but never actually populated by the installed odf.js build (a real .odm's text:section-source is always a bare external reference — see odmToPdf's own module comment), so there is no byte-level .odm fixture that can drive this branch through odmToPdf's own public entry point; this exercises the conversion function directly with a hand-built OdmSection instead, the only way to prove it works at all.
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
          el("draw:frame"), // no ContentBlock this package's own odt reader produces either — silently skipped
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
