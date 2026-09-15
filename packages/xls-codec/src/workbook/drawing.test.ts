import { describe, expect, it } from "vitest";

import type { FormulaSheetContext } from "../biff/ptg";
import {
  BOF_TYPE_CHART,
  BOF_TYPE_WORKSHEET,
  RECORD_BOF,
  RECORD_EOF,
  RECORD_MSODRAWING,
  RECORD_OBJ,
} from "../biff/record-types";
import { readRecords } from "../biff/records";
import {
  groupRecords,
  splitSubstreams,
  type RecordGroup,
  type Substream,
} from "../biff/substreams";
import { bofData, ftCmo, record, u16, u32 } from "../test-support/biff";
import {
  clientAnchorSheet,
  escherContainer,
  foptEntry,
  optAtom,
  spAtom,
} from "../test-support/escher";
import { PAGE_SIZE_LETTER } from "document-schema.js";
import type { BlipImage } from "../drawing/blips";
import type { DrawingShape } from "../drawing/shapes";
import { writeEmbeddedObjectPackage } from "./embedded-object";
import {
  chartFromShape,
  chartTableCells,
  drawingObjectFromShape,
  embeddedObjectFromObjRecord,
  imageFromShape,
  readSheetDrawing,
  SheetGridGeometry,
  type SheetDrawingContext,
} from "./drawing";

const SHAPE_TYPE_RECTANGLE = 0x01;
const SHAPE_TYPE_PICTURE_FRAME = 0x4b;
const OBJECT_TYPE_PICTURE = 0x08;
const OBJECT_TYPE_CHART = 0x05;
const OBJECT_TYPE_NOTE = 0x19;
const OBJECT_TYPE_OFFICE_ART = 0x1e;

const EMPTY_FORMULA_CONTEXT: FormulaSheetContext = {
  sheets: [],
  sheetRanges: [],
};

function baseContext(
  overrides: Partial<SheetDrawingContext> = {},
): SheetDrawingContext {
  return {
    blipStore: new Map<number, BlipImage>(),
    columns: [],
    rows: [],
    ownSheetIndex: 0,
    formulaSheets: EMPTY_FORMULA_CONTEXT,
    ownSheetCells: [],
    metadata: {},
    allSubstreams: [],
    embeddingStreams: new Map<number, Uint8Array<ArrayBuffer>>(),
    ...overrides,
  };
}

/** One MsoDrawing record wrapping the given patriarch+shape Escher bytes -- a real file may split this across several MsoDrawing records, but one is enough for these tests since drawing.ts concatenates them all before parsing regardless. */
function msoDrawing(
  shapeContainers: readonly (readonly number[])[],
): Uint8Array<ArrayBuffer> {
  const patriarch = spAtom(SHAPE_TYPE_RECTANGLE, 1024, 0);
  const bytes = escherContainer(0xf002, 0, [
    escherContainer(0xf003, 0, [
      escherContainer(0xf004, 0, [patriarch]),
      ...shapeContainers,
    ]),
  ]);
  return record(RECORD_MSODRAWING, bytes);
}

function objRecord(ot: number, id: number): Uint8Array<ArrayBuffer> {
  return record(RECORD_OBJ, ftCmo(ot, id));
}

function pictureShape(
  spid: number,
  blipIndex: number,
  anchor: readonly number[],
): number[] {
  return escherContainer(0xf004, 0, [
    spAtom(SHAPE_TYPE_PICTURE_FRAME, spid, 0),
    optAtom([foptEntry(0x0104, blipIndex)]),
    anchor,
  ]);
}

function rectangleShape(spid: number, anchor: readonly number[]): number[] {
  return escherContainer(0xf004, 0, [
    spAtom(SHAPE_TYPE_RECTANGLE, spid, 0),
    anchor,
  ]);
}

/** A picture-blip-carrying shape whose own OfficeArtFSP shapeType is chosen independently of the blip, for isolating obj.ot===PICTURE from shape.shapeType===PICTURE_FRAME in readSheetDrawing's own picture-or-embedded dispatch. */
function pictureShapeOfType(
  shapeType: number,
  spid: number,
  blipIndex: number,
  anchor: readonly number[],
): number[] {
  return escherContainer(0xf004, 0, [
    spAtom(shapeType, spid, 0),
    optAtom([foptEntry(0x0104, blipIndex)]),
    anchor,
  ]);
}

