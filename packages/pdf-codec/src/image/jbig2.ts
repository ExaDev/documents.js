import { decodeCcittFax } from './ccitt';
import { MqDecoder, createArithContexts } from './jbig2-arith';
import type { Jbig2Bitmap, Jbig2CombinationOperator } from './jbig2-bitmap';
import { combineBitmap, combinationOperatorFromCode, createBitmap, getPixel, packBitmapRows, unpackBitmapRows } from './jbig2-bitmap';
import type { Jbig2AtPixel } from './jbig2-generic';
import { Jbig2ParseError, Jbig2UnsupportedError } from './jbig2-errors';
import { GENERIC_CONTEXT_BITS, NOMINAL_REFINEMENT_AT, REFINEMENT_CONTEXT_BITS, decodeGenericRegion, decodeRefinementRegion } from './jbig2-generic';
import type { TextRegionParams } from './jbig2-text';
import { createTextArithContexts, decodeSymbolDictionary, decodeTextRegion, referenceCornerFromCode, symbolCodeLength } from './jbig2-text';

// A hand-written JBIG2 decoder (ITU-T T.88), reading the "embedded stream" organisation a PDF /JBIG2Decode filter carries: a bare sequence of segments for one page, with no file header and no page-count preamble. This module owns the segment framing of T.88 clause 7 and the page composition of 6.2.2; the decoding procedures themselves live in jbig2-arith.ts (the MQ coder and the integer/symbol-ID procedures of Annexes A and E), jbig2-generic.ts (generic and refinement regions, 6.2 and 6.3), and jbig2-text.ts (symbol dictionaries and text regions, 6.5 and 6.4).
//
// Like its src/image/ siblings this module has zero PDF knowledge: the /JBIG2Globals stream is handed here as plain bytes by src/filters.ts, and the output is a packed bitmap in JBIG2's OWN polarity, where a 1 bit is black (T.88 3.29). PDF's filter output convention is the inverse of that, and inverting is the caller's job.
//
// What is implemented: generic regions (arithmetic, templates 0-3, TPGDON, and MMR via the T.6 decoder in ccitt.ts), refinement regions, symbol dictionaries and text regions in their arithmetic form, and page composition with all five combination operators. What is not: the Huffman-coded forms of symbol dictionaries and text regions, halftone regions and pattern dictionaries, intermediate (auxiliary-buffer) regions, and segments of unknown length. Each of those raises Jbig2UnsupportedError naming itself rather than producing a plausible-looking wrong bitmap; a stream that is simply broken raises Jbig2ParseError instead (see jbig2-errors.ts for why the two are kept apart).

// T.88 7.3: the segment types this decoder recognises. Everything else is reported by number.
const SEGMENT_SYMBOL_DICTIONARY = 0;
const SEGMENT_INTERMEDIATE_TEXT_REGION = 4;
const SEGMENT_IMMEDIATE_TEXT_REGION = 6;
const SEGMENT_IMMEDIATE_LOSSLESS_TEXT_REGION = 7;
const SEGMENT_PATTERN_DICTIONARY = 16;
const SEGMENT_INTERMEDIATE_HALFTONE_REGION = 20;
const SEGMENT_IMMEDIATE_HALFTONE_REGION = 22;
const SEGMENT_IMMEDIATE_LOSSLESS_HALFTONE_REGION = 23;
const SEGMENT_INTERMEDIATE_GENERIC_REGION = 36;
const SEGMENT_IMMEDIATE_GENERIC_REGION = 38;
const SEGMENT_IMMEDIATE_LOSSLESS_GENERIC_REGION = 39;
const SEGMENT_INTERMEDIATE_REFINEMENT_REGION = 40;
const SEGMENT_IMMEDIATE_REFINEMENT_REGION = 42;
const SEGMENT_IMMEDIATE_LOSSLESS_REFINEMENT_REGION = 43;
const SEGMENT_PAGE_INFORMATION = 48;
const SEGMENT_END_OF_PAGE = 49;
const SEGMENT_END_OF_STRIPE = 50;
const SEGMENT_END_OF_FILE = 51;
const SEGMENT_PROFILES = 52;
const SEGMENT_TABLES = 53;
const SEGMENT_EXTENSION = 62;

