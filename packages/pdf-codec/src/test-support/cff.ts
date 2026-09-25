import { STIX_TWO_MATH_FONT_BASE64 } from "../assets/stix-two-math-font";
import {
  CFF_DICT_OP_CHARSET,
  CFF_DICT_OP_CHARSTRINGS,
  CFF_DICT_OP_ENCODING,
  CFF_DICT_OP_PRIVATE,
  CFF_DICT_OP_SUBRS,
} from "../cff";
import { parseSfnt, sfntTableBytes } from "../sfnt";
import { base64ToBytes } from "byte-codec";

// Byte-splitting constants shared by every fixture builder below.
const BITS_PER_BYTE = 8;
const BYTE_MASK = 0xff;
const TWO_BYTE_SHIFT = 16;
const THREE_BYTE_SHIFT = 24;
// A DICT/charstring 16-bit int operand's own prefix byte (spec Table 3 / TN 5177 section 3.2, operand 28): the same encoding in both a DICT and a charstring, so one name covers cffIndex's own callers below and csInt16.
const OPERAND_INT16_PREFIX = 28;
// Masks a value down to its low 16 bits, the range a 16-bit int16 operand's own two's-complement wraparound needs.
const UINT16_MASK = 0xffff;
// A DICT small-int operand's own bias (spec Table 3): the byte value alone (with no following byte) encodes value - 139, so 139 by itself encodes 0.
const DICT_OPERAND_SMALL_BIAS = 139;
// The escape byte that introduces a two-byte DICT operator (spec Table 9), and the second byte that selects ROS specifically, matching CFF_DICT_OP_ROS's own definition as CFF_ESCAPED_OPERATOR_BASE + 30 in cff.ts.
const DICT_OPERATOR_ESCAPE = 12;
const CFF_ESCAPED_OP_ROS_BYTE = 30;
// A DICT 32-bit int operand's own prefix byte (spec Table 3, operand 29): dictInt32 below always uses this fixed-width form.
const DICT_OPERAND_INT32 = 29;
// The high bit of an Encoding's own format byte (spec section 12), set when supplementary code -> SID entries follow the base encoding.
const ENCODING_SUPPLEMENT_FLAG = 0x80;
// charset, Encoding, and CharStrings: the three Top DICT entries cffFontWithBuiltinEncoding's own topDict always carries.
const TOP_DICT_ENTRY_COUNT = 3;
// The Type 2 charstring `endchar` operator (TN 5177 Appendix A): a bare endchar is the minimal valid charstring, drawing nothing.
const CS_OP_ENDCHAR = 14;

// Fixtures for the two CFF readers (cff-probe.ts and cff-bounds.ts): the real vendored font's own 'CFF ' table, plus a builder for the small hand-made programs that font does not happen to contain (a CID-keyed Top DICT, and the malformed shapes).

// Extracted from stixMathCffBytes so a test can drive its two guards directly against a small synthetic sfnt, rather than only against the one real 691 KB vendored asset that never actually triggers either of them.
export function cffTableFromSfnt(
  sfntBytes: Uint8Array<ArrayBuffer>,
  sourceDescription: string,
): Uint8Array<ArrayBuffer> {
  const font = parseSfnt(sfntBytes);
  if (font === undefined) {
    throw new Error(
      `${sourceDescription} failed to parse as an sfnt container`,
    );
  }
  const cff = sfntTableBytes(font, "CFF ");
  if (cff === undefined) {
    throw new Error(`${sourceDescription} has no CFF table`);
  }
  return cff;
}

// The real, vendored STIX Two Math font's own 'CFF ' table — 691 KB of genuine CFF data produced by a real font toolchain, not a fixture written to satisfy these parsers.
export function stixMathCffBytes(): Uint8Array<ArrayBuffer> {
  return cffTableFromSfnt(
    base64ToBytes(STIX_TWO_MATH_FONT_BASE64),
    "the vendored STIX Two Math font",
  );
}