/** A minimal FtPictFmla sub-record naming `storageId`, matching comments.test.ts's own identical fixture for the same [MS-XLS] 2.5.150 structure. */
function ftPictFmla(storageId: number): number[] {
  const data = [...u16(0), ...u32(storageId)];
  return [...u16(0x0009), ...u16(data.length), ...data];
}

/** A standalone Obj RecordGroup naming `storageId` via FtPictFmla, for direct embeddedObjectFromObjRecord tests that never go through readSheetDrawing's own MsoDrawing/Obj pairing at all. */
function pictureObjGroup(storageId: number): RecordGroup {
  const bytes = record(RECORD_OBJ, [
    ...ftCmo(OBJECT_TYPE_PICTURE, 1),
    ...ftPictFmla(storageId),
  ]);
  const group = groupRecords(readRecords(bytes))[0];
  if (group === undefined) {
    throw new Error("expected an Obj record group");
  }
  return group;
}

/** An anchor whose own placement collapses to exactly zero width, at a real (non-zero) height -- isolating widthPt<=0 from heightPt<=0 in every one of the three shape-to-content functions that share the identical guard. */
const ZERO_WIDTH_ANCHOR = {
  colL: 0,
  dxL: 0,
  rwT: 0,
  dyT: 0,
  colR: 0,
  dxR: 0,
  rwB: 1,
  dyB: 0,
};

/** The mirror of ZERO_WIDTH_ANCHOR: exactly zero height, at a real (non-zero) width. */
const ZERO_HEIGHT_ANCHOR = {
  colL: 0,
  dxL: 0,
  rwT: 0,
  dyT: 0,
  colR: 1,
  dxR: 0,
  rwB: 0,
  dyB: 0,
};

/** Runs a hand-built worksheet substream's own record() bytes through the real BIFF framing/grouping passes. */
function worksheetRecords(rawRecords: readonly Uint8Array<ArrayBuffer>[]) {
  let offset = 0;
  const withOffsets = rawRecords.map((data) => {
    const entry = {
      type: new DataView(data.buffer, data.byteOffset).getUint16(0, true),
      data: data.slice(4),
      offset,
    };
    offset += data.length;
    return entry;
  });
  return groupRecords(withOffsets);
}

