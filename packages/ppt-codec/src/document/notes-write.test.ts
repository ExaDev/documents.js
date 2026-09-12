import { describe, expect, it } from "vitest";
import { NOOP_PPT_DIAGNOSTIC_SINK } from "../diagnostics";
import type { DrawingWriteContext } from "../drawing/shapes-write";
import { readDrawingShapes } from "../drawing/shapes";
import { childRecords, findChild, readRecordAt } from "../record/tree";
import { RT_Drawing, RT_NotesAtom } from "../record/types";
import { writeNotesAtom, writeNotesContainer } from "./notes-write";

const CONTEXT: DrawingWriteContext = {
  fontIndexOf: () => 0,
  blipIndexOf: () => 1,
  sink: NOOP_PPT_DIAGNOSTIC_SINK,
  strict: false,
  location: "test",
};

describe("writeNotesAtom", () => {
  it("stamps recVer 0x1, which [MS-PPT] 2.5.7 mandates of a NotesAtom", () => {
    const bytes = writeNotesAtom(256);
    const record = readRecordAt(bytes, 0);
    expect(record.header.recVer).toBe(0x1);
    expect(record.header.recType).toBe(RT_NotesAtom);
  });

  it("names the slide the notes belong to and leaves every inheritance flag clear", () => {
    const bytes = writeNotesAtom(0x0104);
    const record = readRecordAt(bytes, 0);
    const view = new DataView(record.data.buffer, record.data.byteOffset);
    expect(view.getUint32(0, true)).toBe(0x0104);
    expect(view.getUint16(4, true)).toBe(0);
  });
});

function notesDrawingShapes(bytes: Uint8Array<ArrayBuffer>) {
  const record = readRecordAt(bytes, 0);
  const drawingRecord = findChild(childRecords(record), RT_Drawing);
  if (drawingRecord === undefined) {
    throw new Error("expected the written NotesContainer to carry a drawing");
  }
  return readDrawingShapes(drawingRecord);
}

describe("writeNotesContainer", () => {
  it("anchors the notes body in the lower half of the notes page, inset from every edge", () => {
    const written = writeNotesContainer(
      256,
      "Some notes",
      { widthPt: 720, heightPt: 540 },
      CONTEXT,
    );
    const [shape] = notesDrawingShapes(written.bytes);
    if (shape === undefined || !("anchor" in shape)) {
      throw new Error("expected one anchored shape");
    }
    // Points: 5% of 720 = 36, 50% of 540 = 270, right = 720 - 36 = 684, height = 540 - 270 - 27 = 243 so bottom = 270 + 243 = 513. Master units are 8x points ([MS-PPT]'s 1/576in unit against a 1/72in point).
    expect(shape.anchor).toEqual({
      left: 36 * 8,
      top: 270 * 8,
      right: 684 * 8,
      bottom: 513 * 8,
    });
  });

  it("splits multi-line notes into one paragraph per line", () => {
    const written = writeNotesContainer(
      256,
      "First point\nSecond point",
      { widthPt: 720, heightPt: 540 },
      CONTEXT,
    );
    const [shape] = notesDrawingShapes(written.bytes);
    if (shape === undefined || !("clientTextbox" in shape)) {
      throw new Error("expected one shape with a client textbox");
    }
    expect(shape.clientTextbox).toBeDefined();
  });

  it("counts the one shape it wrote and reports its spid in maxSpid", () => {
    const written = writeNotesContainer(
      256,
      "Some notes",
      { widthPt: 720, heightPt: 540 },
      CONTEXT,
    );
    // 2: the outermost patriarch group every drawing carries, plus the one notes body shape.
    expect(written.shapeCount).toBe(2);
    expect(written.maxSpid).toBeGreaterThan(0);
  });
});