// CFF INDEX offSize thresholds (spec Table 2): the largest unsigned value representable in 1/2/3 bytes, used to pick the smallest offSize (1-4) that holds the INDEX's own last offset.
const OFFSET_1_BYTE_MAX = 0xff;
const OFFSET_2_BYTE_MAX = 0xffff;
const OFFSET_3_BYTE_MAX = 0xffffff;
const OFFSET_SIZE_3 = 3;
const OFFSET_SIZE_4 = 4;

// A CFF INDEX (spec section 5). offSize is computed from the largest offset actually needed (spec Table 2: the smallest of 1/2/3/4 bytes that holds it), not hardcoded to 1 — a fixture with enough entries or entry bytes to push the final offset past 255 (this package's own subrBias tests need a Local Subrs INDEX of over a thousand entries to reach the 1240-entry medium-bias threshold) still needs a spec-conformant INDEX, not a truncated one-byte offset that wraps.
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
    lastOffset <= OFFSET_1_BYTE_MAX
      ? 1
      : lastOffset <= OFFSET_2_BYTE_MAX
        ? 2
        : lastOffset <= OFFSET_3_BYTE_MAX
          ? OFFSET_SIZE_3
          : OFFSET_SIZE_4;
  const offsetBytes: number[] = [];
  for (const offset of offsets) {
    for (let byteIndex = offSize - 1; byteIndex >= 0; byteIndex--) {
      offsetBytes.push((offset >>> (byteIndex * BITS_PER_BYTE)) & BYTE_MASK);
    }
  }
  return [
    (entries.length >> BITS_PER_BYTE) & BYTE_MASK,
    entries.length & BYTE_MASK,
    offSize,
    ...offsetBytes,
    ...entries.flat(),
  ];
}

// A charstring operand in its 3-byte int16 form (TN 5177 section 3.2, operand 28): valid for any value in [-32768, 32767], which is every integer a curve-bounds test needs to place a control point at. Deliberately uniform rather than picking the shortest single-byte encoding a real font toolchain would choose — cff-bounds.ts's own readOperand already has dedicated tests for its other operand forms, so a charstring built purely to drive the curve-extrema math needs only one encoding it never has to think about.
export function csInt16(value: number): number[] {
  const unsigned = value & UINT16_MASK;
  return [
    OPERAND_INT16_PREFIX,
    (unsigned >>> BITS_PER_BYTE) & BYTE_MASK,
    unsigned & BYTE_MASK,
  ];
}

// CFF header bytes (spec Table 1): major 1, minor 0, hdrSize 4, offSize 1. hdrSize is the only one outside this rule's own ignored range (-1..2).
const CFF_HEADER_SIZE = 4;
export const CFF_HEADER = [1, 0, CFF_HEADER_SIZE, 1];

// A minimal CFF program: header, a Name INDEX holding `name`, and a Top DICT INDEX holding `topDict`. Deliberately stops there — the String and Global Subr INDEXes that a real program carries next are only reached by a reader that gets past the Top DICT, which is exactly what the fixtures built from this are testing does not happen.
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

// Arbitrary but realistic-looking test SIDs for the ROS operator's own registry and ordering operands below; the exact values carry no meaning beyond being valid, distinct SIDs a test can assert against.
const ROS_REGISTRY_SID = 0x0187;
const ROS_ORDERING_SID = 0x0188;

// The ROS operator with the three operands it really takes (registry SID, ordering SID, supplement): two 16-bit operands and one small integer, then the escaped operator 12 30.
export const ROS_OPERANDS_AND_OPERATOR = [
  OPERAND_INT16_PREFIX,
  (ROS_REGISTRY_SID >>> BITS_PER_BYTE) & BYTE_MASK,
  ROS_REGISTRY_SID & BYTE_MASK,
  OPERAND_INT16_PREFIX,
  (ROS_ORDERING_SID >>> BITS_PER_BYTE) & BYTE_MASK,
  ROS_ORDERING_SID & BYTE_MASK,
  DICT_OPERAND_SMALL_BIAS,
  DICT_OPERATOR_ESCAPE,
  CFF_ESCAPED_OP_ROS_BYTE,
];