describe("readSheetDrawing", () => {
  it("returns nothing for a worksheet with no drawing records", () => {
    expect(readSheetDrawing([], baseContext())).toStrictEqual({
      images: [],
      embeddedObjects: [],
    });
  });

  it("resolves a picture shape into a ContentSheetImage via its own pib blip index", () => {
    const anchor = clientAnchorSheet(0, 0, 0, 0, 1, 0, 1, 0);
    const records = worksheetRecords([
      msoDrawing([pictureShape(10, 1, anchor)]),
      objRecord(OBJECT_TYPE_PICTURE, 1),
    ]);
    const blipStore = new Map<number, BlipImage>([
      [1, { format: "png", base64: "abc" }],
    ]);

    const drawing = readSheetDrawing(records, baseContext({ blipStore }));

    expect(drawing.embeddedObjects).toStrictEqual([]);
    expect(drawing.images).toHaveLength(1);
    expect(drawing.images[0]?.format).toBe("png");
    expect(drawing.images[0]?.base64).toBe("abc");
    expect(drawing.images[0]?.anchorColumn).toBe(0);
    expect(drawing.images[0]?.anchorRow).toBe(0);
  });

  it("resolves a non-picture, non-chart shape as a generic 'drawing' embedded object", () => {
    const anchor = clientAnchorSheet(0, 0, 0, 0, 1, 0, 1, 0);
    const records = worksheetRecords([
      msoDrawing([rectangleShape(11, anchor)]),
      objRecord(OBJECT_TYPE_OFFICE_ART, 1),
    ]);

    const drawing = readSheetDrawing(records, baseContext());

    expect(drawing.images).toStrictEqual([]);
    expect(drawing.embeddedObjects).toHaveLength(1);
    expect(drawing.embeddedObjects[0]?.objectKind).toBe("drawing");
  });

  it("skips a Note-type shape entirely, since comments.ts already reads it", () => {
    const anchor = clientAnchorSheet(0, 0, 0, 0, 1, 0, 1, 0);
    const records = worksheetRecords([
      msoDrawing([rectangleShape(12, anchor)]),
      objRecord(OBJECT_TYPE_NOTE, 1),
    ]);

    const drawing = readSheetDrawing(records, baseContext());

    expect(drawing.images).toStrictEqual([]);
    expect(drawing.embeddedObjects).toStrictEqual([]);
  });

  it("pairs multiple shapes with multiple Obj records in document order", () => {
    const anchorA = clientAnchorSheet(0, 0, 0, 0, 1, 0, 1, 0);
    const anchorB = clientAnchorSheet(2, 0, 2, 0, 3, 0, 3, 0);
    const records = worksheetRecords([
      msoDrawing([pictureShape(20, 1, anchorA), rectangleShape(21, anchorB)]),
      objRecord(OBJECT_TYPE_PICTURE, 1),
      objRecord(OBJECT_TYPE_OFFICE_ART, 2),
    ]);
    const blipStore = new Map<number, BlipImage>([
      [1, { format: "jpeg", base64: "xyz" }],
    ]);

    const drawing = readSheetDrawing(records, baseContext({ blipStore }));

    expect(drawing.images).toHaveLength(1);
    expect(drawing.embeddedObjects).toHaveLength(1);
    expect(drawing.embeddedObjects[0]?.objectKind).toBe("drawing");
  });

  it("treats an Obj record's own picture object type as sufficient on its own, even when the shape's own type is not picture-frame", () => {
    const anchor = clientAnchorSheet(0, 0, 0, 0, 1, 0, 1, 0);
    const records = worksheetRecords([
      msoDrawing([pictureShapeOfType(SHAPE_TYPE_RECTANGLE, 50, 1, anchor)]),
      objRecord(OBJECT_TYPE_PICTURE, 1),
    ]);
    const blipStore = new Map<number, BlipImage>([
      [1, { format: "png", base64: "xyz" }],
    ]);

    const drawing = readSheetDrawing(records, baseContext({ blipStore }));

    expect(drawing.images).toHaveLength(1);
    expect(drawing.embeddedObjects).toStrictEqual([]);
  });

  it("treats the shape's own picture-frame type as sufficient on its own, even when the Obj record's own object type is not picture", () => {
    const anchor = clientAnchorSheet(0, 0, 0, 0, 1, 0, 1, 0);
    const records = worksheetRecords([
      msoDrawing([pictureShape(51, 1, anchor)]),
      objRecord(OBJECT_TYPE_OFFICE_ART, 1),
    ]);
    const blipStore = new Map<number, BlipImage>([
      [1, { format: "png", base64: "xyz" }],
    ]);

    const drawing = readSheetDrawing(records, baseContext({ blipStore }));

    expect(drawing.images).toHaveLength(1);
    expect(drawing.embeddedObjects).toStrictEqual([]);
  });

  it("pairs only as many shapes and Obj records as the shorter side names, when a sheet's own two lists disagree in length", () => {
    const anchorA = clientAnchorSheet(0, 0, 0, 0, 1, 0, 1, 0);
    const anchorB = clientAnchorSheet(2, 0, 2, 0, 3, 0, 3, 0);
    // Two shapes, three Obj records: the third Obj record names no shape at all, and must be silently skipped rather than crashing or spuriously pairing with something.
    const records = worksheetRecords([
      msoDrawing([rectangleShape(60, anchorA), rectangleShape(61, anchorB)]),
      objRecord(OBJECT_TYPE_OFFICE_ART, 1),
      objRecord(OBJECT_TYPE_OFFICE_ART, 2),
      objRecord(OBJECT_TYPE_OFFICE_ART, 3),
    ]);

    const drawing = readSheetDrawing(records, baseContext());

    expect(drawing.embeddedObjects).toHaveLength(2);
  });

  it("resolves a Chart-type shape by finding its own nested BOF(chart)...EOF substream, bounded by offset", () => {
    const anchor = clientAnchorSheet(0, 0, 0, 0, 2, 0, 2, 0);
    // Built directly from the record() framing (BOF worksheet, drawing+Obj, nested BOF chart, EOF chart, EOF worksheet) so splitSubstreams' own nesting logic produces the real chart Substream this reader has to locate by offset -- worksheetRecords' own helper only handles a flat, unnested record list.
    const chunks = [
      record(RECORD_BOF, bofData(BOF_TYPE_WORKSHEET)),
      msoDrawing([rectangleShape(30, anchor)]),
      objRecord(OBJECT_TYPE_CHART, 1),
      record(RECORD_BOF, bofData(BOF_TYPE_CHART)),
      record(RECORD_EOF, []),
      record(RECORD_EOF, []),
    ];
    const rawRecords: {
      type: number;
      data: Uint8Array<ArrayBuffer>;
      offset: number;
    }[] = [];
    let offset = 0;
    for (const chunk of chunks) {
      rawRecords.push({
        type: new DataView(chunk.buffer, chunk.byteOffset).getUint16(0, true),
        data: chunk.slice(4),
        offset,
      });
      offset += chunk.length;
    }
    const substreams = splitSubstreams(groupRecords(rawRecords));
    const worksheetSubstream = substreams.find(
      (s) => s.documentType === BOF_TYPE_WORKSHEET,
    );
    expect(worksheetSubstream).toBeDefined();

    const drawing = readSheetDrawing(
      worksheetSubstream?.records ?? [],
      baseContext({ allSubstreams: substreams }),
    );

    expect(drawing.images).toStrictEqual([]);
    expect(drawing.embeddedObjects).toHaveLength(1);
    expect(drawing.embeddedObjects[0]?.objectKind).toBe("chart");
  });
});

