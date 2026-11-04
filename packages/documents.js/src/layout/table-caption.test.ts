import { describe, expect, it } from "vitest";
import type { LayoutItem } from "pdf-codec";
import { readTableCaptions } from "./table-caption";

function run(
  text: string,
  xPt: number,
  yPt: number,
  sizePt = 10,
  weight: "normal" | "bold" = "normal",
): LayoutItem {
  return {
    kind: "text",
    text,
    xPt,
    yPt,
    font: { family: "Helvetica", weight, style: "normal" },
    sizePt,
    color: { r: 0, g: 0, b: 0 },
    widthPt: text.length * sizePt * 0.5,
  };
}

function captionsOf(...items: LayoutItem[]): string[] {
  return readTableCaptions({ items }).map((caption) => caption.text);
}

/** `count` lines of an index set at one pitch in a column starting at `xPt`: the entry, with nothing but entries above and below it. */
function indexColumn(
  xPt: number,
  topYPt: number,
  entries: readonly string[],
): LayoutItem[] {
  return entries.map((entry, index) => run(entry, xPt, topYPt - index * 10, 9));
}

describe("readTableCaptions", () => {
  it("reads a numbered table's caption as the whole line it is set on, however its runs were split", () => {
    expect(
      captionsOf(
        run("Current-carrying capacity (amperes)", 120, 700),
        run("TABLE 4H2A", 54, 700),
        run("62", 54, 650),
      ),
    ).toEqual(["TABLE 4H2A Current-carrying capacity (amperes)"]);
  });

  it("reads each caption on a page in reading order", () => {
    expect(
      captionsOf(
        run("Table 41.1 Maximum disconnection times", 54, 400),
        run("Table 41.2 Maximum earth fault loop impedance", 54, 700),
      ),
    ).toEqual([
      "Table 41.2 Maximum earth fault loop impedance",
      "Table 41.1 Maximum disconnection times",
    ]);
  });

  it.each([
    "Table 4",
    "TABLE 4H2A",
    "Table 4D2B - Voltage drop",
    "Table 4D2B – Voltage drop",
    "Table A.1: Colours",
    "Table B-3 (amperes)",
    "Table 54.7 Minimum cross-sectional area",
  ])("reads %s as a caption", (line) => {
    expect(captionsOf(run(line, 54, 700))).toEqual([line]);
  });

  it.each([
    "Table 4H2A gives the current-carrying capacity of aluminium conductors",
    "The values in Table 4H2A apply",
    "Tables 4D1A and 4D1B",
    "Table of contents",
    "Table 4H2A (continued)",
    "TABLE 4H2A Current-carrying capacity (continued)",
    "TABLE 4H2A (cont.)",
    "Table",
  ])("does not read %s as a caption", (line) => {
    expect(captionsOf(run(line, 54, 700))).toEqual([]);
  });

  it("truncates a caption past the length that still identifies a table, keeping its opening", () => {
    const [caption] = captionsOf(
      run(`Table 9 ${"Words ".repeat(100)}`, 54, 700),
    );

    expect(caption?.startsWith("Table 9 Words")).toBe(true);
    expect(caption?.endsWith("...")).toBe(true);
    expect(caption?.length).toBeLessThan(210);
  });

  it("reads nothing from a page without text", () => {
    expect(readTableCaptions({ items: [] })).toEqual([]);
  });
});

// novus-power/hive#4091: a caption is a standalone line carrying its whole title, and a mention of a table in an index or a contents list is not one.
describe("readTableCaptions, the whole caption", () => {
  it("reads a title that wraps onto the lines below as part of the caption, lines centred under it or not", () => {
    expect(
      captionsOf(
        run(
          "TABLE 4C4 - Rating factors for groups, to be applied to",
          90,
          780,
          10,
          "bold",
        ),
        run(
          "reference capacities for multicore cables in free air -",
          135,
          768.5,
          10,
          "bold",
        ),
        run("Reference Method E in Tables 4D2A to 4J4A", 196, 757, 10, "bold"),
        run("Installation Method", 94, 735, 10, "bold"),
      ),
    ).toEqual([
      "TABLE 4C4 - Rating factors for groups, to be applied to reference capacities for multicore cables in free air - Reference Method E in Tables 4D2A to 4J4A",
    ]);
  });

  it("reads a caption whose number stands on a line of its own above its title", () => {
    expect(
      captionsOf(
        run("TABLE 41.2 -", 269, 710, 10, "bold"),
        run(
          "Maximum earth fault loop impedance for fuses, for a disconnection time of 0.4 s",
          72,
          698.5,
          10,
          "bold",
        ),
        run("(see Regulation 411.4.201)", 238, 687, 10, "bold"),
        run("Rating", 84, 640, 9, "bold"),
      ),
    ).toEqual([
      "TABLE 41.2 - Maximum earth fault loop impedance for fuses, for a disconnection time of 0.4 s (see Regulation 411.4.201)",
    ]);
  });

  it("stops the title at a line set further below than a line's leading, a table's header row, however it is styled", () => {
    expect(
      captionsOf(
        run("TABLE 4D1B - Voltage drop", 54, 700, 10, "bold"),
        run("Conductor", 54, 678, 10, "bold"),
      ),
    ).toEqual(["TABLE 4D1B - Voltage drop"]);
  });

  it("stops the title at a line in another style, a row of the table set in the page's body text", () => {
    expect(
      captionsOf(
        run("TABLE 4D1B - Voltage drop", 54, 700, 10, "bold"),
        run("Ambient temperature: 30", 54, 688.5, 10),
      ),
    ).toEqual(["TABLE 4D1B - Voltage drop"]);
  });

  it("stops the title at a line that is not under it, a bold figure elsewhere on the page", () => {
    expect(
      captionsOf(
        run("TABLE 4D1B - Voltage drop", 54, 700, 10, "bold"),
        run("30", 500, 688.5, 10, "bold"),
      ),
    ).toEqual(["TABLE 4D1B - Voltage drop"]);
  });

  it("stops the title at the line opening the next caption", () => {
    expect(
      captionsOf(
        run("TABLE 4C2 - Rating factors", 54, 700, 10, "bold"),
        run("TABLE 4C3 - Other factors", 54, 688.5, 10, "bold"),
      ),
    ).toEqual(["TABLE 4C2 - Rating factors"]);
  });

  it("leaves out text set larger than the caption on its baseline, a running tab the page sets beside it", () => {
    expect(
      captionsOf(
        run("TABLE 4F3A - Flexible cables,", 353, 533, 10, "bold"),
        run("CONDUCTORS", 608, 531, 24, "bold"),
        run("non-armoured", 390, 521.5, 10, "bold"),
      ),
    ).toEqual(["TABLE 4F3A - Flexible cables, non-armoured"]);
  });

  it("reads a caption beside a page number set in another style at the page's edge", () => {
    expect(
      captionsOf(
        run("476", 22, 552, 9),
        run("TABLE 4E2A - Multicore cables", 88, 552.5, 10, "bold"),
      ),
    ).toEqual(["TABLE 4E2A - Multicore cables"]);
  });

  it("gives where the caption's first line sits", () => {
    expect(
      readTableCaptions({
        items: [run("TABLE 4C2 - Rating factors", 54, 700, 10, "bold")],
      }),
    ).toEqual([{ text: "TABLE 4C2 - Rating factors", yPt: 700 }]);
  });
});

