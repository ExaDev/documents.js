import type { CmapLookup } from './cmap-table';
import { buildCmapLookup } from './cmap-table';
import { parseHead, parseMaxp } from './font-tables';
import type { GlyfTable } from './glyf';
import { parseGlyf } from './glyf';
import type { SfntFont } from './sfnt';
import { hasBytes, sfntTableBytes, u16, u32 } from './sfnt';

// A glyph subsetter for a TrueType-outline ('glyf'/'loca') sfnt font: given the Unicode code points a document actually uses for one face, it emits a new, much smaller sfnt font carrying only those glyphs' outlines.
//
// The one design decision everything else follows from: glyph IDs are PRESERVED, never renumbered. A glyph that was ID 79 in the source font is still ID 79 in the subset; every unused ID below the highest used one survives as an empty 'loca' entry (zero bytes of glyph data) rather than being squeezed out. That buys three things a renumbering subsetter has to work for. A composite glyph's own component records reference their base letter and combining marks by glyph ID, inside bytes this subsetter copies verbatim; preserving IDs means those references stay correct without rewriting a single glyph's bytes. A caller's own already-resolved code-point-to-glyph-ID mapping (what cmap-table.ts hands back, and what a text run has already been laid out against) stays valid against the subset. And CID == GID stays trivially true for the embedded font program, which is the same invariant the math-font pipeline already relies on for its own, unrelated reason (see math-font-write.ts: a bare CFF program embedded for a /CIDFontType0 is indexed by glyph order, so no /CIDToGIDMap is needed) -- here it means a /CIDFontType2 needs only /CIDToGIDMap /Identity.
//
// The honest cost, stated rather than buried: an unused slot still occupies four bytes of 'loca' and four of 'hmtx', so those two tables stay proportional to the HIGHEST used glyph ID rather than to the number of glyphs actually kept. Outlines are where the bulk of a text font lives, and they collapse to the handful of glyphs a document really uses, so the output is a small fraction of the source either way -- but for a document that touches one glyph near the end of a large font's glyph order (an accented character's own combining mark, say), most of what remains is those two index tables rather than outline data.
//
// What the output contains (ISO/IEC 14496-22 for the sfnt tables themselves, ISO 32000-1 9.9 for what a PDF embedded font program actually needs):
//   - rebuilt: 'head' (with indexToLocFormat forced long), 'hhea', 'maxp', 'loca', 'glyf', 'hmtx'
//   - copied verbatim when the source has them: 'cvt ', 'fpgm', 'prep' -- the hinting programs, which are global to the font rather than per-glyph, so a subset that drops them renders differently at small sizes than the font it was cut from
//   - stubbed: 'post', as a version 3.0 header meaning "this font carries no glyph names"
//   - omitted: 'cmap' (a CIDFontType2 program is addressed by glyph ID through the PDF font dictionary's own encoding, never through the font's own character map), and 'name'/'OS/2'/'GSUB'/'GPOS'/'kern' (a PDF FontDescriptor carries the metrics and style bits a consumer reads, and nothing in an embedded program's own layout tables is consulted once text has already been laid out and positioned)
//
// The whole module returns `undefined` rather than throwing for any font it cannot subset correctly -- a CFF-flavoured font with no 'glyf' at all, a missing or truncated table it must rebuild, a composite whose component list runs past the end of its own glyph, or a 'cmap' pointing outside the glyph range. The caller's fallback for each is the same (embed the source font whole, or substitute another face), and none of them is a defect in this code worth aborting a whole document's conversion over.

export interface SfntSubsetResult {
  readonly bytes: Uint8Array<ArrayBuffer>;
  // The subset's own glyph count: one past the highest glyph ID it carries, since IDs are preserved and the trailing unused ones are simply not there.
  readonly numGlyphs: number;
  // Every glyph ID whose outline the subset carries, ascending: the code points' own glyphs, GID 0 (.notdef), and every glyph reached transitively through a composite's components. Every other ID below `numGlyphs` is present but empty.
  readonly glyphIds: readonly number[];
  // Code points the source font's own 'cmap' has no glyph for, ascending. Reported rather than silently dropped: a caller asking for a character its chosen face cannot render needs to know that happened, and only the caller can decide whether to substitute a face or accept a missing glyph.
  readonly unmappedCodePoints: readonly number[];
}

