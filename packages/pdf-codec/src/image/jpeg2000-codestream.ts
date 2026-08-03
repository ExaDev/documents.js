import { Jpeg2000ParseError, Jpeg2000UnsupportedError } from './jpeg2000-errors';

// The JPEG 2000 codestream syntax of ISO/IEC 15444-1 (ITU-T T.800) Annex A: the marker segments of the main header and of each tile-part header, parsed into a structural model with no decoding attached. Splitting this out from the entropy decoding is what makes real metadata -- image size, component count and depth, tile grid, wavelet kind, decomposition levels, quality layers -- readable from a codestream this package cannot fully decode, which is most of what a PDF caller wants from a JPXDecode image it is going to skip anyway.
//
// Every field name below is the specification's own (Xsiz, XTOsiz, Scod, SPqcd, Psot, ...) so each read can be checked line for line against the tables of A.5 through A.9.

// T.800 Table A.2. Only the markers this parser actually acts on are named; anything else with a length field is skipped by that length, and anything else without one is a parse error.
const MARKER_SOC = 0xff4f;
const MARKER_SIZ = 0xff51;
const MARKER_COD = 0xff52;
const MARKER_COC = 0xff53;
const MARKER_QCD = 0xff5c;
const MARKER_QCC = 0xff5d;
const MARKER_RGN = 0xff5e;
const MARKER_POC = 0xff5f;
const MARKER_PPM = 0xff60;
const MARKER_PPT = 0xff61;
const MARKER_COM = 0xff64;
const MARKER_SOT = 0xff90;
const MARKER_SOD = 0xff93;
const MARKER_EOC = 0xffd9;

// T.800 A.6.1 Table A.16: the five progression orders, in the order the Table's own values run.
export type Jpeg2000ProgressionOrder = 'LRCP' | 'RLCP' | 'RPCL' | 'PCRL' | 'CPRL';

const PROGRESSION_ORDERS: readonly Jpeg2000ProgressionOrder[] = ['LRCP', 'RLCP', 'RPCL', 'PCRL', 'CPRL'];

// T.800 A.6.1 Table A.20: the wavelet filter the tile-component was transformed with.
export type Jpeg2000Transform = 'reversible-5-3' | 'irreversible-9-7';

// T.800 A.6.4 Table A.28: how the SPqcd/SPqcc values are to be read, which also determines whether the coefficients are quantized at all.
export type Jpeg2000QuantizationStyle = 'none' | 'derived' | 'expounded';

export interface Jpeg2000ComponentSize {
  readonly signed: boolean;
  readonly bitDepth: number;
  // XRsiz/YRsiz: the component's own sub-sampling factors relative to the reference grid.
  readonly dx: number;
  readonly dy: number;
}

// T.800 A.5.1: the image and tile geometry on the reference grid, which every other coordinate in the codestream is derived from.
export interface Jpeg2000ImageSize {
  readonly xsiz: number;
  readonly ysiz: number;
  readonly xosiz: number;
  readonly yosiz: number;
  readonly xtsiz: number;
  readonly ytsiz: number;
  readonly xtosiz: number;
  readonly ytosiz: number;
  readonly components: readonly Jpeg2000ComponentSize[];
}

export interface Jpeg2000PrecinctSize {
  readonly ppx: number;
  readonly ppy: number;
}

// T.800 A.6.1 SPcod / A.6.2 SPcoc: the per-tile-component half of a coding style, the part a COC marker can override on its own.
export interface Jpeg2000CodingStyle {
  readonly decompositionLevels: number;
  // xcb and ycb: the code-block dimensions are 2^codeBlockWidthExp by 2^codeBlockHeightExp.
  readonly codeBlockWidthExp: number;
  readonly codeBlockHeightExp: number;
  // T.800 Table A.19, a bit field: 0x01 selective arithmetic coding bypass, 0x02 reset context probabilities, 0x04 termination on each pass, 0x08 vertically causal context, 0x10 predictable termination, 0x20 segmentation symbols.
  readonly codeBlockStyle: number;
  readonly transform: Jpeg2000Transform;
  // One entry per resolution level 0..decompositionLevels. Defaulted to the maximal 2^15 partition (i.e. one precinct covering the whole subband) when Scod's own bit 0 says no explicit sizes were transmitted.
  readonly precinctSizes: readonly Jpeg2000PrecinctSize[];
}

// T.800 A.6.1 SGcod: the tile-wide half of a coding style, which only a COD marker carries.
export interface Jpeg2000CodingDefaults extends Jpeg2000CodingStyle {
  readonly progressionOrder: Jpeg2000ProgressionOrder;
  readonly layers: number;
  readonly multipleComponentTransform: boolean;
  readonly useSop: boolean;
  readonly useEph: boolean;
}

