import { describe, expect, it } from "vitest";
import { readRecordAt } from "../record/tree";
import {
  OfficeArtChildAnchor,
  OfficeArtClientAnchor,
  OfficeArtClientTextbox,
  OfficeArtDgContainer,
  OfficeArtFSP,
  OfficeArtSpContainer,
  OfficeArtSpgrContainer,
  RT_Drawing,
  RT_TextBytesAtom,
} from "../record/types";
import {
  asciiBytes,
  atom,
  concatBytes,
  container,
  i16le,
  i32le,
  u32le,
} from "../test-support/records";
import { readDrawingShapes } from "./shapes";

// OfficeArtFSPGR ([MS-ODRAW] 2.2.38): recVer 0x1, recLen 0x10, then xLeft/yTop/xRight/yBottom as signed 32-bit integers. https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/82d2d6a1-3a7a-4d15-9803-33145a76545a
const OfficeArtFSPGR = 0xf009;

// [MS-ODRAW] 2.2.40 OfficeArtFSP: spid then a flags word whose bits are, in order, fGroup, fChild, fPatriarch, fDeleted, ...
const FSP_GROUP = 1 << 0;
const FSP_PATRIARCH = 1 << 2;
const FSP_DELETED = 1 << 3;

function fsp(spid: number, flags: number): Uint8Array<ArrayBuffer> {
  return atom(OfficeArtFSP, concatBytes(u32le(spid), u32le(flags)), {
    recVer: 0x2,
  });
}

function fspgr(
  xLeft: number,
  yTop: number,
  xRight: number,
  yBottom: number,
): Uint8Array<ArrayBuffer> {
  return atom(
    OfficeArtFSPGR,
    concatBytes(i32le(xLeft), i32le(yTop), i32le(xRight), i32le(yBottom)),
    { recVer: 0x1 },
  );
}

// [MS-PPT] 2.7.1 OfficeArtClientAnchor with recLen 0x8: a SmallRectStruct, whose fields are top, left, right, bottom -- not left, top, right, bottom. https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/e47cb973-8480-4995-90b2-008bcb2ffc65
function smallClientAnchor(
  top: number,
  left: number,
  right: number,
  bottom: number,
): Uint8Array<ArrayBuffer> {
  return atom(
    OfficeArtClientAnchor,
    concatBytes(i16le(top), i16le(left), i16le(right), i16le(bottom)),
  );
}

function largeClientAnchor(
  top: number,
  left: number,
  right: number,
  bottom: number,
): Uint8Array<ArrayBuffer> {
  return atom(
    OfficeArtClientAnchor,
    concatBytes(i32le(top), i32le(left), i32le(right), i32le(bottom)),
  );
}

function childAnchor(
  xLeft: number,
  yTop: number,
  xRight: number,
  yBottom: number,
): Uint8Array<ArrayBuffer> {
  return atom(
    OfficeArtChildAnchor,
    concatBytes(i32le(xLeft), i32le(yTop), i32le(xRight), i32le(yBottom)),
  );
}

function clientTextbox(text: string): Uint8Array<ArrayBuffer> {
  return container(OfficeArtClientTextbox, [
    atom(RT_TextBytesAtom, asciiBytes(text)),
  ]);
}

function drawing(
  ...spgrChildren: readonly Uint8Array<ArrayBuffer>[]
): Uint8Array<ArrayBuffer> {
  return container(RT_Drawing, [
    container(OfficeArtDgContainer, [
      container(OfficeArtSpgrContainer, [
        // The patriarch: every drawing's outermost group, whose own OfficeArtSpContainer carries the drawing-level shape info rather than any content.
        container(OfficeArtSpContainer, [
          fspgr(0, 0, 0, 0),
          fsp(1, FSP_GROUP | FSP_PATRIARCH),
        ]),
        ...spgrChildren,
      ]),
    ]),
  ]);
}

function shapesOf(
  bytes: Uint8Array<ArrayBuffer>,
): ReturnType<typeof readDrawingShapes> {
  return readDrawingShapes(readRecordAt(bytes, 0));
}

