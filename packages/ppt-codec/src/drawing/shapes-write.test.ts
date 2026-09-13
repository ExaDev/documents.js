import type {
  ContentBlock,
  ContentShape,
  ContentTable,
  ContentTableRow,
} from "document-schema.js";
import { describe, expect, it } from "vitest";
import type { PptDiagnostic } from "../diagnostics";
import { NOOP_PPT_DIAGNOSTIC_SINK, PptDiagnosticCodes } from "../diagnostics";
import { readDrawingShapes } from "./shapes";
import { childRecords, findChild, readRecordAt } from "../record/tree";
import {
  OfficeArtDgContainer,
  OfficeArtFOPT,
  OfficeArtFSP,
  OfficeArtFSPGR,
  OfficeArtSpContainer,
  OfficeArtSpgrContainer,
  OfficeArtTertiaryFOPT,
} from "../record/types";
import {
  PROPERTY_DX_TEXT_LEFT,
  PROPERTY_DX_TEXT_RIGHT,
  PROPERTY_DY_TEXT_BOTTOM,
  PROPERTY_DY_TEXT_TOP,
  PROPERTY_PIB,
  PROPERTY_ROTATION,
  PROPERTY_TABLE_ROW_PROPERTIES,
  readIMsoArray,
  readShapeProperties,
} from "./properties";
import {
  type DrawingShape,
  type DrawingWriteContext,
  writeSlideDrawing,
} from "./shapes-write";

const CONTEXT: DrawingWriteContext = {
  fontIndexOf: () => 0,
  blipIndexOf: () => 1,
  sink: NOOP_PPT_DIAGNOSTIC_SINK,
  strict: false,
  location: "test",
};

const DEFAULT_TEXT_INSETS = {
  insetLeftPt: 0.1 * 72,
  insetTopPt: 0.05 * 72,
  insetRightPt: 0.1 * 72,
  insetBottomPt: 0.05 * 72,
};

function textShape(overrides: Partial<ContentShape> = {}): ContentShape {
  return {
    frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 50 },
    ...DEFAULT_TEXT_INSETS,
    blocks: [],
    ...overrides,
  };
}

// RT_Drawing -> OfficeArtDgContainer -> OfficeArtSpgrContainer -> [patriarch, ...content shapes].
function spgrChildren(written: ReturnType<typeof writeSlideDrawing>) {
  const record = readRecordAt(written.bytes, 0);
  const dgContainer = findChild(childRecords(record), OfficeArtDgContainer);
  if (dgContainer === undefined) {
    throw new Error("expected an OfficeArtDgContainer");
  }
  const spgrContainer = findChild(
    childRecords(dgContainer),
    OfficeArtSpgrContainer,
  );
  if (spgrContainer === undefined) {
    throw new Error("expected an OfficeArtSpgrContainer");
  }
  return childRecords(spgrContainer);
}

function firstContentShapeRecord(
  written: ReturnType<typeof writeSlideDrawing>,
) {
  const [, shapeRecord] = spgrChildren(written).filter(
    (r) => r.header.recType === OfficeArtSpContainer,
  );
  if (shapeRecord === undefined) {
    throw new Error("expected the patriarch plus one content shape");
  }
  return shapeRecord;
}

function firstShapeProperties(written: ReturnType<typeof writeSlideDrawing>) {
  return readShapeProperties(firstContentShapeRecord(written));
}

// A table group is its own nested OfficeArtSpgrContainer sitting alongside the patriarch, whose own first child is the group shape (the table's own OfficeArtSpContainer) carrying the property table this reads.
function firstTableGroupProperties(
  written: ReturnType<typeof writeSlideDrawing>,
) {
  const tableSpgr = spgrChildren(written).find(
    (r) => r.header.recType === OfficeArtSpgrContainer,
  );
  if (tableSpgr === undefined) {
    throw new Error("expected a nested table OfficeArtSpgrContainer");
  }
  const [groupShape] = childRecords(tableSpgr);
  if (groupShape === undefined) {
    throw new Error("expected the table group's own shape first");
  }
  return readShapeProperties(groupShape);
}