export interface Jpeg2000StepSize {
  readonly exponent: number;
  readonly mantissa: number;
}

export interface Jpeg2000Quantization {
  readonly style: Jpeg2000QuantizationStyle;
  readonly guardBits: number;
  readonly stepSizes: readonly Jpeg2000StepSize[];
}

// Every marker segment a header (main or tile-part) can carry that changes how the coded data is read.
export interface Jpeg2000HeaderOverrides {
  readonly cod?: Jpeg2000CodingDefaults;
  readonly coc: ReadonlyMap<number, Jpeg2000CodingStyle>;
  readonly qcd?: Jpeg2000Quantization;
  readonly qcc: ReadonlyMap<number, Jpeg2000Quantization>;
  // T.800 A.6.6: whether a POC marker changes the progression order partway through. Recorded as a flag rather than as parsed entries because the decoder refuses such a codestream outright -- reading the entries would be code nothing could act on.
  readonly hasProgressionChanges: boolean;
  // A.6.3: whether an RGN marker declares a region of interest, whose coefficient upshift the decoder does not undo. A flag for the same reason.
  readonly hasRegionOfInterest: boolean;
  // A.7.5: whether a PPT marker moves this tile's packet headers out of the packet bodies. A flag for the same reason.
  readonly hasPackedPacketHeaders: boolean;
}

export interface Jpeg2000TilePart {
  readonly tileIndex: number;
  readonly partIndex: number;
  readonly header: Jpeg2000HeaderOverrides;
  // The bitstream between this tile-part's SOD marker and the end of its Psot-declared extent.
  readonly dataStart: number;
  readonly dataEnd: number;
}

export interface Jpeg2000Codestream {
  // The codestream itself, which every Jpeg2000TilePart's own dataStart/dataEnd index into.
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly siz: Jpeg2000ImageSize;
  readonly main: Jpeg2000HeaderOverrides;
  readonly tileParts: readonly Jpeg2000TilePart[];
  readonly comments: readonly string[];
  readonly numTilesWide: number;
  readonly numTilesHigh: number;
  // Set when the codestream ended without an EOC marker, which a truncated PDF stream shows up as.
  readonly truncated: boolean;
}

class MarkerCursor {
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
      throw new Jpeg2000ParseError('JPEG 2000 codestream ended in the middle of a marker segment');
    }
    this.position++;
    return value;
  }

  uint16(): number {
    return (this.uint8() << 8) | this.uint8();
  }

  uint32(): number {
    // Assembled through multiplication rather than shifts: a 32-bit field with its top bit set (Psot on a large tile, or the 0xFFFFFFFF "unknown" sentinel) would come back negative from `<<`.
    return this.uint16() * 0x10000 + this.uint16();
  }

  bytes(length: number): Uint8Array<ArrayBuffer> {
    if (length < 0 || this.position + length > this.data.length) {
      throw new Jpeg2000ParseError('a JPEG 2000 marker segment declares more data than the codestream carries');
    }
    const slice = this.data.subarray(this.position, this.position + length);
    this.position += length;
    return slice;
  }
}

function readImageSize(cursor: MarkerCursor, segmentEnd: number): Jpeg2000ImageSize {
  cursor.uint16(); // Rsiz: the capabilities field. Deliberately not enforced -- a profile a decoder does not recognise is not by itself a reason to refuse a codestream whose actual markers it does understand.
  const xsiz = cursor.uint32();
  const ysiz = cursor.uint32();
  const xosiz = cursor.uint32();
  const yosiz = cursor.uint32();
  const xtsiz = cursor.uint32();
  const ytsiz = cursor.uint32();
  const xtosiz = cursor.uint32();
  const ytosiz = cursor.uint32();
  const count = cursor.uint16();
  if (count === 0) {
    throw new Jpeg2000ParseError('SIZ declares zero components');
  }
  if (cursor.position + count * 3 > segmentEnd) {
    throw new Jpeg2000ParseError(`SIZ declares ${String(count)} components but its own length leaves room for fewer`);
  }
  const components: Jpeg2000ComponentSize[] = [];
  for (let i = 0; i < count; i++) {
    const ssiz = cursor.uint8();
    components.push({ signed: (ssiz & 0x80) !== 0, bitDepth: (ssiz & 0x7f) + 1, dx: cursor.uint8(), dy: cursor.uint8() });
  }
  if (xsiz <= xosiz || ysiz <= yosiz) {
    throw new Jpeg2000ParseError('SIZ declares an image with no area (Xsiz/Ysiz do not exceed XOsiz/YOsiz)');
  }
  if (xtsiz === 0 || ytsiz === 0) {
    throw new Jpeg2000ParseError('SIZ declares a zero-sized tile');
  }
  return { xsiz, ysiz, xosiz, yosiz, xtsiz, ytsiz, xtosiz, ytosiz, components };
}

