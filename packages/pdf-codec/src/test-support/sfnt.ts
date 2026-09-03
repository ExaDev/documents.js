// Hand-built sfnt (TrueType/OpenType) fixtures: a table directory wrapping whichever synthetic tables a test needs, plus emitters for the two tables a font's own built-in encoding is recovered through -- 'cmap' (character code -> glyph ID) and 'post' (glyph ID -> glyph name). Built by literal byte layout against ISO/IEC 14496-22, deliberately importing nothing from this package's own sfnt readers, so a reader bug cannot cancel itself out against a fixture built by the same code.

const DIRECTORY_HEADER_SIZE = 12;
const RECORD_SIZE = 16;
const SFNT_VERSION_TRUETYPE = 0x00010000;

export function buildSfnt(
  tables: ReadonlyMap<string, Uint8Array<ArrayBuffer>>,
): Uint8Array<ArrayBuffer> {
  const entries = [...tables.entries()];
  const directorySize = DIRECTORY_HEADER_SIZE + entries.length * RECORD_SIZE;
  const totalLength = entries.reduce(
    (total, [, bytes]) => total + bytes.length,
    directorySize,
  );
  const font = new Uint8Array(totalLength);
  const view = new DataView(font.buffer);
  view.setUint32(0, SFNT_VERSION_TRUETYPE);
  view.setUint16(4, entries.length);
  let offset = directorySize;
  entries.forEach(([tag, bytes], index) => {
    const recordOffset = DIRECTORY_HEADER_SIZE + index * RECORD_SIZE;
    for (let i = 0; i < 4; i++) {
      font[recordOffset + i] = tag.charCodeAt(i);
    }
    view.setUint32(recordOffset + 8, offset);
    view.setUint32(recordOffset + 12, bytes.length);
    font.set(bytes, offset);
    offset += bytes.length;
  });
  return font;
}

// One 'cmap' subtable: the platform/encoding pair identifying what its codes mean, the subtable format to emit it in, and the code -> glyph ID mapping itself.
export interface CmapSubtableSpec {
  readonly platformId: number;
  readonly encodingId: number;
  readonly format: 0 | 4 | 6;
  readonly mappings: ReadonlyMap<number, number>;
}

// Format 0 (byte encoding table, clause 5.2.4): a fixed 256-entry glyph-ID array, so only codes 0..255 can appear.
function buildFormat0(mappings: ReadonlyMap<number, number>): Uint8Array {
  const subtable = new Uint8Array(262);
  const view = new DataView(subtable.buffer);
  view.setUint16(0, 0);
  view.setUint16(2, subtable.length);
  for (const [code, glyphId] of mappings) {
    subtable[6 + code] = glyphId;
  }
  return subtable;
}

// Format 4 (segment mapping to delta values): emitted as one single-code segment per mapping plus the mandatory 0xFFFF terminator, which is a legal -- if deliberately unoptimised -- encoding of any mapping and exercises the idDelta path rather than the glyph-index-array one.
function buildFormat4(mappings: ReadonlyMap<number, number>): Uint8Array {
  const codes = [...mappings.keys()].sort((a, b) => a - b);
  const segCount = codes.length + 1;
  const length = 16 + segCount * 8;
  const subtable = new Uint8Array(length);
  const view = new DataView(subtable.buffer);
  const searchRange = 2 * 2 ** Math.floor(Math.log2(segCount));
  view.setUint16(0, 4);
  view.setUint16(2, length);
  view.setUint16(6, segCount * 2);
  view.setUint16(8, searchRange);
  view.setUint16(10, Math.log2(searchRange / 2));
  view.setUint16(12, segCount * 2 - searchRange);
  const endCodes = 14;
  const startCodes = endCodes + segCount * 2 + 2;
  const idDeltas = startCodes + segCount * 2;
  codes.forEach((code, index) => {
    view.setUint16(endCodes + index * 2, code);
    view.setUint16(startCodes + index * 2, code);
    view.setUint16(
      idDeltas + index * 2,
      ((mappings.get(code) ?? 0) - code) & 0xffff,
    );
  });
  view.setUint16(endCodes + codes.length * 2, 0xffff);
  view.setUint16(startCodes + codes.length * 2, 0xffff);
  view.setUint16(idDeltas + codes.length * 2, 1);
  return subtable;
}