const HEAD_TABLE_SIZE = 54;
const HEAD_CHECKSUM_ADJUSTMENT_OFFSET = 8;
const HEAD_INDEX_TO_LOC_FORMAT_OFFSET = 50;
const INDEX_TO_LOC_FORMAT_LONG = 1;

const HHEA_TABLE_SIZE = 36;
const HHEA_NUMBER_OF_HMETRICS_OFFSET = 34;

const MAXP_MIN_SIZE = 6; // version (Fixed) + numGlyphs -- the whole of a version 0.5 'maxp'
const MAXP_NUM_GLYPHS_OFFSET = 4;

// A 'post' version 3.0 header, the format whose whole meaning is "no glyph names follow" (clause 5.2.5). Everything after the version and the four metric fields is a memory-usage hint no consumer of an embedded PDF font program reads.
const POST_STUB_SIZE = 32;
const POST_VERSION_3_0 = 0x00030000;
const POST_METRICS_OFFSET = 4; // italicAngle, underlinePosition, underlineThickness, isFixedPitch
const POST_METRICS_SIZE = 12;

const LONG_HOR_METRIC_SIZE = 4; // advanceWidth (uint16) + leftSideBearing (int16)
const LEFT_SIDE_BEARING_SIZE = 2; // one entry of 'hmtx's trailing bearing-only array
const LOCA_LONG_ENTRY_SIZE = 4;

const TABLE_DIRECTORY_HEADER_SIZE = 12;
const TABLE_RECORD_SIZE = 16;
const SFNT_VERSION_TRUETYPE = 0x00010000;
// The value a whole file's checksum is defined to sum to once 'head's own checkSumAdjustment is filled in (clause 4.1) -- so the adjustment is this constant minus the checksum of the file with that field zeroed.
const CHECKSUM_ADJUSTMENT_MAGIC = 0xb1b0afba;

const GLYPH_ALIGNMENT = 4;

// Tables copied byte for byte when the source font has them. The hinting programs are the whole list: 'fpgm' (the font program, run once), 'prep' (the control-value program, run at each size change), and 'cvt ' (the control values both read). Dropping them from a subset would silently change how the same outlines are gridfit at small sizes.
const COPIED_TAGS: readonly string[] = ['cvt ', 'fpgm', 'prep'];

function alignUp(value: number): number {
  return Math.ceil(value / GLYPH_ALIGNMENT) * GLYPH_ALIGNMENT;
}

function writeU16(bytes: Uint8Array<ArrayBuffer>, offset: number, value: number): void {
  bytes[offset] = (value >>> 8) & 0xff;
  bytes[offset + 1] = value & 0xff;
}