describe("chartTableCells", () => {
  it("writes each series' own name and values under its own column", () => {
    const cells = chartTableCells([
      { name: "Revenue", categories: ["Jan", "Feb"], values: ["10", "20"] },
      { name: "Cost", categories: ["Jan", "Feb"], values: ["5", "8"] },
    ]);

    expect(cells).toContainEqual({
      row: 0,
      column: 1,
      value: { kind: "string", value: "Revenue" },
      displayText: "Revenue",
    });
    expect(cells).toContainEqual({
      row: 0,
      column: 2,
      value: { kind: "string", value: "Cost" },
      displayText: "Cost",
    });
    expect(cells).toContainEqual({
      row: 1,
      column: 1,
      value: { kind: "string", value: "10" },
      displayText: "10",
    });
    expect(cells).toContainEqual({
      row: 2,
      column: 2,
      value: { kind: "string", value: "8" },
      displayText: "8",
    });
  });

  it("writes the shared category column once, not once per series, even when series disagree", () => {
    // Two series whose own category arrays genuinely disagree at index 1 -- the first series to label a given point wins, and the category cell at (row 2, column 0) appears exactly once, never one entry per series.
    const cells = chartTableCells([
      { name: "A", categories: ["Jan", "Feb"], values: ["1", "2"] },
      { name: "B", categories: ["Jan", "Mar"], values: ["3", "4"] },
    ]);

    const categoryCells = cells.filter((cell) => cell.column === 0);
    expect(categoryCells).toHaveLength(2);
    expect(categoryCells).toContainEqual({
      row: 1,
      column: 0,
      value: { kind: "string", value: "Jan" },
      displayText: "Jan",
    });
    expect(categoryCells).toContainEqual({
      row: 2,
      column: 0,
      value: { kind: "string", value: "Feb" },
      displayText: "Feb",
    });
  });

  it("omits an empty-string name, category, or value rather than materialising an empty cell", () => {
    const cells = chartTableCells([
      { name: undefined, categories: [""], values: [""] },
    ]);

    expect(cells).toStrictEqual([]);
  });
});

describe("SheetGridGeometry", () => {
  it("sums only the columns strictly before the one asked for, using each column's own declared width rather than the default", () => {
    const geometry = new SheetGridGeometry(
      [
        { index: 0, widthPt: 100, hidden: false },
        { index: 1, widthPt: 50, hidden: false },
      ],
      [],
    );

    expect(geometry.columnWidthPt(0)).toBe(100);
    expect(geometry.xPt(1)).toBe(100);
    expect(geometry.xPt(2)).toBe(150);
  });

  it("sums only the rows strictly before the one asked for, using each row's own declared height rather than the default", () => {
    const geometry = new SheetGridGeometry(
      [],
      [
        { index: 0, heightPt: 20, hidden: false },
        { index: 1, heightPt: 10, hidden: false },
      ],
    );

    expect(geometry.rowHeightPt(0)).toBe(20);
    expect(geometry.yPt(1)).toBe(20);
    expect(geometry.yPt(2)).toBe(30);
  });

  it("falls back to Excel's own Normal-style default width/height for a column/row the sheet never declared", () => {
    const geometry = new SheetGridGeometry([], []);

    expect(geometry.columnWidthPt(0)).toBeGreaterThan(0);
    expect(geometry.rowHeightPt(0)).toBeGreaterThan(0);
    expect(geometry.xPt(0)).toBe(0);
    expect(geometry.yPt(0)).toBe(0);
  });
});