describe("readTableCaptions, a mention of a table is not a caption", () => {
  it("does not read a table cited in an index column, whatever follows its number", () => {
    const items = [
      ...indexColumn(212, 600, ["522.6.202,", "Table 7", "Sec 553", "Part 2"]),
      ...indexColumn(450, 600, ["705.422", "Table 55.2 (No 35)", "705.1"]),
    ];

    expect(captionsOf(...items)).toEqual([]);
  });

  it("does not join an index entry's table to the entry beside it into a caption", () => {
    // Two columns of an index whose baselines differ by less than a line: `Table 41.1` and `Barriers -` read as one line.
    const items = [
      ...indexColumn(212, 400, ["411.3.2.3", "411.3.2.2", "Table 41.1"]),
      run("Barriers -", 309, 382.5, 9),
    ];

    expect(captionsOf(...items)).toEqual([]);
  });

  it("does not read a table cited as one cell of a row, with a run of its own style to its left", () => {
    expect(
      captionsOf(
        run("Aerial cables", 308, 700, 9),
        run("Table 4A2 (No 35)", 449, 700, 9),
      ),
    ).toEqual([]);
  });

  it("does not read a contents line ending in the page it is on, however the page number is set", () => {
    expect(
      captionsOf(
        run(
          "TABLE 4C1 - Rating factors for one circuit                   471",
          54,
          700,
        ),
      ),
    ).toEqual([]);
    expect(
      captionsOf(
        run("TABLE 4C1 - Rating factors for one circuit", 54, 700),
        run("471", 520, 700),
      ),
    ).toEqual([]);
    expect(
      captionsOf(run("Table 4.2 - Cable sizes ........ 33", 54, 700)),
    ).toEqual([]);
  });

  it("does not read a title with a number in it as a page", () => {
    expect(
      captionsOf(run("TABLE 4B1 - Rating factors for 30 C", 54, 700)),
    ).toEqual(["TABLE 4B1 - Rating factors for 30 C"]);
  });

  it("does not read a line of a list of tables, each set at one pitch under the one before", () => {
    expect(
      captionsOf(
        run("List of tables", 54, 720, 11, "bold"),
        run("Table 1.1 - Cable sizes", 54, 708),
        run("Table 1.2 - Voltage drops", 54, 696),
        run("Table 1.3 - Ratings", 54, 684),
      ),
    ).toEqual([]);
  });

  it("reads a caption set apart from the text above it by more than a line's leading", () => {
    expect(
      captionsOf(
        run("prose of the page ends here", 54, 740),
        run("Table 4H2A Current-carrying capacity", 54, 712),
      ),
    ).toEqual(["Table 4H2A Current-carrying capacity"]);
  });

  it("does not read a line directly under a line of text as a caption, where text above overlaps it", () => {
    expect(
      captionsOf(
        run("prose of the page ends here", 54, 740),
        run("Table 4H2A Current-carrying capacity", 54, 728),
      ),
    ).toEqual([]);
  });

  it("reads a caption with a larger running tab set just above it, since a list's lines are all one size", () => {
    expect(
      captionsOf(
        run("CONDUCTORS", 200, 531, 24, "bold"),
        run("TABLE 4H2A - Multicore cables, non-armoured", 54, 517, 10, "bold"),
      ),
    ).toEqual(["TABLE 4H2A - Multicore cables, non-armoured"]);
  });

  it("reads a caption with text above it that does not overlap it", () => {
    expect(
      captionsOf(
        run("margin note", 450, 722, 8),
        run("Table 4H2A Current-carrying capacity", 54, 712),
      ),
    ).toEqual(["Table 4H2A Current-carrying capacity"]);
  });
});