function writeU32(bytes: Uint8Array<ArrayBuffer>, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

// The sfnt checksum (clause 4.1): the sum of a region's big-endian uint32s, truncated to 32 bits. Callers pass a 4-byte-aligned region only -- every table this module writes is zero-padded to a multiple of four, which is the same thing the spec's own "pad with zeroes" wording produces.
function checksum(bytes: Uint8Array<ArrayBuffer>, offset: number, length: number): number {
  let sum = 0;
  for (let i = 0; i < length; i += GLYPH_ALIGNMENT) {
    sum = (sum + u32(bytes, offset + i)) >>> 0;
  }
  return sum;
}

interface SubsetTable {
  readonly tag: string;
  readonly data: Uint8Array<ArrayBuffer>;
}

interface SourceHmtx {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly numberOfHMetrics: number;
}

// One glyph's advance width and left side bearing, both as their raw 16-bit patterns so the bearing round-trips without a signed/unsigned conversion in either direction. Beyond `numberOfHMetrics` a font stores only bearings, every such glyph sharing the last explicit advance (clause 5.2.4) -- the subset re-expands that into a full record per glyph, so its own numberOfHMetrics can simply equal its glyph count.
function readHorizontalMetrics(source: SourceHmtx, glyphId: number): { advanceWidth: number; leftSideBearing: number } | undefined {
  if (glyphId < source.numberOfHMetrics) {
    const offset = glyphId * LONG_HOR_METRIC_SIZE;
    if (!hasBytes(source.bytes, offset, LONG_HOR_METRIC_SIZE)) {
      return undefined;
    }
    return { advanceWidth: u16(source.bytes, offset), leftSideBearing: u16(source.bytes, offset + 2) };
  }
  const lastAdvanceOffset = (source.numberOfHMetrics - 1) * LONG_HOR_METRIC_SIZE;
  const bearingOffset = source.numberOfHMetrics * LONG_HOR_METRIC_SIZE + (glyphId - source.numberOfHMetrics) * LEFT_SIDE_BEARING_SIZE;
  if (!hasBytes(source.bytes, lastAdvanceOffset, LONG_HOR_METRIC_SIZE) || !hasBytes(source.bytes, bearingOffset, LEFT_SIDE_BEARING_SIZE)) {
    return undefined;
  }
  return { advanceWidth: u16(source.bytes, lastAdvanceOffset), leftSideBearing: u16(source.bytes, bearingOffset) };
}

function buildPostStub(font: SfntFont): Uint8Array<ArrayBuffer> {
  const post = new Uint8Array(POST_STUB_SIZE);
  writeU32(post, 0, POST_VERSION_3_0);
  const sourcePost = sfntTableBytes(font, 'post');
  // italicAngle, underline geometry, and isFixedPitch are real font-wide facts a consumer may still read off an embedded program, so they are carried over where the source declares them; the four trailing memory-usage fields are left zero, which is what every subsetting tool writes and what the spec itself says may be ignored.
  if (sourcePost !== undefined && hasBytes(sourcePost, POST_METRICS_OFFSET, POST_METRICS_SIZE)) {
    post.set(sourcePost.subarray(POST_METRICS_OFFSET, POST_METRICS_OFFSET + POST_METRICS_SIZE), POST_METRICS_OFFSET);
  }
  return post;
}

// The transitive closure a subset needs: the glyphs the code points map to, GID 0, and -- following each composite's own component records, which themselves may be composite -- every glyph any of those is assembled from.
function collectGlyphIds(glyf: GlyfTable, cmap: CmapLookup, numGlyphs: number, codePoints: Iterable<number>): { used: Set<number>; unmapped: number[] } | undefined {
  const used = new Set<number>([0]);
  const unmapped = new Set<number>();
  const pending: number[] = [0];
  for (const codePoint of codePoints) {
    const glyphId = cmap(codePoint);
    if (glyphId === undefined) {
      unmapped.add(codePoint);
      continue;
    }
    if (glyphId >= numGlyphs) {
      return undefined; // a 'cmap' entry pointing past 'maxp's own glyph count: the font is internally inconsistent, and any subset built from it would be missing exactly the glyph the caller asked for
    }
    if (!used.has(glyphId)) {
      used.add(glyphId);
      pending.push(glyphId);
    }
  }

  while (pending.length > 0) {
    const glyphId = pending.pop()!;
    const bytes = glyf.glyphBytes(glyphId);
    if (bytes === undefined) {
      return undefined; // an unreadable 'loca' entry, as opposed to a legitimately empty glyph (a space), which is a zero-length one
    }
    const header = glyf.glyphHeader(glyphId);
    if (header === undefined || header.numberOfContours >= 0) {
      continue; // empty or simple: no components to follow
    }
    const components = glyf.compositeComponents(glyphId);
    if (components === undefined) {
      return undefined; // a composite whose component list is truncated -- glyf.ts never returns a partial walk, and half a composite's components would emit a visibly broken glyph
    }
    for (const component of components) {
      if (component.glyphIndex >= numGlyphs) {
        return undefined;
      }
      if (!used.has(component.glyphIndex)) {
        used.add(component.glyphIndex);
        pending.push(component.glyphIndex);
      }
    }
  }

  return { used, unmapped: [...unmapped].sort((a, b) => a - b) };
}

export function subsetSfnt(font: SfntFont, codePoints: Iterable<number>): SfntSubsetResult | undefined {
  const head = parseHead(font);
  const maxp = parseMaxp(font);
  const sourceHead = sfntTableBytes(font, 'head');
  const sourceHhea = sfntTableBytes(font, 'hhea');
  const sourceMaxp = sfntTableBytes(font, 'maxp');
  const sourceHmtx = sfntTableBytes(font, 'hmtx');
  if (head === undefined || maxp === undefined || sourceHead === undefined || sourceHhea === undefined || sourceMaxp === undefined || sourceHmtx === undefined) {
    return undefined;
  }
  if (!hasBytes(sourceHead, 0, HEAD_TABLE_SIZE) || !hasBytes(sourceHhea, 0, HHEA_TABLE_SIZE) || !hasBytes(sourceMaxp, 0, MAXP_MIN_SIZE)) {
    return undefined;
  }
  const numberOfHMetrics = u16(sourceHhea, HHEA_NUMBER_OF_HMETRICS_OFFSET);
  if (numberOfHMetrics === 0) {
    return undefined;
  }

  const glyf = parseGlyf(font, { numGlyphs: maxp.numGlyphs, indexToLocFormat: head.indexToLocFormat });
  const cmap = buildCmapLookup(font);
  if (glyf === undefined || cmap === undefined) {
    return undefined; // no 'glyf'/'loca' at all (a CFF-flavoured font, which needs Type2 charstring subsetting rather than this), or no character map to resolve the caller's code points through
  }
  const collected = collectGlyphIds(glyf, cmap, maxp.numGlyphs, codePoints);
  if (collected === undefined) {
    return undefined;
  }
  const glyphIds = [...collected.used].sort((a, b) => a - b);
  const numGlyphs = glyphIds[glyphIds.length - 1]! + 1; // GID-preserving: the subset spans 0..maxUsedGid, with every unused slot in between kept empty

  // 'glyf' and 'loca' together. Each used glyph's own bytes go in verbatim, padded to a four-byte boundary; every unused glyph gets a zero-length entry, which is exactly how the format already represents a glyph with no outline. The padding lands inside the glyph's own 'loca' range, since the next entry points past it -- the standard way the format expresses alignment, and invisible to a consumer, which stops at the end of the glyph's own contour data.
  const outlines = new Map<number, Uint8Array<ArrayBuffer>>();
  let glyfLength = 0;
  for (const glyphId of glyphIds) {
    const bytes = glyf.glyphBytes(glyphId);
    if (bytes === undefined) {
      return undefined;
    }
    outlines.set(glyphId, bytes);
    glyfLength += alignUp(bytes.length);
  }
  const glyfData = new Uint8Array(glyfLength);
  const locaData = new Uint8Array((numGlyphs + 1) * LOCA_LONG_ENTRY_SIZE);
  let glyfOffset = 0;
  for (let glyphId = 0; glyphId < numGlyphs; glyphId++) {
    writeU32(locaData, glyphId * LOCA_LONG_ENTRY_SIZE, glyfOffset);
    const bytes = outlines.get(glyphId);
    if (bytes === undefined) {
      continue; // an unused slot: its own entry and the next one are equal, i.e. zero bytes of glyph data
    }
    glyfData.set(bytes, glyfOffset);
    glyfOffset += alignUp(bytes.length); // the padding bytes are already zero from the allocation
  }
  writeU32(locaData, numGlyphs * LOCA_LONG_ENTRY_SIZE, glyfOffset);

  // 'hmtx', re-expanded to one full record per glyph so the subset's own numberOfHMetrics can equal its glyph count -- one code path, always legal, at a cost of two bytes per glyph the source stored bearing-only.
  const hmtxData = new Uint8Array(numGlyphs * LONG_HOR_METRIC_SIZE);
  for (let glyphId = 0; glyphId < numGlyphs; glyphId++) {
    const metrics = readHorizontalMetrics({ bytes: sourceHmtx, numberOfHMetrics }, glyphId);
    if (metrics === undefined) {
      return undefined; // a truncated 'hmtx': the source font cannot state this glyph's advance, and inventing one would silently change how text measures
    }
    writeU16(hmtxData, glyphId * LONG_HOR_METRIC_SIZE, metrics.advanceWidth);
    writeU16(hmtxData, glyphId * LONG_HOR_METRIC_SIZE + 2, metrics.leftSideBearing);
  }

  const headData = new Uint8Array(HEAD_TABLE_SIZE);
  headData.set(sourceHead.subarray(0, HEAD_TABLE_SIZE));
  writeU32(headData, HEAD_CHECKSUM_ADJUSTMENT_OFFSET, 0); // zeroed while every checksum is computed, then filled in once the whole file exists
  writeU16(headData, HEAD_INDEX_TO_LOC_FORMAT_OFFSET, INDEX_TO_LOC_FORMAT_LONG);

  const hheaData = new Uint8Array(HHEA_TABLE_SIZE);
  hheaData.set(sourceHhea.subarray(0, HHEA_TABLE_SIZE));
  writeU16(hheaData, HHEA_NUMBER_OF_HMETRICS_OFFSET, numGlyphs);

  // 'maxp' is carried over whole with only numGlyphs changed: every other field in a version 1.0 'maxp' is an upper bound (maximum points, contours, component depth, ...), and a bound that held for the whole font still holds for a subset of it.
  const maxpData = new Uint8Array(sourceMaxp.length);
  maxpData.set(sourceMaxp);
  writeU16(maxpData, MAXP_NUM_GLYPHS_OFFSET, numGlyphs);

  const tables: SubsetTable[] = [
    { tag: 'glyf', data: glyfData },
    { tag: 'head', data: headData },
    { tag: 'hhea', data: hheaData },
    { tag: 'hmtx', data: hmtxData },
    { tag: 'loca', data: locaData },
    { tag: 'maxp', data: maxpData },
    { tag: 'post', data: buildPostStub(font) },
  ];
  for (const tag of COPIED_TAGS) {
    const bytes = sfntTableBytes(font, tag);
    if (bytes !== undefined) {
      const copy = new Uint8Array(bytes.length);
      copy.set(bytes);
      tables.push({ tag, data: copy });
    }
  }
  tables.sort((a, b) => (a.tag < b.tag ? -1 : 1)); // table records are ordered by tag, ascending (clause 4.2); tags are unique, so no equal case can arise

  const numTables = tables.length;
  let entrySelector = 0;
  while (1 << (entrySelector + 1) <= numTables) {
    entrySelector++;
  }
  const searchRange = (1 << entrySelector) * TABLE_RECORD_SIZE;
  const rangeShift = numTables * TABLE_RECORD_SIZE - searchRange;

  const directorySize = TABLE_DIRECTORY_HEADER_SIZE + numTables * TABLE_RECORD_SIZE;
  const offsets: number[] = [];
  let fileLength = alignUp(directorySize);
  for (const table of tables) {
    offsets.push(fileLength);
    fileLength += alignUp(table.data.length);
  }

  const file = new Uint8Array(fileLength);
  writeU32(file, 0, SFNT_VERSION_TRUETYPE);
  writeU16(file, 4, numTables);
  writeU16(file, 6, searchRange);
  writeU16(file, 8, entrySelector);
  writeU16(file, 10, rangeShift);
  for (let i = 0; i < numTables; i++) {
    const table = tables[i]!;
    const tableOffset = offsets[i]!;
    file.set(table.data, tableOffset);
    const recordOffset = TABLE_DIRECTORY_HEADER_SIZE + i * TABLE_RECORD_SIZE;
    for (let c = 0; c < table.tag.length; c++) {
      file[recordOffset + c] = table.tag.charCodeAt(c);
    }
    // The record's own checksum covers the table's zero-padded region, and its length field the unpadded one (clause 4.2). For 'head' this is the checksum with checkSumAdjustment zeroed, which is exactly what the spec asks for and what the file currently holds.
    writeU32(file, recordOffset + 4, checksum(file, tableOffset, alignUp(table.data.length)));
    writeU32(file, recordOffset + 8, tableOffset);
    writeU32(file, recordOffset + 12, table.data.length);
  }

  // Last, once every other byte of the file is final: the whole file, with this field still zero, must sum to the magic constant once the value written here is added back (clause 4.1). The 'head' record's own checksum above deliberately stays as computed against the zeroed field, which is what that record is defined to hold.
  const headOffsetInFile = offsets[tables.findIndex((table) => table.tag === 'head')]!;
  writeU32(file, headOffsetInFile + HEAD_CHECKSUM_ADJUSTMENT_OFFSET, (CHECKSUM_ADJUSTMENT_MAGIC - checksum(file, 0, fileLength)) >>> 0);

  return { bytes: file, numGlyphs, glyphIds, unmappedCodePoints: collected.unmapped };
}
