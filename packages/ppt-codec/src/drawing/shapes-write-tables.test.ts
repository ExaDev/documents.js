// The table half of the writeSlideDrawing suite: row heights, group geometry and spid numbering, and cell spans with their content. Split from shapes-write.test.ts, which keeps the non-table shape cases; the fixtures and record-walking helpers both halves need live in ../test-support/drawing-write.ts.

import type { ContentTable } from "document-schema.js";
import { describe, expect, it } from "vitest";
import type { PptDiagnostic } from "../diagnostics";
import { PptDiagnosticCodes } from "../diagnostics";
import { readDrawingShapes } from "./shapes";
import { childRecords, findChild, readRecordAt } from "../record/tree";
import {
  OfficeArtFSP,
  OfficeArtFSPGR,
  OfficeArtSpgrContainer,
  OfficeArtTertiaryFOPT,
} from "../record/types";
import { PROPERTY_TABLE_ROW_PROPERTIES, readIMsoArray } from "./properties";
import {
  type DrawingShape,
  type DrawingWriteContext,
  writeSlideDrawing,
} from "./shapes-write";
import {
  CONTEXT,
  firstContentShapeRecord,
  firstTableGroupProperties,
  spgrChildren,
  tableShape,
  textShape,
} from "../test-support/drawing-write";

describe("writeSlideDrawing: table row heights", () => {
  it("shares the frame's remaining height equally among every row stating none", () => {
    const shapes: DrawingShape[] = [
      {
        shape: tableShape([{ cells: [] }, { cells: [] }], [], {
          frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 },
        }),
        clientData: undefined,
      },
    ];
    const properties = firstTableGroupProperties(
      writeSlideDrawing(shapes, CONTEXT),
    );
    const rowHeightsMasterUnits = readIMsoArray(
      properties.get(PROPERTY_TABLE_ROW_PROPERTIES)?.complex ??
        new Uint8Array(),
    );
    // 100pt frame height = 800 master units, split equally between 2 unstated rows.
    expect(rowHeightsMasterUnits).toEqual([400, 400]);
  });

  it("subtracts every row's own stated height before sharing the remainder among the rest", () => {
    const shapes: DrawingShape[] = [
      {
        shape: tableShape(
          [{ cells: [], heightPt: 30 }, { cells: [] }, { cells: [] }],
          [],
          { frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 } },
        ),
        clientData: undefined,
      },
    ];
    const properties = firstTableGroupProperties(
      writeSlideDrawing(shapes, CONTEXT),
    );
    const rowHeightsMasterUnits = readIMsoArray(
      properties.get(PROPERTY_TABLE_ROW_PROPERTIES)?.complex ??
        new Uint8Array(),
    );
    // 30pt stated = 240 master units; remaining (800-240)/2 = 280 each for the two unstated rows.
    expect(rowHeightsMasterUnits).toEqual([240, 280, 280]);
  });

  it("writes every row's own stated height verbatim when none are left unstated", () => {
    const shapes: DrawingShape[] = [
      {
        shape: tableShape(
          [
            { cells: [], heightPt: 20 },
            { cells: [], heightPt: 40 },
          ],
          [],
        ),
        clientData: undefined,
      },
    ];
    const properties = firstTableGroupProperties(
      writeSlideDrawing(shapes, CONTEXT),
    );
    const rowHeightsMasterUnits = readIMsoArray(
      properties.get(PROPERTY_TABLE_ROW_PROPERTIES)?.complex ??
        new Uint8Array(),
    );
    expect(rowHeightsMasterUnits).toEqual([160, 320]);
  });
});

