import { STIX_TWO_MATH_FONT_BASE64 } from "../assets/stix-two-math-font";
import { parseSfnt, sfntTableBytes } from "../sfnt";
import { base64ToBytes } from "../util/base64";

// Fixtures for the two CFF readers (cff-probe.ts and cff-bounds.ts): the real vendored font's own 'CFF ' table, plus a builder for the small hand-made programs that font does not happen to contain (a CID-keyed Top DICT, and the malformed shapes).

// The real, vendored STIX Two Math font's own 'CFF ' table -- 691 KB of genuine CFF data produced by a real font toolchain, not a fixture written to satisfy these parsers.
export function stixMathCffBytes(): Uint8Array<ArrayBuffer> {
  const font = parseSfnt(base64ToBytes(STIX_TWO_MATH_FONT_BASE64));
  if (font === undefined) {
    throw new Error(
      "the vendored STIX Two Math font failed to parse as an sfnt container",
    );
  }
  const cff = sfntTableBytes(font, "CFF ");
  if (cff === undefined) {
    throw new Error("the vendored STIX Two Math font has no CFF table");
  }
  return cff;
}

// A CFF INDEX (spec section 5). offSize is computed from the largest offset actually needed (spec Table 2: the smallest of 1/2/3/4 bytes that holds it), not hardcoded to 1 -- a fixture with enough entries or entry bytes to push the final offset past 255 (this package's own subrBias tests need a Local Subrs INDEX of over a thousand entries to reach the 1240-entry medium-bias threshold) still needs a spec-conformant INDEX, not a truncated one-byte offset that wraps.
export function cffIndex(entries: readonly (readonly number[])[]): number[] {
  if (entries.length === 0) {
    return [0, 0];
  }
  const offsets = [1];
  for (const entry of entries) {
    offsets.push(offsets[offsets.length - 1]! + entry.length);
  }
  const lastOffset = offsets[offsets.length - 1]!;
  const offSize =
    lastOffset <= 0xff
      ? 1
      : lastOffset <= 0xffff
        ? 2
        : lastOffset <= 0xffffff
          ? 3
          : 4;
  const offsetBytes: number[] = [];
  for (const offset of offsets) {
    for (let byteIndex = offSize - 1; byteIndex >= 0; byteIndex--) {
      offsetBytes.push((offset >>> (byteIndex * 8)) & 0xff);
    }
  }
  return [
    (entries.length >> 8) & 0xff,
    entries.length & 0xff,
    offSize,
    ...offsetBytes,
    ...entries.flat(),
  ];
}

export const CFF_HEADER = [1, 0, 4, 1]; // major 1, minor 0, hdrSize 4, offSize 1

// A minimal CFF program: header, a Name INDEX holding `name`, and a Top DICT INDEX holding `topDict`. Deliberately stops there -- the String and Global Subr INDEXes that a real program carries next are only reached by a reader that gets past the Top DICT, which is exactly what the fixtures built from this are testing does not happen.
export function cffFont(
  name: string,
  topDict: readonly number[],
  header: readonly number[] = CFF_HEADER,
): Uint8Array<ArrayBuffer> {
  return new Uint8Array([
    ...header,
    ...cffIndex([[...new TextEncoder().encode(name)]]),
    ...cffIndex([topDict]),
  ]);
}

// The ROS operator with the three operands it really takes (registry SID, ordering SID, supplement): two 16-bit operands and one small integer, then the escaped operator 12 30.
export const ROS_OPERANDS_AND_OPERATOR = [
  28, 0x01, 0x87, 28, 0x01, 0x88, 139, 12, 30,
];

// A DICT operand always written in the 5-byte 32-bit integer form (spec Table 3, operand 29), so an offset operand occupies the same space whatever its value -- which is what lets the builder below lay a whole font out in one pass rather than iterating until the Top DICT's own size stops changing.
function dictInt32(value: number): number[] {
  return [
    29,
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ];
}

const CFF_STANDARD_STRING_COUNT = 391; // SIDs below this index the standard strings (spec Appendix A); the String INDEX starts here

