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
import { buildPostV3Table, buildSfnt } from "./test-support/sfnt";

const OHM_SIGN = 0x2126; // the Adobe Glyph List's own mapping for the glyph name "Omega"

function textBytes(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text);
}

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
function sidPair(sid: number): number[] {
  return [(sid >> 8) & 0xff, sid & 0xff];
}
describe("readFontProgramEncoding: Type 1 header scanning", () => {
  it("refuses a program that does not open with the PostScript magic, however encodeable its body", () => {
    const program = textBytes(
      [
        "not-postscript-at-all",
        "/Encoding 256 array",
        "dup 87 /Omega put",
        "def",
      ].join("\n"),
    );
    expect(readFontProgramEncoding(program)).toBeUndefined();
  });

  it("refuses a PostScript program whose header names no /Encoding at all", () => {
    const program = textBytes(
      [
        "%!PS-AdobeFont-1.0: Unencoded 001.000",
        "dup 87 /Omega put",
        "currentfile eexec",
        "",
      ].join("\n"),
    );
    expect(readFontProgramEncoding(program)).toBeUndefined();
  });

  it("refuses a header that names /Encoding but lists no assignments", () => {
    const program = textBytes(
      [
        "%!PS-AdobeFont-1.0: EmptyArray 001.000",
        "/Encoding 256 array",
        "readonly def",
        "currentfile eexec",
        "",
      ].join("\n"),
    );
    expect(readFontProgramEncoding(program)).toBeUndefined();
  });

  it("stops the cleartext at an eexec embedded inside a glyph name, dropping anything after it", () => {
    // The terminator scan is a plain substring match, so "freexecx" ends the cleartext header:
    // the assignment before it survives and the one after the real eexec must never be read.
    const program = textBytes(
      [
        "%!PS-AdobeFont-1.0: Tricky 001.000",
        "/Encoding 256 array",
        "dup 87 /freexecx put",
        "currentfile eexec",
        "dup 88 /W put",
      ].join("\n"),
    );
    const encoding = readFontProgramEncoding(program);
    expect(encoding?.codeToUnicode(0x58)).toBeUndefined();
  });

  it("matches the StandardEncoding spelling across repeated whitespace", () => {
    // The regex's own \\s+ spans any run of blanks between the three tokens.
    const program = textBytes(
      [
        "%!PS-AdobeFont-1.0: Spaced 001.000",
        "/Encoding  StandardEncoding  def",
        "currentfile eexec",
        "",
      ].join("\\n"),
    );
    expect(readFontProgramEncoding(program)?.codeToUnicode(0x41)).toBe(0x41);
  });

  it("matches dup assignments across repeated whitespace in each position", () => {
    const program = textBytes(
      [
        "%!PS-AdobeFont-1.0: Gaps 001.000",
        "/Encoding 256 array",
        "dup  87  /Omega  put",
        "dup\t109 /mu put",
        "readonly def",
        "currentfile eexec",
        "",
      ].join("\n"),
    );
    const encoding = readFontProgramEncoding(program);
    expect(encoding?.codeToUnicode(0x57)).toBe(OHM_SIGN);
    expect(encoding?.codeToUnicode(0x6d)).toBe(0xb5);
  });
});

describe("readFontProgramEncoding: CFF-flavoured OpenType programs", () => {
  it("names glyphs through the CFF charset of an sfnt-wrapped font whose cmap names nothing", () => {
    // A 'CFF ' table (carrying a charset and a custom Encoding over custom strings) inside an
    // sfnt with no cmap at all and a nameless version 3 'post': every name AND every code
    // mapping come from the CFF alone, because the container states nothing itself.
    const program = buildSfnt(
      new Map([
        [
          "CFF ",
          cffFontWithBuiltinEncoding({
            name: "WrappedCff",
            glyphNames: ["Omega", "mu"],
            encoding: new Map([
              [0x57, 1],
              [0x6d, 2],
            ]),
          }),
        ],
        ["post", buildPostV3Table()],
      ]),
    );
    const encoding = readFontProgramEncoding(program);
    expect(encoding?.glyphIdToUnicode(1)).toBe(OHM_SIGN);
    expect(encoding?.glyphIdToUnicode(2)).toBe(0xb5);
    expect(encoding?.codeToUnicode(0x57)).toBe(OHM_SIGN);
  });

  it("applies no predefined StandardEncoding to an sfnt-wrapped CFF that states no Encoding operator", () => {
    // The same font shape with no custom Encoding at all: the charset still names glyphs, and a
    // code maps to nothing because predefined encodings belong to bare Type1C programs only.
    const program = buildSfnt(
      new Map([
        [
          "CFF ",
          cffFontWithCharstrings({
            name: "WrappedPredefined",
            charStrings: [[14], [14]],
          }),
        ],
        ["post", buildPostV3Table()],
      ]),
    );
    const encoding = readFontProgramEncoding(program);
    expect(encoding?.glyphIdToUnicode(1)).toBe(0x20);
    expect(encoding?.codeToUnicode(0x20)).toBeUndefined();
  });
});