describe("writeSlideDrawing: insets", () => {
  it("writes no inset property at all when every inset matches the plain-text default", () => {
    const shapes: DrawingShape[] = [
      { shape: textShape(), clientData: undefined },
    ];
    const properties = firstShapeProperties(writeSlideDrawing(shapes, CONTEXT));
    expect(properties.get(PROPERTY_DX_TEXT_LEFT)).toBeUndefined();
    expect(properties.get(PROPERTY_DY_TEXT_TOP)).toBeUndefined();
    expect(properties.get(PROPERTY_DX_TEXT_RIGHT)).toBeUndefined();
    expect(properties.get(PROPERTY_DY_TEXT_BOTTOM)).toBeUndefined();
  });

  it.each([
    ["insetLeftPt", PROPERTY_DX_TEXT_LEFT],
    ["insetTopPt", PROPERTY_DY_TEXT_TOP],
    ["insetRightPt", PROPERTY_DX_TEXT_RIGHT],
    ["insetBottomPt", PROPERTY_DY_TEXT_BOTTOM],
  ] as const)(
    "writes only %s when it alone differs from the default",
    (field, opid) => {
      const shapes: DrawingShape[] = [
        { shape: textShape({ [field]: 20 }), clientData: undefined },
      ];
      const properties = firstShapeProperties(
        writeSlideDrawing(shapes, CONTEXT),
      );
      const others = [
        PROPERTY_DX_TEXT_LEFT,
        PROPERTY_DY_TEXT_TOP,
        PROPERTY_DX_TEXT_RIGHT,
        PROPERTY_DY_TEXT_BOTTOM,
      ].filter((o) => o !== opid);
      expect(properties.get(opid)).toBeDefined();
      for (const other of others) {
        expect(properties.get(other)).toBeUndefined();
      }
    },
  );

  it("uses zero, not the text default, as a picture shape's own inset default", () => {
    const shapes: DrawingShape[] = [
      {
        shape: textShape({
          insetLeftPt: 0,
          insetTopPt: 0,
          insetRightPt: 0,
          insetBottomPt: 0,
          blocks: [
            {
              kind: "image",
              format: "png",
              base64: "AA==",
              widthPt: 10,
              heightPt: 10,
            },
          ],
        }),
        clientData: undefined,
      },
    ];
    const properties = firstShapeProperties(writeSlideDrawing(shapes, CONTEXT));
    expect(properties.get(PROPERTY_DX_TEXT_LEFT)).toBeUndefined();
    expect(properties.get(PROPERTY_PIB)?.value).toBe(1);
  });
});

describe("writeSlideDrawing: rotation and pib", () => {
  it("writes rotation as a fixed-point degrees value", () => {
    const shapes: DrawingShape[] = [
      { shape: textShape({ rotationDeg: 90 }), clientData: undefined },
    ];
    const properties = firstShapeProperties(writeSlideDrawing(shapes, CONTEXT));
    expect(properties.get(PROPERTY_ROTATION)?.value).toBe(90 * 0x10000);
  });

  it("writes no property table at all for a shape stating nothing beyond the plain-text defaults", () => {
    // A parsed properties map of size 0 is also what an empty-but-present OfficeArtFOPT record would parse as, so this checks for the record's own absence directly rather than merely an empty read-back.
    const shapes: DrawingShape[] = [
      { shape: textShape(), clientData: undefined },
    ];
    const written = writeSlideDrawing(shapes, CONTEXT);
    const shapeRecord = firstContentShapeRecord(written);
    expect(findChild(childRecords(shapeRecord), OfficeArtFOPT)).toBeUndefined();
  });

  it("sets fBid on the pib property, distinctly from rotation's own plain value", () => {
    const shapes: DrawingShape[] = [
      {
        // Insets matching the picture's own zero default (as the sibling "uses zero..." test above relies on too) so pib is the property table's only entry -- otherwise insetProperties would add entries of its own, and sorting by opid could put one ahead of pib.
        shape: textShape({
          insetLeftPt: 0,
          insetTopPt: 0,
          insetRightPt: 0,
          insetBottomPt: 0,
          blocks: [
            {
              kind: "image",
              format: "png",
              base64: "AA==",
              widthPt: 10,
              heightPt: 10,
            },
          ],
        }),
        clientData: undefined,
      },
    ];
    const written = writeSlideDrawing(shapes, CONTEXT);
    const shapeRecord = firstContentShapeRecord(written);
    const fopt = findChild(childRecords(shapeRecord), OfficeArtFOPT);
    if (fopt === undefined) {
      throw new Error("expected an OfficeArtFOPT property table");
    }
    // 6-byte entry per property (opid word then a 4-byte value); pib is the only entry, so its own opid word sits right after the 8-byte record header.
    const opidWord = new DataView(
      fopt.data.buffer,
      fopt.data.byteOffset,
    ).getUint16(0, true);
    expect(opidWord & (1 << 15)).not.toBe(0);
  });

  it("stamps recVer 0x2 on a content shape's own OfficeArtFSP", () => {
    const shapes: DrawingShape[] = [
      { shape: textShape(), clientData: undefined },
    ];
    const written = writeSlideDrawing(shapes, CONTEXT);
    const shapeRecord = firstContentShapeRecord(written);
    const fsp = findChild(childRecords(shapeRecord), OfficeArtFSP);
    expect(fsp?.header.recVer).toBe(0x2);
  });
});