// T.88 7.2.7: a data length of 0xFFFFFFFF means the segment's own length is not transmitted, and the decoder must find the end by searching for a terminating row count. Only ever legal for an immediate generic region, and not something any mainstream encoder emits.
const UNKNOWN_DATA_LENGTH = 0xffffffff;

// T.88 7.4.8.5: a page whose height is not known when its page information segment is written, resolved either by end-of-stripe segments or -- in a PDF, where the image dictionary already declares it -- by the caller's own height.
const UNKNOWN_PAGE_HEIGHT = 0xffffffff;

interface SegmentHeader {
  readonly number: number;
  readonly type: number;
  readonly referredTo: readonly number[];
  readonly pageAssociation: number;
  readonly dataStart: number;
  readonly dataEnd: number;
}

class ByteCursor {
  position: number;

  constructor(
    readonly data: Uint8Array<ArrayBuffer>,
    start = 0,
  ) {
    this.position = start;
  }

  get remaining(): number {
    return this.data.length - this.position;
  }

  uint8(): number {
    const value = this.data[this.position];
    if (value === undefined) {
      throw new Jbig2ParseError('JBIG2 stream ended in the middle of a segment header');
    }
    this.position++;
    return value;
  }

  uint16(): number {
    return (this.uint8() << 8) | this.uint8();
  }

  uint32(): number {
    return ((this.uint8() << 24) | (this.uint8() << 16) | (this.uint8() << 8) | this.uint8()) >>> 0;
  }

  int8(): number {
    const value = this.uint8();
    return value > 127 ? value - 256 : value;
  }
}

function readSegmentHeader(cursor: ByteCursor, dataLength: number): SegmentHeader {
  const number = cursor.uint32();
  const flags = cursor.uint8();
  const type = flags & 0x3f;
  const pageAssociationIsLong = (flags & 0x40) !== 0;

  // T.88 7.2.4: the referred-to count is the top three bits of one byte, unless that value is 7, in which case a 29-bit count follows and a retain-flag bit array after it.
  const countByte = cursor.uint8();
  let referredCount = countByte >> 5;
  if (referredCount === 7) {
    cursor.position -= 1;
    referredCount = cursor.uint32() & 0x1fffffff;
    cursor.position += Math.ceil((referredCount + 1) / 8);
  }

  // T.88 7.2.5: each referred-to segment number is sized by THIS segment's own number, since no segment may refer forwards.
  const referredSize = number <= 256 ? 1 : number <= 65536 ? 2 : 4;
  const referredTo: number[] = [];
  for (let i = 0; i < referredCount; i++) {
    referredTo.push(referredSize === 1 ? cursor.uint8() : referredSize === 2 ? cursor.uint16() : cursor.uint32());
  }

  const pageAssociation = pageAssociationIsLong ? cursor.uint32() : cursor.uint8();
  const declaredLength = cursor.uint32();
  if (declaredLength === UNKNOWN_DATA_LENGTH) {
    throw new Jbig2UnsupportedError('JBIG2 segment declares an unknown data length (T.88 7.2.7), which this decoder does not scan for a terminator');
  }
  const dataStart = cursor.position;
  const dataEnd = dataStart + declaredLength;
  if (dataEnd > dataLength) {
    throw new Jbig2ParseError(`JBIG2 segment ${String(number)} declares ${String(declaredLength)} bytes of data but only ${String(dataLength - dataStart)} remain`);
  }
  return { number, type, referredTo, pageAssociation, dataStart, dataEnd };
}

interface RegionInfo {
  readonly width: number;
  readonly height: number;
  readonly x: number;
  readonly y: number;
  readonly combinationOperator: Jbig2CombinationOperator;
}