describe("imageFromShape", () => {
  const context = baseContext({
    blipStore: new Map<number, BlipImage>([
      [1, { format: "png", base64: "abc" }],
    ]),
  });
  const geometry = new SheetGridGeometry([], []);

  function shapeAt(anchor: typeof ZERO_WIDTH_ANCHOR): DrawingShape {
    return {
      shapeType: SHAPE_TYPE_PICTURE_FRAME,
      spid: 1,
      blipIndex: 1,
      anchor,
    };
  }

  it("returns undefined for a zero-width anchor, isolated from the height half of the same guard", () => {
    expect(
      imageFromShape(shapeAt(ZERO_WIDTH_ANCHOR), context, geometry),
    ).toBeUndefined();
  });

  it("returns undefined for a zero-height anchor, isolated from the width half of the same guard", () => {
    expect(
      imageFromShape(shapeAt(ZERO_HEIGHT_ANCHOR), context, geometry),
    ).toBeUndefined();
  });
});

describe("embeddedObjectFromObjRecord", () => {
  const objGroup = pictureObjGroup(7);
  // A genuinely valid Package stream (not arbitrary bytes) -- readEmbeddedObjectPackage's own foreign-payload degrade would otherwise return undefined regardless of the size guard below, making the guard's own removal invisible to these tests.
  const packageBytes = writeEmbeddedObjectPackage({
    objectKind: "drawing",
    document: {
      kind: "drawing",
      metadata: {},
      pages: [{ size: { widthPt: 10, heightPt: 10 }, shapes: [], vectors: [] }],
    },
    frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
    anchorRow: 0,
    anchorColumn: 0,
    offsetXPt: 0,
    offsetYPt: 0,
  });
  const context = baseContext({
    embeddingStreams: new Map<number, Uint8Array<ArrayBuffer>>([
      [7, packageBytes],
    ]),
  });
  const geometry = new SheetGridGeometry([], []);

  function shapeAt(anchor: typeof ZERO_WIDTH_ANCHOR): DrawingShape {
    return {
      shapeType: SHAPE_TYPE_PICTURE_FRAME,
      spid: 1,
      blipIndex: undefined,
      anchor,
    };
  }

  it("returns undefined for a zero-width anchor, isolated from the height half of the same guard, before ever reading the Embedding Storage's own Package stream", () => {
    expect(
      embeddedObjectFromObjRecord(
        objGroup,
        shapeAt(ZERO_WIDTH_ANCHOR),
        context,
        geometry,
      ),
    ).toBeUndefined();
  });

  it("returns undefined for a zero-height anchor, isolated from the width half of the same guard", () => {
    expect(
      embeddedObjectFromObjRecord(
        objGroup,
        shapeAt(ZERO_HEIGHT_ANCHOR),
        context,
        geometry,
      ),
    ).toBeUndefined();
  });
});

