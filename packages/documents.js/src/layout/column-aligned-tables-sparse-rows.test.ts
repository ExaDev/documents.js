import { describe, expect, it } from "vitest";
import { detectColumnAlignedTables } from "./column-aligned-tables";
import { cellsOf, page } from "./column-aligned-tables-fixtures";

describe("detectColumnAlignedTables on a sparse table (novus-power/hive#2494)", () => {
  /** The column starts of a nine-column test-report table: number, parameter, unit, then six test columns. */
  const reportColumns = [40, 70, 250, 290, 340, 390, 440, 490, 540];

  /** Positions one test-report row, `cells` holding each populated column's index and text. */
  const reportRow = (
    index: number,
    cells: [column: number, text: string][],
  ): { text: string; xPt: number; yPt: number }[] =>
    cells.flatMap(([column, text]) => {
      const xPt = reportColumns[column];
      return xPt === undefined ? [] : [{ text, xPt, yPt: 700 - index * 14 }];
    });

  /** A header and two rows filling every column, too few on their own to be a table, so whether the page is recovered rests on what else it holds. */
  const reportHead = [
    reportRow(0, [
      [0, "No."],
      [1, "Parameter"],
      [2, "Unit"],
      [3, "Test 1"],
      [4, "Test 2"],
      [5, "Test 3"],
      [6, "Test 4"],
      [7, "Test 5"],
      [8, "Test 6"],
    ]),
    reportRow(1, [
      [0, "49"],
      [1, "Residual voltage"],
      [2, "%"],
      [3, "5"],
      [4, "25"],
      [5, "50"],
      [6, "75"],
      [7, "90"],
      [8, "95"],
    ]),
    reportRow(2, [
      [0, "50"],
      [1, "Dip duration"],
      [2, "ms"],
      [3, "150"],
      [4, "500"],
      [5, "750"],
      [6, "1200"],
      [7, "1500"],
      [8, "2000"],
    ]),
  ].flat();

  /** The measured rows of a sparse test report: each reports one test's phase pair and `notApplicable` for the next, leaving the rest of the row blank, so it fills five of nine columns. */
  const sparseReportRows = (notApplicable: string) =>
    (
      [
        [
          "51",
          "Short-circuit currents, phase1 t1 to t1+20ms",
          3,
          "334.85  363.42",
        ],
        [
          "52",
          "Highest instantaneous phase2 t1 to t1+20ms",
          3,
          "284.44  311.92",
        ],
        [
          "53",
          "Short-circuit currents, phase1 t1 to t1+20ms",
          5,
          "301.17  330.05",
        ],
        [
          "54",
          "Highest instantaneous phase2 t1 to t1+20ms",
          5,
          "262.08  290.61",
        ],
        [
          "55",
          "Short-circuit currents, phase1 t1 to t1+20ms",
          7,
          "288.40  317.26",
        ],
        [
          "56",
          "Highest instantaneous phase2 t1 to t1+20ms",
          7,
          "251.93  279.14",
        ],
      ] as const
    ).flatMap(([number, parameter, column, figures], index) =>
      reportRow(3 + index, [
        [0, number],
        [1, parameter],
        [2, "A"],
        [column, figures],
        [column + 1, notApplicable],
      ]),
    );

  it.each(["N/A", "n/a", "NA", "-", "\u2013", "\u2014"])(
    "recovers a sparse test-report table whose rows each state a measurement in one test column and %s beside it",
    (notApplicable) => {
      // Shaped like the Sungrow SG350HX certificate's page 44 (novus-power/hive#2494): the header and two full rows are too few to be a table on their own, and every other row fills five of nine columns, under MIN_ROW_COLUMN_SHARE, although it is plainly data.
      const tables = detectColumnAlignedTables(
        page([...reportHead, ...sparseReportRows(notApplicable)]),
        new Set(),
      );

      const rows = cellsOf(tables.get(0)?.[0]);
      expect(rows).toHaveLength(9);
      expect(rows).toContainEqual([
        "51",
        "Short-circuit currents, phase1 t1 to t1+20ms",
        "A",
        "334.85  363.42",
        notApplicable,
        "",
        "",
        "",
        "",
      ]);
    },
  );

  it("still drops a sparse row stating one figure and nothing else, which is what a running footer's folio or a chart's axis labels also are", () => {
    // Both measured on the reference manuals: a specification's footer (`Amendment - February 2016` with its folio) and a battery guide's discharge-curve axis, each landing under a real table's measurement column.
    const tables = detectColumnAlignedTables(
      page([
        ...reportHead,
        ...reportRow(3, [
          [0, "51"],
          [1, "Short-circuit currents, phase1 t1 to t1+20ms"],
          [2, "A"],
          [3, "334.85  363.42"],
          [4, "350.12  371.08"],
          [5, "301.17  330.05"],
          [6, "N/A"],
          [7, "288.40  317.26"],
          [8, "N/A"],
        ]),
        ...reportRow(10, [
          [1, "Amendment - February 2016"],
          [3, "16"],
        ]),
        ...reportRow(11, [
          [3, "0.010.11 10 50"],
          [8, "Figure A-2"],
        ]),
        // The row number in the first column is the row's label, not one of its values, so this is still one figure.
        ...reportRow(12, [
          [0, "57"],
          [1, "Short-circuit currents, phase3 t1 to t1+20ms"],
          [5, "296.54  325.87"],
        ]),
      ]),
      new Set(),
    );

    const rows = cellsOf(tables.get(0)?.[0]);
    expect(rows).toHaveLength(4);
    expect(rows.flat()).not.toContain("Amendment - February 2016");
    expect(rows.flat()).not.toContain("0.010.11 10 50");
    expect(rows.flat()).not.toContain("57");
  });

  it("still drops a sparse row stating only not-applicable markers, since it states no measurement", () => {
    const tables = detectColumnAlignedTables(
      page([
        ...reportHead,
        ...reportRow(3, [
          [0, "51"],
          [1, "Short-circuit currents, phase1 t1 to t1+20ms"],
          [2, "A"],
          [3, "334.85  363.42"],
          [4, "350.12  371.08"],
          [5, "301.17  330.05"],
          [6, "N/A"],
          [7, "288.40  317.26"],
          [8, "N/A"],
        ]),
        ...reportRow(10, [
          [0, "58"],
          [1, "Reactive current, phase1"],
          [2, "A"],
          [3, "N/A"],
          [4, "N/A"],
        ]),
      ]),
      new Set(),
    );

    const rows = cellsOf(tables.get(0)?.[0]);
    expect(rows).toHaveLength(4);
    expect(rows.flat()).not.toContain("Reactive current, phase1");
  });

  it("still drops a sparse row whose figures sit only under a column of words, which is not a measurement column", () => {
    const tables = detectColumnAlignedTables(
      page([
        ...reportHead,
        ...reportRow(3, [
          [0, "51"],
          [1, "Short-circuit currents, phase1 t1 to t1+20ms"],
          [2, "A"],
          [3, "334.85  363.42"],
          [4, "350.12  371.08"],
          [5, "301.17  330.05"],
          [6, "N/A"],
          [7, "288.40  317.26"],
          [8, "N/A"],
        ]),
        // The unit column states words (`%`, `ms`, `A`), so a figure landing in it proves nothing about the row.
        ...reportRow(10, [
          [0, "59"],
          [1, "Recovery time"],
          [2, "20"],
          [6, "N/A"],
        ]),
      ]),
      new Set(),
    );

    const rows = cellsOf(tables.get(0)?.[0]);
    expect(rows).toHaveLength(4);
    expect(rows.flat()).not.toContain("Recovery time");
  });

  it("judges whether a table states measurements by the rows it keeps, not by rows the fill bar dropped", () => {
    // A block of words in four columns, with a stray figure beside four other labels: those rows fill half the columns and state one figure each, so they are dropped, and their figures must not make the words' column read as measurements.
    const words = [
      ["Enclosure", "Steel", "Painted", "Grey"],
      ["Door", "Hinged", "Lockable", "Left"],
      ["Gland plate", "Removable", "Undrilled", "Base"],
      ["Mounting", "Floor", "Bolted", "Plinth"],
    ];
    const tables = detectColumnAlignedTables(
      page([
        ...words.flatMap((cells, index) =>
          reportRow(
            index,
            cells.map((text, column): [number, string] => [column * 2, text]),
          ),
        ),
        ...["Rev", "Sheet", "Drawing", "Issue"].flatMap((label, index) =>
          reportRow(10 + index, [
            [0, label],
            [2, String(index + 1)],
          ]),
        ),
      ]),
      new Set(),
    );

    expect(tables.size).toBe(0);
  });

  it("still drops a callout legend filling a third of a wide table's columns, since none of its cells states a measurement", () => {
    const tables = detectColumnAlignedTables(
      page([
        ...reportHead,
        ...reportRow(3, [
          [0, "51"],
          [1, "Short-circuit currents, phase1 t1 to t1+20ms"],
          [2, "A"],
          [3, "334.85  363.42"],
          [4, "350.12  371.08"],
          [5, "301.17  330.05"],
          [6, "N/A"],
          [7, "288.40  317.26"],
          [8, "N/A"],
        ]),
        // A wiring diagram's callout legend: three labels to a line against a nine-column table, a third of its columns and inside the 25-40% band MIN_ROW_COLUMN_SHARE describes, and not one figure among them.
        ...reportRow(10, [
          [1, "4. Bonded semi-conducting screen"],
          [4, "Power Distribution (PD)"],
          [7, "1. Solid aluminium conductor"],
        ]),
        ...reportRow(11, [
          [1, "7. MDPE sheath (RED)"],
          [4, "5. Copper wire screen"],
          [7, "8. Water blocking tape"],
        ]),
        ...reportRow(12, [
          [1, "2. Conductor screen"],
          [3, "6. Swellable tape"],
          [6, "9. Overall sheath"],
        ]),
        ...reportRow(13, [
          [1, "3. XLPE insulation"],
          [5, "IEC 60502-2"],
          [8, "10. Anti-termite jacket"],
        ]),
      ]),
      new Set(),
    );

    const rows = cellsOf(tables.get(0)?.[0]);
    expect(rows).toHaveLength(4);
    expect(rows.flat()).not.toContain("4. Bonded semi-conducting screen");
    expect(rows.flat()).not.toContain("3. XLPE insulation");
  });
});