// Format 6 (trimmed table mapping): one contiguous run of codes with an explicit glyph ID each.
function buildFormat6(mappings: ReadonlyMap<number, number>): Uint8Array {
  const codes = [...mappings.keys()].sort((a, b) => a - b);
  const firstCode = codes[0] ?? 0;
  const entryCount = (codes[codes.length - 1] ?? 0) - firstCode + 1;
  const subtable = new Uint8Array(10 + entryCount * 2);
  const view = new DataView(subtable.buffer);
  view.setUint16(0, 6);
  view.setUint16(2, subtable.length);
  view.setUint16(6, firstCode);
  view.setUint16(8, entryCount);
  for (const [code, glyphId] of mappings) {
    view.setUint16(10 + (code - firstCode) * 2, glyphId);
  }
  return subtable;
}

export function buildCmapTable(
  subtables: readonly CmapSubtableSpec[],
): Uint8Array<ArrayBuffer> {
  const encoded = subtables.map((spec) =>
    spec.format === 0
      ? buildFormat0(spec.mappings)
      : spec.format === 4
        ? buildFormat4(spec.mappings)
        : buildFormat6(spec.mappings),
  );
  const headerSize = 4 + subtables.length * 8;
  const total = encoded.reduce((sum, bytes) => sum + bytes.length, headerSize);
  const table = new Uint8Array(total);
  const view = new DataView(table.buffer);
  view.setUint16(2, subtables.length);
  let offset = headerSize;
  subtables.forEach((spec, index) => {
    const recordOffset = 4 + index * 8;
    view.setUint16(recordOffset, spec.platformId);
    view.setUint16(recordOffset + 2, spec.encodingId);
    view.setUint32(recordOffset + 4, offset);
    const bytes = encoded[index];
    if (bytes === undefined) {
      throw new Error("cmap subtable was not encoded");
    }
    table.set(bytes, offset);
    offset += bytes.length;
  });
  return table;
}

const POST_HEADER_SIZE = 32;
const POST_MAC_STANDARD_NAME_COUNT = 258;

// A version 2.0 'post' table (clause 5.2.9) naming every glyph explicitly: each glyph's index points past the 258 standard Macintosh names into this table's own Pascal-string array. An empty name leaves that glyph pointing at the standard `.notdef` instead.
export function buildPostV2Table(
  glyphNames: readonly string[],
): Uint8Array<ArrayBuffer> {
  const custom = glyphNames.filter((name) => name !== "");
  const stringBytes = custom.flatMap((name) => [
    name.length,
    ...[...name].map((character) => character.charCodeAt(0)),
  ]);
  const table = new Uint8Array(
    POST_HEADER_SIZE + 2 + glyphNames.length * 2 + stringBytes.length,
  );
  const view = new DataView(table.buffer);
  view.setUint32(0, 0x00020000);
  view.setUint16(POST_HEADER_SIZE, glyphNames.length);
  let customIndex = 0;
  glyphNames.forEach((name, glyphId) => {
    const index =
      name === "" ? 0 : POST_MAC_STANDARD_NAME_COUNT + customIndex++;
    view.setUint16(POST_HEADER_SIZE + 2 + glyphId * 2, index);
  });
  table.set(
    Uint8Array.from(stringBytes),
    POST_HEADER_SIZE + 2 + glyphNames.length * 2,
  );
  return table;
}

// A version 3.0 'post' table: the header alone, declaring that the font carries no glyph names at all -- what a subsetting tool emits when it strips them, and the case a reader must recover a glyph's identity some other way for.
export function buildPostV3Table(): Uint8Array<ArrayBuffer> {
  const table = new Uint8Array(POST_HEADER_SIZE);
  new DataView(table.buffer).setUint32(0, 0x00030000);
  return table;
}
