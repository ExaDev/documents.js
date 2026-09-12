import type {
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
  OfficeArtFSPGR,
  OfficeArtSpContainer,
  OfficeArtSpgrContainer,
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

function firstShapeProperties(written: ReturnType<typeof writeSlideDrawing>) {
  const [, shapeRecord] = spgrChildren(written).filter(
    (r) => r.header.recType === OfficeArtSpContainer,
  );
  if (shapeRecord === undefined) {
    throw new Error("expected the patriarch plus one content shape");
  }
  return readShapeProperties(shapeRecord);
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
    const shapes: DrawingShape[] = [
      { shape: textShape(), clientData: undefined },
    ];
    const properties = firstShapeProperties(writeSlideDrawing(shapes, CONTEXT));
    expect(properties.size).toBe(0);
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