// T.88 7.4.1: the region segment information field every region segment starts with.
function readRegionInfo(cursor: ByteCursor): RegionInfo {
  const width = cursor.uint32();
  const height = cursor.uint32();
  const x = cursor.uint32();
  const y = cursor.uint32();
  const flags = cursor.uint8();
  const combinationOperator = combinationOperatorFromCode(flags & 0x07);
  if (combinationOperator === undefined) {
    throw new Jbig2ParseError(`JBIG2 region declares external combination operator ${String(flags & 0x07)}, outside the 0-4 range T.88 Table 12 defines`);
  }
  return { width, height, x, y, combinationOperator };
}

function readAtPixels(cursor: ByteCursor, count: number): Jbig2AtPixel[] {
  const at: Jbig2AtPixel[] = [];
  for (let i = 0; i < count; i++) {
    at.push({ x: cursor.int8(), y: cursor.int8() });
  }
  return at;
}

interface PageState {
  bitmap: Jbig2Bitmap;
  readonly defaultCombinationOperator: Jbig2CombinationOperator;
  readonly combinationOperatorOverridden: boolean;
}

export interface Jbig2DecodeOptions {
  // The /JBIG2Globals stream's own bytes: segments (typically symbol dictionaries) shared by every page of the document, parsed before the page's own segments so a text region can refer to them.
  readonly globals?: Uint8Array<ArrayBuffer>;
  // The output size the caller already knows, which for a PDF image is its own /Width and /Height. Overrides the page information segment, and is the only way to resolve a page whose declared height is "unknown".
  readonly width?: number;
  readonly height?: number;
  readonly onWarning?: (message: string) => void;
}

export interface Jbig2Image {
  // Packed 1 bit per pixel, MSB first, each row padded out to a whole number of bytes. A 1 bit is a BLACK pixel, JBIG2's own polarity -- the inverse of what a PDF /DeviceGray image expects.
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly width: number;
  readonly height: number;
}

class Jbig2Decoder {
  private page: PageState | undefined;
  private readonly exportedSymbols = new Map<number, readonly Jbig2Bitmap[]>();

  constructor(private readonly options: Jbig2DecodeOptions) {}

  warn(message: string): void {
    this.options.onWarning?.(message);
  }

  run(data: Uint8Array<ArrayBuffer>): void {
    const cursor = new ByteCursor(data);
    while (cursor.remaining > 0) {
      const header = readSegmentHeader(cursor, data.length);
      this.handleSegment(header, data);
      cursor.position = header.dataEnd;
    }
  }

  private handleSegment(header: SegmentHeader, data: Uint8Array<ArrayBuffer>): void {
    const cursor = new ByteCursor(data, header.dataStart);
    switch (header.type) {
      case SEGMENT_PAGE_INFORMATION:
        this.readPageInformation(cursor);
        return;
      case SEGMENT_SYMBOL_DICTIONARY:
        this.exportedSymbols.set(header.number, this.readSymbolDictionary(header, cursor));
        return;
      case SEGMENT_IMMEDIATE_GENERIC_REGION:
      case SEGMENT_IMMEDIATE_LOSSLESS_GENERIC_REGION:
        this.readGenericRegion(cursor, header.dataEnd);
        return;
      case SEGMENT_IMMEDIATE_TEXT_REGION:
      case SEGMENT_IMMEDIATE_LOSSLESS_TEXT_REGION:
        this.readTextRegion(header, cursor);
        return;
      case SEGMENT_IMMEDIATE_REFINEMENT_REGION:
      case SEGMENT_IMMEDIATE_LOSSLESS_REFINEMENT_REGION:
        this.readRefinementRegion(cursor, header.dataEnd);
        return;
      case SEGMENT_END_OF_PAGE:
      case SEGMENT_END_OF_STRIPE:
      case SEGMENT_END_OF_FILE:
      case SEGMENT_PROFILES:
      case SEGMENT_EXTENSION:
        return; // Framing and metadata only: nothing this decoder needs to act on.
      case SEGMENT_INTERMEDIATE_GENERIC_REGION:
      case SEGMENT_INTERMEDIATE_TEXT_REGION:
      case SEGMENT_INTERMEDIATE_REFINEMENT_REGION:
      case SEGMENT_INTERMEDIATE_HALFTONE_REGION:
        throw new Jbig2UnsupportedError(`JBIG2 segment ${String(header.number)} is an intermediate region (type ${String(header.type)}), which is retained in an auxiliary buffer rather than composed onto the page; auxiliary buffers are not implemented`);
      case SEGMENT_PATTERN_DICTIONARY:
      case SEGMENT_IMMEDIATE_HALFTONE_REGION:
      case SEGMENT_IMMEDIATE_LOSSLESS_HALFTONE_REGION:
        throw new Jbig2UnsupportedError(`JBIG2 segment ${String(header.number)} is a halftone region or pattern dictionary (type ${String(header.type)}), which is not implemented`);
      case SEGMENT_TABLES:
        throw new Jbig2UnsupportedError(`JBIG2 segment ${String(header.number)} is a custom Huffman table, which only the Huffman-coded region forms use; those are not implemented`);
      default:
        throw new Jbig2UnsupportedError(`JBIG2 segment ${String(header.number)} has unrecognised type ${String(header.type)}`);
    }
  }

