// The cmap subtable format builders (format 0, 4, 6, 12), split from sfnt.ts: each encodes one cmap subtable layout the tests exercise.

const FORMAT0_HEADER_SIZE = 6;
const FORMAT0_GLYPH_COUNT = 256;
// Format 0 (byte encoding table, clause 5.2.4): a fixed 256-entry glyph-ID array, so only codes 0..255 can appear.
export function buildFormat0(
  mappings: ReadonlyMap<number, number>,
): Uint8Array {
  const subtable = new Uint8Array(FORMAT0_HEADER_SIZE + FORMAT0_GLYPH_COUNT);
  const view = new DataView(subtable.buffer);
  // The format field (offset 0) is already 0 from Uint8Array's own zero-initialization — format 0 is the one subtable format whose own numeric value needs no explicit write.
  view.setUint16(2, subtable.length);
  for (const [code, glyphId] of mappings) {
    subtable[FORMAT0_HEADER_SIZE + code] = glyphId;
  }
  return subtable;
}

// Format 4 subtable format number (clause 5.2.5.1).
export const CMAP_FORMAT_4 = 4;
// Format 4 header field offsets, up to where the endCode array starts (clause 5.2.5.2): format(2) + length(2) + language(2) + segCountX2(2) + searchRange(2) + entrySelector(2) + rangeShift(2) = 14 bytes.
const FORMAT4_SEGCOUNTX2_OFFSET = 6;
const FORMAT4_SEARCH_RANGE_OFFSET = 8;
const FORMAT4_ENTRY_SELECTOR_OFFSET = 10;
const FORMAT4_RANGE_SHIFT_OFFSET = 12;
const FORMAT4_HEADER_SIZE = 14;
// After the header: endCode[segCount], a reservedPad word, startCode[segCount], idDelta[segCount], and idRangeOffset[segCount] left zero-filled (valid per spec: zero selects the idDelta-only mapping this builder always uses), four uint16 arrays of segCount entries plus the pad word.
const FORMAT4_RESERVED_PAD_SIZE = 2;
const FORMAT4_ARRAYS_PER_SEGMENT = 4;
const FORMAT4_ARRAY_ENTRY_SIZE = 2;
// The mandatory final segment's endCode/startCode value (clause 5.2.5.2): the sentinel that terminates the segment list.
const FORMAT4_TERMINATOR_CODE = 0xffff;
const UINT16_MASK = 0xffff;

// Format 4 (segment mapping to delta values): emitted as one single-code segment per mapping plus the mandatory 0xFFFF terminator, which is a legal — if deliberately unoptimised — encoding of any mapping and exercises the idDelta path rather than the glyph-index-array one.
export function buildFormat4(
  mappings: ReadonlyMap<number, number>,
): Uint8Array {
  const codes = [...mappings.keys()].sort((a, b) => a - b);
  const segCount = codes.length + 1;
  const length =
    FORMAT4_HEADER_SIZE +
    FORMAT4_RESERVED_PAD_SIZE +
    segCount * FORMAT4_ARRAYS_PER_SEGMENT * FORMAT4_ARRAY_ENTRY_SIZE;
  const subtable = new Uint8Array(length);
  const view = new DataView(subtable.buffer);
  const searchRange = 2 * 2 ** Math.floor(Math.log2(segCount));
  view.setUint16(0, CMAP_FORMAT_4);
  view.setUint16(2, length);
  view.setUint16(FORMAT4_SEGCOUNTX2_OFFSET, segCount * 2);
  view.setUint16(FORMAT4_SEARCH_RANGE_OFFSET, searchRange);
  view.setUint16(FORMAT4_ENTRY_SELECTOR_OFFSET, Math.log2(searchRange / 2));
  view.setUint16(FORMAT4_RANGE_SHIFT_OFFSET, segCount * 2 - searchRange);

  const startCodes =
    FORMAT4_HEADER_SIZE + segCount * 2 + FORMAT4_RESERVED_PAD_SIZE;
  const idDeltas = startCodes + segCount * 2;
  codes.forEach((code, index) => {
    view.setUint16(FORMAT4_HEADER_SIZE + index * 2, code);
    view.setUint16(startCodes + index * 2, code);
    view.setUint16(
      idDeltas + index * 2,
      ((mappings.get(code) ?? 0) - code) & UINT16_MASK,
    );
  });
  view.setUint16(
    FORMAT4_HEADER_SIZE + codes.length * 2,
    FORMAT4_TERMINATOR_CODE,
  );
  view.setUint16(startCodes + codes.length * 2, FORMAT4_TERMINATOR_CODE);
  view.setUint16(idDeltas + codes.length * 2, 1);
  return subtable;
}

