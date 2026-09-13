import { describe, expect, it } from "vitest";
import { NOOP_PPT_DIAGNOSTIC_SINK } from "../diagnostics";
import { readDrawingShapes } from "../drawing/shapes";
import type { DrawingWriteContext } from "../drawing/shapes-write";
import {
  childRecords,
  findChild,
  findChildren,
  readRecordAt,
} from "../record/tree";
import {
  RT_Drawing,
  RT_PlaceholderAtom,
  RT_SlidePersistAtom,
  RT_TextMasterStyleAtom,
} from "../record/types";
import {
  TEXT_TYPE_BODY,
  TEXT_TYPE_NOTES,
  TEXT_TYPE_TITLE,
} from "../text/atoms";
import {
  writeMainMaster,
  writeMasterListWithText,
  writeSlideAtom,
} from "./master-write";

const CONTEXT: DrawingWriteContext = {
  fontIndexOf: () => 0,
  blipIndexOf: () => 1,
  sink: NOOP_PPT_DIAGNOSTIC_SINK,
  strict: false,
  location: "test",
};

function masterDrawingShapes(size: { widthPt: number; heightPt: number }) {
  const written = writeMainMaster(size, CONTEXT);
  const record = readRecordAt(written.bytes, 0);
  const drawingRecord = findChild(childRecords(record), RT_Drawing);
  if (drawingRecord === undefined) {
    throw new Error("expected the written MainMaster to carry a drawing");
  }
  return readDrawingShapes(drawingRecord);
}

// Points, at a page size chosen so every placeholder's own fraction produces a whole number of points: 1000 x 2000. Master units (the anchor's own unit) are 8x points.
const SIZE = { widthPt: 1000, heightPt: 2000 };
const MU = 8;

describe("writeMainMaster", () => {
  it("places the title placeholder at its own 6%-from-top, 16%-tall band", () => {
    const [title] = masterDrawingShapes(SIZE);
    if (title === undefined || !("anchor" in title)) {
      throw new Error("expected an anchored title placeholder");
    }
    // margin = 1000*0.05 = 50, contentWidth = 1000-100 = 900.
    expect(title.anchor).toEqual({
      left: 50 * MU,
      top: 2000 * 0.06 * MU,
      right: (50 + 900) * MU,
      bottom: (2000 * 0.06 + 2000 * 0.16) * MU,
    });
  });

  it("places the body placeholder at its own 26%-from-top, 60%-tall band", () => {
    const [, body] = masterDrawingShapes(SIZE);
    if (body === undefined || !("anchor" in body)) {
      throw new Error("expected an anchored body placeholder");
    }
    expect(body.anchor).toEqual({
      left: 50 * MU,
      top: 2000 * 0.26 * MU,
      right: (50 + 900) * MU,
      bottom: (2000 * 0.26 + 2000 * 0.6) * MU,
    });
  });

  it("places the three footer-row placeholders side by side along the 92%-from-top band", () => {
    const [, , left, center, right] = masterDrawingShapes(SIZE);
    if (
      left === undefined ||
      !("anchor" in left) ||
      center === undefined ||
      !("anchor" in center) ||
      right === undefined ||
      !("anchor" in right)
    ) {
      throw new Error("expected three anchored footer placeholders");
    }
    const footerColumn = 1000 * 0.28;
    const footerTop = 2000 * 0.92 * MU;
    const footerBottom = (2000 * 0.92 + 2000 * 0.05) * MU;
    expect(left.anchor).toEqual({
      left: 50 * MU,
      top: footerTop,
      right: (50 + footerColumn) * MU,
      bottom: footerBottom,
    });
    expect(center.anchor).toEqual({
      left: ((1000 - footerColumn) / 2) * MU,
      top: footerTop,
      right: ((1000 - footerColumn) / 2 + footerColumn) * MU,
      bottom: footerBottom,
    });
    expect(right.anchor).toEqual({
      left: (1000 - 50 - footerColumn) * MU,
      top: footerTop,
      right: (1000 - 50) * MU,
      bottom: footerBottom,
    });
  });

  it("writes exactly the five placeholder shapes SL_TitleBody requires, plus the patriarch", () => {
    const written = writeMainMaster(SIZE, CONTEXT);
    expect(written.shapeCount).toBe(6);
  });

  it("carries a real PlaceholderAtom on each placeholder's own client data, naming its position and placement id", () => {
    const [title, , left] = masterDrawingShapes(SIZE);
    if (
      title === undefined ||
      !("clientData" in title) ||
      title.clientData === undefined
    ) {
      throw new Error("expected the title placeholder to carry client data");
    }
    if (
      left === undefined ||
      !("clientData" in left) ||
      left.clientData === undefined
    ) {
      throw new Error(
        "expected the left footer placeholder to carry client data",
      );
    }
    const titlePlaceholder = findChild(
      childRecords(title.clientData),
      RT_PlaceholderAtom,
    );
    const leftPlaceholder = findChild(
      childRecords(left.clientData),
      RT_PlaceholderAtom,
    );
    if (titlePlaceholder === undefined || leftPlaceholder === undefined) {
      throw new Error("expected a PlaceholderAtom inside the client data");
    }
    const titleView = new DataView(
      titlePlaceholder.data.buffer,
      titlePlaceholder.data.byteOffset,
    );
    const leftView = new DataView(
      leftPlaceholder.data.buffer,
      leftPlaceholder.data.byteOffset,
    );
    // position(i32) then placementId(u8): the title is placeholder 0 with placement id PT_MASTER_TITLE (0x01); the left footer column is placeholder 2 with placement id PT_MASTER_DATE (0x07).
    expect(titleView.getInt32(0, true)).toBe(0);
    expect(titlePlaceholder.data[4]).toBe(0x01);
    expect(leftView.getInt32(0, true)).toBe(2);
    expect(leftPlaceholder.data[4]).toBe(0x07);
  });

  it("states each master TextMasterStyleAtom's own text type as its recInstance, not just cLevels 0", () => {
    const written = writeMainMaster(SIZE, CONTEXT);
    const record = readRecordAt(written.bytes, 0);
    const styleAtoms = findChildren(
      childRecords(record),
      RT_TextMasterStyleAtom,
    );
    expect(styleAtoms.map((a) => a.header.recInstance)).toEqual([
      TEXT_TYPE_TITLE,
      TEXT_TYPE_BODY,
      TEXT_TYPE_NOTES,
    ]);
  });
});

