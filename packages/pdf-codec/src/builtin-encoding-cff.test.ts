import { describe, expect, it } from "vitest";
import { readFontProgramEncoding } from "./builtin-encoding";
import {
  CFF_HEADER,
  CFF_STANDARD_STRING_COUNT,
  cffIndex,
  cffFontWithBuiltinEncoding,
  cffFontWithCharstrings,
  dictInt32,
} from "./test-support/cff";
import {} from "./test-support/sfnt";

const OHM_SIGN = 0x2126; // the Adobe Glyph List's own mapping for the glyph name "Omega"

function charsetFormat0(sids: readonly number[]): number[] {
  return [0, ...sids.flatMap((sid) => [(sid >> 8) & 0xff, sid & 0xff])];
}

function rawCffFont(parts: {
  readonly header: readonly number[];
  readonly glyphNames: readonly string[];
  readonly charset: readonly number[];
  readonly encoding: readonly number[];
  readonly charstrings: readonly (readonly number[])[];
  readonly truncateAfterCharsetBytes?: number;
}): Uint8Array<ArrayBuffer> {
  const nameIndex = cffIndex([[...new TextEncoder().encode("Fixture")]]);
  const stringIndex = cffIndex(
    parts.glyphNames.map((name) => [...new TextEncoder().encode(name)]),
  );
  const topDictEntry = 3 * (dictInt32(0).length + 1); // charset, Encoding, CharStrings
  const topDictIndexSize = cffIndex([
    new Array<number>(topDictEntry).fill(0),
  ]).length;
  const prefix =
    parts.header.length +
    nameIndex.length +
    topDictIndexSize +
    stringIndex.length;

  const charstringsOffset = prefix + parts.encoding.length;
  const charsetOffset = charstringsOffset + cffIndex(parts.charstrings).length;
  const topDict = [
    ...dictInt32(charsetOffset),
    15,
    ...dictInt32(prefix),
    16,
    ...dictInt32(charstringsOffset),
    17,
  ];
  const bytes = [
    ...parts.header,
    ...nameIndex,
    ...cffIndex([topDict]),
    ...stringIndex,
    ...parts.encoding,
    ...cffIndex(parts.charstrings),
    ...parts.charset,
  ];
  const cut =
    parts.truncateAfterCharsetBytes === undefined
      ? undefined
      : charsetOffset + parts.truncateAfterCharsetBytes;
  return new Uint8Array(cut === undefined ? bytes : bytes.slice(0, cut));
}

