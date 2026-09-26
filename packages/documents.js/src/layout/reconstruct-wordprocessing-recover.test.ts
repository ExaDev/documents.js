import { describe, expect, it } from "vitest";
import type {
  ContentBlock,
  ContentSlide,
  ContentTableCell,
  ContentVector,
} from "document-schema.js";
import { drawingOfBlock } from "../model/embedded-drawing";
import { reconstructPresentation } from "./reconstruct-presentations-prod";
import { reconstructWordprocessing } from "./reconstruct";
import type {
  LayoutDocument,
  LayoutImageAsset,
  LayoutItem,
  LayoutPage,
  LayoutText,
} from "pdf-codec";
const RED = { r: 1, g: 0, b: 0 };
const BLACK = { r: 0, g: 0, b: 0 };

function text(overrides: {
  text: string;
  xPt: number;
  yPt: number;
  widthPt: number;
  sizePt?: number;
  family?: string;
  bold?: boolean;
}): LayoutText {
  return {
    kind: "text",
    text: overrides.text,
    xPt: overrides.xPt,
    yPt: overrides.yPt,
    font: {
      family: overrides.family ?? "Helvetica",
      weight: overrides.bold === true ? "bold" : "normal",
      style: "normal",
    },
    sizePt: overrides.sizePt ?? 12,
    color: { r: 0, g: 0, b: 0 },
    widthPt: overrides.widthPt,
  };
}

function line(
  x1Pt: number,
  y1Pt: number,
  x2Pt: number,
  y2Pt: number,
): LayoutItem {
  return { kind: "line", x1Pt, y1Pt, x2Pt, y2Pt, color: BLACK, widthPt: 0.5 };
}

// The generic-path shape a stroke can still arrive in when it misses pdf-codec's own LayoutLine shape pattern (several segments in one subpath, or a subpath that is also filled), and the shape every stroke arrived in before that pattern existed. detectGridLattice accepts it alongside a genuine LayoutLine so a hand-built LayoutDocument, an older recorded one, and a freshly round-tripped one all detect identically — which the "built from stroked LayoutPath items" test below is what actually pins.
function page(
  widthPt: number,
  heightPt: number,
  items: LayoutItem[],
): LayoutPage {
  return { widthPt, heightPt, items };
}

function docFrom(
  pages: LayoutPage[],
  images: Record<string, LayoutImageAsset> = {},
): LayoutDocument {
  return { formatVersion: 1, metadata: {}, pages, images };
}

function drawingVectorsOf(block: ContentBlock | undefined): ContentVector[] {
  if (block?.kind !== "embeddedObject") {
    throw new Error(
      `expected an embeddedObject block, got ${String(block?.kind)}`,
    );
  }
  const document = drawingOfBlock(block);
  if (document === undefined) {
    throw new Error("expected the embedded document to be a drawing document");
  }
  return [...document.pages[0]!.vectors];
}

function blocksOf(
  doc: ReturnType<typeof reconstructWordprocessing>,
): ContentBlock[] {
  if (doc.kind !== "wordprocessing") {
    throw new Error("expected a wordprocessing document");
  }
  return doc.sections.flatMap((s) => s.blocks);
}

function slidesOf(
  doc: ReturnType<typeof reconstructPresentation>,
): ContentSlide[] {
  if (doc.kind !== "presentation") {
    throw new Error("expected a presentation document");
  }
  return [...doc.slides];
}