// The maximal precinct partition (2^15) is what a codestream means when Scod's bit 0 is clear: T.800 A.6.1 defines that case as PPx = PPy = 15, which for any real image size is one precinct covering the whole resolution level.
const DEFAULT_PRECINCT_EXPONENT = 15;

function readCodingStyleParameters(cursor: MarkerCursor, explicitPrecincts: boolean): Jpeg2000CodingStyle {
  const decompositionLevels = cursor.uint8();
  const codeBlockWidthExp = (cursor.uint8() & 0x0f) + 2;
  const codeBlockHeightExp = (cursor.uint8() & 0x0f) + 2;
  const codeBlockStyle = cursor.uint8();
  const transformCode = cursor.uint8();
  if (transformCode !== 0 && transformCode !== 1) {
    throw new Jpeg2000ParseError(`SPcod/SPcoc declares transformation ${String(transformCode)}, which is neither of the two ISO/IEC 15444-1 defines`);
  }
  // T.800 Table A.18: the transmitted values are xcb-2 and ycb-2, and the standard caps the code-block area at 4096 samples with each side at most 2^10.
  if (codeBlockWidthExp > 10 || codeBlockHeightExp > 10 || codeBlockWidthExp + codeBlockHeightExp > 12) {
    throw new Jpeg2000ParseError(`code-block size 2^${String(codeBlockWidthExp)} by 2^${String(codeBlockHeightExp)} is outside the range ISO/IEC 15444-1 Table A.18 permits`);
  }
  const precinctSizes: Jpeg2000PrecinctSize[] = [];
  if (explicitPrecincts) {
    for (let r = 0; r <= decompositionLevels; r++) {
      const packed = cursor.uint8();
      precinctSizes.push({ ppx: packed & 0x0f, ppy: (packed >> 4) & 0x0f });
    }
  } else {
    for (let r = 0; r <= decompositionLevels; r++) {
      precinctSizes.push({ ppx: DEFAULT_PRECINCT_EXPONENT, ppy: DEFAULT_PRECINCT_EXPONENT });
    }
  }
  return { decompositionLevels, codeBlockWidthExp, codeBlockHeightExp, codeBlockStyle, transform: transformCode === 1 ? 'reversible-5-3' : 'irreversible-9-7', precinctSizes };
}

function readCodingDefaults(cursor: MarkerCursor): Jpeg2000CodingDefaults {
  const scod = cursor.uint8();
  const progressionOrder = PROGRESSION_ORDERS[cursor.uint8()];
  if (progressionOrder === undefined) {
    throw new Jpeg2000ParseError('COD declares a progression order outside the five ISO/IEC 15444-1 Table A.16 defines');
  }
  const layers = cursor.uint16();
  if (layers === 0) {
    throw new Jpeg2000ParseError('COD declares zero quality layers');
  }
  const multipleComponentTransform = cursor.uint8() !== 0;
  const style = readCodingStyleParameters(cursor, (scod & 0x01) !== 0);
  return { ...style, progressionOrder, layers, multipleComponentTransform, useSop: (scod & 0x02) !== 0, useEph: (scod & 0x04) !== 0 };
}

function readQuantization(cursor: MarkerCursor, segmentEnd: number): Jpeg2000Quantization {
  const sq = cursor.uint8();
  const guardBits = sq >> 5;
  const styleCode = sq & 0x1f;
  const stepSizes: Jpeg2000StepSize[] = [];
  if (styleCode === 0) {
    while (cursor.position < segmentEnd) {
      stepSizes.push({ exponent: cursor.uint8() >> 3, mantissa: 0 });
    }
    return { style: 'none', guardBits, stepSizes };
  }
  if (styleCode === 1 || styleCode === 2) {
    while (cursor.position + 1 < segmentEnd) {
      const packed = cursor.uint16();
      stepSizes.push({ exponent: packed >> 11, mantissa: packed & 0x7ff });
    }
    return { style: styleCode === 1 ? 'derived' : 'expounded', guardBits, stepSizes };
  }
  throw new Jpeg2000ParseError(`QCD/QCC declares quantization style ${String(styleCode)}, which ISO/IEC 15444-1 Table A.28 does not define`);
}