// A complete-enough CFF program carrying its own built-in encoding: a custom Encoding (spec section 12, format 0) mapping character codes onto glyph indices, and a charset (section 13, format 0) naming each glyph through a SID resolved against the String INDEX. Every glyph name is written as a custom string rather than reused from the standard strings, which is what a subsetted symbol font really does with names outside the ISOAdobe repertoire.
export function cffFontWithBuiltinEncoding(options: {
  readonly name: string;
  readonly glyphNames: readonly string[]; // glyphs 1..n; glyph 0 is always .notdef and is not named here
  readonly encoding: ReadonlyMap<number, number>; // character code -> glyph index
}): Uint8Array<ArrayBuffer> {
  const nameIndex = cffIndex([[...new TextEncoder().encode(options.name)]]);
  const stringIndex = cffIndex(
    options.glyphNames.map((glyphName) => [
      ...new TextEncoder().encode(glyphName),
    ]),
  );
  const globalSubrIndex = [0, 0];
  const charset = [
    0,
    ...options.glyphNames.flatMap((_, index) => {
      const sid = CFF_STANDARD_STRING_COUNT + index;
      return [(sid >> 8) & 0xff, sid & 0xff];
    }),
  ];
  const codesByGlyph = [...options.glyphNames.keys()].map((index) => {
    for (const [code, glyph] of options.encoding) {
      if (glyph === index + 1) {
        return code;
      }
    }
    return 0;
  });
  const encoding = [0, codesByGlyph.length, ...codesByGlyph];
  const charStrings = cffIndex([
    [14],
    ...options.glyphNames.map(() => [14]), // one bare `endchar` charstring per glyph: the CharStrings INDEX count is what sizes the charset
  ]);

  const topDictEntrySize = 3 * dictInt32(0).length + 3; // charset, Encoding and CharStrings, each a 5-byte operand plus its one-byte operator
  const topDictIndexSize = cffIndex([
    new Array<number>(topDictEntrySize).fill(0),
  ]).length;
  const charsetOffset =
    CFF_HEADER.length +
    nameIndex.length +
    topDictIndexSize +
    stringIndex.length +
    globalSubrIndex.length;
  const encodingOffset = charsetOffset + charset.length;
  const charStringsOffset = encodingOffset + encoding.length;
  const topDict = [
    ...dictInt32(charsetOffset),
    15,
    ...dictInt32(encodingOffset),
    16,
    ...dictInt32(charStringsOffset),
    17,
  ];

  return new Uint8Array([
    ...CFF_HEADER,
    ...nameIndex,
    ...cffIndex([topDict]),
    ...stringIndex,
    ...globalSubrIndex,
    ...charset,
    ...encoding,
    ...charStrings,
  ]);
}

// A complete-enough CFF program for exercising cff-bounds.ts's charstring interpreter directly: real header/Name/Top-DICT/String/Global-Subr INDEXes wrapped around hand-written CharStrings, with an optional Private DICT and Local Subrs INDEX. Unlike cffFontWithBuiltinEncoding's fixed one-byte `endchar` glyphs, every charstring here is caller-supplied, which is what lets a test drive execute()'s and executeEscaped()'s own interpreter limits and malformed-input paths directly -- none of which the vendored STIX Two Math font's own well-formed charstrings ever reach.
export function cffFontWithCharstrings(options: {
  readonly name: string;
  readonly charStrings: readonly (readonly number[])[];
  readonly globalSubrs?: readonly (readonly number[])[];
  readonly localSubrs?: readonly (readonly number[])[]; // presence alone (even []) adds a Private DICT with a Subrs operator
}): Uint8Array<ArrayBuffer> {
  const nameIndex = cffIndex([[...new TextEncoder().encode(options.name)]]);
  const stringIndex = cffIndex([]);
  const globalSubrIndex = cffIndex(options.globalSubrs ?? []);
  const hasPrivate = options.localSubrs !== undefined;

  // Every Top DICT operand below is the fixed-width 5-byte 32-bit form (dictInt32), so the Top DICT's own byte length -- and therefore topDictIndexSize -- depends only on which operators are present, never on the offset values those operators end up carrying. That is what lets every downstream offset be computed in one pass instead of iterating until a size stops changing.
  const topDictEntrySize = hasPrivate
    ? dictInt32(0).length + 1 + dictInt32(0).length * 2 + 1
    : dictInt32(0).length + 1;
  const topDictIndexSize = cffIndex([
    new Array<number>(topDictEntrySize).fill(0),
  ]).length;

  const afterGlobalSubrs =
    CFF_HEADER.length +
    nameIndex.length +
    topDictIndexSize +
    stringIndex.length +
    globalSubrIndex.length;

  // A Private DICT holding only a Subrs operator (19), whose own offset is relative to the Private DICT's own start (spec Table 23) -- fixed at the Private DICT's own byte length, since the Local Subrs INDEX immediately follows it. The Private DICT itself starts right where the Global Subr INDEX ends.
  const privateDictBytes = [...dictInt32(6), 19];
  const localSubrIndex = hasPrivate ? cffIndex(options.localSubrs ?? []) : [];
  const privateSize = privateDictBytes.length;

  const charStringsOffset = hasPrivate
    ? afterGlobalSubrs + privateDictBytes.length + localSubrIndex.length
    : afterGlobalSubrs;

  const topDict = hasPrivate
    ? [
        ...dictInt32(charStringsOffset),
        17,
        ...dictInt32(privateSize),
        ...dictInt32(afterGlobalSubrs),
        18,
      ]
    : [...dictInt32(charStringsOffset), 17];

  const charStringsIndex = cffIndex(options.charStrings);

  return new Uint8Array([
    ...CFF_HEADER,
    ...nameIndex,
    ...cffIndex([topDict]),
    ...stringIndex,
    ...globalSubrIndex,
    ...(hasPrivate ? [...privateDictBytes, ...localSubrIndex] : []),
    ...charStringsIndex,
  ]);
}