// A DICT operand always written in the 5-byte 32-bit integer form (spec Table 3, operand 29), so an offset operand occupies the same space whatever its value — which is what lets the builder below lay a whole font out in one pass rather than iterating until the Top DICT's own size stops changing.
export function dictInt32(value: number): number[] {
  return [
    DICT_OPERAND_INT32,
    (value >>> THREE_BYTE_SHIFT) & BYTE_MASK,
    (value >>> TWO_BYTE_SHIFT) & BYTE_MASK,
    (value >>> BITS_PER_BYTE) & BYTE_MASK,
    value & BYTE_MASK,
  ];
}

export const CFF_STANDARD_STRING_COUNT = 391; // SIDs below this index the standard strings (spec Appendix A); the String INDEX starts here

// A charset (spec section 13) in format 1: one run of consecutive SIDs per range, each range a first SID plus a count of additional glyphs it covers — the form a real font toolchain reaches for once its glyph SIDs are dense enough that format 0's one-SID-per-glyph listing wastes space. Builds the same glyph-order SIDs cffFontWithBuiltinEncoding's own format 0 charset does (CFF_STANDARD_STRING_COUNT + index per glyph), just run-length-encoded into ranges of `rangeSize` glyphs apiece so a test can choose whether the whole charset is one range or several.
function charsetFormat1(glyphCount: number, rangeSize: number): number[] {
  const bytes = [1];
  for (let glyphId = 1; glyphId < glyphCount;) {
    const firstSid = CFF_STANDARD_STRING_COUNT + (glyphId - 1);
    const nLeft = Math.min(rangeSize, glyphCount - glyphId) - 1;
    bytes.push(
      (firstSid >> BITS_PER_BYTE) & BYTE_MASK,
      firstSid & BYTE_MASK,
      nLeft,
    );
    glyphId += nLeft + 1;
  }
  return bytes;
}

// The same run-length encoding as charsetFormat1, but with a 16-bit nLeft (format 2): the form a font with tens of thousands of glyphs in one contiguous SID range needs, since format 1's own nLeft is a single byte.
function charsetFormat2(glyphCount: number, rangeSize: number): number[] {
  const bytes = [2];
  for (let glyphId = 1; glyphId < glyphCount;) {
    const firstSid = CFF_STANDARD_STRING_COUNT + (glyphId - 1);
    const nLeft = Math.min(rangeSize, glyphCount - glyphId) - 1;
    bytes.push(
      (firstSid >> BITS_PER_BYTE) & BYTE_MASK,
      firstSid & BYTE_MASK,
      (nLeft >> BITS_PER_BYTE) & BYTE_MASK,
      nLeft & BYTE_MASK,
    );
    glyphId += nLeft + 1;
  }
  return bytes;
}

// An Encoding (spec section 12) in format 1: ranges of consecutive codes assigned to consecutive glyph IDs starting at 1, each range a first code plus a count of additional codes it covers — the form a font toolchain reaches for once most of its codes are contiguous, rather than format 0's one-code-per-glyph list. Run-length-encodes `codesByGlyph` (glyph 1's code, glyph 2's code, ...) into the fewest ranges that reproduce it: a run of consecutive codes collapses into one range with nLeft > 0, and any break (a gap, or an unmapped glyph's placeholder 0) starts a new one — so a caller supplying genuinely consecutive codes exercises the multi-code, nLeft > 0 span this format exists for, not just one range per glyph.
function encodingFormat1(codesByGlyph: readonly number[]): number[] {
  const ranges: { first: number; nLeft: number }[] = [];
  for (const code of codesByGlyph) {
    const last = ranges[ranges.length - 1];
    if (last !== undefined && code === last.first + last.nLeft + 1) {
      last.nLeft += 1;
    } else {
      ranges.push({ first: code, nLeft: 0 });
    }
  }
  return [1, ranges.length, ...ranges.flatMap((r) => [r.first, r.nLeft])];
}