describe("reconstructWordprocessing: vector recovery", () => {
  it("recovers a page's rect/ellipse/line/path geometry as an embedded drawing block, using the same classification reconstructDrawing does", () => {
    const items: LayoutItem[] = [
      text({ text: "Heading", xPt: 50, yPt: 700, widthPt: 60 }),
      {
        kind: "rect",
        xPt: 50,
        yPt: 600,
        widthPt: 100,
        heightPt: 40,
        fill: RED,
      },
      {
        kind: "ellipse",
        xPt: 200,
        yPt: 600,
        widthPt: 60,
        heightPt: 30,
        stroke: { color: BLACK, widthPt: 1 },
      },
      line(50, 580, 300, 580),
    ];
    const blocks = blocksOf(
      reconstructWordprocessing(docFrom([page(612, 792, items)])),
    );
    const embedded = blocks.find((b) => b.kind === "embeddedObject");
    const vectors = drawingVectorsOf(embedded);
    expect(vectors.map((v) => v.kind)).toEqual(["rect", "ellipse", "line"]);
    // The identical flipY inverse reconstructDrawing applies: yPt = 792 - 600 - 40.
    expect(vectors[0]).toMatchObject({
      kind: "rect",
      frame: { xPt: 50, yPt: 152, widthPt: 100, heightPt: 40 },
      fill: RED,
      paintOrder: 0,
    });
    // The text is untouched by vector recovery — it still clusters into its own paragraph.
    expect(blocks.filter((b) => b.kind === "paragraph")).toHaveLength(1);
  });

  it("emits no embedded drawing block at all for a page carrying no vector geometry, leaving a text-only page exactly as it was", () => {
    const blocks = blocksOf(
      reconstructWordprocessing(
        docFrom([
          page(612, 792, [
            text({ text: "Only text", xPt: 50, yPt: 700, widthPt: 60 }),
          ]),
        ]),
      ),
    );
    expect(blocks.map((b) => b.kind)).toEqual(["paragraph"]);
  });

  // The recovered drawing sorts into the page's own block flow by its topmost vector, not pinned to the top or bottom — so a rule drawn below a paragraph reads after it.
  it("positions the recovered drawing among the page's other blocks by its own topmost recovered edge", () => {
    const items: LayoutItem[] = [
      text({ text: "Above the rule", xPt: 50, yPt: 700, widthPt: 80 }),
      line(50, 650, 300, 650),
      text({ text: "Below the rule", xPt: 50, yPt: 600, widthPt: 80 }),
    ];
    const blocks = blocksOf(
      reconstructWordprocessing(docFrom([page(612, 792, items)])),
    );
    expect(blocks.map((b) => b.kind)).toEqual([
      "paragraph",
      "embeddedObject",
      "paragraph",
    ]);
  });
});

describe("reconstructPresentation: vector recovery", () => {
  it("recovers a slide's vector geometry as a backmost shape wrapping an embedded drawing block", () => {
    const items: LayoutItem[] = [
      { kind: "rect", xPt: 0, yPt: 0, widthPt: 960, heightPt: 540, fill: RED },
      text({ text: "Title", xPt: 100, yPt: 400, widthPt: 60 }),
    ];
    const [slide] = slidesOf(
      reconstructPresentation(docFrom([page(960, 540, items)])),
    );
    expect(slide!.shapes).toHaveLength(2);
    // Vectors paint behind everything else, matching drawing.ts's own documented fallback ordering.
    expect(
      drawingVectorsOf(slide!.shapes[0]!.blocks[0]).map((v) => v.kind),
    ).toEqual(["rect"]);
    expect(slide!.shapes[0]!.frame).toEqual({
      xPt: 0,
      yPt: 0,
      widthPt: 960,
      heightPt: 540,
    });
    expect(slide!.shapes[1]!.blocks[0]).toMatchObject({ kind: "paragraph" });
  });

  it("leaves a text-only slide with exactly the shapes it always had", () => {
    const [slide] = slidesOf(
      reconstructPresentation(
        docFrom([
          page(960, 540, [
            text({ text: "Title", xPt: 100, yPt: 400, widthPt: 60 }),
          ]),
        ]),
      ),
    );
    expect(slide!.shapes).toHaveLength(1);
    expect(slide!.shapes[0]!.blocks[0]).toMatchObject({ kind: "paragraph" });
  });
});

// --- Table recovery, gated on a real drawn gridline lattice ---------------------------------------------------

// The same 3x3 boundary lattice the spreadsheet suite above uses, so the gate is demonstrably the identical detector rather than a second one with its own thresholds.
function latticeItems(): LayoutItem[] {
  return [
    line(0, 200, 300, 200),
    line(0, 150, 300, 150),
    line(0, 100, 300, 100),
    line(0, 100, 0, 200),
    line(120, 100, 120, 200),
    line(300, 100, 300, 200),
  ];
}