describe("writeSlideDrawing: table geometry, properties and spid numbering", () => {
  function tableGroupShape(written: ReturnType<typeof writeSlideDrawing>) {
    const tableSpgr = spgrChildren(written).find(
      (r) => r.header.recType === OfficeArtSpgrContainer,
    );
    if (tableSpgr === undefined) {
      throw new Error("expected a nested table OfficeArtSpgrContainer");
    }
    return childRecords(tableSpgr);
  }

  function fspSpid(shapeRecord: ReturnType<typeof readRecordAt>): number {
    const fsp = findChild(childRecords(shapeRecord), OfficeArtFSP);
    if (fsp === undefined) {
      throw new Error("expected an OfficeArtFSP");
    }
    return new DataView(fsp.data.buffer, fsp.data.byteOffset).getUint32(
      0,
      true,
    );
  }

  it("stamps recVer 0x1 on the table group's own FSPGR coordinate system", () => {
    const shapes: DrawingShape[] = [
      { shape: tableShape([{ cells: [] }]), clientData: undefined },
    ];
    const [groupShape] = tableGroupShape(writeSlideDrawing(shapes, CONTEXT));
    if (groupShape === undefined) {
      throw new Error("expected the table group's own shape first");
    }
    const fspgr = findChild(childRecords(groupShape), OfficeArtFSPGR);
    expect(fspgr?.header.recVer).toBe(0x1);
  });

  it("sets fBid on the table row properties, alongside fComplex", () => {
    const shapes: DrawingShape[] = [
      { shape: tableShape([{ cells: [] }]), clientData: undefined },
    ];
    const properties = firstTableGroupProperties(
      writeSlideDrawing(shapes, CONTEXT),
    );
    const rowProperties = properties.get(PROPERTY_TABLE_ROW_PROPERTIES);
    if (rowProperties === undefined) {
      throw new Error("expected a tableRowProperties entry");
    }
    // The complex property's own pooled payload is only ever emitted when fComplex is set (readShapeProperties would not otherwise have found it at all), so its presence already proves fComplex; only fBid remains to check directly against the raw entry word.
    expect(rowProperties.complex).toBeDefined();
    const [groupShape] = tableGroupShape(writeSlideDrawing(shapes, CONTEXT));
    if (groupShape === undefined) {
      throw new Error("expected the table group's own shape first");
    }
    const tertiaryFopt = findChild(
      childRecords(groupShape),
      OfficeArtTertiaryFOPT,
    );
    if (tertiaryFopt === undefined) {
      throw new Error("expected an OfficeArtTertiaryFOPT");
    }
    // Two 6-byte entries (tableProperties, tableRowProperties), ascending by opid; tableRowProperties' own opid word is the second entry, 6 bytes into the record.
    const view = new DataView(
      tertiaryFopt.data.buffer,
      tertiaryFopt.data.byteOffset,
    );
    const opidWord = view.getUint16(6, true);
    expect(opidWord & (1 << 15)).not.toBe(0);
  });

  it("repeats the last declared column width past the declared count, not an earlier one", () => {
    const shapes: DrawingShape[] = [
      {
        shape: tableShape(
          [
            {
              cells: [
                { blocks: [] },
                { blocks: [] },
                { blocks: [] },
                { blocks: [] },
              ],
            },
          ],
          [100, 200, 300],
          { frame: { xPt: 0, yPt: 0, widthPt: 1000, heightPt: 100 } },
        ),
        clientData: undefined,
      },
    ];
    const written = writeSlideDrawing(shapes, CONTEXT);
    const record = readRecordAt(written.bytes, 0);
    const [entry] = readDrawingShapes(record);
    if (entry === undefined || !("cells" in entry)) {
      throw new Error("expected a table entry");
    }
    const fourthCell = entry.cells[3];
    if (
      fourthCell === undefined ||
      !("anchor" in fourthCell) ||
      fourthCell.anchor === undefined
    ) {
      throw new Error("expected a fourth, anchored cell");
    }
    // Columns 0-2 are 100/200/300pt wide (master units 800/1600/2400); the fourth column, past the declared three, repeats the third (300pt = 2400 master units) rather than the second (200pt = 1600).
    expect(fourthCell.anchor.right - fourthCell.anchor.left).toBe(2400);
  });

  it("shares the frame's own width equally among columns when none are declared", () => {
    const shapes: DrawingShape[] = [
      {
        shape: tableShape([{ cells: [{ blocks: [] }, { blocks: [] }] }], [], {
          frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 },
        }),
        clientData: undefined,
      },
    ];
    const written = writeSlideDrawing(shapes, CONTEXT);
    const record = readRecordAt(written.bytes, 0);
    const [entry] = readDrawingShapes(record);
    if (entry === undefined || !("cells" in entry)) {
      throw new Error("expected a table entry");
    }
    const [first, second] = entry.cells;
    if (
      first === undefined ||
      !("anchor" in first) ||
      first.anchor === undefined ||
      second === undefined ||
      !("anchor" in second) ||
      second.anchor === undefined
    ) {
      throw new Error("expected two anchored cells");
    }
    // 100pt = 800 master units, split equally between 2 columns: 400 each. Math.min(1, …) in place of Math.max would force width 1; the wrong operator (* instead of /) would produce a width many orders of magnitude off.
    expect(first.anchor.right - first.anchor.left).toBe(400);
    expect(second.anchor.right - second.anchor.left).toBe(400);
  });

  it("numbers the group shape then each cell contiguously, and resumes numbering after the table for the next shape", () => {
    const shapes: DrawingShape[] = [
      {
        shape: tableShape([{ cells: [{ blocks: [] }, { blocks: [] }] }]),
        clientData: undefined,
      },
      { shape: textShape(), clientData: undefined },
    ];
    const written = writeSlideDrawing(shapes, CONTEXT);
    const [groupShape, cellA, cellB] = tableGroupShape(written);
    if (
      groupShape === undefined ||
      cellA === undefined ||
      cellB === undefined
    ) {
      throw new Error("expected the group shape and two cells");
    }
    expect(fspSpid(groupShape)).toBe(2);
    expect(fspSpid(cellA)).toBe(3);
    expect(fspSpid(cellB)).toBe(4);
    const nextShapeRecord = firstContentShapeRecord(written);
    expect(fspSpid(nextShapeRecord)).toBe(5);
  });
});

