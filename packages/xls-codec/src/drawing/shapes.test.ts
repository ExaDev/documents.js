import { describe, expect, it } from "vitest";

import { readSheetShapes } from "./shapes";
import {
  clientAnchorSheet,
  escherContainer,
  foptEntry,
  optAtom,
  spAtom,
} from "../test-support/escher";

const SHAPE_TYPE_RECTANGLE = 0x01;
const SHAPE_TYPE_PICTURE_FRAME = 0x4b;

/** The full DgContainer/SpgrContainer/patriarch wrapper every real MsoDrawing stream carries around its actual shapes -- patriarchBody lets each test state only the shapes it cares about. */
function drawingBytes(
  shapeContainers: readonly (readonly number[])[],
): Uint8Array<ArrayBuffer> {
  const patriarch = spAtom(SHAPE_TYPE_RECTANGLE, 1024, 0);
  return new Uint8Array(
    escherContainer(0xf002, 0, [
      escherContainer(0xf003, 0, [
        escherContainer(0xf004, 0, [patriarch]), // the patriarch's own SpContainer -- no anchor, not a real shape
        ...shapeContainers,
      ]),
    ]),
  );
}

function rectangleShape(spid: number, anchor: readonly number[]): number[] {
  return escherContainer(0xf004, 0, [
    spAtom(SHAPE_TYPE_RECTANGLE, spid, 0),
    anchor,
  ]);
}

describe("readSheetShapes", () => {
  it("returns no shapes for an empty drawing stream", () => {
    expect(readSheetShapes(new Uint8Array())).toEqual([]);
  });

  it("returns no shapes when the stream carries no DgContainer", () => {
    const bytes = new Uint8Array(escherContainer(0xf003, 0, []));
    expect(readSheetShapes(bytes)).toEqual([]);
  });

  it("skips the patriarch and reads one real top-level shape", () => {
    const anchor = clientAnchorSheet(1, 100, 2, 50, 3, 200, 4, 150);
    const bytes = drawingBytes([rectangleShape(1025, anchor)]);

    const shapes = readSheetShapes(bytes);

    expect(shapes).toHaveLength(1);
    expect(shapes[0]).toEqual({
      shapeType: SHAPE_TYPE_RECTANGLE,
      spid: 1025,
      blipIndex: undefined,
      anchor: {
        colL: 1,
        dxL: 100,
        rwT: 2,
        dyT: 50,
        colR: 3,
        dxR: 200,
        rwB: 4,
        dyB: 150,
      },
    });
  });

  it("reads multiple top-level shapes in document order", () => {
    const anchorA = clientAnchorSheet(0, 0, 0, 0, 1, 0, 1, 0);
    const anchorB = clientAnchorSheet(2, 0, 2, 0, 3, 0, 3, 0);
    const bytes = drawingBytes([
      rectangleShape(10, anchorA),
      rectangleShape(11, anchorB),
    ]);

    const shapes = readSheetShapes(bytes);

    expect(shapes.map((shape) => shape.spid)).toEqual([10, 11]);
  });

  it("resolves a picture shape's own pib property to a 1-based Blip Store index", () => {
    const anchor = clientAnchorSheet(0, 0, 0, 0, 1, 0, 1, 0);
    const picture = escherContainer(0xf004, 0, [
      spAtom(SHAPE_TYPE_PICTURE_FRAME, 20, 0),
      optAtom([foptEntry(0x0104, 3)]),
      anchor,
    ]);
    const bytes = drawingBytes([picture]);

    const shapes = readSheetShapes(bytes);

    expect(shapes[0]?.blipIndex).toBe(3);
    expect(shapes[0]?.shapeType).toBe(SHAPE_TYPE_PICTURE_FRAME);
  });

  it("skips a shape with no ClientAnchor rather than throwing", () => {
    const noAnchor = escherContainer(0xf004, 0, [
      spAtom(SHAPE_TYPE_RECTANGLE, 30, 0),
    ]);
    const anchor = clientAnchorSheet(0, 0, 0, 0, 1, 0, 1, 0);
    const bytes = drawingBytes([noAnchor, rectangleShape(31, anchor)]);

    const shapes = readSheetShapes(bytes);

    expect(shapes.map((shape) => shape.spid)).toEqual([31]);
  });

  it("recurses into a nested shape group, skipping the group's own shape record", () => {
    const groupOwnAnchor = clientAnchorSheet(0, 0, 0, 0, 5, 0, 5, 0);
    const childAnchor = clientAnchorSheet(1, 0, 1, 0, 2, 0, 2, 0);
    const nestedGroup = escherContainer(0xf003, 0, [
      escherContainer(0xf004, 0, [
        spAtom(SHAPE_TYPE_RECTANGLE, 40, 0x1), // fGroup -- the group's own shape record
        groupOwnAnchor,
      ]),
      rectangleShape(41, childAnchor),
    ]);
    const bytes = drawingBytes([nestedGroup]);

    const shapes = readSheetShapes(bytes);

    expect(shapes.map((shape) => shape.spid)).toEqual([41]);
  });
});