function tableShape(
  rows: readonly ContentTableRow[],
  columnWidthsPt: readonly number[] = [],
  overrides: Partial<ContentShape> = {},
): ContentShape {
  const table: ContentTable = {
    kind: "table",
    rows: [...rows],
    columnWidthsPt: [...columnWidthsPt],
  };
  return textShape({ blocks: [table], ...overrides });
}

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
  function collectDiagnostics(shapes: DrawingShape[]): PptDiagnostic[] {
    const diagnostics: PptDiagnostic[] = [];
    const context: DrawingWriteContext = {
      ...CONTEXT,
      sink: (diagnostic) => diagnostics.push(diagnostic),
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

describe("writeSlideDrawing: block planning", () => {
  function collectDiagnostics(shapes: DrawingShape[]): PptDiagnostic[] {
    const diagnostics: PptDiagnostic[] = [];
    const context: DrawingWriteContext = {
      ...CONTEXT,
      sink: (diagnostic) => diagnostics.push(diagnostic),
    };
    writeSlideDrawing(shapes, context);
    return diagnostics;
  }

  const embeddedObjectBlock: ContentBlock = {
    kind: "embeddedObject",
    objectKind: "spreadsheet",
    document: { kind: "spreadsheet", metadata: {}, sheets: [] },
    frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
  };

  it("drops an embeddedObject block outright when the shape carries no OLE client data", () => {
    const diagnostics = collectDiagnostics([
      {
        shape: textShape({ blocks: [embeddedObjectBlock] }),
        clientData: undefined,
      },
    ]);
    expect(
      diagnostics.some(
        (d) =>
          d.code === PptDiagnosticCodes.BLOCK_DROPPED &&
          d.message.includes(
            "a 'embeddedObject' block is dropped; this writer produces no [MS-PPT] spelling for it",
          ),
      ),
    ).toBe(true);
  });

  it("keeps an embeddedObject block silently when the shape does carry OLE client data", () => {
    const diagnostics = collectDiagnostics([
      {
        shape: textShape({ blocks: [embeddedObjectBlock] }),
        clientData: new Uint8Array(0),
      },
    ]);
    expect(
      diagnostics.some((d) => d.code === PptDiagnosticCodes.BLOCK_DROPPED),
    ).toBe(false);
  });

  it("drops a pib-consuming image alongside a table, naming the table-group reason rather than a plain second-image one", () => {
    const diagnostics = collectDiagnostics([
      {
        shape: textShape({
          blocks: [
            {
              kind: "image",
              format: "png",
              base64: "AA==",
              widthPt: 10,
              heightPt: 10,
            },
            { kind: "table", rows: [], columnWidthsPt: [] },
          ],
        }),
        clientData: undefined,
      },
    ]);
    expect(
      diagnostics.some(
        (d) =>
          d.code === PptDiagnosticCodes.IMAGE_DROPPED &&
          d.message.includes(
            "a shape carrying a table becomes a table group, which has no blip reference of its own",
          ),
      ),
    ).toBe(true);
  });
});

describe("writeSlideDrawing: patriarch framing", () => {
  it("stamps recVer 0x1 on the patriarch's own degenerate OfficeArtFSPGR", () => {
    const shapes: DrawingShape[] = [
      { shape: textShape(), clientData: undefined },
    ];
    const written = writeSlideDrawing(shapes, CONTEXT);
    const [patriarch] = spgrChildren(written);
    if (patriarch === undefined) {
      throw new Error("expected the patriarch shape container first");
    }
    const fspgr = findChild(childRecords(patriarch), OfficeArtFSPGR);
    expect(fspgr?.header.recVer).toBe(0x1);
  });

  it("counts the patriarch plus every content shape in shapeCount", () => {
    const shapes: DrawingShape[] = [
      { shape: textShape(), clientData: undefined },
      { shape: textShape(), clientData: undefined },
    ];
    const written = writeSlideDrawing(shapes, CONTEXT);
    expect(written.shapeCount).toBe(3);
  });
});
