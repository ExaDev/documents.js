/**
 * A list of tables is not cut at its entries (novus-power/hive#4059): the first line of a wrapped entry stands alone as a caption does, and the rows after it were cut into a table titled by it and indexed as that table, so a search for a table found its entry in the list before the table.
 */
import { describe, expect, it } from "vitest";
import type { LayoutDocument, LayoutItem } from "pdf-codec";
import { detectColumnAlignedTables } from "./column-aligned-tables";
import { cellsOf } from "./column-aligned-tables-fixtures";

function text(
  content: string,
  xPt: number,
  yPt: number,
  bold = false,
): LayoutItem {
  return {
    kind: "text",
    text: content,
    xPt,
    yPt,
    font: {
      family: "Helvetica",
      weight: bold ? "bold" : "normal",
      style: "normal",
    },
    sizePt: 10,
    color: { r: 0, g: 0, b: 0 },
    widthPt: content.length * 5,
  };
}

function pageOf(...items: LayoutItem[]): LayoutDocument {
  return {
    formatVersion: 1,
    metadata: {},
    pages: [{ widthPt: 612, heightPt: 792, items }],
    images: {},
  };
}

const ENTRY_X_PT = 54;
const FOLIO_X_PT = 500;
const LINE_PITCH_PT = 14;
/** The gap above a wrapped entry's first line, wide enough that the line is set apart from the entry above it, as a caption is. */
const PARAGRAPH_GAP_PT = 2 * LINE_PITCH_PT;

/** One entry of a list of tables: its title and the page it is on, or, when `wrapped`, the title's first line alone and the rest of it beside the page. */
type Entry =
  | { readonly title: string; readonly folio: string }
  | {
      readonly first: string;
      readonly rest: string;
      readonly folio: string;
    };

/** The list set down from `topYPt`: each entry's title in bold and its folio at the right in the body face, a wrapped entry's first line alone above its second line. As a list of tables is typeset, the titles are set as the captions they cite are, which is what lets a wrapped entry's first line read as a caption. */
function listOf(topYPt: number, entries: readonly Entry[]): LayoutItem[] {
  const items: LayoutItem[] = [];
  let yPt = topYPt;
  for (const entry of entries) {
    if ("first" in entry) {
      yPt -= PARAGRAPH_GAP_PT;
      items.push(text(entry.first, ENTRY_X_PT, yPt, true));
      yPt -= LINE_PITCH_PT;
      items.push(text(entry.rest, ENTRY_X_PT, yPt, true));
      items.push(text(entry.folio, FOLIO_X_PT, yPt));
    } else {
      yPt -= LINE_PITCH_PT;
      items.push(text(entry.title, ENTRY_X_PT, yPt, true));
      items.push(text(entry.folio, FOLIO_X_PT, yPt));
    }
  }
  return items;
}

/** A made-up list of tables, with two entries that wrap, in the order of its pages. */
const LIST_OF_TABLES: readonly Entry[] = [
  { title: "TABLE 1A - Widget ratings", folio: "12" },
  { title: "TABLE 1B - Widget voltage drop", folio: "14" },
  { title: "TABLE 2A - Gadget ratings", folio: "16" },
  {
    first: "TABLE 2B - Gadget ratings for cables in ducts",
    rest: "(ratings in amperes)",
    folio: "18",
  },
  { title: "TABLE 3A - Sprocket ratings", folio: "21" },
  { title: "TABLE 3B - Sprocket voltage drop", folio: "23" },
  {
    first: "TABLE 4A - Cog ratings for cables in free air",
    rest: "(ratings in amperes)",
    folio: "25",
  },
  { title: "TABLE 4B - Cog voltage drop", folio: "28" },
  { title: "TABLE 5A - Lever ratings", folio: "31" },
  { title: "TABLE 5B - Lever voltage drop", folio: "33" },
  { title: "TABLE 6A - Pulley ratings", folio: "36" },
  { title: "TABLE 6B - Pulley voltage drop", folio: "38" },
] as const;

describe("detectColumnAlignedTables, a list of tables (novus-power/hive#4059)", () => {
  it("keeps a list of tables whole under no title, so a wrapped entry's first line is not the caption of the rows after it", () => {
    const tables = detectColumnAlignedTables(
      pageOf(...listOf(700, LIST_OF_TABLES)),
      new Set(),
    ).get(0);

    expect(tables).toHaveLength(1);
    expect(tables?.[0]?.caption).toBeUndefined();
    expect(cellsOf(tables?.[0])).toContainEqual(["(ratings in amperes)", "18"]);
  });

  it("still cuts a page of data tables at their captions when their rows are labels beside rising figures, since no entry of them names a table", () => {
    const ratings = (topYPt: number, first: number) =>
      Array.from({ length: 6 }, (_row, index) => {
        const yPt = topYPt - index * LINE_PITCH_PT;
        return [
          text(`Circuit ${String.fromCharCode(65 + index)}`, ENTRY_X_PT, yPt),
          text(String(first + 4 * index), FOLIO_X_PT, yPt),
        ];
      }).flat();

    const tables = detectColumnAlignedTables(
      pageOf(
        text("TABLE 7A - Circuit ratings", ENTRY_X_PT, 740),
        ...ratings(700, 6),
        text("TABLE 7B - Spare circuit ratings", ENTRY_X_PT, 560),
        ...ratings(520, 40),
      ),
      new Set(),
    ).get(0);

    expect(tables?.map((table) => table.caption)).toEqual([
      "TABLE 7A - Circuit ratings",
      "TABLE 7B - Spare circuit ratings",
    ]);
  });
});