// Format 6 subtable format number (clause 5.2.6), and its header: format(2) + length(2) + language(2) + firstCode(2) + entryCount(2) = 10 bytes, immediately followed by the glyphIdArray.
export const CMAP_FORMAT_6 = 6;
const FORMAT6_FIRST_CODE_OFFSET = 6;
const FORMAT6_ENTRY_COUNT_OFFSET = 8;
const FORMAT6_HEADER_SIZE = 10;

// Format 6 (trimmed table mapping): one contiguous run of codes with an explicit glyph ID each.
export function buildFormat6(
  mappings: ReadonlyMap<number, number>,
): Uint8Array {
  const codes = [...mappings.keys()].sort((a, b) => a - b);
  const firstCode = codes[0] ?? 0;
  const entryCount = (codes[codes.length - 1] ?? 0) - firstCode + 1;
  const subtable = new Uint8Array(FORMAT6_HEADER_SIZE + entryCount * 2);
  const view = new DataView(subtable.buffer);
  view.setUint16(0, CMAP_FORMAT_6);
  view.setUint16(2, subtable.length);
  view.setUint16(FORMAT6_FIRST_CODE_OFFSET, firstCode);
  view.setUint16(FORMAT6_ENTRY_COUNT_OFFSET, entryCount);
  for (const [code, glyphId] of mappings) {
    view.setUint16(FORMAT6_HEADER_SIZE + (code - firstCode) * 2, glyphId);
  }
  return subtable;
}

// A format 12 segmented subtable (OpenType cmap, "Format 12: Segmented Coverage"): one group per
// code, each covering the single code point it maps, which is the only shape this builder needs —
// every test mapping is expressible as single-code groups.
// Format 12 subtable format number ("Format 12: Segmented Coverage"). Header: format(2) + reserved(2) + length(4) + language(4) + numGroups(4) = 16 bytes; each SequentialMapGroup is startCharCode(4) + endCharCode(4) + startGlyphID(4) = 12 bytes.
export const CMAP_FORMAT_12 = 12;
const FORMAT12_LENGTH_OFFSET = 4;
const FORMAT12_NUM_GROUPS_OFFSET = 12;
const FORMAT12_HEADER_SIZE = 16;
const FORMAT12_GROUP_SIZE = 12;
const FORMAT12_GROUP_END_CHAR_OFFSET = 4;
const FORMAT12_GROUP_START_GLYPH_OFFSET = 8;

export function buildFormat12(
  mappings: ReadonlyMap<number, number>,
): Uint8Array {
  const groups: { startCode: number; glyphId: number }[] = [...mappings]
    .sort((a, b) => a[0] - b[0])
    .map(([code, glyphId]) => ({ startCode: code, glyphId }));
  const subtable = new Uint8Array(
    FORMAT12_HEADER_SIZE + groups.length * FORMAT12_GROUP_SIZE,
  );
  const view = new DataView(subtable.buffer);
  view.setUint16(0, CMAP_FORMAT_12);
  view.setUint32(FORMAT12_LENGTH_OFFSET, subtable.length);
  view.setUint32(FORMAT12_NUM_GROUPS_OFFSET, groups.length);
  groups.forEach((group, index) => {
    const at = FORMAT12_HEADER_SIZE + index * FORMAT12_GROUP_SIZE;
    view.setUint32(at, group.startCode);
    view.setUint32(at + FORMAT12_GROUP_END_CHAR_OFFSET, group.startCode);
    view.setUint32(at + FORMAT12_GROUP_START_GLYPH_OFFSET, group.glyphId);
  });
  return subtable;
}

// The cmap table's own header (version(2) + numTables(2) = 4 bytes) and each encoding record (platformID(2) + encodingID(2) + offset(4) = 8 bytes), per clause 5.2.1.
export const CMAP_TABLE_HEADER_SIZE = 4;
export const CMAP_ENCODING_RECORD_SIZE = 8;
export const CMAP_ENCODING_RECORD_OFFSET_FIELD = 4;