describe("readFontProgramEncoding: charset SIDs shared by several glyphs", () => {
  it("addresses a duplicated SID through the first glyph that carries it", () => {
    // A supplement resolves its SID through the charset's own glyph list; when two glyphs carry
    // the same SID, the first one encountered is the one the mapping must reach.
    const program = rawCffFontEndingInEncoding({
      glyphNames: ["Omega", "mu"],
      charset: charsetFormat0([
        CFF_STANDARD_STRING_COUNT,
        CFF_STANDARD_STRING_COUNT,
      ]),
      encoding: [
        0x80, // format 0 with the supplement flag
        1, // one base code
        0x57,
        1, // one supplement entry
        0x1a,
        ...sidPair(CFF_STANDARD_STRING_COUNT),
      ],
      charstrings: [[14], [14], [14]],
    });
    // Code 0x57 comes from the base format 0 list (glyph 1); code 0x1a from the supplement,
    // which must also resolve to glyph 1, not to glyph 2 sharing its SID.
    const encoding = readFontProgramEncoding(program);
    expect(encoding?.codeToUnicode(0x57)).toBe(OHM_SIGN);
    expect(encoding?.codeToUnicode(0x1a)).toBe(OHM_SIGN);
  });
});

describe("readFontProgramEncoding: CFF range and header edge shapes", () => {
  it("reads a format 1 charset whose ranges carry non-consecutive SIDs", () => {
    // Glyph 1 is SID 391 ("Omega") and glyph 2 is SID 500, beyond this font's custom strings: a
    // range decoder that misreads nLeft's width would run glyph 2 off the end of range 1 instead.
    const program = rawCffFontEndingInEncoding({
      glyphNames: ["Omega", "mu"],
      charset: [1, ...sidPair(CFF_STANDARD_STRING_COUNT), 0, ...sidPair(500)],
      encoding: [0, 2, 0x57, 0x6d],
      charstrings: [[14], [14], [14]],
    });
    const encoding = readFontProgramEncoding(program);
    expect(encoding?.codeToUnicode(0x57)).toBe(OHM_SIGN);
    expect(encoding?.codeToUnicode(0x6d)).toBeUndefined();
  });

  it("names no glyph past the count under a non-contiguous format 1 charset", () => {
    const program = rawCffFontEndingInEncoding({
      glyphNames: ["Omega", "mu", "A"],
      charset: [
        1,
        ...sidPair(CFF_STANDARD_STRING_COUNT),
        0,
        ...sidPair(CFF_STANDARD_STRING_COUNT + 2),
        0,
      ],
      encoding: [0, 3, 0x57, 0x6d, 0x41],
      charstrings: [[14], [14], [14], [14]],
    });
    expect(
      readFontProgramEncoding(program)?.glyphIdToUnicode(4),
    ).toBeUndefined();
  });

  it("refuses an Encoding format byte of 3 even when the bytes after it would parse as ranges", () => {
    const program = rawCffFontEndingInEncoding({
      glyphNames: ["Omega", "mu"],
      charset: charsetFormat0([
        CFF_STANDARD_STRING_COUNT,
        CFF_STANDARD_STRING_COUNT + 1,
      ]),
      encoding: [3, 1, 0x57, 0], // format 3 does not exist; the tail is not ranges
      charstrings: [[14], [14], [14]],
    });
    const encoding = readFontProgramEncoding(program);
    expect(encoding?.glyphIdToUnicode(1)).toBe(OHM_SIGN);
    expect(encoding?.codeToUnicode(0x57)).toBeUndefined();
  });

  it("reads exactly the declared number of format 1 Encoding ranges, ignoring trailing bytes", () => {
    // Two ranges, then two more bytes that a decoder running one range too far would consume as
    // a third and use to overwrite code 0x57's real mapping.
    const program = rawCffFontEndingInEncoding({
      glyphNames: ["Omega", "mu"],
      charset: charsetFormat0([
        CFF_STANDARD_STRING_COUNT,
        CFF_STANDARD_STRING_COUNT + 1,
      ]),
      encoding: [1, 2, 0x41, 0, 0x57, 0, 0x57, 0],
      charstrings: [[14], [14], [14]],
    });
    const encoding = readFontProgramEncoding(program);
    expect(encoding?.codeToUnicode(0x41)).toBe(OHM_SIGN);
    expect(encoding?.codeToUnicode(0x57)).toBe(0xb5);
  });

  it("reads no supplements from an Encoding whose format byte carries no supplement flag", () => {
    // The bytes after the one-code list look exactly like a supplement entry; without the flag
    // they are padding, and code 0x1a must stay unmapped.
    const program = rawCffFontEndingInEncoding({
      glyphNames: ["Omega", "mu"],
      charset: charsetFormat0([
        CFF_STANDARD_STRING_COUNT,
        CFF_STANDARD_STRING_COUNT + 1,
      ]),
      encoding: [0, 1, 0x57, 1, 0x1a, ...sidPair(CFF_STANDARD_STRING_COUNT)],
      charstrings: [[14], [14], [14]],
    });
    const encoding = readFontProgramEncoding(program);
    expect(encoding?.codeToUnicode(0x57)).toBe(OHM_SIGN);
    expect(encoding?.codeToUnicode(0x1a)).toBeUndefined();
  });

  it("reads exactly the declared number of supplements, ignoring trailing bytes", () => {
    // One supplement, then three more bytes that a decoder running one supplement too far would
    // consume and use to overwrite code 0x1a's real mapping with an unnamed glyph.
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
        0x1a,
        ...sidPair(CFF_STANDARD_STRING_COUNT + 1),
      ],
      charstrings: [[14], [14], [14]],
    });
    const encoding = readFontProgramEncoding(program);
    expect(encoding?.codeToUnicode(0x1a)).toBe(OHM_SIGN);
  });

  it("reads an Encoding that lives in the header's own padding, at exactly the minimum offset", () => {
    // hdrSize 8 leaves bytes 4..7 free, and a format 0 Encoding of one code fits in three of
    // them: offset 4 is the smallest the guard permits.
    const program = rawCffFont({
      header: [1, 0, 8, 1, 0, 1, 0x57, 0],
      glyphNames: ["Omega"],
      charset: charsetFormat0([CFF_STANDARD_STRING_COUNT]),
      encoding: [0, 0],
      charstrings: [[14], [14]],
    });
    const patched = patchEncodingOffset(program, 4);
    expect(readFontProgramEncoding(patched)?.codeToUnicode(0x57)).toBe(
      OHM_SIGN,
    );
  });

  it("refuses an Encoding operator pointing past the end of the program without throwing", () => {
    // The Encoding offset sits exactly at EOF: no mapping is read, the charset still names
    // glyphs, and the out-of-range read the guard prevents would have thrown.
    const whole = rawCffFontEndingInEncoding({
      glyphNames: ["Omega"],
      charset: charsetFormat0([CFF_STANDARD_STRING_COUNT]),
      encoding: [0, 1, 0x57],
      charstrings: [[14], [14]],
    });
    const cut = new Uint8Array(whole.slice(0, whole.length - 3));
    const patched = patchEncodingOffset(cut, cut.length);
    const encoding = readFontProgramEncoding(patched);
    expect(encoding?.glyphIdToUnicode(1)).toBe(OHM_SIGN);
    expect(encoding?.codeToUnicode(0x57)).toBeUndefined();
  });

  it("refuses a CFF whose major version is not 1", () => {
    const program = cffFontWithBuiltinEncoding({
      name: "Major2",
      glyphNames: ["Omega"],
      encoding: new Map([[0x57, 1]]),
    });
    const patched = new Uint8Array(program);
    patched[0] = 2;
    expect(readFontProgramEncoding(patched)).toBeUndefined();
  });

  it("refuses a CFF whose hdrSize undercuts the fixed header itself", () => {
    const program = cffFontWithBuiltinEncoding({
      name: "TinyHeader",
      glyphNames: ["Omega"],
      encoding: new Map([[0x57, 1]]),
    });
    const patched = new Uint8Array(program);
    patched[2] = 3;
    expect(readFontProgramEncoding(patched)).toBeUndefined();
  });
});

// Patches the Encoding operator's 32-bit operand (the second [29 b3 b2 b1 b0, 16] pair in the
// Top DICT INDEX) to `offset`.
function patchEncodingOffset(
  program: Uint8Array<ArrayBuffer>,
  offset: number,
): Uint8Array<ArrayBuffer> {
  const patched = new Uint8Array(program);
  let seen = 0;
  for (let i = 0; i + 5 < patched.length; i++) {
    if (patched[i] === 29 && patched[i + 5] === 15) {
      seen += 1; // the charset operator comes first
      continue;
    }
    if (patched[i] === 29 && patched[i + 5] === 16 && seen === 1) {
      patched[i + 1] = (offset >>> 24) & 0xff;
      patched[i + 2] = (offset >>> 16) & 0xff;
      patched[i + 3] = (offset >>> 8) & 0xff;
      patched[i + 4] = offset & 0xff;
      return patched;
    }
  }
  throw new Error("no Encoding operator found in the fixture's Top DICT");
}
