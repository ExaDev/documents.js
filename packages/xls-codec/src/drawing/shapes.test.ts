import { describe, expect, it } from "vitest";

import {
  ESCHER_CLIENT_ANCHOR,
  ESCHER_DG_CONTAINER,
  ESCHER_OPT,
} from "./escher-constants";
import { readSheetShapes } from "./shapes";
import {
  clientAnchorSheet,
  escherAtom,
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
    expect(readSheetShapes(new Uint8Array())).toStrictEqual([]);
  });

  it("returns no shapes when the stream carries no DgContainer", () => {
    const bytes = new Uint8Array(escherContainer(0xf003, 0, []));
    expect(readSheetShapes(bytes)).toStrictEqual([]);
  });

  it("selects the DgContainer among several top-level records by its own recType, not merely the first container found", () => {
    // Both this container's own kind ("container") and its lack of any real content give the same [] result whether it's wrongly picked or correctly skipped -- what actually tells the two apart is that the REAL DgContainer, found second, carries a genuine shape the wrong one never does.
    const anchor = clientAnchorSheet(0, 0, 0, 0, 1, 0, 1, 0);
    const unrelatedContainer = escherContainer(0xf999, 0, []);
    const bytes = new Uint8Array([
      ...unrelatedContainer,
      ...drawingBytes([rectangleShape(50, anchor)]),
    ]);

    expect(readSheetShapes(bytes).map((shape) => shape.spid)).toStrictEqual([
      50,
    ]);
  });

  it("excludes a top-level record that merely shares DgContainer's own recType while not being a container at all", () => {
    // The recType half of the DgContainer search alone can't rule this one out -- it genuinely carries ESCHER_DG_CONTAINER's own recType value, just on a plain ATOM instead of a container. Only requiring BOTH halves together excludes it, and doing so wrongly would try to read a container's children off an atom that has none.
    const anchor = clientAnchorSheet(0, 0, 0, 0, 1, 0, 1, 0);
    const bogusAtom = escherAtom(ESCHER_DG_CONTAINER, 0, []);
    const bytes = new Uint8Array([
      ...bogusAtom,
      ...drawingBytes([rectangleShape(51, anchor)]),
    ]);

    expect(readSheetShapes(bytes).map((shape) => shape.spid)).toStrictEqual([
      51,
    ]);
  });

  it("skips the patriarch and reads one real top-level shape", () => {
    const anchor = clientAnchorSheet(1, 100, 2, 50, 3, 200, 4, 150);
    const bytes = drawingBytes([rectangleShape(1025, anchor)]);

    const shapes = readSheetShapes(bytes);

    expect(shapes).toHaveLength(1);
    expect(shapes[0]).toStrictEqual({
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

    expect(shapes.map((shape) => shape.spid)).toStrictEqual([10, 11]);
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

    expect(shapes.map((shape) => shape.spid)).toStrictEqual([31]);
  });

  it("excludes a group child of an unrelated recType, even though it is itself a container", () => {
    // A container's own kind check alone can't rule this one out -- it genuinely IS a container, just not one of the two recTypes a shape tree ever nests. Giving it a real, well-formed Sp/anchor pair of its own (rather than leaving it empty) is what makes wrongly including it produce an EXTRA shape, rather than an empty one indistinguishable from correctly excluding it.
    const interloperAnchor = clientAnchorSheet(0, 0, 0, 0, 1, 0, 1, 0);
    const interloper = escherContainer(0xf999, 0, [
      spAtom(SHAPE_TYPE_RECTANGLE, 999, 0),
      interloperAnchor,
    ]);
    const realAnchor = clientAnchorSheet(2, 0, 2, 0, 3, 0, 3, 0);
    const bytes = drawingBytes([interloper, rectangleShape(60, realAnchor)]);

    expect(readSheetShapes(bytes).map((shape) => shape.spid)).toStrictEqual([
      60,
    ]);
  });

  it("excludes a group child that merely shares an SpContainer's own recType while not being a container at all", () => {
    // The recType half of the filter alone can't rule this one out either -- 0xf004 is genuinely SpContainer's own recType, carried here on a plain ATOM instead. Only requiring BOTH halves of the check together excludes it.
    const bogusAtom = escherAtom(0xf004, 0, []);
    const realAnchor = clientAnchorSheet(0, 0, 0, 0, 1, 0, 1, 0);
    const bytes = drawingBytes([bogusAtom, rectangleShape(61, realAnchor)]);

    expect(readSheetShapes(bytes).map((shape) => shape.spid)).toStrictEqual([
      61,
    ]);
  });

  it("skips a shape whose ClientAnchor atom is present but too short to hold every field, rather than reading past its own data", () => {
    const tooShort = escherAtom(ESCHER_CLIENT_ANCHOR, 0, [0, 0, 1, 0]); // OfficeArtClientAnchorSheet needs 18 bytes; this carries 4
    const shapeWithShortAnchor = escherContainer(0xf004, 0, [
      spAtom(SHAPE_TYPE_RECTANGLE, 70, 0),
      tooShort,
    ]);
    const validAnchor = clientAnchorSheet(0, 0, 0, 0, 1, 0, 1, 0);
    const bytes = drawingBytes([
      shapeWithShortAnchor,
      rectangleShape(71, validAnchor),
    ]);

    expect(readSheetShapes(bytes).map((shape) => shape.spid)).toStrictEqual([
      71,
    ]);
  });

  it("recovers from an Opt table whose own byte count is not a whole multiple of one FOPTE entry's size, rather than reading a torn entry off its own end", () => {
    const malformedOpt = escherAtom(ESCHER_OPT, 0, [0x04, 0x01, 0x00]); // 3 bytes: not a multiple of one entry's 6
    const anchor = clientAnchorSheet(0, 0, 0, 0, 1, 0, 1, 0);
    const shape = escherContainer(0xf004, 0, [
      spAtom(SHAPE_TYPE_PICTURE_FRAME, 80, 0),
      malformedOpt,
      anchor,
    ]);
    const bytes = drawingBytes([shape]);

    const shapes = readSheetShapes(bytes);

    expect(shapes).toHaveLength(1);
    expect(shapes[0]?.blipIndex).toBeUndefined();
  });

  it("ignores a well-formed FOPTE entry whose own opid is not pib's", () => {
    // A single-entry Opt table is otherwise indistinguishable from a real pib entry unless the opid itself is what's actually checked -- this entry is exactly as well-formed as a real pib one, just naming a different property.
    const anchor = clientAnchorSheet(0, 0, 0, 0, 1, 0, 1, 0);
    const picture = escherContainer(0xf004, 0, [
      spAtom(SHAPE_TYPE_PICTURE_FRAME, 90, 0),
      optAtom([foptEntry(0x0099, 42)]),
      anchor,
    ]);
    const bytes = drawingBytes([picture]);

    expect(readSheetShapes(bytes)[0]?.blipIndex).toBeUndefined();
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

    expect(shapes.map((shape) => shape.spid)).toStrictEqual([41]);
  });
});