describe("writeSlideAtom", () => {
  it("truncates a placeholderTypes array longer than the field's own 8-byte width, rather than overflowing into masterIdRef", () => {
    // Uint8Array.set throws RangeError when its source is longer than the destination it targets, so a caller-supplied array longer than the field's own 8 bytes would crash outright were it not sliced down first -- this proves the slice actually runs, not just that a short array happens to fit either way.
    const bytes = writeSlideAtom({
      geom: 0,
      placeholderTypes: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      masterIdRef: 0x80000000,
      notesIdRef: 512,
      slideFlags: 0,
    });
    const record = readRecordAt(bytes, 0);
    expect(record.header.recVer).toBe(0x2);
    const view = new DataView(record.data.buffer, record.data.byteOffset);
    // geom(4) + placeholderTypes(8) = 12, then masterIdRef -- untouched by the 9th and 10th placeholder types the field has no room for.
    for (let i = 0; i < 8; i += 1) {
      expect(record.data[4 + i]).toBe(i + 1);
    }
    expect(view.getUint32(12, true)).toBe(0x80000000);
    expect(view.getUint32(16, true)).toBe(512); // notesIdRef
  });
});

describe("writeMasterListWithText", () => {
  it("writes one SlidePersistAtom naming the master's own persist id and slide id", () => {
    const bytes = writeMasterListWithText(2);
    const record = readRecordAt(bytes, 0);
    const [entry] = childRecords(record);
    if (entry?.header.recType !== RT_SlidePersistAtom) {
      throw new Error("expected one SlidePersistAtom child");
    }
    const view = new DataView(entry.data.buffer, entry.data.byteOffset);
    expect(view.getUint32(0, true)).toBe(2); // persistIdRef
    expect(view.getUint32(12, true)).toBeGreaterThanOrEqual(0x80000000); // MASTER_SLIDE_ID
  });
});
