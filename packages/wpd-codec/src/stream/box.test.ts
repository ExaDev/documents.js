import { describe, expect, it } from "vitest";
import { BOX_CONTENT_TYPE_TEXT, readBoxContent } from "./box";

function putUint16(bytes: number[], offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
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
});
