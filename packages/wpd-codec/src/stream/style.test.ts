import { describe, expect, it } from "vitest";
import {
  isParagraphNumberDisplayOff,
  isParagraphNumberDisplayOn,
  isStyleScopeCloser,
  isStyleScopeOpener,
  readDisplayNumberLevel,
  readStyleBeginBlock,
  readSystemStyleNumber,
  styleSemanticsFor,
} from "./style";

function putUint32(bytes: number[], offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

// A Normal Style packet (type 0x30) carrying no link PID and a non-empty "beginning style text" block, laid out exactly as WPFF Prefix Packet Type 48 states: [pid count=0] [numTextBlocks=4] {relOffset} {paragraphSize} {beginSize} {endSize} {extraSize}, then whatever bytes the text-block region holds starting at relOffset.
function stylePacket(options: {
  readonly relOffset: number;
  readonly paragraphSize: number;
  readonly beginSize: number;
  readonly endSize?: number;
  readonly extraSize?: number;
  readonly totalLength: number;
  readonly beginBytes?: readonly number[];
}): Uint8Array {
  const bytes = new Array<number>(options.totalLength).fill(0);
  bytes[0] = 0; // pid count low byte
  bytes[1] = 0; // pid count high byte
  bytes[2] = 4; // number of text blocks
  bytes[3] = 0;
  putUint32(bytes, 4, options.relOffset);
  putUint32(bytes, 8, options.paragraphSize);
  putUint32(bytes, 12, options.beginSize);
  putUint32(bytes, 16, options.endSize ?? 0);
  putUint32(bytes, 20, options.extraSize ?? 0);
  if (options.beginBytes !== undefined) {
    const start = options.relOffset + options.paragraphSize;
    options.beginBytes.forEach((byte, index) => {
      bytes[start + index] = byte;
    });
  }
  return new Uint8Array(bytes);
}

function opener(systemStyleNumber: number): Uint8Array {
  // "[size of non-deletable information = 3]": "[hash of this Begin On]" then "<system style number>".
  return new Uint8Array([0x34, 0x12, systemStyleNumber]);
}

describe("readSystemStyleNumber", () => {
  it("reads the system style number after the hash", () => {
    expect(readSystemStyleNumber(opener(68))).toBe(68);
  });

  // "<system style number (-1 if normal)>", written into one byte, so the sentinel arrives as 0xFF.
  it("declines the normal-style sentinel", () => {
    expect(readSystemStyleNumber(opener(0xff))).toBeUndefined();
  });

  it("declines a function with no room for the field", () => {
    expect(readSystemStyleNumber(new Uint8Array([0x00, 0x00]))).toBeUndefined();
  });
});

describe("styleSemanticsFor", () => {
  // "68 = heading level 1 style" through "75 = heading level 8 style".
  it.each([
    [68, 1],
    [69, 2],
    [75, 8],
  ])("maps system style %i to heading level %i", (systemStyle, level) => {
    expect(styleSemanticsFor(systemStyle)).toEqual({
      headingLevel: level,
      listLevel: undefined,
    });
  });

  // "52 = level 1 style (indented)" through "59 = level 8 style (indented)", and "60 = level 1 style (not indented)" through "67 = level 8 style (not indented)". ContentListMembership counts levels from zero, so the SDK's level 1 is level 0 here.
  it.each([
    [52, 0],
    [59, 7],
    [60, 0],
    [67, 7],
  ])("maps outline system style %i to list level %i", (systemStyle, level) => {
    expect(styleSemanticsFor(systemStyle)).toEqual({
      headingLevel: undefined,
      listLevel: level,
    });
  });

  // "31 = list" and "48 = bullets" name a flat list rather than a numbered outline depth.
  it.each([31, 48])(
    "maps system style %i to the outermost list level",
    (systemStyle) => {
      expect(styleSemanticsFor(systemStyle)).toEqual({
        headingLevel: undefined,
        listLevel: 0,
      });
    },
  );

  // Every other entry the SDK enumerates -- "1 = normal", "36 = footnote", "39 = header a", "35 = caption" -- names a region whose own construct this package does not lift, so it carries no structure rather than being forced onto the nearest thing that fits.
  it.each([1, 35, 36, 39])(
    "gives system style %i no structural meaning",
    (systemStyle) => {
      expect(styleSemanticsFor(systemStyle)).toBeUndefined();
    },
  );

  // One past the heading range's own upper bound (75): every existing case above either lands inside a range or well below all of them, so nothing yet proves the heading and not-indented ranges actually stop where the SDK says they do, rather than continuing to swallow everything above their first value.
  it("gives system style 76, one past the heading range, no structural meaning", () => {
    expect(styleSemanticsFor(76)).toBeUndefined();
  });
});

describe("style scope pairing", () => {
  // "2 = Encased/paired function. Begin/On codes are mod 4=0 subfunctions ... followed immediately by Begin/Off, End/On and End/Off codes numbered consecutively", and "3 = Encased function. Begin/On codes are even subfunctions and End/Off codes are the next odd subfunction". So 0 opens and 3 closes; 4 opens and 9 closes; 10 opens and 11 closes.
  it.each([0, 4, 10])(
    "treats subfunction %i as a scope opener",
    (subfunction) => {
      expect(isStyleScopeOpener(subfunction)).toBe(true);
      expect(isStyleScopeCloser(subfunction)).toBe(false);
    },
  );

  it.each([3, 9, 11])(
    "treats subfunction %i as a scope closer",
    (subfunction) => {
      expect(isStyleScopeCloser(subfunction)).toBe(true);
      expect(isStyleScopeOpener(subfunction)).toBe(false);
    },
  );

  // The four intermediate subfunctions delimit the style's own before- and after-codes inside a region already open, so neither opens nor closes a scope of its own.
  it.each([1, 2, 5, 6, 7, 8])(
    "treats subfunction %i as neither opener nor closer",
    (subfunction) => {
      expect(isStyleScopeOpener(subfunction)).toBe(false);
      expect(isStyleScopeCloser(subfunction)).toBe(false);
    },
  );
});

describe("paragraph number display", () => {
  it("recognises the Paragraph Number Display pair", () => {
    expect(isParagraphNumberDisplayOn(0x0c)).toBe(true);
    expect(isParagraphNumberDisplayOff(0x0d)).toBe(true);
  });

  // The other members of the group display a page, chapter, box, footnote or endnote counter inside running text and carry no document structure.
  it.each([0x04, 0x0e, 0x10])(
    "does not treat subfunction %i as a paragraph number",
    (subfunction) => {
      expect(isParagraphNumberDisplayOn(subfunction)).toBe(false);
    },
  );

  // The On code itself, and an unrelated subfunction, must both fail isParagraphNumberDisplayOff -- otherwise a version that always answers true regardless of input would pass every existing check here.
  it.each([0x0c, 0x04])(
    "does not treat subfunction %i as the paragraph number display Off code",
    (subfunction) => {
      expect(isParagraphNumberDisplayOff(subfunction)).toBe(false);
    },
  );

  // "[size of non-deletable information = 1] <level number to display (0 - n)>".
  it("reads the level number to display", () => {
    expect(readDisplayNumberLevel(new Uint8Array([2]))).toBe(2);
  });
});

describe("readStyleBeginBlock", () => {
  it("reads the beginning style text block at its stated offset", () => {
    const beginBytes = [0xf2, 12, 0xf2]; // Attribute On (bold)
    const packet = stylePacket({
      relOffset: 24,
      paragraphSize: 0,
      beginSize: beginBytes.length,
      totalLength: 24 + beginBytes.length,
      beginBytes,
    });
    expect(readStyleBeginBlock(packet)).toEqual(new Uint8Array(beginBytes));
  });

  it("skips past a non-empty paragraph text block to reach the begin block", () => {
    const beginBytes = [0xf2, 12, 0xf2];
    const packet = stylePacket({
      relOffset: 24,
      paragraphSize: 5,
      beginSize: beginBytes.length,
      totalLength: 24 + 5 + beginBytes.length,
      beginBytes,
    });
    expect(readStyleBeginBlock(packet)).toEqual(new Uint8Array(beginBytes));
  });

  it("returns undefined for a style with no begin codes", () => {
    const packet = stylePacket({
      relOffset: 24,
      paragraphSize: 0,
      beginSize: 0,
      totalLength: 24,
    });
    expect(readStyleBeginBlock(packet)).toBeUndefined();
  });

  it("returns undefined rather than reading past the packet's own bytes", () => {
    const packet = stylePacket({
      relOffset: 24,
      paragraphSize: 0,
      beginSize: 100,
      totalLength: 24,
    });
    expect(readStyleBeginBlock(packet)).toBeUndefined();
  });

  it("returns undefined for a packet too short to carry the text-block header", () => {
    expect(readStyleBeginBlock(new Uint8Array([0, 0]))).toBeUndefined();
  });

  it("returns undefined for a packet too short to even hold the pid count", () => {
    expect(readStyleBeginBlock(new Uint8Array(0))).toBeUndefined();
  });

  // A pid count (60) whose doubled byte cost the packet plainly cannot afford: the overrun check must reject it using the real byte cost, not an under- or negatively-computed one that would let the walk proceed and misread bytes 30-58 past where the pid list truly ends.
  it("rejects a pid count whose doubled byte cost overruns the packet", () => {
    const bytes = new Array<number>(60).fill(0);
    bytes[0] = 60; // pid count = 60, low byte
    bytes[42] = 5; // only reachable, and only turns into a real answer, if afterPids is mis-computed
    expect(readStyleBeginBlock(new Uint8Array(bytes))).toBeUndefined();
  });
});