// A complete-enough CFF program carrying its own built-in encoding: a custom Encoding (spec section 12) mapping character codes onto glyph indices, and a charset (section 13) naming each glyph through a SID resolved against the String INDEX. Every glyph name is written as a custom string rather than reused from the standard strings, which is what a subsetted symbol font really does with names outside the ISOAdobe repertoire. `charsetFormat`/`encodingFormat` choose the on-disk encoding of each (format 0's explicit per-glyph list by default); `encodingSupplement` adds format 0/1's own optional supplementary code -> SID entries (spec section 12's high bit on the format byte), each resolved against the charset's own SIDs rather than glyph indices directly.
export function cffFontWithBuiltinEncoding(options: {
  readonly name: string;
  readonly glyphNames: readonly string[]; // glyphs 1..n; glyph 0 is always .notdef and is not named here
  readonly encoding: ReadonlyMap<number, number>; // character code -> glyph index
  readonly charsetFormat?: 0 | 1 | 2;
  readonly charsetRangeSize?: number; // format 1/2 only: how many glyphs each range covers before starting a new one
  readonly encodingFormat?: 0 | 1;
  readonly encodingSupplement?: readonly { code: number; sid: number }[];
}): Uint8Array<ArrayBuffer> {
  const nameIndex = cffIndex([[...new TextEncoder().encode(options.name)]]);
  const stringIndex = cffIndex(
    options.glyphNames.map((glyphName) => [
      ...new TextEncoder().encode(glyphName),
    ]),
  );
  const globalSubrIndex = [0, 0];
  const glyphCount = options.glyphNames.length + 1; // +1 for .notdef
  const charsetFormat = options.charsetFormat ?? 0;
  const charset =
    charsetFormat === 1
      ? charsetFormat1(glyphCount, options.charsetRangeSize ?? glyphCount)
      : charsetFormat === 2
        ? charsetFormat2(glyphCount, options.charsetRangeSize ?? glyphCount)
        : [
            0,
            ...options.glyphNames.flatMap((_, index) => {
              const sid = CFF_STANDARD_STRING_COUNT + index;
              return [(sid >> BITS_PER_BYTE) & BYTE_MASK, sid & BYTE_MASK];
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
  const supplementBytes = (options.encodingSupplement ?? []).flatMap((s) => [
    s.code,
    (s.sid >> BITS_PER_BYTE) & BYTE_MASK,
    s.sid & BYTE_MASK,
  ]);
  const supplementFlag =
    options.encodingSupplement === undefined ? 0 : ENCODING_SUPPLEMENT_FLAG;
  const encodingBody =
    options.encodingFormat === 1
      ? encodingFormat1(codesByGlyph)
      : [0, codesByGlyph.length, ...codesByGlyph];
  const encoding = [
    supplementFlag | encodingBody[0]!,
    ...encodingBody.slice(1),
    ...(options.encodingSupplement === undefined
      ? []
      : [options.encodingSupplement.length, ...supplementBytes]),
  ];
  const charStrings = cffIndex([
    [CS_OP_ENDCHAR],
    ...options.glyphNames.map(() => [CS_OP_ENDCHAR]), // one bare `endchar` charstring per glyph: the CharStrings INDEX count is what sizes the charset
  ]);

  // charset, Encoding and CharStrings: three Top DICT entries, each a 5-byte dictInt32 operand plus its one-byte operator.
  const topDictEntrySize =
    TOP_DICT_ENTRY_COUNT * dictInt32(0).length + TOP_DICT_ENTRY_COUNT;
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
    CFF_DICT_OP_CHARSET,
    ...dictInt32(encodingOffset),
    CFF_DICT_OP_ENCODING,
    ...dictInt32(charStringsOffset),
    CFF_DICT_OP_CHARSTRINGS,
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

// A complete-enough CFF program for exercising cff-bounds.ts's charstring interpreter directly: real header/Name/Top-DICT/String/Global-Subr INDEXes wrapped around hand-written CharStrings, with an optional Private DICT and Local Subrs INDEX. Unlike cffFontWithBuiltinEncoding's fixed one-byte `endchar` glyphs, every charstring here is caller-supplied, which is what lets a test drive execute()'s and executeEscaped()'s own interpreter limits and malformed-input paths directly — none of which the vendored STIX Two Math font's own well-formed charstrings ever reach.
export function cffFontWithCharstrings(options: {
  readonly name: string;
  readonly charStrings: readonly (readonly number[])[];
  readonly globalSubrs?: readonly (readonly number[])[];
  readonly localSubrs?: readonly (readonly number[])[]; // presence alone (even []) adds a Private DICT with a Subrs operator
  // Overrides the four header bytes every other fixture uses. Downstream offsets are laid out from this array's own length, so a fixture claiming a different hdrSize still places its INDEXes consistently with what it claims.
  readonly header?: readonly number[];
  // Replaces the default Private DICT bytes (a lone Subrs operator) while keeping the Top DICT's own Private operands pointing at whatever is supplied, for fixtures that need a malformed or Subrs-less Private DICT rather than none at all.
  readonly privateDict?: readonly number[];
}): Uint8Array<ArrayBuffer> {
  const header = options.header ?? CFF_HEADER;
  const nameIndex = cffIndex([[...new TextEncoder().encode(options.name)]]);
  const stringIndex = cffIndex([]);
  const globalSubrIndex = cffIndex(options.globalSubrs ?? []);
  const hasPrivate =
    options.localSubrs !== undefined || options.privateDict !== undefined;

  // Every Top DICT operand below is the fixed-width 5-byte 32-bit form (dictInt32), so the Top DICT's own byte length — and therefore topDictIndexSize — depends only on which operators are present, never on the offset values those operators end up carrying. That is what lets every downstream offset be computed in one pass instead of iterating until a size stops changing.
  const topDictEntrySize = hasPrivate
    ? dictInt32(0).length + 1 + dictInt32(0).length * 2 + 1
    : dictInt32(0).length + 1;
  const topDictIndexSize = cffIndex([
    new Array<number>(topDictEntrySize).fill(0),
  ]).length;

  const afterGlobalSubrs =
    header.length +
    nameIndex.length +
    topDictIndexSize +
    stringIndex.length +
    globalSubrIndex.length;

  // A Private DICT holding only a Subrs operator (19), whose own offset is relative to the Private DICT's own start (spec Table 23) — fixed at the Private DICT's own byte length, since the Local Subrs INDEX immediately follows it. The Private DICT itself starts right where the Global Subr INDEX ends.
  const privateDictBytes =
    options.privateDict === undefined
      ? [...dictInt32(dictInt32(0).length + 1), CFF_DICT_OP_SUBRS]
      : [...options.privateDict];
  // Narrowed directly on options.localSubrs itself, not on the separately-computed hasPrivate boolean above — hasPrivate is already defined as this exact check, so a `?? []` fallback here could never actually fire; checking the real value lets TypeScript rule that branch out entirely instead of leaving an always-unreachable default in the code.
  const localSubrIndex =
    options.localSubrs === undefined ? [] : cffIndex(options.localSubrs);
  const privateSize = privateDictBytes.length;

  const charStringsOffset = hasPrivate
    ? afterGlobalSubrs + privateDictBytes.length + localSubrIndex.length
    : afterGlobalSubrs;

  const topDict = hasPrivate
    ? [
        ...dictInt32(charStringsOffset),
        CFF_DICT_OP_CHARSTRINGS,
        ...dictInt32(privateSize),
        ...dictInt32(afterGlobalSubrs),
        CFF_DICT_OP_PRIVATE,
      ]
    : [...dictInt32(charStringsOffset), CFF_DICT_OP_CHARSTRINGS];

  const charStringsIndex = cffIndex(options.charStrings);

  return new Uint8Array([
    ...header,
    ...nameIndex,
    ...cffIndex([topDict]),
    ...stringIndex,
    ...globalSubrIndex,
    ...(hasPrivate ? [...privateDictBytes, ...localSubrIndex] : []),
    ...charStringsIndex,
  ]);
}
