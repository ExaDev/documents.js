import { describe, expect, it } from "vitest";
import { pointsFromWpu as pointsFromWpuForTest } from "./units";
import {
  BOX_CONTENT_TYPE_IMAGE,
  BOX_CONTENT_TYPE_TEXT,
  readBoxContent,
} from "./box";

function putUint16(bytes: number[], offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
}

function word16(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff];
}

// Builds a box function's own `nonDeletable` bytes: 14 reserved, [override+wrap size], [override size], [override flags], then each set bit's own [size]<data> block in descending bit order.
function boxNonDeletable(options: {
  readonly overrideFlags: number;
  readonly blocks: ReadonlyMap<number, readonly number[]>;
}): Uint8Array {
  const bytes = new Array<number>(14 + 2 + 2).fill(0);
  putUint16(bytes, 18, options.overrideFlags);
  for (let bit = 15; bit >= 5; bit -= 1) {
    const data = options.blocks.get(bit);
    if (data === undefined) {
      continue;
    }
    putUint16(bytes, bytes.length, data.length);
    bytes.push(...data);
  }
  // total override+wrap size and total override size (not read by readBoxContent, left as 0)
  return new Uint8Array(bytes);
}

// A content override block, per WPFF_DF-BOX.htm's own nested layout: [content override flags] with bit14 (content type override) set, then the content type byte.
function contentBlock(contentType: number): number[] {
  const flags = new Array<number>(2);
  putUint16(flags, 0, 0x4000); // bit 14 only
  return [...flags, contentType];
}

// A position override block with width and height overridden (bits 11 and 10), and no horizontal/vertical offset.
function positionBlockWidthHeight(
  widthWpu: number,
  heightWpu: number,
): number[] {
  const flags = new Array<number>(2);
  putUint16(flags, 0, 0x0c00); // bits 11 and 10
  const width = [0, 0, 0]; // <width flags = fixed>[width]
  putUint16(width, 1, widthWpu);
  const height = [0, 0, 0]; // <height flags = fixed>[height]
  putUint16(height, 1, heightWpu);
  return [...flags, ...width, ...height];
}