  // T.88 7.4.8: the page's own size, default pixel value, and default combination operator.
  private readPageInformation(cursor: ByteCursor): void {
    const declaredWidth = cursor.uint32();
    const declaredHeight = cursor.uint32();
    cursor.uint32(); // X resolution, in pixels per metre -- display metadata this decoder has no use for.
    cursor.uint32(); // Y resolution.
    const flags = cursor.uint8();
    cursor.uint16(); // Striping information: the maximum stripe size, which only matters when composing a page from end-of-stripe segments.

    const width = this.options.width ?? declaredWidth;
    const declaredOrHintedHeight = declaredHeight === UNKNOWN_PAGE_HEIGHT ? this.options.height : (this.options.height ?? declaredHeight);
    if (declaredOrHintedHeight === undefined) {
      throw new Jbig2UnsupportedError('JBIG2 page information declares an unknown height and the caller supplied none; a striped page with no known height is not resolvable from the page segments alone');
    }

    const defaultPixel = (flags >> 2) & 1;
    const defaultCombinationOperator = combinationOperatorFromCode((flags >> 3) & 0x03);
    if (defaultCombinationOperator === undefined) {
      throw new Jbig2ParseError('JBIG2 page information declares an unrecognised default combination operator');
    }
    this.page = {
      bitmap: createBitmap(width, declaredOrHintedHeight, defaultPixel),
      defaultCombinationOperator,
      combinationOperatorOverridden: (flags & 0x40) !== 0,
    };
  }

  private requirePage(): PageState {
    if (this.page === undefined) {
      throw new Jbig2ParseError('JBIG2 stream composed a region before any page information segment declared the page');
    }
    return this.page;
  }

  private compose(region: RegionInfo, bitmap: Jbig2Bitmap): void {
    const page = this.requirePage();
    combineBitmap(page.bitmap, bitmap, region.x, region.y, page.combinationOperatorOverridden ? region.combinationOperator : page.defaultCombinationOperator);
  }

