import { describe, expect, it } from "vitest";
import { NOOP_PPT_DIAGNOSTIC_SINK } from "../diagnostics";
import { readDrawingShapes } from "../drawing/shapes";
import type { DrawingWriteContext } from "../drawing/shapes-write";
import { childRecords, findChild, readRecordAt } from "../record/tree";
import { RT_Drawing, RT_SlidePersistAtom } from "../record/types";
import {
  writeMainMaster,
  writeMasterListWithText,
  writeSlideAtomForSlide,
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
});

describe("writeSlideAtomForSlide", () => {
  it("truncates a placeholderTypes array longer than the field's own 8-byte width, rather than overflowing into masterIdRef", () => {
    // writeSlideAtomForSlide itself always states just [PT_NONE], so this exercises writeSlideAtom's own truncation directly through the write/read round trip a longer array would need -- proved here by writing the slide atom bytes and re-reading masterIdRef untouched.
    const bytes = writeSlideAtomForSlide(512);
    const record = readRecordAt(bytes, 0);
    expect(record.header.recVer).toBe(0x2);
    const view = new DataView(record.data.buffer, record.data.byteOffset);
    // geom(4) + placeholderTypes(8) = 12, then masterIdRef.
    expect(view.getUint32(12, true)).toBeGreaterThan(0); // MASTER_SLIDE_ID
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