describe("drawingObjectFromShape", () => {
  const geometry = new SheetGridGeometry([], []);

  function shapeAt(anchor: typeof ZERO_WIDTH_ANCHOR): DrawingShape {
    return {
      shapeType: SHAPE_TYPE_RECTANGLE,
      spid: 5,
      blipIndex: undefined,
      anchor,
    };
  }

  it("returns undefined for a zero-width anchor, isolated from the height half of the same guard", () => {
    expect(
      drawingObjectFromShape(shapeAt(ZERO_WIDTH_ANCHOR), geometry),
    ).toBeUndefined();
  });

  it("returns undefined for a zero-height anchor, isolated from the width half of the same guard", () => {
    expect(
      drawingObjectFromShape(shapeAt(ZERO_HEIGHT_ANCHOR), geometry),
    ).toBeUndefined();
  });

  it("builds a single-page, single-shape document sized and framed exactly at the anchor's own placement, with no image content of its own", () => {
    const anchor = {
      colL: 0,
      dxL: 0,
      rwT: 0,
      dyT: 0,
      colR: 1,
      dxR: 0,
      rwB: 1,
      dyB: 0,
    };
    const shape: DrawingShape = {
      shapeType: SHAPE_TYPE_RECTANGLE,
      spid: 5,
      blipIndex: undefined,
      anchor,
    };
    const widthPt = geometry.columnWidthPt(0);
    const heightPt = geometry.rowHeightPt(0);

    const result = drawingObjectFromShape(shape, geometry);

    expect(result).toStrictEqual({
      objectKind: "drawing",
      document: {
        kind: "drawing",
        metadata: {},
        pages: [
          {
            size: { widthPt, heightPt },
            shapes: [
              {
                frame: { xPt: 0, yPt: 0, widthPt, heightPt },
                insetLeftPt: 0,
                insetTopPt: 0,
                insetRightPt: 0,
                insetBottomPt: 0,
                blocks: [],
              },
            ],
            vectors: [],
          },
        ],
      },
      frame: { xPt: 0, yPt: 0, widthPt, heightPt },
      anchorRow: 0,
      anchorColumn: 0,
      offsetXPt: 0,
      offsetYPt: 0,
    });
  });
});

describe("chartFromShape", () => {
  const shape: DrawingShape = {
    shapeType: SHAPE_TYPE_RECTANGLE,
    spid: 1,
    blipIndex: undefined,
    anchor: {
      colL: 0,
      dxL: 0,
      rwT: 0,
      dyT: 0,
      colR: 1,
      dxR: 0,
      rwB: 1,
      dyB: 0,
    },
  };
  const geometry = new SheetGridGeometry([], []);
  const context = baseContext();

  function substream(documentType: number, offset: number): Substream {
    return { documentType, offset, records: [], index: 0 };
  }

  it("returns undefined when no candidate substream is chart-typed at all", () => {
    expect(
      chartFromShape(
        shape,
        10,
        20,
        {
          ...context,
          allSubstreams: [substream(BOF_TYPE_WORKSHEET, 15)],
        },
        geometry,
      ),
    ).toBeUndefined();
  });

  it("returns undefined for a chart substream sitting at or before the Obj record's own offset", () => {
    expect(
      chartFromShape(
        shape,
        10,
        20,
        {
          ...context,
          allSubstreams: [substream(BOF_TYPE_CHART, 10)],
        },
        geometry,
      ),
    ).toBeUndefined();
  });

  it("returns undefined for a chart substream sitting at or after the next worksheet record's own offset", () => {
    expect(
      chartFromShape(
        shape,
        10,
        20,
        {
          ...context,
          allSubstreams: [substream(BOF_TYPE_CHART, 20)],
        },
        geometry,
      ),
    ).toBeUndefined();
  });

  it("picks the one candidate genuinely bounded between the Obj record and the next, ignoring near-miss substreams elsewhere in the list, and builds the chart's own single-sheet document exactly", () => {
    const result = chartFromShape(
      shape,
      10,
      20,
      {
        ...context,
        allSubstreams: [
          substream(BOF_TYPE_WORKSHEET, 15),
          substream(BOF_TYPE_CHART, 5),
          substream(BOF_TYPE_CHART, 25),
          substream(BOF_TYPE_CHART, 15),
        ],
      },
      geometry,
    );

    const widthPt = geometry.columnWidthPt(0);
    const heightPt = geometry.rowHeightPt(0);
    expect(result).toStrictEqual({
      objectKind: "chart",
      document: {
        kind: "spreadsheet",
        metadata: {},
        sheets: [
          {
            name: "Chart",
            cells: [],
            columns: [],
            rows: [],
            images: [],
            printSettings: {
              pageSize: PAGE_SIZE_LETTER,
              margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
              gridlines: false,
              headers: false,
              pageOrder: "downThenOver",
            },
          },
        ],
      },
      frame: { xPt: 0, yPt: 0, widthPt, heightPt },
      anchorRow: 0,
      anchorColumn: 0,
      offsetXPt: 0,
      offsetYPt: 0,
    });
  });
});
