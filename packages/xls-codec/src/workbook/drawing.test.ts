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
import { groupRecords, splitSubstreams } from "../biff/substreams";
import { bofData, ftCmo, record } from "../test-support/biff";
import {
  clientAnchorSheet,
  escherContainer,
  foptEntry,
  optAtom,
  spAtom,
} from "../test-support/escher";
import type { BlipImage } from "../drawing/blips";
import {
  chartTableCells,
  readSheetDrawing,
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
    expect(readSheetDrawing([], baseContext())).toEqual({
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

    expect(drawing.embeddedObjects).toEqual([]);
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

    expect(drawing.images).toEqual([]);
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

    expect(drawing.images).toEqual([]);
    expect(drawing.embeddedObjects).toEqual([]);
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

    expect(drawing.images).toEqual([]);
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

    expect(cells).toEqual([]);
  });
});