// T.800 A.6.2/A.6.5: the component index is one byte when the image has fewer than 257 components and two otherwise -- the one place in the codestream where a field's width depends on a value from a different marker segment.
function readComponentIndex(cursor: MarkerCursor, componentCount: number): number {
  return componentCount < 257 ? cursor.uint8() : cursor.uint16();
}

interface MutableHeader {
  cod?: Jpeg2000CodingDefaults;
  readonly coc: Map<number, Jpeg2000CodingStyle>;
  qcd?: Jpeg2000Quantization;
  readonly qcc: Map<number, Jpeg2000Quantization>;
  hasProgressionChanges: boolean;
  hasRegionOfInterest: boolean;
  hasPackedPacketHeaders: boolean;
}

function emptyHeader(): MutableHeader {
  return { coc: new Map(), qcc: new Map(), hasProgressionChanges: false, hasRegionOfInterest: false, hasPackedPacketHeaders: false };
}

function freezeHeader(header: MutableHeader): Jpeg2000HeaderOverrides {
  const base = {
    coc: header.coc,
    qcc: header.qcc,
    hasProgressionChanges: header.hasProgressionChanges,
    hasRegionOfInterest: header.hasRegionOfInterest,
    hasPackedPacketHeaders: header.hasPackedPacketHeaders,
  };
  if (header.cod !== undefined && header.qcd !== undefined) {
    return { ...base, cod: header.cod, qcd: header.qcd };
  }
  if (header.cod !== undefined) {
    return { ...base, cod: header.cod };
  }
  if (header.qcd !== undefined) {
    return { ...base, qcd: header.qcd };
  }
  return base;
}

// Reads one marker segment into `header`, given the cursor already positioned just past the marker itself. Returns nothing: every branch either records something or deliberately skips the segment's body.
function readHeaderSegment(marker: number, cursor: MarkerCursor, header: MutableHeader, componentCount: number, comments: string[]): void {
  const length = cursor.uint16();
  if (length < 2) {
    throw new Jpeg2000ParseError(`marker segment 0x${marker.toString(16)} declares a length of ${String(length)}, which is shorter than the length field itself`);
  }
  const segmentEnd = cursor.position + length - 2;
  if (segmentEnd > cursor.data.length) {
    throw new Jpeg2000ParseError(`marker segment 0x${marker.toString(16)} declares more data than the codestream carries`);
  }
  if (marker === MARKER_COD) {
    header.cod = readCodingDefaults(cursor);
  } else if (marker === MARKER_COC) {
    const component = readComponentIndex(cursor, componentCount);
    header.coc.set(component, readCodingStyleParameters(cursor, (cursor.uint8() & 0x01) !== 0));
  } else if (marker === MARKER_QCD) {
    header.qcd = readQuantization(cursor, segmentEnd);
  } else if (marker === MARKER_QCC) {
    const component = readComponentIndex(cursor, componentCount);
    header.qcc.set(component, readQuantization(cursor, segmentEnd));
  } else if (marker === MARKER_POC) {
    header.hasProgressionChanges = true;
  } else if (marker === MARKER_RGN) {
    header.hasRegionOfInterest = true;
  } else if (marker === MARKER_PPT) {
    header.hasPackedPacketHeaders = true;
  } else if (marker === MARKER_COM) {
    const registration = cursor.uint16();
    const body = cursor.bytes(segmentEnd - cursor.position);
    // Rcom 1 is ISO/IEC 8859-15 (Latin) text; 0 is binary, which is not worth guessing at.
    if (registration === 1) {
      comments.push(Array.from(body, (byte) => String.fromCharCode(byte)).join(''));
    }
  }
  // TLM, PLM, PLT and CRG (and anything else) are positional or informational only: skipping to segmentEnd is the whole of their handling. PPM specifically would change where packet headers live, so the decoder refuses a codestream carrying one rather than reading past it silently -- see readCodestreamHeader's own check.
  cursor.position = segmentEnd;
}

// A COC or QCC before any COD or QCD would leave the override with nothing to override, and a PPM moves every tile's packet headers into the main header -- a genuinely different bitstream organisation this parser does not reassemble.
function validateMainHeader(header: MutableHeader): void {
  if (header.cod === undefined) {
    throw new Jpeg2000ParseError('the main header carries no COD marker, so no coding style is defined for any tile');
  }
  if (header.qcd === undefined) {
    throw new Jpeg2000ParseError('the main header carries no QCD marker, so no quantization is defined for any tile');
  }
}

