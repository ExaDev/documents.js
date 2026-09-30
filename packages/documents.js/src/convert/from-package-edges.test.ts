import {
  assembleTree,
  type ContentDocument,
  type DocumentTree,
} from "document-schema.js";
import type { ContentRun } from "document-schema.js";
import type { LayoutItem } from "pdf-codec";
import { describe, expect, it } from "vitest";
import { NOMINAL_TEXT_SIZE_PT } from "../layout/shared";
import { NOMINAL_CELL_TEXT_SIZE_PT } from "../layout/sheets";
import { layoutDocumentFromPackage } from "./from-package";

// The emission edges of the frames-to-layout inverse: which branch a sheet cell takes (its stamped runs, or the displayText fallback at the nominal cell font), the border lines and images a sheet renders, frames that point at a page the package does not have, the styled and wrapped run emission with its re-derived fragment boundaries, and a drawing vector's item.

const frame = { pageIndex: 0, xPt: 10, yPt: 100, widthPt: 50, heightPt: 12 };

const printSettings = {
  pageSize: { widthPt: 200, heightPt: 200 },
  margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
  gridlines: false,
  headers: false,
  pageOrder: "downThenOver" as const,
};

type SpreadsheetContent = Extract<ContentDocument, { kind: "spreadsheet" }>;

function spreadsheetOf(
  cells: SpreadsheetContent["sheets"][number]["cells"],
  images: SpreadsheetContent["sheets"][number]["images"] = [],
): ContentDocument {
  return {
    kind: "spreadsheet",
    metadata: {},
    sheets: [
      { name: "Sheet1", cells, images, columns: [], rows: [], printSettings },
    ],
  };
}

function layoutOf(content: ContentDocument): {
  items: readonly LayoutItem[];
  images: Record<string, unknown>;
} {
  const pkg: DocumentTree = assembleTree(content, [
    { widthPt: 200, heightPt: 200 },
  ]);
  const layout = layoutDocumentFromPackage(pkg);
  const page = layout.pages[0];
  if (page === undefined) {
    throw new Error("expected a first page");
  }
  return { items: page.items, images: layout.images };
}

describe("layoutDocumentFromPackage: sheet cell emission", () => {
  it("a cell with stamped runs renders the runs, not the displayText fallback", () => {
    const { items } = layoutOf(
      spreadsheetOf([
        {
          row: 0,
          column: 0,
          value: { kind: "string", value: "fallback" },
          displayText: "fallback",
          frames: [frame],
          runs: [
            {
              text: "stamped",
              sizePt: 9,
              frames: [{ ...frame, xPt: 11 }],
            },
          ],
        },
      ]),
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "text",
      text: "stamped",
      xPt: 11,
      sizePt: 9,
    });
  });

  it("a cell with no stamped runs falls back to its displayText at the nominal cell font", () => {
    const { items } = layoutOf(
      spreadsheetOf([
        {
          row: 0,
          column: 0,
          value: { kind: "string", value: "plain" },
          displayText: "plain",
          frames: [frame],
        },
      ]),
    );
    expect(items).toEqual([
      {
        kind: "text",
        text: "plain",
        xPt: frame.xPt,
        yPt: frame.yPt,
        font: { family: "Helvetica", weight: "normal", style: "normal" },
        sizePt: NOMINAL_CELL_TEXT_SIZE_PT,
        color: { r: 0, g: 0, b: 0 },
      },
    ]);
  });

  it("a cell's declared borders render as line items beside its text", () => {
    const edge = {
      style: "solid" as const,
      widthPt: 1,
      color: { r: 0, g: 0, b: 0 },
    };
    const { items } = layoutOf(
      spreadsheetOf([
        {
          row: 0,
          column: 0,
          value: { kind: "string", value: "b" },
          displayText: "b",
          frames: [frame],
          borders: { top: edge, left: edge },
        },
      ]),
    );
    expect(items.filter((i) => i.kind === "text")).toHaveLength(1);
    expect(items.filter((i) => i.kind === "line")).toHaveLength(2);
  });

  it("a frame naming a page the package does not carry emits nothing, quietly", () => {
    const { items } = layoutOf(
      spreadsheetOf([
        {
          row: 0,
          column: 0,
          value: { kind: "string", value: "gone" },
          displayText: "gone",
          frames: [{ ...frame, pageIndex: 5 }],
        },
      ]),
    );
    expect(items).toEqual([]);
  });
});

describe("layoutDocumentFromPackage: run emission", () => {
  function wordprocessingOf(runs: ContentRun[]): ContentDocument {
    return {
      kind: "wordprocessing",
      metadata: {},
      sections: [
        {
          pageSize: { widthPt: 200, heightPt: 200 },
          margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
          blocks: [{ kind: "paragraph", runs }],
        },
      ],
    };
  }

  it("a styled run keeps its weight and style and defaults to the nominal text size", () => {
    const { items } = layoutOf(
      wordprocessingOf([
        { text: "bolditalic", bold: true, italic: true, frames: [frame] },
      ]),
    );
    expect(items).toEqual([
      {
        kind: "text",
        text: "bolditalic",
        xPt: frame.xPt,
        yPt: frame.yPt,
        font: { family: "Helvetica", weight: "bold", style: "italic" },
        sizePt: NOMINAL_TEXT_SIZE_PT,
        color: { r: 0, g: 0, b: 0 },
        underline: undefined,
      },
    ]);
  });

  it("a wrapped run re-derives its fragment boundaries frame by frame", () => {
    const { items } = layoutOf(
      wordprocessingOf([
        { text: "wrapped", frames: [frame, { ...frame, yPt: 80 }] },
      ]),
    );
    const texts = items
      .filter(
        (i): i is Extract<LayoutItem, { kind: "text" }> => i.kind === "text",
      )
      .map((i) => [i.text, i.xPt, i.yPt]);
    expect(texts).toEqual([
      ["wrapp", frame.xPt, frame.yPt],
      ["ed", frame.xPt, 80],
    ]);
  });
});

describe("layoutDocumentFromPackage: drawing vectors", () => {
  it("a framed drawing vector renders its item on that page", () => {
    const content: ContentDocument = {
      kind: "drawing",
      metadata: {},
      pages: [
        {
          size: { widthPt: 200, heightPt: 200 },
          vectors: [
            {
              kind: "rect",
              frame: { xPt: 10, yPt: 100, widthPt: 30, heightPt: 20 },
              fill: { r: 255, g: 0, b: 0 },
              frames: [frame],
            },
          ],
          shapes: [],
        },
      ],
    };
    const { items } = layoutOf(content);
    expect(items.filter((i) => i.kind === "rect")).toHaveLength(1);
  });
});