describe("readDrawingShapes", () => {
  it("reads a top-level shape's anchor from its 8-byte SmallRectStruct client anchor", () => {
    const bytes = drawing(
      container(OfficeArtSpContainer, [
        fsp(2, 0),
        smallClientAnchor(0x00ad, 0x0120, 0x1560, 0x037d),
      ]),
    );
    expect(shapesOf(bytes)[0]?.anchor).toEqual({
      left: 0x0120,
      top: 0x00ad,
      right: 0x1560,
      bottom: 0x037d,
    });
  });

  it("reads the 16-byte RectStruct client anchor the same way", () => {
    const bytes = drawing(
      container(OfficeArtSpContainer, [
        fsp(2, 0),
        largeClientAnchor(100, 200, 900, 700),
      ]),
    );
    expect(shapesOf(bytes)[0]?.anchor).toEqual({
      left: 200,
      top: 100,
      right: 900,
      bottom: 700,
    });
  });

  it("keeps the shape's client textbox, where its text records live", () => {
    const bytes = drawing(
      container(OfficeArtSpContainer, [
        fsp(2, 0),
        smallClientAnchor(0, 0, 100, 50),
        clientTextbox("Hello"),
      ]),
    );
    const [shape] = shapesOf(bytes);
    expect(shape?.spid).toBe(2);
    expect(shape?.clientTextbox?.header.recType).toBe(OfficeArtClientTextbox);
  });

  it("leaves the anchor undefined for a shape carrying neither anchor record", () => {
    const bytes = drawing(container(OfficeArtSpContainer, [fsp(2, 0)]));
    expect(shapesOf(bytes)[0]?.anchor).toBeUndefined();
  });

  it("skips the patriarch's own shape container, which holds drawing info rather than content", () => {
    const bytes = drawing(
      container(OfficeArtSpContainer, [
        fsp(2, 0),
        smallClientAnchor(0, 0, 10, 10),
      ]),
    );
    expect(shapesOf(bytes).map((s) => s.spid)).toEqual([2]);
  });

  it("skips a shape flagged deleted", () => {
    const bytes = drawing(
      container(OfficeArtSpContainer, [
        fsp(2, FSP_DELETED),
        smallClientAnchor(0, 0, 10, 10),
      ]),
      container(OfficeArtSpContainer, [
        fsp(3, 0),
        smallClientAnchor(0, 0, 10, 10),
      ]),
    );
    expect(shapesOf(bytes).map((s) => s.spid)).toEqual([3]);
  });

  it("maps a grouped shape's child anchor through the group's own coordinate system", () => {
    // The group occupies slide rectangle (1000,2000)-(3000,4000) and declares a child coordinate space of (0,0)-(100,100), so a child at (50,50)-(100,100) in that space lands in the lower-right quarter of the group.
    const bytes = drawing(
      container(OfficeArtSpgrContainer, [
        container(OfficeArtSpContainer, [
          fspgr(0, 0, 100, 100),
          fsp(10, FSP_GROUP),
          largeClientAnchor(2000, 1000, 3000, 4000),
        ]),
        container(OfficeArtSpContainer, [
          fsp(11, 0),
          childAnchor(50, 50, 100, 100),
        ]),
      ]),
    );
    expect(shapesOf(bytes)[0]?.anchor).toEqual({
      left: 2000,
      top: 3000,
      right: 3000,
      bottom: 4000,
    });
  });

  it("uses a grouped shape's own client anchor unchanged, since that is already in slide coordinates", () => {
    const bytes = drawing(
      container(OfficeArtSpgrContainer, [
        container(OfficeArtSpContainer, [
          fspgr(0, 0, 100, 100),
          fsp(10, FSP_GROUP),
          largeClientAnchor(2000, 1000, 3000, 4000),
        ]),
        container(OfficeArtSpContainer, [
          fsp(11, 0),
          largeClientAnchor(7, 8, 9, 10),
        ]),
      ]),
    );
    expect(shapesOf(bytes)[0]?.anchor).toEqual({
      left: 8,
      top: 7,
      right: 9,
      bottom: 10,
    });
  });

  it("composes nested group coordinate systems rather than only the innermost", () => {
    // Outer group: slide (0,0)-(1000,1000), child space (0,0)-(100,100), so the inner group's (0,0)-(50,50) is slide (0,0)-(500,500). The inner group declares child space (0,0)-(10,10), so its child at (5,5)-(10,10) lands at slide (250,250)-(500,500).
    const bytes = drawing(
      container(OfficeArtSpgrContainer, [
        container(OfficeArtSpContainer, [
          fspgr(0, 0, 100, 100),
          fsp(10, FSP_GROUP),
          largeClientAnchor(0, 0, 1000, 1000),
        ]),
        container(OfficeArtSpgrContainer, [
          container(OfficeArtSpContainer, [
            fspgr(0, 0, 10, 10),
            fsp(11, FSP_GROUP),
            childAnchor(0, 0, 50, 50),
          ]),
          container(OfficeArtSpContainer, [
            fsp(12, 0),
            childAnchor(5, 5, 10, 10),
          ]),
        ]),
      ]),
    );
    expect(shapesOf(bytes)[0]?.anchor).toEqual({
      left: 250,
      top: 250,
      right: 500,
      bottom: 500,
    });
  });

  it("reads shapes sitting directly in the drawing container alongside the patriarch group", () => {
    const bytes = container(RT_Drawing, [
      container(OfficeArtDgContainer, [
        container(OfficeArtSpgrContainer, [
          container(OfficeArtSpContainer, [
            fspgr(0, 0, 0, 0),
            fsp(1, FSP_GROUP | FSP_PATRIARCH),
          ]),
        ]),
        container(OfficeArtSpContainer, [
          fsp(4, 0),
          smallClientAnchor(1, 2, 3, 4),
        ]),
      ]),
    ]);
    expect(shapesOf(bytes).map((s) => s.spid)).toEqual([4]);
  });

  it("returns nothing for a drawing with no OfficeArtDgContainer", () => {
    expect(shapesOf(container(RT_Drawing, []))).toEqual([]);
  });
});