describe("readFontProgramEncoding: CFF charset and encoding bounds", () => {
  it("reads no SID past the charstrings count under the predefined ISOAdobe charset", () => {
    // Two charstrings make glyphCount 2: glyph 1 is SID 1 (space), and there is no glyph 2.
    const program = cffFontWithCharstrings({
      name: "IsoAdobeBound",
      charStrings: [[14], [14]],
    });
    const encoding = readFontProgramEncoding(program);
    expect(encoding?.glyphIdToUnicode(1)).toBe(0x20);
    expect(encoding?.glyphIdToUnicode(2)).toBeUndefined();
  });

  it("reads no SID past the charstrings count under a format 0 charset", () => {
    const program = cffFontWithBuiltinEncoding({
      name: "Format0Bound",
      glyphNames: ["Omega", "mu", "A"],
      encoding: new Map([
        [0x57, 1],
        [0x6d, 2],
        [0x41, 3],
      ]),
    });
    // glyphCount is 4 (.notdef + 3); a fourth SID read would come from the Encoding's own bytes.
    expect(
      readFontProgramEncoding(program)?.glyphIdToUnicode(4),
    ).toBeUndefined();
  });

  it("keeps the glyphs a truncated format 0 charset did name, and names no glyph past the cut", () => {
    // Charstrings placed before the charset, which is then cut after one SID: the parser hands
    // back the partial map rather than throwing or reading past the end of the program.
    const program = rawCffFont({
      header: CFF_HEADER,
      glyphNames: ["Omega", "mu", "A"],
      charset: charsetFormat0([
        CFF_STANDARD_STRING_COUNT,
        CFF_STANDARD_STRING_COUNT + 1,
        CFF_STANDARD_STRING_COUNT + 2,
      ]),
      encoding: [0, 3, 0x57, 0x6d, 0x41],
      charstrings: [[14], [14], [14], [14]],
      truncateAfterCharsetBytes: 3, // format byte + exactly one SID
    });
    const encoding = readFontProgramEncoding(program);
    expect(encoding?.codeToUnicode(0x57)).toBe(OHM_SIGN);
    expect(encoding?.codeToUnicode(0x6d)).toBeUndefined();
    expect(encoding?.glyphIdToUnicode(3)).toBeUndefined();
  });

  it("reads a charset that lives in the header's own padding, at exactly the minimum offset", () => {
    // hdrSize 8 leaves bytes 4..7 unused by the fixed four-byte header, and a font may legally
    // point its charset operator into them: offset 4 is the smallest offset the guard permits.
    const program = rawCffFont({
      header: [1, 0, 8, 1, 0, 0, 5, 0], // bytes 4..6 are a format 0 charset naming glyph 1 as SID 5
      glyphNames: ["dollar"],
      charset: [5], // consumed from the header padding, not from here (the operator points at 4)
      encoding: [0, 0],
      charstrings: [[14], [14]],
    });
    // Patch the charset operand to 4: the raw layout placed it after the indexes.
    const patched = patchCharsetOffset(program, 4);
    expect(readFontProgramEncoding(patched)?.glyphIdToUnicode(1)).toBe(0x24);
  });

  it("refuses a charset operator pointing into the header itself, before any table", () => {
    // Offset 1 would read SIDs out of the header's own version and size bytes.
    const program = cffFontWithBuiltinEncoding({
      name: "CharsetInHeader",
      glyphNames: ["Omega", "mu"],
      encoding: new Map([
        [0x57, 1],
        [0x6d, 2],
      ]),
    });
    const patched = patchCharsetOffset(program, 1);
    const encoding = readFontProgramEncoding(patched);
    // No glyph is named (the guard rejects the offset), and nothing crashes.
    expect(encoding?.glyphIdToUnicode(1)).toBeUndefined();
    expect(encoding?.glyphIdToUnicode(2)).toBeUndefined();
  });

  it("names no glyph past the count under a format 1 charset, however the ranges split", () => {
    const program = cffFontWithBuiltinEncoding({
      name: "Format1Bound",
      glyphNames: ["Omega", "mu", "A"],
      encoding: new Map([
        [0x57, 1],
        [0x6d, 2],
        [0x41, 3],
      ]),
      charsetFormat: 1,
      charsetRangeSize: 2,
    });
    expect(
      readFontProgramEncoding(program)?.glyphIdToUnicode(4),
    ).toBeUndefined();
  });

  it("names no glyph past the count under a format 2 charset", () => {
    const program = cffFontWithBuiltinEncoding({
      name: "Format2Bound",
      glyphNames: ["Omega", "mu"],
      encoding: new Map([
        [0x57, 1],
        [0x6d, 2],
      ]),
      charsetFormat: 2,
      charsetRangeSize: 1,
    });
    expect(
      readFontProgramEncoding(program)?.glyphIdToUnicode(3),
    ).toBeUndefined();
  });

  it("keeps the glyphs a truncated format 2 charset did name", () => {
    // Cut inside the second range's 16-bit nLeft: the guard hands back a partial map instead of
    // reading the missing byte pair.
    const program = rawCffFont({
      header: CFF_HEADER,
      glyphNames: ["Omega", "mu", "A"],
      charset: [
        2,
        ...sidPair(CFF_STANDARD_STRING_COUNT),
        0,
        0, // first range covers glyph 1 only
        ...sidPair(CFF_STANDARD_STRING_COUNT + 2),
        0,
        1, // second range covers glyphs 2 and 3
      ],
      encoding: [0, 3, 0x57, 0x6d, 0x41],
      charstrings: [[14], [14], [14], [14]],
      truncateAfterCharsetBytes: 6, // format byte + first range (2+2) + the second range's SID pair only
    });
    const encoding = readFontProgramEncoding(program);
    expect(encoding?.codeToUnicode(0x57)).toBe(OHM_SIGN);
    expect(encoding?.codeToUnicode(0x6d)).toBeUndefined();
  });

  it("drops Encoding codes past the charstrings count rather than mapping them onto phantom glyphs", () => {
    // Format 0 Encoding listing three codes for a font with only two glyphs.
    const program = rawCffFont({
      header: CFF_HEADER,
      glyphNames: ["Omega", "mu"],
      charset: charsetFormat0([
        CFF_STANDARD_STRING_COUNT,
        CFF_STANDARD_STRING_COUNT + 1,
      ]),
      encoding: [0, 3, 0x57, 0x6d, 0x41],
      charstrings: [[14], [14], [14]],
    });
    const encoding = readFontProgramEncoding(program);
    expect(encoding?.codeToUnicode(0x57)).toBe(OHM_SIGN);
    expect(encoding?.codeToUnicode(0x6d)).toBe(0xb5);
    expect(encoding?.codeToUnicode(0x41)).toBeUndefined();
  });

  it("reads every range of a multi-range format 1 Encoding", () => {
    const program = cffFontWithBuiltinEncoding({
      name: "TwoRangeEncoding",
      glyphNames: ["A", "B", "C", "a", "b"],
      encoding: new Map([
        [0x41, 1],
        [0x42, 2],
        [0x43, 3],
        [0x61, 4],
        [0x62, 5],
      ]),
      encodingFormat: 1,
    });
    const encoding = readFontProgramEncoding(program);
    expect(encoding?.codeToUnicode(0x41)).toBe(0x41);
    expect(encoding?.codeToUnicode(0x43)).toBe(0x43);
    expect(encoding?.codeToUnicode(0x61)).toBe(0x61);
    expect(encoding?.codeToUnicode(0x62)).toBe(0x62);
  });

  it("keeps only the glyphs a truncated format 1 Encoding did map", () => {
    const program = rawCffFont({
      header: CFF_HEADER,
      glyphNames: ["Omega", "mu", "A"],
      charset: charsetFormat0([
        CFF_STANDARD_STRING_COUNT,
        CFF_STANDARD_STRING_COUNT + 1,
        CFF_STANDARD_STRING_COUNT + 2,
      ]),
      encoding: [1, 2, 0x57, 1, 0x6d, 0], // two ranges, then a cut before the second's data
      charstrings: [[14], [14], [14], [14]],
    });
    const truncated = new Uint8Array(program.slice(0, program.length - 2));
    const encoding = readFontProgramEncoding(truncated);
    expect(encoding?.codeToUnicode(0x57)).toBe(OHM_SIGN);
    expect(encoding?.codeToUnicode(0x6d)).toBeUndefined();
  });

  it("refuses an Encoding in a format this reader does not know, while the charset still names glyphs", () => {
    const program = rawCffFont({
      header: CFF_HEADER,
      glyphNames: ["Omega", "mu"],
      charset: charsetFormat0([
        CFF_STANDARD_STRING_COUNT,
        CFF_STANDARD_STRING_COUNT + 1,
      ]),
      encoding: [3, 0], // no format 3 exists in CFF 1.0
      charstrings: [[14], [14], [14]],
    });
    const encoding = readFontProgramEncoding(program);
    expect(encoding?.glyphIdToUnicode(1)).toBe(OHM_SIGN);
    expect(encoding?.codeToUnicode(0x57)).toBeUndefined();
  });

  it("reads several supplementary codes, and keeps the base mapping of a code whose supplement names no known SID", () => {
    // Two supplements resolve through the charset; a third names a SID no glyph carries, and its
    // code collides with a base format 0 mapping that must survive the ignored supplement.
    const program = cffFontWithBuiltinEncoding({
      name: "TwoSupplements",
      glyphNames: ["Omega", "mu"],
      encoding: new Map([
        [0x57, 1],
        [0x6d, 2],
      ]),
      encodingSupplement: [
        { code: 0x1a, sid: CFF_STANDARD_STRING_COUNT },
        { code: 0x1b, sid: CFF_STANDARD_STRING_COUNT + 1 },
        { code: 0x57, sid: 9999 }, // no glyph in this font carries SID 9999
      ],
    });
    const encoding = readFontProgramEncoding(program);
    expect(encoding?.codeToUnicode(0x1a)).toBe(OHM_SIGN);
    expect(encoding?.codeToUnicode(0x1b)).toBe(0xb5);
    expect(encoding?.codeToUnicode(0x57)).toBe(OHM_SIGN);
  });

  it("keeps the mappings a truncated supplement list did carry", () => {
    // The encoding (format 0 with a supplement list naming both glyphs) sits at the very end of
    // the program, cut inside the second supplement's three bytes: the first must survive, the
    // second must simply be absent, and nothing may throw.
    const program = rawCffFontEndingInEncoding({
      glyphNames: ["Omega", "mu"],
      charset: charsetFormat0([
        CFF_STANDARD_STRING_COUNT,
        CFF_STANDARD_STRING_COUNT + 1,
      ]),
      encoding: [
        0x80,
        1,
        0x57,
        1,
        0x1a,
        ...sidPair(CFF_STANDARD_STRING_COUNT),
        0x1b,
        ...sidPair(CFF_STANDARD_STRING_COUNT + 1),
      ],
      charstrings: [[14], [14], [14]],
      cutBytesFromEnd: 1,
    });
    const encoding = readFontProgramEncoding(program);
    expect(encoding?.codeToUnicode(0x57)).toBe(OHM_SIGN);
    expect(encoding?.codeToUnicode(0x1a)).toBe(OHM_SIGN);
    expect(encoding?.codeToUnicode(0x1b)).toBeUndefined();
  });
});

