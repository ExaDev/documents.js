import { describe, expect, it } from "vitest";
import { detectColumnAlignedTables } from "./column-aligned-tables";
import { cellsOf, page } from "./column-aligned-tables-fixtures";

/** Rows of a three-column datasheet-shaped table: a label at x54, then one figure per product at x291/x387/x486 -- the real column geometry of Prysmian's 11kV-SACXB-58-115AWS-PE datasheet. */
function datasheetRows(
  rows: [label: string, a: string, b: string, c: string][],
): { text: string; xPt: number; yPt: number }[] {
  return rows.flatMap(([label, a, b, c], index) => {
    const yPt = 700 - index * 14;
    return [
      { text: label, xPt: 54, yPt },
      { text: a, xPt: 291, yPt },
      { text: b, xPt: 387, yPt },
      { text: c, xPt: 486, yPt },
    ];
  });
}

describe("detectColumnAlignedTables", () => {
  it("recovers a table from text aligned in columns with no gridlines drawn at all", () => {
    const tables = detectColumnAlignedTables(
      page(
        datasheetRows([
          ["UKPN Product Code", "20297551", "20364357", "20353674"],
          ["Conductor diameter mm", "10.8", "14.7", "18.8"],
          ["Overall diameter mm", "30.5", "34.5", "39.0"],
          ["Bending radius mm", "650", "700", "800"],
        ]),
      ),
      new Set(),
    );

    const table = tables.get(0)?.[0];
    expect(table?.table.kind).toBe("table");
    // Each figure lands in its own product's column, which is the entire point: flattened to prose, "10.8 14.7 18.8" cannot be attributed at all.
    expect(cellsOf(table)).toEqual([
      ["UKPN Product Code", "20297551", "20364357", "20353674"],
      ["Conductor diameter mm", "10.8", "14.7", "18.8"],
      ["Overall diameter mm", "30.5", "34.5", "39.0"],
      ["Bending radius mm", "650", "700", "800"],
    ]);
  });

  it("leaves a page the gridline path already claimed entirely alone, so a drawn lattice always wins", () => {
    const tables = detectColumnAlignedTables(
      page(
        datasheetRows([
          ["Code", "1", "2", "3"],
          ["Diameter", "10.8", "14.7", "18.8"],
          ["Mass", "2.5", "3.8", "5.0"],
          ["Radius", "650", "700", "800"],
        ]),
      ),
      new Set([0]),
    );

    expect(tables.size).toBe(0);
  });

  it("declines a page of ordinary left-aligned prose, which is one column and never a table", () => {
    const tables = detectColumnAlignedTables(
      page([
        { text: "This standard specifies requirements.", xPt: 54, yPt: 700 },
        { text: "It applies to distribution cables.", xPt: 54, yPt: 686 },
        { text: "Compliance is assessed per clause 4.", xPt: 54, yPt: 672 },
        { text: "See also the referenced documents.", xPt: 54, yPt: 658 },
        { text: "Nothing here is tabular.", xPt: 54, yPt: 644 },
      ]),
      new Set(),
    );

    expect(tables.size).toBe(0);
  });

  it("declines two aligned lines, which prove nothing -- a heading above a caption aligns", () => {
    const tables = detectColumnAlignedTables(
      page(
        datasheetRows([
          ["Code", "1", "2", "3"],
          ["Diameter", "10.8", "14.7", "18.8"],
        ]),
      ),
      new Set(),
    );

    expect(tables.size).toBe(0);
  });

  it("drops a diagram's callout legend, whose labels sit two-to-a-row against a wide table, rather than emitting mostly-empty rows a reader would mine properties out of", () => {
    const tables = detectColumnAlignedTables(
      page([
        ...datasheetRows([
          ["UKPN Product Code", "20297551", "20364357", "20353674"],
          ["Conductor diameter mm", "10.8", "14.7", "18.8"],
          ["Overall diameter mm", "30.5", "34.5", "39.0"],
          ["Bending radius mm", "650", "700", "800"],
        ]),
        // The wiring diagram's own numbered callouts: positioned text like everything else, but only ever two items to a row against a four-column table.
        { text: "4. Bonded semi-conducting screen", xPt: 54, yPt: 600 },
        { text: "Power Distribution (PD)", xPt: 486, yPt: 600 },
        { text: "7. MDPE sheath (RED)", xPt: 54, yPt: 586 },
        { text: "Solid aluminium conductor", xPt: 486, yPt: 586 },
      ]),
      new Set(),
    );

    const rows = cellsOf(tables.get(0)?.[0]);
    expect(rows).toHaveLength(4);
    expect(rows.flat()).not.toContain("4. Bonded semi-conducting screen");
  });

  it("gives every row the same cell count, filling a column a row has no text in with an empty string, so a consumer can index columns positionally", () => {
    const tables = detectColumnAlignedTables(
      page([
        ...datasheetRows([
          ["Code", "20297551", "20364357", "20353674"],
          ["Diameter", "10.8", "14.7", "18.8"],
          ["Mass", "2.5", "3.8", "5.0"],
        ]),
        // A row whose second product column is genuinely blank, but which still fills three of four.
        { text: "Screen area", xPt: 54, yPt: 658 },
        { text: "58", xPt: 291, yPt: 658 },
        { text: "115", xPt: 486, yPt: 658 },
      ]),
      new Set(),
    );

    const rows = cellsOf(tables.get(0)?.[0]);
    expect(rows.every((row) => row.length === 4)).toBe(true);
    expect(rows).toContainEqual(["Screen area", "58", "", "115"]);
  });

  it("reads rows down the page in reading order, not up from the bottom as PDF user space stores them", () => {
    const tables = detectColumnAlignedTables(
      page(
        datasheetRows([
          ["first", "1", "2", "3"],
          ["second", "1", "2", "3"],
          ["third", "1", "2", "3"],
          ["fourth", "1", "2", "3"],
        ]),
      ),
      new Set(),
    );

    expect(cellsOf(tables.get(0)?.[0]).map((row) => row[0])).toEqual([
      "first",
      "second",
      "third",
      "fourth",
    ]);
  });

  it("treats a few tenths of a point of baseline jitter across one visual row as the same row", () => {
    const tables = detectColumnAlignedTables(
      page([
        ...datasheetRows([
          ["Code", "1", "2", "3"],
          ["Diameter", "10.8", "14.7", "18.8"],
          ["Mass", "2.5", "3.8", "5.0"],
        ]),
        { text: "Resistance", xPt: 54, yPt: 658 },
        { text: "0.320", xPt: 291, yPt: 658.4 },
        { text: "0.164", xPt: 387, yPt: 657.6 },
        { text: "0.100", xPt: 486, yPt: 658.2 },
      ]),
      new Set(),
    );

    expect(cellsOf(tables.get(0)?.[0])).toContainEqual([
      "Resistance",
      "0.320",
      "0.164",
      "0.100",
    ]);
  });

  it("returns nothing for a document with no pages", () => {
    const tables = detectColumnAlignedTables(
      { formatVersion: 1, metadata: {}, pages: [], images: {} },
      new Set(),
    );

    expect(tables.size).toBe(0);
  });
  it("refuses a decoratively-set title whose every glyph is separately positioned", () => {
    // Verbatim shape from a real installation guide, which this emitted as a 143-"product" table
    // before the glyph rule: the word "installation" set letter by letter, each its own text item.
    const glyphs = "installation".split("");
    const items = [0, 1, 2, 3, 4].flatMap((rowIndex) =>
      glyphs.map((ch, column) => ({
        text: ch,
        xPt: 54 + column * 20,
        yPt: 700 - rowIndex * 14,
      })),
    );

    expect(detectColumnAlignedTables(page(items), new Set()).size).toBe(0);
  });

  it("refuses a two-column prose layout, which recurs at the same x on every line without being a table", () => {
    // A real cable datasheet's marketing block, emitted as a 22-"product" table before this.
    const rows: [string, string][] = [
      ["APPLICATION", "CABLE THIRD-PARTY ACCREDITATIONS"],
      [
        "Multi-core PVC cable with steel wire armour",
        "We supply BASEC approved products",
      ],
      [
        "and auxiliary fixed wiring cables for use",
        "Cables are tested and certified by BASEC",
      ],
      [
        "underground, outdoor and indoor applications",
        "The British Approvals Service for Cables",
      ],
      ["Temperature Rating", "AN ISO/IEC 17025 ACCREDITED FACILITY"],
    ];

    expect(
      detectColumnAlignedTables(
        page(
          rows.flatMap(([left, right], index) => [
            { text: left, xPt: 54, yPt: 700 - index * 14 },
            { text: right, xPt: 300, yPt: 700 - index * 14 },
          ]),
        ),
        new Set(),
      ).size,
    ).toBe(0);
  });

  it("refuses a contents page, whose numbering aligns but states no measurement", () => {
    // `3.1 | Product Overview` -- a brochure's contents, emitted as a 91-"product" table before this.
    const entries: [string, string][] = [
      ["3.1", "Product Overview"],
      ["3.2", "Technical Information"],
      ["3.3", "How to Select and Specify"],
      ["3.4", "Installation Guidance"],
      ["3.5", "Maintenance"],
    ];

    expect(
      detectColumnAlignedTables(
        page(
          entries.flatMap(([n, title], index) => [
            { text: n, xPt: 54, yPt: 700 - index * 14 },
            { text: title, xPt: 120, yPt: 700 - index * 14 },
          ]),
        ),
        new Set(),
      ).size,
    ).toBe(0);
  });

  // novus-power/hive#2566: the y-axis ticks of two charts set side by side share baselines, so their labels align into a two-column table of figures.
  describe("side-by-side charts", () => {
    const TICKS = ["2.00", "1.50", "1.00", "0.50", "0.00", "-0.50", "-1.00"];

    /** One label at each chart's y axis per tick, the two charts at x124 and x301, on the same baselines. */
    function chartTicks(
      right: readonly string[],
    ): { text: string; xPt: number; yPt: number }[] {
      return TICKS.flatMap((tick, index) => [
        { text: tick, xPt: 124, yPt: 270 - index * 14 },
        { text: right[index] ?? "", xPt: 301, yPt: 270 - index * 14 },
      ]);
    }

    it("refuses two axes carrying the same ticks, which state no figure beyond their own row label", () => {
      expect(
        detectColumnAlignedTables(page(chartTicks(TICKS)), new Set()).size,
      ).toBe(0);
    });

    it("refuses them with a caption line and an x-axis label row among the ticks", () => {
      const items = [
        { text: "3rd harmonic phase angle altered", xPt: 124, yPt: 300 },
        { text: "Degrees", xPt: 301, yPt: 300 },
        ...chartTicks(TICKS),
        { text: "0 45 90 135 180", xPt: 124, yPt: 40 },
        { text: "0 45 90 135 180", xPt: 301, yPt: 40 },
      ];

      expect(detectColumnAlignedTables(page(items), new Set()).size).toBe(0);
    });

    it("still recovers a table whose figures differ from its row label column", () => {
      const tables = detectColumnAlignedTables(
        page(chartTicks(["20", "27", "36", "46", "63", "85", "112"])),
        new Set(),
      );

      expect(cellsOf(tables.get(0)?.[0])[0]).toEqual(["2.00", "20"]);
      expect(tables.get(0)?.[0]?.table.rows).toHaveLength(TICKS.length);
    });

    it("still recovers a table where one value column repeats the label column and another does not", () => {
      const items = TICKS.flatMap((tick, index) => [
        { text: tick, xPt: 54, yPt: 700 - index * 14 },
        { text: tick, xPt: 200, yPt: 700 - index * 14 },
        { text: String(index * 7 + 3), xPt: 350, yPt: 700 - index * 14 },
      ]);

      const table = detectColumnAlignedTables(page(items), new Set()).get(
        0,
      )?.[0];

      expect(cellsOf(table)[0]).toEqual(["2.00", "2.00", "3"]);
    });
  });

  it("keeps one value column together when its own cells drift left down the column, rather than splitting it and merging the figures it drops into the neighbour", () => {
    // The SPEL Puraceptor brochure's own range table, at its real geometry: the value columns are
    // centred, so each cell's first glyph sits further left as the figures get wider -- silt runs
    // from x253 down to x247. Anchored at the header's own x255, a first-match bucket takes the
    // wider figures no further than x249 and splits the rest off into a bucket of their own, which
    // is then too small to survive the vote -- and `20,000` lands back in the oil column beside
    // `2,000` as the single cell `2,000 20,000`, losing one of the two outright (novus-power/hive#918).
    const rows: [
      label: string,
      oil: [string, number],
      silt: [string, number],
    ][] = [
      ["Model", ["Oil", 220], ["Silt", 255]],
      ["P004 1C/SC", ["40", 223], ["400", 253]],
      ["P100 1C/SC", ["1,000", 221], ["10,000", 252]],
      ["P015 1C/SC", ["150", 221], ["1,500", 251]],
      ["P200 1C/SC", ["2,000", 218], ["20,000", 248]],
      ["P300 1C/SC", ["3,000", 218], ["30,000", 247]],
    ];

    const tables = detectColumnAlignedTables(
      page(
        rows.flatMap(([label, [oil, oilX], [silt, siltX]], index) => {
          const yPt = 700 - index * 14;
          return [
            { text: label, xPt: 54, yPt },
            { text: oil, xPt: oilX, yPt },
            { text: silt, xPt: siltX, yPt },
          ];
        }),
      ),
      new Set(),
    );

    expect(cellsOf(tables.get(0)?.[0])).toEqual([
      ["Model", "Oil", "Silt"],
      ["P004 1C/SC", "40", "400"],
      ["P100 1C/SC", "1,000", "10,000"],
      ["P015 1C/SC", "150", "1,500"],
      ["P200 1C/SC", "2,000", "20,000"],
      ["P300 1C/SC", "3,000", "30,000"],
    ]);
  });

  it("still discards an x only one row uses, so a stray annotation never becomes a column every other row is empty in", () => {
    const tables = detectColumnAlignedTables(
      page([
        ...datasheetRows([
          ["UKPN Product Code", "20297551", "20364357", "20353674"],
          ["Conductor diameter mm", "10.8", "14.7", "18.8"],
          ["Overall diameter mm", "30.5", "34.5", "39.0"],
          ["Bending radius mm", "650", "700", "800"],
        ]),
        // One row's own footnote marker, at an x nothing else on the page shares.
        { text: "*", xPt: 200, yPt: 672 },
      ]),
      new Set(),
    );

    const rows = cellsOf(tables.get(0)?.[0]);
    // Four columns still, with the marker folded into the cell left of it rather than opening a fifth every other row would be empty in.
    expect(rows.every((row) => row.length === 4)).toBe(true);
    expect(rows).toContainEqual([
      "Overall diameter mm *",
      "30.5",
      "34.5",
      "39.0",
    ]);
  });

  it("recovers a specification table whose value columns state ranges and pairs rather than bare numbers", () => {
    // The Clivet Cristallo HVAC manual's own general-specifications table, whose value columns are
    // full of the compound forms a real datasheet states: a supply range, a pair of capacities, a
    // pair of currents, three fan speeds. Scored against bare numbers alone this column reads as a
    // third numeric and the whole 51-row table is discarded (novus-power/hive#918).
    const rows: [label: string, unit: string, a: string, b: string][] = [
      ["Power supply", "V- Ph-Hz", "220~240-1-50", "220~240-1-50"],
      ["Max. input consumption", "W", "2150", "2150"],
      ["Max. current", "A", "10", "10"],
      ["Capacity", "W", "2035/3255", "2035/3255"],
      ["Rated current(RLA)", "A", "2.40/5.65", "2.40/5.65"],
      ["Speed(Hi/Mi/Lo)", "r/min", "1150/850/700", "1100/900/750"],
      ["Tube pitch(a)x row pitch(b)", "mm", "21x13.37", "21x13.37"],
    ];

    const tables = detectColumnAlignedTables(
      page(
        rows.flatMap(([label, unit, a, b], index) => {
          const yPt = 700 - index * 14;
          return [
            { text: label, xPt: 171, yPt },
            { text: unit, xPt: 300, yPt },
            { text: a, xPt: 368, yPt },
            { text: b, xPt: 474, yPt },
          ];
        }),
      ),
      new Set(),
    );

    expect(cellsOf(tables.get(0)?.[0])).toContainEqual([
      "Speed(Hi/Mi/Lo)",
      "r/min",
      "1150/850/700",
      "1100/900/750",
    ]);
  });

  it("refuses a list of figures whose only value column is leader dots trailing a page number", () => {
    // The SEL RTAC manual's own list of figures, whose second column is a run of leader dots ending
    // in the folio. That cell holds a digit and not one letter, so a measurement test asking only
    // for those two things scores the column as measurements and emits the whole list as a table --
    // measured against the corpus, this readmitted many such pages (novus-power/hive#918).
    const entries: [string, string][] = [
      ["Figure B.36 ABS Example in CFC, LD", ". . . . . . . . . . . . . . 667"],
      ["Figure B.37 ADD Example in CFC, LD", ". . . . . . . . . . . . 670"],
      [
        "Figure B.38 AND Example in CFC, LD",
        ". . . . . . . . . . . . . . . 673",
      ],
      ["Figure B.39 BSR Example in CFC, LD", ". . . . . . . . . . . 674"],
      ["Figure B.40 CTD Example in CFC, LD", ". . . . . . . . . . . . . 678"],
    ];

    expect(
      detectColumnAlignedTables(
        page(
          entries.flatMap(([title, leader], index) => {
            const yPt = 700 - index * 14;
            return [
              { text: title, xPt: 54, yPt },
              { text: leader, xPt: 300, yPt },
            ];
          }),
        ),
        new Set(),
      ).size,
    ).toBe(0);
  });

  it("refuses a contents page whose folios are set in their own column, joined to each entry by leaders", () => {
    // The shape of a meter installation guide's contents: the folio column is all figures, so it
    // passes as a measurement column, and only the leaders say this is a contents page.
    const entries: [string, string, string][] = [
      ["1", "Important safety information .........", "4"],
      ["2", "Disclaimer ...........................", "4"],
      ["3", "Meter overview .......................", "5"],
      ["4", "Installation .........................", "9"],
      ["5", "Commissioning ........................", "15"],
    ];

    expect(
      detectColumnAlignedTables(
        page(
          entries.flatMap(([number, title, folio], index) => {
            const yPt = 700 - index * 14;
            return [
              { text: number, xPt: 54, yPt },
              { text: title, xPt: 80, yPt },
              { text: folio, xPt: 500, yPt },
            ];
          }),
        ),
        new Set(),
      ).size,
    ).toBe(0);
  });

  it("keeps a specification table where only a minority of rows carry leader dots", () => {
    const tables = detectColumnAlignedTables(
      page(
        datasheetRows([
          ["Conductor size mm²", "95", "185", "300"],
          ["Overall diameter mm", "35.2", "41.8", "47.0"],
          ["Weight kg/km ......", "1450", "2150", "3120"],
          ["DC resistance Ω/km", "0.320", "0.164", "0.100"],
          ["Current rating A", "280", "400", "515"],
        ]),
      ),
      new Set(),
    );

    expect(tables.size).toBe(1);
  });

  it("recovers the same table whatever order the page's own items arrive in, since that order is the PDF writer's artefact and not the table's", () => {
    const items = [
      ...datasheetRows([
        ["UKPN Product Code", "20297551", "20364357", "20353674"],
        ["Conductor diameter mm", "10.8", "14.7", "18.8"],
        ["Overall diameter mm", "30.5", "34.5", "39.0"],
        ["Bending radius mm", "650", "700", "800"],
      ]),
    ];
    const asWritten = cellsOf(
      detectColumnAlignedTables(page(items), new Set()).get(0)?.[0],
    );
    const reversed = cellsOf(
      detectColumnAlignedTables(page([...items].reverse()), new Set()).get(
        0,
      )?.[0],
    );

    expect(reversed).toEqual(asWritten);
    expect(asWritten).toHaveLength(4);
  });

  it("still recovers a real specification table, whose value columns are numbers", () => {
    const tables = detectColumnAlignedTables(
      page(
        datasheetRows([
          ["UKPN Product Code", "20297551", "20364357", "20353674"],
          ["Conductor diameter mm", "10.8", "14.7", "18.8"],
          ["Overall diameter mm", "30.5", "34.5", "39.0"],
          ["Bending radius mm", "650", "700", "800"],
        ]),
      ),
      new Set(),
    );

    expect(tables.size).toBe(1);
  });

  it("recovers the smallest table it admits: a label column and one column of figures", () => {
    const tables = detectColumnAlignedTables(
      page(
        [
          ["Rated voltage kV", "11"],
          ["Rated current A", "630"],
          ["Short-time current kA", "20"],
          ["Frequency Hz", "50"],
        ].flatMap(([label, value], index) => {
          const yPt = 700 - index * 14;
          return [
            { text: label ?? "", xPt: 54, yPt },
            { text: value ?? "", xPt: 300, yPt },
          ];
        }),
      ),
      new Set(),
    );

    const table = tables.get(0)?.[0];
    expect(table).toBeDefined();
    if (table === undefined) return;
    expect(cellsOf(table)).toEqual([
      ["Rated voltage kV", "11"],
      ["Rated current A", "630"],
      ["Short-time current kA", "20"],
      ["Frequency Hz", "50"],
    ]);
  });

  it("refuses a block whose cells are mostly single letters, which is lettering and not a table", () => {
    // A third of every row's cells a lone letter: past MAX_GLYPH_CELL_SHARE even though the figures
    // beside them would pass as a measurement column.
    expect(
      detectColumnAlignedTables(
        page(
          ["A", "B", "C", "D"].flatMap((letter, index) => {
            const yPt = 700 - index * 14;
            return [
              { text: letter, xPt: 54, yPt },
              { text: String(10 + index), xPt: 200, yPt },
              { text: String(20 + index), xPt: 300, yPt },
            ];
          }),
        ),
        new Set(),
      ).size,
    ).toBe(0);
  });

  it("recovers a ratings table whose sizes state a not-applicable dash in most of their cells, since a dash is a value and not lettering", () => {
    // The smaller sizes have a rating in one column and a dash in the other three, so dashes are more than MAX_GLYPH_CELL_SHARE of the cells.
    const rows: [size: string, ...ratings: string[]][] = [
      ["1", "11", "-", "-", "-"],
      ["1.5", "14", "-", "-", "-"],
      ["2.5", "20", "-", "-", "-"],
      ["4", "26", "-", "-", "-"],
      ["6", "34", "-", "-", "-"],
      ["25", "80", "131", "114", "110"],
      ["35", "99", "162", "143", "137"],
    ];

    const tables = detectColumnAlignedTables(
      page(
        rows.flatMap((cells, index) => {
          const yPt = 700 - index * 14;
          return cells.map((text, column) => ({
            text,
            xPt: 54 + column * 100,
            yPt,
          }));
        }),
      ),
      new Set(),
    );

    expect(cellsOf(tables.get(0)?.[0])).toEqual(rows);
  });

  it("keeps a value that drifts left by exactly the column tolerance in its own column", () => {
    const tables = detectColumnAlignedTables(
      page(
        [
          ["Weight kg/km", "950", 297],
          ["Diameter mm", "31.5", 297],
          ["Radius mm", "650", 297],
          ["Price per metre", "12,500", 291],
        ].flatMap(([label, value, xPt], index) => {
          const yPt = 700 - index * 14;
          return [
            { text: String(label), xPt: 54, yPt },
            { text: String(value), xPt: Number(xPt), yPt },
          ];
        }),
      ),
      new Set(),
    );

    const table = tables.get(0)?.[0];
    expect(table).toBeDefined();
    if (table === undefined) return;
    expect(cellsOf(table).map((row) => row.length)).toEqual([2, 2, 2, 2]);
    expect(cellsOf(table)[3]).toEqual(["Price per metre", "12,500"]);
  });

  it("treats runs exactly the row tolerance apart vertically as one row", () => {
    const tables = detectColumnAlignedTables(
      page(
        datasheetRows([
          ["Conductor size mm²", "95", "185", "300"],
          ["Overall diameter mm", "35.2", "41.8", "47.0"],
          ["Weight kg/km", "1450", "2150", "3120"],
          ["DC resistance Ω/km", "0.320", "0.164", "0.100"],
        ]).map((item) =>
          item.xPt === 486 ? { ...item, yPt: item.yPt - 3 } : item,
        ),
      ),
      new Set(),
    );

    const table = tables.get(0)?.[0];
    expect(table).toBeDefined();
    if (table === undefined) return;
    expect(cellsOf(table)).toHaveLength(4);
    expect(cellsOf(table)[0]).toEqual([
      "Conductor size mm²",
      "95",
      "185",
      "300",
    ]);
  });
});