describe("readBoxContent", () => {
  it("resolves content type and prefix ID when no counter PID precedes it", () => {
    const nonDeletable = boxNonDeletable({
      overrideFlags: 0x2000, // bit 13: content
      blocks: new Map([[13, contentBlock(BOX_CONTENT_TYPE_TEXT)]]),
    });
    const result = readBoxContent(nonDeletable, [41, 42]); // [template, contents]
    expect(result?.contentType).toBe(BOX_CONTENT_TYPE_TEXT);
    expect(result?.contentPrefixId).toBe(42);
  });

  it("shifts the content PID past a counter PID when the counter bit is also set", () => {
    const nonDeletable = boxNonDeletable({
      overrideFlags: 0xa000, // bits 15 (counter) and 13 (content)
      blocks: new Map([
        [15, [0, 0, 0]], // arbitrary counter override bytes, not read
        [13, contentBlock(BOX_CONTENT_TYPE_TEXT)],
      ]),
    });
    const result = readBoxContent(nonDeletable, [41, 99, 42]); // [template, counter, contents]
    expect(result?.contentPrefixId).toBe(42);
  });

  it("returns undefined for a box with no content override at all", () => {
    const nonDeletable = boxNonDeletable({
      overrideFlags: 0,
      blocks: new Map(),
    });
    expect(readBoxContent(nonDeletable, [41])).toBeUndefined();
  });

  it("resolves width and height from a position override, defaulting an unresolved offset to 0", () => {
    const nonDeletable = boxNonDeletable({
      overrideFlags: 0x6000, // bits 14 (position) and 13 (content)
      blocks: new Map([
        [14, positionBlockWidthHeight(1200, 600)], // 1200 WPU = 72pt, 600 WPU = 36pt
        [13, contentBlock(BOX_CONTENT_TYPE_TEXT)],
      ]),
    });
    const result = readBoxContent(nonDeletable, [41, 42]);
    expect(result?.frame).toEqual({
      xPt: 0,
      yPt: 0,
      widthPt: 72,
      heightPt: 36,
      positionResolved: false,
    });
  });

  it("leaves frame undefined when the position override states no width or height", () => {
    const nonDeletable = boxNonDeletable({
      overrideFlags: 0x2000,
      blocks: new Map([[13, contentBlock(BOX_CONTENT_TYPE_TEXT)]]),
    });
    const result = readBoxContent(nonDeletable, [41, 42]);
    expect(result?.frame).toBeUndefined();
  });

  // A stated bit (5) below the three this module names (counter, position, content). Nothing here ever reads its own block, but the walk must still correctly reject a function whose bit-5 block itself declares a corrupt, overrunning size -- not silently skip straight past it to whatever content override happens to sit earlier in the same function.
  it("rejects the whole function when a walked-but-unread bit (5) declares an overrunning size, even though a valid content override precedes it", () => {
    const nonDeletable = boxNonDeletable({
      overrideFlags: 0x2020, // bit 13 (content) and bit 5
      blocks: new Map([
        [13, contentBlock(BOX_CONTENT_TYPE_TEXT)],
        [5, [0]], // any single byte; only its (lying) size prefix matters below
      ]),
    });
    // Overwrite bit 5's own size prefix (the two bytes just before its one data byte) to claim far more than remains.
    nonDeletable[nonDeletable.length - 3] = 0xe8;
    nonDeletable[nonDeletable.length - 2] = 0x03;
    expect(readBoxContent(nonDeletable, [41, 42])).toBeUndefined();
  });

  it("skips bit 7 (HTML) without trying to read an inline size-prefixed block for it", () => {
    const nonDeletable = boxNonDeletable({
      overrideFlags: 0x2080, // bit 13 (content) and bit 7 (HTML, no inline data)
      blocks: new Map([[13, contentBlock(BOX_CONTENT_TYPE_TEXT)]]),
    });
    const result = readBoxContent(nonDeletable, [41, 42]);
    expect(result?.contentType).toBe(BOX_CONTENT_TYPE_TEXT);
  });

  it("rejects a function that states a content override bit with no block data at all", () => {
    const nonDeletable = boxNonDeletable({
      overrideFlags: 0x2000, // claims bit 13, but no block is supplied below
      blocks: new Map(),
    });
    expect(readBoxContent(nonDeletable, [41, 42])).toBeUndefined();
  });

  // A content override whose own stated size lies far beyond the function's true extent: the walk must refuse it outright, never let a lying size borrow whatever real bytes happen to follow within the function's own true bounds as if they belonged to this block.
  it("never lets a content override with a lying, oversized declaration borrow real trailing bytes", () => {
    const nonDeletable = new Array<number>(14 + 2 + 2).fill(0);
    putUint16(nonDeletable, 18, 0x2000); // bit 13 (content)
    putUint16(nonDeletable, nonDeletable.length, 100); // lying size: 100
    nonDeletable.push(...contentBlock(BOX_CONTENT_TYPE_IMAGE)); // 3 real bytes, far short of 100
    expect(
      readBoxContent(new Uint8Array(nonDeletable), [41, 42]),
    ).toBeUndefined();
  });

  it("rejects a content override block too short to even hold its own flags word", () => {
    const nonDeletable = boxNonDeletable({
      overrideFlags: 0x2000,
      blocks: new Map([[13, [0x40]]]), // one byte: too short for the two-byte flags word
    });
    expect(readBoxContent(nonDeletable, [41, 42])).toBeUndefined();
  });

  // The content block's own PID-flags skip (bit 15) must consume exactly two bytes before the type byte, not zero -- otherwise the type ends up misread as the first byte of what was actually the PID data.
  it("reads the type byte after the content block's own PID-flags skip, not before it", () => {
    const nonDeletable = boxNonDeletable({
      overrideFlags: 0x2000,
      blocks: new Map([
        [
          13,
          [
            0x00,
            0xc0, // content flags: bit 15 (PID) and bit 14 (type override)
            0x99,
            0x99, // PID data, skipped
            BOX_CONTENT_TYPE_IMAGE,
          ],
        ],
      ]),
    });
    const result = readBoxContent(nonDeletable, [41, 42]);
    expect(result?.contentType).toBe(BOX_CONTENT_TYPE_IMAGE);
  });

  it("declines a content block whose own bit 14 (type override) is not set", () => {
    const nonDeletable = boxNonDeletable({
      overrideFlags: 0x2000,
      blocks: new Map([[13, [0x00, 0x00, BOX_CONTENT_TYPE_IMAGE]]]),
    });
    expect(readBoxContent(nonDeletable, [41, 42])).toBeUndefined();
  });

  it("rejects a position override block too short to even hold its own flags word", () => {
    const nonDeletable = boxNonDeletable({
      overrideFlags: 0x6000,
      blocks: new Map([
        [14, [0x00]], // one byte: too short for the two-byte flags word
        [13, contentBlock(BOX_CONTENT_TYPE_TEXT)],
      ]),
    });
    expect(readBoxContent(nonDeletable, [41, 42])?.frame).toBeUndefined();
  });

  it("declines a horizontal-position sub-block with no room for its own five bytes", () => {
    const nonDeletable = boxNonDeletable({
      overrideFlags: 0x6000,
      blocks: new Map([
        // bit 13 (horizontal) claimed: flags word, then one more byte -- not even the three (flags, offset) this code actually reads, let alone the declared five.
        [14, [0x00, 0x20, 0]],
        [13, contentBlock(BOX_CONTENT_TYPE_TEXT)],
      ]),
    });
    expect(readBoxContent(nonDeletable, [41, 42])?.frame).toBeUndefined();
  });

  it("declines a vertical-position sub-block with no room for its own three bytes", () => {
    const nonDeletable = boxNonDeletable({
      overrideFlags: 0x6000,
      blocks: new Map([
        [14, [0x00, 0x10, 0]], // bit 12 (vertical) claimed, only 1 of its 3 bytes present
        [13, contentBlock(BOX_CONTENT_TYPE_TEXT)],
      ]),
    });
    expect(readBoxContent(nonDeletable, [41, 42])?.frame).toBeUndefined();
  });

  it("declines a width sub-block with no room for its own three bytes", () => {
    const nonDeletable = boxNonDeletable({
      overrideFlags: 0x6000,
      blocks: new Map([
        [14, [0x00, 0x08, 0]], // bit 11 (width) claimed, only 1 of its 3 bytes present
        [13, contentBlock(BOX_CONTENT_TYPE_TEXT)],
      ]),
    });
    expect(readBoxContent(nonDeletable, [41, 42])?.frame).toBeUndefined();
  });

  it("declines a height sub-block with no room for its own three bytes", () => {
    const nonDeletable = boxNonDeletable({
      overrideFlags: 0x6000,
      blocks: new Map([
        [14, [0x00, 0x04, 0]], // bit 10 (height) claimed, only 1 of its 3 bytes present
        [13, contentBlock(BOX_CONTENT_TYPE_TEXT)],
      ]),
    });
    expect(readBoxContent(nonDeletable, [41, 42])?.frame).toBeUndefined();
  });

  // Every optional position sub-block set at once, each with a distinct value, so a wrong cursor advance anywhere throws reading a later field rather than silently landing on a coincidentally-plausible one.
  it("resolves every position sub-block together, each reading its own bytes rather than a neighbour's", () => {
    const positionData = [
      0x00,
      0xaa, // PID flags (bit 15), skipped -- 2 bytes
      0x00,
      0xbb, // general flags (bit 14), skipped -- 2 bytes
      0x00,
      ...word16(1000),
      0,
      0, // horizontal (bit 13): flags=0 (absolute), offset=1000, leftcol, rightcol
      0x00,
      ...word16(500), // vertical (bit 12): flags=0 (absolute), offset=500
      0x00,
      ...word16(1200), // width (bit 11): flags, width=1200
      0x00,
      ...word16(600), // height (bit 10): flags, height=600
    ];
    const nonDeletable = boxNonDeletable({
      overrideFlags: 0x6000, // bit 14 (position) and bit 13 (content)
      blocks: new Map([
        [14, [0x00, 0xfc, ...positionData]], // bits 15,14,13,12,11,10 all set
        [13, contentBlock(BOX_CONTENT_TYPE_TEXT)],
      ]),
    });
    const result = readBoxContent(nonDeletable, [41, 42]);
    expect(result?.frame).toEqual({
      xPt: pointsFromWpuForTest(1000),
      yPt: pointsFromWpuForTest(500),
      widthPt: pointsFromWpuForTest(1200),
      heightPt: pointsFromWpuForTest(600),
      positionResolved: true,
    });
  });

  // Width and height are also set here (unlike a bare "no other bits set" case), because frame is only ever computed at all once both are defined -- otherwise a version that wrongly resolved x regardless of the offset's own type would still report frame: undefined, for the unrelated reason that width and height were never supplied, and the bug would go unnoticed.
  it("does not resolve x from a horizontal offset whose own type is not absolute-from-page", () => {
    const nonDeletable = boxNonDeletable({
      overrideFlags: 0x6000,
      blocks: new Map([
        [
          14,
          [
            0x00,
            0x2c, // bits 13 (horizontal), 11 (width), 10 (height)
            0x01,
            ...word16(1000),
            0,
            0, // horizontal flags = 1 (not absolute), offset = 1000
            0x00,
            ...word16(1200), // width
            0x00,
            ...word16(600), // height
          ],
        ],
        [13, contentBlock(BOX_CONTENT_TYPE_TEXT)],
      ]),
    });
    const result = readBoxContent(nonDeletable, [41, 42]);
    expect(result?.frame).toEqual({
      xPt: pointsFromWpuForTest(0),
      yPt: pointsFromWpuForTest(0),
      widthPt: pointsFromWpuForTest(1200),
      heightPt: pointsFromWpuForTest(600),
      positionResolved: false,
    });
  });

  it("does not resolve y from a vertical offset whose own type is not absolute-from-page", () => {
    const nonDeletable = boxNonDeletable({
      overrideFlags: 0x6000,
      blocks: new Map([
        [
          14,
          [
            0x00,
            0x1c, // bits 12 (vertical), 11 (width), 10 (height)
            0x01,
            ...word16(500), // vertical flags = 1 (not absolute), offset = 500
            0x00,
            ...word16(1200), // width
            0x00,
            ...word16(600), // height
          ],
        ],
        [13, contentBlock(BOX_CONTENT_TYPE_TEXT)],
      ]),
    });
    const result = readBoxContent(nonDeletable, [41, 42]);
    expect(result?.frame).toEqual({
      xPt: pointsFromWpuForTest(0),
      yPt: pointsFromWpuForTest(0),
      widthPt: pointsFromWpuForTest(1200),
      heightPt: pointsFromWpuForTest(600),
      positionResolved: false,
    });
  });

  // Exactly one of x/y resolved -- the existing "full house" test resolves both, which cannot tell positionResolved's && from ||, and neither non-absolute case above ever reaches this field at all (frame's xWpu/yWpu stay undefined there for an unrelated reason upstream).
  it("reports positionResolved false when only x resolved, not just when neither did", () => {
    const nonDeletable = boxNonDeletable({
      overrideFlags: 0x6000,
      blocks: new Map([
        [
          14,
          [
            0x00,
            0x2c, // bits 13 (horizontal, absolute), 11 (width), 10 (height)
            0x00,
            ...word16(1000),
            0,
            0,
            0x00,
            ...word16(1200),
            0x00,
            ...word16(600),
          ],
        ],
        [13, contentBlock(BOX_CONTENT_TYPE_TEXT)],
      ]),
    });
    expect(
      readBoxContent(nonDeletable, [41, 42])?.frame?.positionResolved,
    ).toBe(false);
  });

  it("reports positionResolved false when only y resolved, not just when neither did", () => {
    const nonDeletable = boxNonDeletable({
      overrideFlags: 0x6000,
      blocks: new Map([
        [
          14,
          [
            0x00,
            0x1c, // bits 12 (vertical, absolute), 11 (width), 10 (height)
            0x00,
            ...word16(500),
            0x00,
            ...word16(1200),
            0x00,
            ...word16(600),
          ],
        ],
        [13, contentBlock(BOX_CONTENT_TYPE_TEXT)],
      ]),
    });
    expect(
      readBoxContent(nonDeletable, [41, 42])?.frame?.positionResolved,
    ).toBe(false);
  });

  // Width is not set in the override flags at all; the walk must never read a phantom width from bytes that in fact belong entirely to the (genuinely set) height sub-block, even when there happen to be enough trailing bytes for such a misread to succeed silently.
  it("never resolves a width the position override never actually stated", () => {
    const nonDeletable = boxNonDeletable({
      overrideFlags: 0x6000,
      blocks: new Map([
        [
          14,
          [
            0x00,
            0x04, // bit 10 (height) only -- bit 11 (width) is NOT set
            0x00,
            ...word16(999), // would-be phantom width source
            0x00,
            ...word16(500), // the real height data, once correctly reached
          ],
        ],
        [13, contentBlock(BOX_CONTENT_TYPE_TEXT)],
      ]),
    });
    expect(readBoxContent(nonDeletable, [41, 42])?.frame).toBeUndefined();
  });

  // Height is not set in the override flags at all; the mirror image of the width case above.
  it("never resolves a height the position override never actually stated", () => {
    const nonDeletable = boxNonDeletable({
      overrideFlags: 0x6000,
      blocks: new Map([
        [
          14,
          [
            0x00,
            0x08, // bit 11 (width) only -- bit 10 (height) is NOT set
            0x00,
            ...word16(999), // would-be phantom height source
            0x00,
            ...word16(1200), // the real width data, once correctly reached
          ],
        ],
        [13, contentBlock(BOX_CONTENT_TYPE_TEXT)],
      ]),
    });
    expect(readBoxContent(nonDeletable, [41, 42])?.frame).toBeUndefined();
  });
});