describe("reconstructWordprocessing: gridline-gated table recovery", () => {
  it("synthesizes a real table from a drawn lattice, with genuinely measured column widths and row heights", () => {
    const items: LayoutItem[] = [
      ...latticeItems(),
      text({ text: "Name", xPt: 10, yPt: 180, widthPt: 30 }),
      text({ text: "Total", xPt: 130, yPt: 180, widthPt: 30 }),
      text({ text: "Acme", xPt: 10, yPt: 130, widthPt: 30 }),
      text({ text: "10", xPt: 130, yPt: 130, widthPt: 15 }),
    ];
    const blocks = blocksOf(
      reconstructWordprocessing(docFrom([page(300, 300, items)])),
    );
    const table = blocks.find((b) => b.kind === "table");
    if (table?.kind !== "table") {
      throw new Error("expected a recovered table block");
    }
    expect(table.columns).toEqual([{ widthPt: 120 }, { widthPt: 180 }]);
    expect(table.rows.map((r) => r.heightPt)).toEqual([50, 50]);
    expect(
      table.rows.map((r) =>
        r.cells.map((c) =>
          c.blocks
            .flatMap((b) =>
              b.kind === "paragraph" ? b.runs.map((run) => run.text) : [],
            )
            .join(""),
        ),
      ),
    ).toEqual([
      ["Name", "Total"],
      ["Acme", "10"],
    ]);
  });

  it("does not also emit the table's own text as loose paragraphs, nor its own gridlines as loose vectors", () => {
    const items: LayoutItem[] = [
      ...latticeItems(),
      text({ text: "Inside", xPt: 10, yPt: 180, widthPt: 30 }),
    ];
    const blocks = blocksOf(
      reconstructWordprocessing(docFrom([page(300, 300, items)])),
    );
    expect(blocks.map((b) => b.kind)).toEqual(["table"]);
  });

  it("recovers a vector drawn OUTSIDE the lattice while still excluding the lattice's own strokes", () => {
    const items: LayoutItem[] = [
      ...latticeItems(),
      text({ text: "Inside", xPt: 10, yPt: 180, widthPt: 30 }),
      {
        kind: "ellipse",
        xPt: 20,
        yPt: 250,
        widthPt: 40,
        heightPt: 20,
        fill: RED,
      },
    ];
    const blocks = blocksOf(
      reconstructWordprocessing(docFrom([page(300, 300, items)])),
    );
    const embedded = blocks.find((b) => b.kind === "embeddedObject");
    expect(drawingVectorsOf(embedded).map((v) => v.kind)).toEqual(["ellipse"]); // the six lattice lines are the table's structure, reported once
  });

  // The whole point of the gate: aligned columns of text with wide gaps are indistinguishable from a tabbed paragraph or a two-column layout, so they must never become a table.
  it("never invents a table from column-aligned text alone, with no lattice drawn", () => {
    const items: LayoutItem[] = [
      text({ text: "Name", xPt: 50, yPt: 200, widthPt: 40 }),
      text({ text: "Total", xPt: 200, yPt: 200, widthPt: 40 }),
      text({ text: "Acme", xPt: 50, yPt: 180, widthPt: 40 }),
      text({ text: "10", xPt: 200, yPt: 180, widthPt: 15 }),
    ];
    const blocks = blocksOf(
      reconstructWordprocessing(docFrom([page(300, 300, items)])),
    );
    expect(blocks.some((b) => b.kind === "table")).toBe(false);
    expect(blocks.every((b) => b.kind === "paragraph")).toBe(true);
  });

  it("rejects a lattice with no text inside it as decoration rather than recovering an empty table", () => {
    const items: LayoutItem[] = [
      ...latticeItems(),
      text({ text: "Caption below", xPt: 10, yPt: 40, widthPt: 60 }),
    ];
    const blocks = blocksOf(
      reconstructWordprocessing(docFrom([page(300, 300, items)])),
    );
    expect(blocks.some((b) => b.kind === "table")).toBe(false);
    // The strokes are still real geometry, so they come back as recovered vectors rather than vanishing.
    expect(
      drawingVectorsOf(blocks.find((b) => b.kind === "embeddedObject")),
    ).toHaveLength(6);
  });

  it("does not fire on too few parallel lines, exactly as the spreadsheet direction does not", () => {
    const items: LayoutItem[] = [
      line(0, 200, 300, 200),
      line(0, 100, 300, 100),
      line(0, 100, 0, 200),
      line(300, 100, 300, 200),
      text({ text: "Solo", xPt: 10, yPt: 180, widthPt: 30 }),
    ];
    const blocks = blocksOf(
      reconstructWordprocessing(docFrom([page(300, 300, items)])),
    );
    expect(blocks.some((b) => b.kind === "table")).toBe(false);
  });

  // A table's borders in real output are drawn per cell edge, not as one line across the whole row (src/layout/shared.ts's own border emission) — so the detector must union collinear touching segments before measuring a boundary's span, or a multi-column table never reaches the span-consistency bar.
  it("detects a lattice whose boundaries are drawn as per-cell segments rather than full-width lines", () => {
    const items: LayoutItem[] = [
      line(0, 200, 120, 200),
      line(120, 200, 300, 200),
      line(0, 150, 120, 150),
      line(120, 150, 300, 150),
      line(0, 100, 120, 100),
      line(120, 100, 300, 100),
      line(0, 100, 0, 200),
      line(120, 100, 120, 200),
      line(300, 100, 300, 200),
      text({ text: "Cell", xPt: 10, yPt: 180, widthPt: 30 }),
    ];
    const blocks = blocksOf(
      reconstructWordprocessing(docFrom([page(300, 300, items)])),
    );
    expect(blocks.some((b) => b.kind === "table")).toBe(true);
  });

  it("synthesizes a real table from a lattice drawn entirely as thin filled rects, not stroked lines (several real-world PDF generators draw table gridlines this way)", () => {
    const THICKNESS = 0.5;
    const items: LayoutItem[] = [
      {
        kind: "rect",
        xPt: 0,
        yPt: 200 - THICKNESS / 2,
        widthPt: 300,
        heightPt: THICKNESS,
        fill: BLACK,
      },
      {
        kind: "rect",
        xPt: 0,
        yPt: 150 - THICKNESS / 2,
        widthPt: 300,
        heightPt: THICKNESS,
        fill: BLACK,
      },
      {
        kind: "rect",
        xPt: 0,
        yPt: 100 - THICKNESS / 2,
        widthPt: 300,
        heightPt: THICKNESS,
        fill: BLACK,
      },
      {
        kind: "rect",
        xPt: 0 - THICKNESS / 2,
        yPt: 100,
        widthPt: THICKNESS,
        heightPt: 100,
        fill: BLACK,
      },
      {
        kind: "rect",
        xPt: 120 - THICKNESS / 2,
        yPt: 100,
        widthPt: THICKNESS,
        heightPt: 100,
        fill: BLACK,
      },
      {
        kind: "rect",
        xPt: 300 - THICKNESS / 2,
        yPt: 100,
        widthPt: THICKNESS,
        heightPt: 100,
        fill: BLACK,
      },
      text({ text: "Name", xPt: 10, yPt: 180, widthPt: 30 }),
      text({ text: "Total", xPt: 130, yPt: 180, widthPt: 30 }),
      text({ text: "Acme", xPt: 10, yPt: 130, widthPt: 30 }),
      text({ text: "10", xPt: 130, yPt: 130, widthPt: 15 }),
    ];
    const blocks = blocksOf(
      reconstructWordprocessing(docFrom([page(300, 300, items)])),
    );
    const table = blocks.find((b) => b.kind === "table");
    if (table?.kind !== "table") {
      throw new Error("expected a recovered table block");
    }
    expect(table.columns).toEqual([{ widthPt: 120 }, { widthPt: 180 }]);
    expect(table.rows.map((r) => r.heightPt)).toEqual([50, 50]);
    expect(
      table.rows.map((r) =>
        r.cells.map((c) =>
          c.blocks
            .flatMap((b) =>
              b.kind === "paragraph" ? b.runs.map((run) => run.text) : [],
            )
            .join(""),
        ),
      ),
    ).toEqual([
      ["Name", "Total"],
      ["Acme", "10"],
    ]);
  });

  // ExaDev/documents.js#1077: a real production document's every page carried a full-width header rule and footer rule, so the "table" bounding box the old whole-page detector picked became the whole page (the header/footer rules closing the top/bottom edges, nothing ever closing the sides) — recovering zero tables from a document whose entire payload was six ruled tables. Header and footer rules never cross any of the table's own column lines, so they now fall into their own rejected clusters instead of contaminating the real one.
  it("still recovers the table when the page also carries a header rule and a footer rule (regression: ExaDev/documents.js#1077)", () => {
    const items: LayoutItem[] = [
      ...latticeItems(),
      line(0, 280, 300, 280), // header rule, full page width, well above the table
      line(0, 20, 300, 20), // footer rule, full page width, well below the table
      text({ text: "Name", xPt: 10, yPt: 180, widthPt: 30 }),
      text({ text: "Total", xPt: 130, yPt: 180, widthPt: 30 }),
      text({ text: "Acme", xPt: 10, yPt: 130, widthPt: 30 }),
      text({ text: "10", xPt: 130, yPt: 130, widthPt: 15 }),
    ];
    const blocks = blocksOf(
      reconstructWordprocessing(docFrom([page(300, 300, items)])),
    );
    const table = blocks.find((b) => b.kind === "table");
    if (table?.kind !== "table") {
      throw new Error("expected a recovered table block");
    }
    expect(table.columns).toEqual([{ widthPt: 120 }, { widthPt: 180 }]);
    expect(table.rows.map((r) => r.heightPt)).toEqual([50, 50]);
  });

  // ExaDev/documents.js#1077: a caption sitting immediately above a real table (its own underline sorting above the table's real top edge in descending-y order) used to become rowLines[0] itself, scoring the real top edge's coverage against the caption's own narrow width. The underline never reaches either of the table's column lines, so it now falls into its own rejected cluster instead.
  it("still recovers the table when a caption's own underline sits just above its top edge (regression: ExaDev/documents.js#1077)", () => {
    const items: LayoutItem[] = [
      ...latticeItems(),
      line(90, 214, 170, 214), // caption underline, narrower than the table, 14pt above its real top edge
      text({ text: "Table 1", xPt: 90, yPt: 220, widthPt: 60 }),
      text({ text: "Name", xPt: 10, yPt: 180, widthPt: 30 }),
      text({ text: "Total", xPt: 130, yPt: 180, widthPt: 30 }),
      text({ text: "Acme", xPt: 10, yPt: 130, widthPt: 30 }),
      text({ text: "10", xPt: 130, yPt: 130, widthPt: 15 }),
    ];
    const blocks = blocksOf(
      reconstructWordprocessing(docFrom([page(300, 300, items)])),
    );
    const table = blocks.find((b) => b.kind === "table");
    if (table?.kind !== "table") {
      throw new Error("expected a recovered table block");
    }
    expect(table.columns).toEqual([{ widthPt: 120 }, { widthPt: 180 }]);
    expect(table.rows.map((r) => r.heightPt)).toEqual([50, 50]);
  });

  // ExaDev/documents.js#1077: a border interrupted by one real gap (a single row whose own side rule a producer never drew) is still overwhelmingly a drawn boundary — scoring it by its longest unbroken run alone (the old bestRunCoverageRatio) rejected an edge that was ~97% drawn.
  it("still recovers the table when one edge is drawn as two segments with a small real gap between them (regression: ExaDev/documents.js#1077)", () => {
    const items: LayoutItem[] = [
      line(0, 300, 300, 300),
      line(0, 200, 300, 200),
      line(0, 100, 300, 100),
      line(0, 100, 0, 197), // left column, lower segment
      line(0, 203, 0, 300), // left column, upper segment — 6pt gap out of a 200pt span
      line(150, 100, 150, 300),
      line(300, 100, 300, 300),
      text({ text: "Name", xPt: 10, yPt: 280, widthPt: 30 }),
      text({ text: "Total", xPt: 160, yPt: 280, widthPt: 30 }),
      text({ text: "Acme", xPt: 10, yPt: 130, widthPt: 30 }),
      text({ text: "10", xPt: 160, yPt: 130, widthPt: 15 }),
    ];
    const blocks = blocksOf(
      reconstructWordprocessing(docFrom([page(300, 300, items)])),
    );
    const table = blocks.find((b) => b.kind === "table");
    if (table?.kind !== "table") {
      throw new Error("expected a recovered table block");
    }
    expect(table.columns).toEqual([{ widthPt: 150 }, { widthPt: 150 }]);
    expect(table.rows.map((r) => r.heightPt)).toEqual([100, 100]);
  });
});