  // T.88 7.4.6: an immediate generic region segment.
  private readGenericRegion(cursor: ByteCursor, dataEnd: number): void {
    const region = readRegionInfo(cursor);
    const flags = cursor.uint8();
    const mmr = (flags & 0x01) !== 0;
    const template = (flags >> 1) & 0x03;
    const tpgdon = (flags & 0x08) !== 0;
    if ((flags & 0x10) !== 0) {
      throw new Jbig2UnsupportedError('JBIG2 generic region sets EXTTEMPLATE, the twelve-adaptive-pixel template of T.88 Amendment 2, which is not implemented');
    }
    const at = mmr ? [] : readAtPixels(cursor, template === 0 ? 4 : 1);
    const payload = cursor.position;

    if (mmr) {
      // T.88 6.2.6: an MMR-coded generic region is exactly a T.6 (Group 4) bitstream, which src/image/ccitt.ts already decodes -- with black in the 1 bits, matching JBIG2's own polarity.
      const fax = decodeCcittFax(cursor.data.subarray(payload, dataEnd), { k: -1, columns: region.width, rows: region.height, blackIs1: true, onWarning: (message) => this.warn(message) });
      this.compose(region, unpackBitmapRows(fax.bytes, region.width, region.height));
      return;
    }

    const mq = new MqDecoder(cursor.data, payload, dataEnd);
    const contexts = createArithContexts(GENERIC_CONTEXT_BITS[template] ?? 16);
    this.compose(region, decodeGenericRegion(region.width, region.height, { template, tpgdon, at }, mq, contexts));
  }

  // T.88 7.4.7: an immediate refinement region segment, refining whatever the page already holds at that location.
  private readRefinementRegion(cursor: ByteCursor, dataEnd: number): void {
    const region = readRegionInfo(cursor);
    const flags = cursor.uint8();
    const template = flags & 0x01;
    const tpgron = (flags & 0x02) !== 0;
    const at = template === 0 ? readAtPixels(cursor, 2) : [...NOMINAL_REFINEMENT_AT];
    const page = this.requirePage();

    // With no intermediate buffers in play, T.88 7.4.7.2 makes the reference the page region the refinement covers.
    const reference = createBitmap(region.width, region.height);
    for (let y = 0; y < region.height; y++) {
      for (let x = 0; x < region.width; x++) {
        reference.data[y * region.width + x] = getPixel(page.bitmap, region.x + x, region.y + y);
      }
    }

    const mq = new MqDecoder(cursor.data, cursor.position, dataEnd);
    const contexts = createArithContexts(REFINEMENT_CONTEXT_BITS[template] ?? 13);
    const refined = decodeRefinementRegion(region.width, region.height, { template, tpgron, at, reference, dx: 0, dy: 0 }, mq, contexts);
    // Composed with the region's OWN declared operator rather than through compose() above, which would let the page's "combination operator may be overridden" flag substitute the page default. A refinement whose reference is the page it is being drawn back onto only makes sense under REPLACE -- under OR it could add black pixels but never correct one back to white, which is most of what refining a lossy region is for -- and T.88 7.4.7.6 requires REPLACE for exactly that case.
    combineBitmap(page.bitmap, refined, region.x, region.y, region.combinationOperator);
  }

  // T.88 7.4.3: a symbol dictionary segment. Its exported symbols are what every text region segment referring to it draws from.
  private readSymbolDictionary(header: SegmentHeader, cursor: ByteCursor): readonly Jbig2Bitmap[] {
    const flags = cursor.uint16();
    if ((flags & 0x01) !== 0) {
      throw new Jbig2UnsupportedError('JBIG2 symbol dictionary is Huffman-coded (SDHUFF = 1); only the arithmetic form is implemented');
    }
    if ((flags & 0x0100) !== 0 || (flags & 0x0200) !== 0) {
      throw new Jbig2UnsupportedError('JBIG2 symbol dictionary uses or retains a shared bitmap coding context (T.88 7.4.3.1.1 bits 8-9), which is not implemented');
    }
    const refinementAggregate = (flags & 0x02) !== 0;
    const template = (flags >> 10) & 0x03;
    const refinementTemplate = (flags >> 12) & 0x01;
    const at = readAtPixels(cursor, template === 0 ? 4 : 1);
    const refinementAt = refinementAggregate && refinementTemplate === 0 ? readAtPixels(cursor, 2) : [...NOMINAL_REFINEMENT_AT];
    const exportedSymbolCount = cursor.uint32();
    const newSymbolCount = cursor.uint32();

    const inputSymbols = this.gatherSymbols(header.referredTo);
    const symbolIdBits = symbolCodeLength(inputSymbols.length + newSymbolCount);
    const mq = new MqDecoder(cursor.data, cursor.position, header.dataEnd);
    const contexts = createTextArithContexts(template, refinementTemplate, symbolIdBits);
    return decodeSymbolDictionary({ template, at, refinementAggregate, refinementTemplate, refinementAt, newSymbolCount, exportedSymbolCount, inputSymbols }, mq, contexts, symbolIdBits);
  }