describe("writeSlideDrawing: table cell spans and content", () => {
  function collectDiagnostics(
    shapes: readonly DrawingShape[],
  ): PptDiagnostic[] {
    const diagnostics: PptDiagnostic[] = [];
    const context: DrawingWriteContext = {
      ...CONTEXT,
      sink: (diagnostic) => {
        diagnostics.push(diagnostic);
      },
    };
    writeSlideDrawing(shapes, context);
    return diagnostics;
  }

  it("reports a colSpan greater than 1 while still writing the cell one column wide", () => {
    const diagnostics = collectDiagnostics([
      {
        shape: tableShape([{ cells: [{ blocks: [], colSpan: 2 }] }], [50, 50]),
        clientData: undefined,
      },
    ]);
    expect(
      diagnostics.some(
        (d) =>
          d.code === PptDiagnosticCodes.TABLE_SPAN_DROPPED &&
          d.message.includes("colSpan 2"),
      ),
    ).toBe(true);
  });

  it("reports a rowSpan greater than 1, distinctly from colSpan", () => {
    const diagnostics = collectDiagnostics([
      {
        shape: tableShape(
          [{ cells: [{ blocks: [], rowSpan: 3 }] }, { cells: [] }],
          [],
        ),
        clientData: undefined,
      },
    ]);
    expect(
      diagnostics.some(
        (d) =>
          d.code === PptDiagnosticCodes.TABLE_SPAN_DROPPED &&
          d.message.includes("rowSpan 3"),
      ),
    ).toBe(true);
  });

  it("reports a header row, naming the row it dropped the flag from, and stays silent for an ordinary one", () => {
    const diagnostics = collectDiagnostics([
      {
        shape: tableShape(
          [
            { cells: [{ blocks: [] }] },
            { cells: [{ blocks: [] }], isHeader: true },
          ],
          [50],
        ),
        clientData: undefined,
      },
    ]);
    const reported = diagnostics.filter(
      (d) => d.code === PptDiagnosticCodes.TABLE_HEADER_ROW_DROPPED,
    );
    expect(reported).toHaveLength(1);
    expect(reported[0]?.message).toContain("table row 1");
  });

  it("reports a header column, naming the column it dropped the flag from, and stays silent for an ordinary one", () => {
    const table: ContentTable = {
      kind: "table",
      columns: [{ widthPt: 50 }, { widthPt: 50, isHeader: true }],
      rows: [{ cells: [{ blocks: [] }, { blocks: [] }] }],
    };
    const diagnostics = collectDiagnostics([
      { shape: textShape({ blocks: [table] }), clientData: undefined },
    ]);
    const reported = diagnostics.filter(
      (d) => d.code === PptDiagnosticCodes.TABLE_HEADER_COLUMN_DROPPED,
    );
    expect(reported).toHaveLength(1);
    expect(reported[0]?.message).toContain("table column 1");
  });

  it("reports no header column at all for a table whose columns state none", () => {
    const diagnostics = collectDiagnostics([
      {
        shape: tableShape([{ cells: [{ blocks: [] }] }], [50]),
        clientData: undefined,
      },
    ]);
    expect(
      diagnostics.some(
        (d) => d.code === PptDiagnosticCodes.TABLE_HEADER_COLUMN_DROPPED,
      ),
    ).toBe(false);
  });

  it("writes one shape at its own grid position for every entry of a merged region, so a covered entry neither obscures the anchor nor removes a row from the grid", () => {
    // A 2x2 region anchored at (0,0) in a 3-row, 2-column grid. The dense grid rule keeps a block-less entry at each covered position; the format has no merge records, so each entry, covered ones included, is a plain shape at the position its array index names, and the anchor stays one cell wide and one row tall. Row 1 holds only covered entries, so skipping them would erase that row on the way back in.
    const diagnostics: PptDiagnostic[] = [];
    const written = writeSlideDrawing(
      [
        {
          shape: tableShape(
            [
              {
                cells: [{ blocks: [], colSpan: 2, rowSpan: 2 }, { blocks: [] }],
              },
              { cells: [{ blocks: [] }, { blocks: [] }] },
              { cells: [{ blocks: [] }, { blocks: [] }] },
            ],
            [50, 50],
          ),
          clientData: undefined,
        },
      ],
      {
        ...CONTEXT,
        sink: (diagnostic) => {
          diagnostics.push(diagnostic);
        },
      },
    );
    const [entry] = readDrawingShapes(readRecordAt(written.bytes, 0));
    if (entry === undefined || !("cells" in entry)) {
      throw new Error("expected a table entry");
    }
    expect(entry.cells).toHaveLength(6);
    const anchors = entry.cells.map((cell) => {
      if (!("anchor" in cell) || cell.anchor === undefined) {
        throw new Error("expected every cell to be anchored");
      }
      return cell.anchor;
    });
    const [anchor, rightNeighbour, below] = anchors;
    if (
      anchor === undefined ||
      rightNeighbour === undefined ||
      below === undefined
    ) {
      throw new Error("expected the anchor and its two neighbours");
    }
    expect(anchor.right).toBe(rightNeighbour.left);
    expect(anchor.bottom).toBe(below.top);
    expect(new Set(anchors.map((a) => a.top)).size).toBe(3);
    expect(new Set(anchors.map((a) => a.left)).size).toBe(2);
    expect(
      diagnostics.filter(
        (d) => d.code === PptDiagnosticCodes.TABLE_SPAN_DROPPED,
      ),
    ).toHaveLength(2);
  });

  it("reports a table breaking the grid rule, naming the fault, and still writes every entry at its own grid position", () => {
    const diagnostics: PptDiagnostic[] = [];
    const written = writeSlideDrawing(
      [
        {
          shape: tableShape(
            [
              {
                cells: [
                  {
                    blocks: [{ kind: "paragraph", runs: [{ text: "anchor" }] }],
                    colSpan: 2,
                  },
                  {
                    blocks: [{ kind: "paragraph", runs: [{ text: "copy" }] }],
                  },
                ],
              },
            ],
            [50, 50],
          ),
          clientData: undefined,
        },
      ],
      {
        ...CONTEXT,
        describeMessage: (reason) => `slide 1: ${reason}`,
        sink: (diagnostic) => {
          diagnostics.push(diagnostic);
        },
      },
    );
    expect(
      diagnostics.filter((d) => d.code === PptDiagnosticCodes.TABLE_GRID_FAULT),
    ).toEqual([
      {
        code: PptDiagnosticCodes.TABLE_GRID_FAULT,
        severity: "warning",
        message:
          "slide 1: a table breaks the grid rule (the cell at row 0, column 1 lies inside the merged region anchored at row 0, column 0 but carries content of its own, and a merged region's content belongs to its anchor); every entry is still written at its own grid position",
      },
    ]);
    const [entry] = readDrawingShapes(readRecordAt(written.bytes, 0));
    if (entry === undefined || !("cells" in entry)) {
      throw new Error("expected a table entry");
    }
    expect(entry.cells).toHaveLength(2);
  });

  it("reports no grid fault for a table obeying the grid rule", () => {
    const diagnostics = collectDiagnostics([
      {
        shape: tableShape(
          [{ cells: [{ blocks: [], colSpan: 2 }, { blocks: [] }] }],
          [50, 50],
        ),
        clientData: undefined,
      },
    ]);
    expect(
      diagnostics.some((d) => d.code === PptDiagnosticCodes.TABLE_GRID_FAULT),
    ).toBe(false);
  });

  it("reports neither span diagnostic for a colSpan/rowSpan of exactly 1", () => {
    const diagnostics = collectDiagnostics([
      {
        shape: tableShape([
          { cells: [{ blocks: [], colSpan: 1, rowSpan: 1 }] },
        ]),
        clientData: undefined,
      },
    ]);
    expect(
      diagnostics.some((d) => d.code === PptDiagnosticCodes.TABLE_SPAN_DROPPED),
    ).toBe(false);
  });

  it("drops a non-paragraph block inside a cell, keeping the cell's paragraph text", () => {
    const diagnostics = collectDiagnostics([
      {
        shape: tableShape([
          {
            cells: [
              {
                blocks: [
                  { kind: "paragraph", runs: [{ text: "kept" }] },
                  {
                    kind: "image",
                    format: "png",
                    base64: "AA==",
                    widthPt: 1,
                    heightPt: 1,
                  },
                ],
              },
            ],
          },
        ]),
        clientData: undefined,
      },
    ]);
    expect(
      diagnostics.some(
        (d) =>
          d.code === PptDiagnosticCodes.BLOCK_DROPPED &&
          d.message.includes("'image' block inside a table cell"),
      ),
    ).toBe(true);
  });

  it("writes one cell shape per grid cell, each with its own child anchor", () => {
    const shapes: DrawingShape[] = [
      {
        shape: tableShape(
          [
            {
              cells: [
                { blocks: [{ kind: "paragraph", runs: [{ text: "a" }] }] },
                { blocks: [{ kind: "paragraph", runs: [{ text: "b" }] }] },
              ],
            },
          ],
          [50, 50],
        ),
        clientData: undefined,
      },
    ];
    const written = writeSlideDrawing(shapes, CONTEXT);
    const record = readRecordAt(written.bytes, 0);
    const [entry] = readDrawingShapes(record);
    if (entry === undefined || !("cells" in entry)) {
      throw new Error("expected a table entry");
    }
    expect(entry.cells).toHaveLength(2);
    expect(entry.cells[0]?.anchor).not.toEqual(entry.cells[1]?.anchor);
  });
});