// --- Irregular per-row/per-column gridlines: colSpan/rowSpan recovery (ExaDev/documents.js#810) ---------------
//
// A real ruled table (a title block, a "field: value" row of varying length) routinely has some rows or columns whose own drawn boundary segments cover only PART of the table's full width/height, because a neighbouring cell spans past that boundary. The two real documents that originally surfaced this (NGET TS 2.01, UKPN EAS 05-0000) are reproduced here as minimal synthetic geometry rather than the licensed PDFs themselves.
describe("reconstructWordprocessing: irregular gridlines recover colSpan/rowSpan rather than being rejected wholesale", () => {
  it("recovers a rowSpan cell whose own row divider is drawn under only some columns, not the whole table's width", () => {
    const items: LayoutItem[] = [
      // Outer rectangle: x 0/150/300, y 200/150/100.
      line(0, 200, 300, 200),
      line(0, 100, 300, 100),
      line(0, 100, 0, 200),
      line(300, 100, 300, 200),
      // The column divider runs the full height — both rows are split into two columns.
      line(150, 100, 150, 200),
      // The row divider is drawn ONLY under the right column: the left column's own cell (Ref) spans both rows, so no boundary is drawn under it at y=150 at all — exactly the "this row boundary's own merged width is narrower than the table's" symptom reported in #810 (94.4pt/134.3pt/... never converging to one consistent span).
      line(150, 150, 300, 150),
      text({ text: "Ref", xPt: 10, yPt: 180, widthPt: 30 }),
      text({ text: "Name", xPt: 160, yPt: 180, widthPt: 30 }),
      text({ text: "Value", xPt: 160, yPt: 120, widthPt: 30 }),
    ];
    const blocks = blocksOf(
      reconstructWordprocessing(docFrom([page(300, 300, items)])),
    );
    const table = blocks.find((b) => b.kind === "table");
    if (table?.kind !== "table") {
      throw new Error("expected a recovered table block");
    }
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0]!.cells).toHaveLength(2);
    expect(table.rows[0]!.cells[0]!.rowSpan).toBe(2);
    expect(table.rows[0]!.cells[0]!.colSpan).toBeUndefined();
    const textOf = (cell: ContentTableCell): string =>
      cell.blocks
        .flatMap((b) =>
          b.kind === "paragraph" ? b.runs.map((r) => r.text) : [],
        )
        .join("");
    expect(textOf(table.rows[0]!.cells[0]!)).toBe("Ref");
    expect(textOf(table.rows[0]!.cells[1]!)).toBe("Name");
    // The second row's own first entry is the position the rowSpan cell covers: a real, empty cell, so the row still holds one entry per grid column.
    expect(table.rows[1]!.cells).toHaveLength(2);
    expect(table.rows[1]!.cells[0]!.blocks).toEqual([]);
    expect(textOf(table.rows[1]!.cells[1]!)).toBe("Value");
  });

  it("recovers a colSpan header cell whose own column dividers are drawn under only some rows", () => {
    const items: LayoutItem[] = [
      // Outer rectangle: x 0/100/200/300, y 200/150/100.
      line(0, 200, 300, 200),
      line(0, 100, 300, 100),
      line(0, 100, 0, 200),
      line(300, 100, 300, 200),
      // The row divider runs the full width — the header row is fully separated from the body.
      line(0, 150, 300, 150),
      // The column dividers are drawn ONLY under the bottom row: the header spans all three columns, so no vertical stroke crosses it at x=100/x=200 — the mirror image of the rowSpan case above, on the column axis instead of the row axis.
      line(100, 100, 100, 150),
      line(200, 100, 200, 150),
      text({ text: "Title", xPt: 10, yPt: 180, widthPt: 30 }),
      text({ text: "A", xPt: 10, yPt: 120, widthPt: 10 }),
      text({ text: "B", xPt: 110, yPt: 120, widthPt: 10 }),
      text({ text: "C", xPt: 210, yPt: 120, widthPt: 10 }),
    ];
    const blocks = blocksOf(
      reconstructWordprocessing(docFrom([page(300, 300, items)])),
    );
    const table = blocks.find((b) => b.kind === "table");
    if (table?.kind !== "table") {
      throw new Error("expected a recovered table block");
    }
    const textOf = (cell: ContentTableCell): string =>
      cell.blocks
        .flatMap((b) =>
          b.kind === "paragraph" ? b.runs.map((r) => r.text) : [],
        )
        .join("");
    expect(table.rows).toHaveLength(2);
    // The header spans three grid columns, so its row still holds one entry per column: the anchor at column 0 and an empty covered cell at each of the two columns it reaches.
    expect(table.rows[0]!.cells).toHaveLength(3);
    expect(table.rows[0]!.cells[0]!.colSpan).toBe(3);
    expect(table.rows[0]!.cells[0]!.rowSpan).toBeUndefined();
    expect(table.rows[0]!.cells.map(textOf)).toEqual(["Title", "", ""]);
    expect(table.rows[0]!.cells[1]).toEqual({ blocks: [] });
    expect(table.rows[0]!.cells[2]).toEqual({ blocks: [] });
    expect(table.rows[1]!.cells).toHaveLength(3);
    expect(table.rows[1]!.cells.map(textOf)).toEqual(["A", "B", "C"]);
  });

  it("recovers a region spanning two columns and two rows as one anchor plus an empty covered cell at every other position it reaches, in every row", () => {
    const items: LayoutItem[] = [
      // Outer rectangle: x 0/100/200/300, y 250/200/150/100.
      line(0, 250, 300, 250),
      line(0, 100, 300, 100),
      line(0, 100, 0, 250),
      line(300, 100, 300, 250),
      // The right column's divider (x=200) and the bottom row's divider (y=150) are drawn in full; the divider at x=100 is drawn only in the bottom row, and the divider at y=200 only in the rightmost column, so the top-left 2x2 block of atomic cells has no stroke between any of them and is one region.
      line(200, 100, 200, 250),
      line(0, 150, 300, 150),
      line(100, 100, 100, 150),
      line(200, 200, 300, 200),
      text({ text: "Big", xPt: 10, yPt: 230, widthPt: 20 }),
      text({ text: "R", xPt: 210, yPt: 230, widthPt: 10 }),
      text({ text: "S", xPt: 210, yPt: 180, widthPt: 10 }),
      text({ text: "X", xPt: 10, yPt: 120, widthPt: 10 }),
      text({ text: "Y", xPt: 110, yPt: 120, widthPt: 10 }),
      text({ text: "Z", xPt: 210, yPt: 120, widthPt: 10 }),
    ];
    const blocks = blocksOf(
      reconstructWordprocessing(docFrom([page(300, 300, items)])),
    );
    const table = blocks.find((b) => b.kind === "table");
    if (table?.kind !== "table") {
      throw new Error("expected a recovered table block");
    }
    const textOf = (cell: ContentTableCell): string =>
      cell.blocks
        .flatMap((b) =>
          b.kind === "paragraph" ? b.runs.map((r) => r.text) : [],
        )
        .join("");
    expect(table.columns).toEqual([
      { widthPt: 100 },
      { widthPt: 100 },
      { widthPt: 100 },
    ]);
    expect(table.rows.map((row) => row.cells.length)).toEqual([3, 3, 3]);
    const anchor = table.rows[0]!.cells[0]!;
    expect(anchor.colSpan).toBe(2);
    expect(anchor.rowSpan).toBe(2);
    expect(textOf(anchor)).toBe("Big");
    // The anchor's frame spans the whole merged region: two 100pt columns and two 50pt rows, its bottom edge at the lower boundary of the region's last row.
    expect(anchor.frames).toEqual([
      { pageIndex: 0, xPt: 0, yPt: 150, widthPt: 200, heightPt: 100 },
    ]);
    expect(table.rows[0]!.cells[2]!.frames).toEqual([
      { pageIndex: 0, xPt: 200, yPt: 200, widthPt: 100, heightPt: 50 },
    ]);
    expect(table.rows[0]!.cells[1]).toEqual({ blocks: [] });
    expect(table.rows[1]!.cells[0]).toEqual({ blocks: [] });
    expect(table.rows[1]!.cells[1]).toEqual({ blocks: [] });
    expect(table.rows.map((row) => row.cells.map(textOf))).toEqual([
      ["Big", "", "R"],
      ["", "", "S"],
      ["X", "Y", "Z"],
    ]);
  });

  it("rejects a lattice whose missing dividers don't reduce to a rectangular merge (an L-shaped union no colSpan/rowSpan pair can express)", () => {
    const items: LayoutItem[] = [
      line(0, 200, 300, 200),
      line(0, 100, 300, 100),
      line(0, 100, 0, 200),
      line(300, 100, 300, 200),
      // The column divider is drawn for the TOP row only; the row divider is drawn for the LEFT column only — so the top-right, bottom-left, and bottom-right atomic cells all merge transitively into one region while the top-left stays alone, a shape no single colSpan/rowSpan cell can express.
      line(150, 150, 150, 200),
      line(0, 150, 150, 150),
      text({ text: "Solo", xPt: 10, yPt: 180, widthPt: 30 }),
    ];
    const blocks = blocksOf(
      reconstructWordprocessing(docFrom([page(300, 300, items)])),
    );
    expect(blocks.some((b) => b.kind === "table")).toBe(false);
    // A rejected lattice's own text still recovers as an ordinary paragraph, and its strokes as loose vectors — exactly as "does not fire on too few parallel lines" and "rejects a lattice with no text inside it" already establish for the other rejection paths above.
    expect(
      blocks.some(
        (b) =>
          b.kind === "paragraph" &&
          b.runs.map((r) => r.text).join("") === "Solo",
      ),
    ).toBe(true);
  });

  it("rejects a lattice whose every interior boundary turns out undrawn, collapsing the outer rectangle into one cell with no real structure", () => {
    const items: LayoutItem[] = [
      line(0, 200, 300, 200),
      line(0, 100, 300, 100),
      line(0, 100, 0, 200),
      line(300, 100, 300, 200),
      // Both interior candidates exist (long enough to qualify, and far enough from the outer edges to be their own distinct boundary) but neither one's own drawn length covers a meaningful fraction of any atomic cell's own edge — a stray mark, not a real divider anywhere on the grid.
      line(0, 150, 5, 150),
      line(150, 100, 150, 105),
      text({ text: "Solo", xPt: 10, yPt: 180, widthPt: 30 }),
    ];
    const blocks = blocksOf(
      reconstructWordprocessing(docFrom([page(300, 300, items)])),
    );
    expect(blocks.some((b) => b.kind === "table")).toBe(false);
    expect(
      blocks.some(
        (b) =>
          b.kind === "paragraph" &&
          b.runs.map((r) => r.text).join("") === "Solo",
      ),
    ).toBe(true);
  });
});

describe("reconstructPresentation: gridline-gated table recovery", () => {
  it("wraps a recovered table in a shape framed at the lattice's own bounds", () => {
    const items: LayoutItem[] = [
      ...latticeItems(),
      text({ text: "Inside", xPt: 10, yPt: 180, widthPt: 30 }),
    ];
    const [slide] = slidesOf(
      reconstructPresentation(docFrom([page(300, 300, items)])),
    );
    const tableShape = slide!.shapes.find((s) => s.blocks[0]?.kind === "table");
    expect(tableShape).toBeDefined();
    expect(tableShape!.frame).toEqual({
      xPt: 0,
      yPt: 100,
      widthPt: 300,
      heightPt: 100,
    }); // flipY of x 0..300, y 100..200 on a 300pt-tall page
    expect(slide!.shapes.some((s) => s.blocks[0]?.kind === "paragraph")).toBe(
      false,
    ); // the table's own text is not also a loose text shape
  });
});

// --- Heuristic cell re-typing, reported through the inference sink ---------------------------------------------