  // T.88 7.4.4: a text region segment.
  private readTextRegion(header: SegmentHeader, cursor: ByteCursor): void {
    const region = readRegionInfo(cursor);
    const flags = cursor.uint16();
    if ((flags & 0x01) !== 0) {
      throw new Jbig2UnsupportedError('JBIG2 text region is Huffman-coded (SBHUFF = 1); only the arithmetic form is implemented');
    }
    const refine = (flags & 0x02) !== 0;
    const stripSize = 1 << ((flags >> 2) & 0x03);
    const referenceCorner = referenceCornerFromCode((flags >> 4) & 0x03);
    if (referenceCorner === undefined) {
      throw new Jbig2ParseError('JBIG2 text region declares an unrecognised REFCORNER');
    }
    const transposed = (flags & 0x40) !== 0;
    const combinationOperator = combinationOperatorFromCode((flags >> 7) & 0x03);
    if (combinationOperator === undefined) {
      throw new Jbig2ParseError('JBIG2 text region declares an unrecognised SBCOMBOP');
    }
    const defaultPixel = (flags >> 9) & 0x01;
    // SBDSOFFSET is a signed five-bit field at bits 10-14 (T.88 7.4.4.1.1), sign-extended here by shifting it to the top of a 32-bit word and back.
    const dsOffset = ((flags << 17) >> 27) | 0;
    const refinementTemplate = (flags >> 15) & 0x01;
    const refinementAt = refine && refinementTemplate === 0 ? readAtPixels(cursor, 2) : [...NOMINAL_REFINEMENT_AT];
    const instanceCount = cursor.uint32();

    const symbols = this.gatherSymbols(header.referredTo);
    if (symbols.length === 0) {
      throw new Jbig2ParseError('JBIG2 text region refers to no symbol dictionary, so it has no symbols to place');
    }
    const symbolIdBits = symbolCodeLength(symbols.length);
    const mq = new MqDecoder(cursor.data, cursor.position, header.dataEnd);
    const contexts = createTextArithContexts(0, refinementTemplate, symbolIdBits);
    const params: TextRegionParams = {
      width: region.width,
      height: region.height,
      instanceCount,
      stripSize,
      symbols,
      defaultPixel,
      combinationOperator,
      transposed,
      referenceCorner,
      dsOffset,
      refine,
      refinementTemplate,
      refinementAt,
    };
    this.compose(region, decodeTextRegion(params, mq, contexts, symbolIdBits));
  }

  private gatherSymbols(referredTo: readonly number[]): readonly Jbig2Bitmap[] {
    const symbols: Jbig2Bitmap[] = [];
    for (const segmentNumber of referredTo) {
      const exported = this.exportedSymbols.get(segmentNumber);
      if (exported !== undefined) {
        symbols.push(...exported);
      }
    }
    return symbols;
  }

  finish(): Jbig2Image {
    const page = this.requirePage();
    const width = this.options.width ?? page.bitmap.width;
    const height = this.options.height ?? page.bitmap.height;
    return { bytes: packBitmapRows(page.bitmap, width, height), width, height };
  }
}

export function decodeJbig2Embedded(data: Uint8Array<ArrayBuffer>, options: Jbig2DecodeOptions = {}): Jbig2Image {
  const decoder = new Jbig2Decoder(options);
  if (options.globals !== undefined) {
    decoder.run(options.globals);
  }
  decoder.run(data);
  return decoder.finish();
}