// Patches the charset operator's 32-bit operand (the first [29 b3 b2 b1 b0, 15] pair in the Top
// DICT INDEX) to `offset`, for fixtures that need a charset pointing somewhere no toolchain puts it.

// The charset-last layout's mirror, for truncation inside the ENCODING instead: charstrings and
// charset first, encoding last, optionally cut short by a whole number of trailing bytes.
function rawCffFontEndingInEncoding(parts: {
  readonly glyphNames: readonly string[];
  readonly charset: readonly number[];
  readonly encoding: readonly number[];
  readonly charstrings: readonly (readonly number[])[];
  readonly cutBytesFromEnd?: number;
}): Uint8Array<ArrayBuffer> {
  const nameIndex = cffIndex([[...new TextEncoder().encode("Fixture")]]);
  const stringIndex = cffIndex(
    parts.glyphNames.map((name) => [...new TextEncoder().encode(name)]),
  );
  const topDictEntry = 3 * (dictInt32(0).length + 1);
  const topDictIndexSize = cffIndex([
    new Array<number>(topDictEntry).fill(0),
  ]).length;
  const prefix =
    CFF_HEADER.length +
    nameIndex.length +
    topDictIndexSize +
    stringIndex.length;

  const charsetOffset = prefix + cffIndex(parts.charstrings).length;
  const encodingOffset = charsetOffset + parts.charset.length;
  const topDict = [
    ...dictInt32(charsetOffset),
    15,
    ...dictInt32(encodingOffset),
    16,
    ...dictInt32(prefix),
    17,
  ];
  const bytes = [
    ...CFF_HEADER,
    ...nameIndex,
    ...cffIndex([topDict]),
    ...stringIndex,
    ...cffIndex(parts.charstrings),
    ...parts.charset,
    ...parts.encoding,
  ];
  return new Uint8Array(
    parts.cutBytesFromEnd === undefined
      ? bytes
      : bytes.slice(0, bytes.length - parts.cutBytesFromEnd),
  );
}

function patchCharsetOffset(
  program: Uint8Array<ArrayBuffer>,
  offset: number,
): Uint8Array<ArrayBuffer> {
  const patched = new Uint8Array(program);
  for (let i = 0; i + 5 < patched.length; i++) {
    if (patched[i] === 29 && patched[i + 5] === 15) {
      patched[i + 1] = (offset >>> 24) & 0xff;
      patched[i + 2] = (offset >>> 16) & 0xff;
      patched[i + 3] = (offset >>> 8) & 0xff;
      patched[i + 4] = offset & 0xff;
      return patched;
    }
  }
  throw new Error("no charset operator found in the fixture's Top DICT");
}

function sidPair(sid: number): number[] {
  return [(sid >> 8) & 0xff, sid & 0xff];
}