export function parseJpeg2000Codestream(data: Uint8Array<ArrayBuffer>): Jpeg2000Codestream {
  const cursor = new MarkerCursor(data);
  if (cursor.remaining < 4 || cursor.uint16() !== MARKER_SOC) {
    throw new Jpeg2000ParseError('codestream does not begin with an SOC marker');
  }
  if (cursor.uint16() !== MARKER_SIZ) {
    throw new Jpeg2000ParseError('the SOC marker is not immediately followed by SIZ, which ISO/IEC 15444-1 A.3 requires');
  }
  const sizLength = cursor.uint16();
  const sizEnd = cursor.position + sizLength - 2;
  const siz = readImageSize(cursor, sizEnd);
  cursor.position = sizEnd;

  const comments: string[] = [];
  const main = emptyHeader();
  const tileParts: Jpeg2000TilePart[] = [];
  let sawEoc = false;

  for (;;) {
    if (cursor.remaining < 2) {
      break;
    }
    const marker = cursor.uint16();
    if (marker === MARKER_EOC) {
      sawEoc = true;
      break;
    }
    if (marker === MARKER_PPM) {
      throw new Jpeg2000UnsupportedError('the codestream carries a PPM marker (packed packet headers in the main header), an organisation this decoder does not reassemble');
    }
    if (marker === MARKER_SOT) {
      cursor.position -= 2;
      readTilePart(cursor, siz.components.length, tileParts, comments);
      continue;
    }
    if (marker === MARKER_SOD || marker === MARKER_SOC) {
      throw new Jpeg2000ParseError(`unexpected marker 0x${marker.toString(16)} in the main header`);
    }
    readHeaderSegment(marker, cursor, main, siz.components.length, comments);
  }

  validateMainHeader(main);

  const numTilesWide = Math.ceil((siz.xsiz - siz.xtosiz) / siz.xtsiz);
  const numTilesHigh = Math.ceil((siz.ysiz - siz.ytosiz) / siz.ytsiz);
  return { bytes: data, siz, main: freezeHeader(main), tileParts, comments, numTilesWide, numTilesHigh, truncated: !sawEoc };
}

// T.800 A.4.2/A.4.4: SOT ... SOD ... coded data, with Psot giving the length of the whole tile-part measured from the first byte of the SOT marker. Psot 0 means "runs to the end of the codestream" (or to the next SOT), which only the last tile-part may use.
function readTilePart(cursor: MarkerCursor, componentCount: number, tileParts: Jpeg2000TilePart[], comments: string[]): void {
  const sotStart = cursor.position;
  cursor.uint16(); // SOT
  const lsot = cursor.uint16();
  if (lsot !== 10) {
    throw new Jpeg2000ParseError(`SOT declares a length of ${String(lsot)}, but ISO/IEC 15444-1 A.4.2 fixes it at 10`);
  }
  const tileIndex = cursor.uint16();
  const psot = cursor.uint32();
  const partIndex = cursor.uint8();
  cursor.uint8(); // TNsot: the number of tile-parts the encoder declares for this tile, which may legitimately be 0 ("not yet known") and which nothing here needs -- the tile-parts actually present are what get decoded.

  const header = emptyHeader();
  for (;;) {
    if (cursor.remaining < 2) {
      throw new Jpeg2000ParseError('a tile-part header ended without an SOD marker');
    }
    const marker = cursor.uint16();
    if (marker === MARKER_SOD) {
      break;
    }
    if (marker === MARKER_SOT || marker === MARKER_EOC) {
      throw new Jpeg2000ParseError(`a tile-part header ended at marker 0x${marker.toString(16)} rather than at SOD`);
    }
    readHeaderSegment(marker, cursor, header, componentCount, comments);
  }

  const dataStart = cursor.position;
  const declaredEnd = psot === 0 ? cursor.data.length : sotStart + psot;
  const dataEnd = Math.min(declaredEnd, cursor.data.length);
  if (dataEnd < dataStart) {
    throw new Jpeg2000ParseError('a tile-part declares a Psot shorter than its own header');
  }
  // A truncated final tile-part is the shape a clipped PDF stream takes; keeping whatever bytes did arrive lets the decoder report a partial image rather than nothing at all.
  const trimmedEnd = trimTrailingEoc(cursor.data, dataStart, dataEnd);
  tileParts.push({ tileIndex, partIndex, header: freezeHeader(header), dataStart, dataEnd: trimmedEnd });
  cursor.position = dataEnd;
}

// A Psot of 0 runs the tile-part to the end of the codestream, which includes the EOC marker; the packet decoder must not see those two bytes as coded data.
function trimTrailingEoc(data: Uint8Array<ArrayBuffer>, start: number, end: number): number {
  if (end - start >= 2 && data[end - 2] === 0xff && data[end - 1] === 0xd9) {
    return end - 2;
  }
  return end;
}
