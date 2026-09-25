// Pins the record-walking helpers in drawing-write.ts against trees that deliberately lack the container each one looks for. The shapes-write suites only ever hand these helpers a real writeSlideDrawing result, so nothing there reaches a guard, and a helper that returned undefined instead of throwing would surface as a confusing failure inside whichever assertion consumed it rather than at the helper itself.

import { describe, expect, it } from "vitest";
import type { DrawingWritten } from "../drawing/shapes-write";
import { readRecordAt } from "../record/tree";
import { writeAtom, writeContainer } from "../record/write";
import {
  OfficeArtDgContainer,
  OfficeArtSpContainer,
  OfficeArtSpgrContainer,
  RT_Drawing,
} from "../record/types";
import {
  firstContentShapeRecord,
  firstTableGroupProperties,
  spgrChildren,
  tableShape,
  textShape,
} from "./drawing-write";

const NO_BYTES = new Uint8Array(new ArrayBuffer(0));

// The helpers read only `bytes`; shapeCount and maxSpid are the writer's own tallies and are never consulted.
function drawing(children: readonly Uint8Array<ArrayBuffer>[]): DrawingWritten {
  return {
    bytes: writeContainer(RT_Drawing, children),
    shapeCount: 0,
    maxSpid: 0,
  };
}

function shape(recInstance: number): Uint8Array<ArrayBuffer> {
  return writeContainer(OfficeArtSpContainer, [
    writeAtom(OfficeArtSpContainer, NO_BYTES, { recInstance }),
  ]);
}

const PATRIARCH = shape(0);
const CONTENT_SHAPE = shape(1);

describe("spgrChildren", () => {
  it("names the missing drawing container when RT_Drawing holds no OfficeArtDgContainer", () => {
    const written = drawing([writeContainer(OfficeArtSpgrContainer, [])]);
    expect(() => spgrChildren(written)).toThrow(
      "expected an OfficeArtDgContainer",
    );
  });

  it("names the missing shape group when the drawing container holds no OfficeArtSpgrContainer", () => {
    const written = drawing([writeContainer(OfficeArtDgContainer, [])]);
    expect(() => spgrChildren(written)).toThrow(
      "expected an OfficeArtSpgrContainer",
    );
  });

  it("returns the shape group's own children", () => {
    const written = drawing([
      writeContainer(OfficeArtDgContainer, [
        writeContainer(OfficeArtSpgrContainer, [PATRIARCH, CONTENT_SHAPE]),
      ]),
    ]);
    expect(
      spgrChildren(written).map((record) => record.header.recType),
    ).toEqual([OfficeArtSpContainer, OfficeArtSpContainer]);
  });
});

describe("firstContentShapeRecord", () => {
  it("rejects a drawing carrying the patriarch alone", () => {
    const written = drawing([
      writeContainer(OfficeArtDgContainer, [
        writeContainer(OfficeArtSpgrContainer, [PATRIARCH]),
      ]),
    ]);
    expect(() => firstContentShapeRecord(written)).toThrow(
      "expected the patriarch plus one content shape",
    );
  });

  it("skips the patriarch and returns the shape after it", () => {
    const written = drawing([
      writeContainer(OfficeArtDgContainer, [
        writeContainer(OfficeArtSpgrContainer, [PATRIARCH, CONTENT_SHAPE]),
      ]),
    ]);
    const record = firstContentShapeRecord(written);
    expect(
      readRecordAt(record.stream, record.dataOffset).header.recInstance,
    ).toBe(1);
  });
});

describe("firstTableGroupProperties", () => {
  it("names the missing table group when no nested shape group sits beside the patriarch", () => {
    const written = drawing([
      writeContainer(OfficeArtDgContainer, [
        writeContainer(OfficeArtSpgrContainer, [PATRIARCH]),
      ]),
    ]);
    expect(() => firstTableGroupProperties(written)).toThrow(
      "expected a nested table OfficeArtSpgrContainer",
    );
  });

  it("names the missing group shape when the table group is empty", () => {
    const written = drawing([
      writeContainer(OfficeArtDgContainer, [
        writeContainer(OfficeArtSpgrContainer, [
          PATRIARCH,
          writeContainer(OfficeArtSpgrContainer, []),
        ]),
      ]),
    ]);
    expect(() => firstTableGroupProperties(written)).toThrow(
      "expected the table group's own shape first",
    );
  });
});

describe("shape fixtures", () => {
  it("gives a text shape no blocks unless the caller supplies them", () => {
    expect(textShape().blocks).toEqual([]);
  });

  it("gives a table no columns unless the caller supplies widths", () => {
    const [table] = tableShape([]).blocks;
    expect(table).toEqual({ kind: "table", rows: [], columns: [] });
  });
});
