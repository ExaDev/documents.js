import { Jpeg2000ParseError, Jpeg2000UnsupportedError } from './jpeg2000-errors';

// The JP2 file format of ISO/IEC 15444-1 Annex I: the box structure that wraps a JPEG 2000 codestream with its own image header and colour specification. A PDF /JPXDecode stream may be either a whole JP2 file or a bare codestream (ISO 32000-1 7.4.9 permits both), so this module's real job is to tell the two apart and hand back the codestream either way, along with whatever the boxes said about colour that the codestream itself does not carry.

// I.5.1: every box is a 4-byte length, a 4-byte type, and a payload; length 1 escapes to a 64-bit XLBox, and length 0 means the box runs to the end of the file.
const BOX_HEADER_BYTES = 8;
const BOX_LENGTH_EXTENDED = 1;
const BOX_LENGTH_TO_END = 0;

// Box types, as the four ASCII characters each is written with.
const BOX_SIGNATURE = 0x6a502020; // 'jP  '
const BOX_JP2_HEADER = 0x6a703268; // 'jp2h'
const BOX_IMAGE_HEADER = 0x69686472; // 'ihdr'
const BOX_COLOUR_SPECIFICATION = 0x636f6c72; // 'colr'
const BOX_PALETTE = 0x70636c72; // 'pclr'
const BOX_COMPONENT_MAPPING = 0x636d6170; // 'cmap'
const BOX_CHANNEL_DEFINITION = 0x63646566; // 'cdef'
const BOX_CONTIGUOUS_CODESTREAM = 0x6a703263; // 'jp2c'

// I.5.3.3 Table I.10: the enumerated colour spaces this codec recognises by number. Anything else is reported by its raw value rather than guessed at.
export type Jp2ColourSpace = 'greyscale' | 'srgb' | 'sycc' | 'cmyk' | 'e-srgb' | 'rommrgb' | 'cielab';

const ENUMERATED_COLOUR_SPACES = new Map<number, Jp2ColourSpace>([
  [12, 'cmyk'],
  [14, 'cielab'],
  [16, 'srgb'],
  [17, 'greyscale'],
  [18, 'sycc'],
  [20, 'e-srgb'],
  [24, 'rommrgb'],
]);

export interface Jp2ImageHeader {
  readonly width: number;
  readonly height: number;
  readonly componentCount: number;
  // Undefined when the ihdr box sets BPC to 255, meaning the components differ and a bpcc box (or the codestream's own SIZ) carries the real depths.
  readonly bitDepth?: number;
  readonly signed?: boolean;
}

export interface Jp2Container {
  // The contiguous codestream: the jp2c box payload for a JP2 file, or the whole input for a bare codestream.
  readonly codestream: Uint8Array<ArrayBuffer>;
  // False when the input was a bare codestream with no JP2 boxes at all, in which case every field below is undefined.
  readonly hasBoxes: boolean;
  readonly imageHeader?: Jp2ImageHeader;
  readonly colourSpace?: Jp2ColourSpace;
  // Set when the colour specification box carried a restricted ICC profile rather than an enumerated space. The profile bytes are kept but never interpreted -- this codec does no colour management.
  readonly iccProfile?: Uint8Array<ArrayBuffer>;
  // I.5.3.6: channel definitions, present when a component is an alpha channel rather than a colour one.
  readonly channelDefinitions: readonly Jp2ChannelDefinition[];
}

export interface Jp2ChannelDefinition {
  readonly channel: number;
  // 0 = colour, 1 = opacity, 2 = premultiplied opacity.
  readonly type: number;
  readonly association: number;
}

// A bare codestream starts with SOC immediately followed by SIZ, which no JP2 file ever can (a JP2 file starts with the signature box's own length field, 0x0000000C).
export function looksLikeBareCodestream(data: Uint8Array<ArrayBuffer>): boolean {
  return data.length >= 4 && data[0] === 0xff && data[1] === 0x4f && data[2] === 0xff && data[3] === 0x51;
}

interface Box {
  readonly type: number;
  readonly payloadStart: number;
  readonly payloadEnd: number;
  readonly nextBoxStart: number;
}

function readUint32(data: Uint8Array<ArrayBuffer>, offset: number): number {
  const b0 = data[offset];
  const b1 = data[offset + 1];
  const b2 = data[offset + 2];
  const b3 = data[offset + 3];
  if (b0 === undefined || b1 === undefined || b2 === undefined || b3 === undefined) {
    throw new Jpeg2000ParseError('JP2 box structure ended in the middle of a 32-bit field');
  }
  return b0 * 0x1000000 + (b1 << 16) + (b2 << 8) + b3;
}

function readBox(data: Uint8Array<ArrayBuffer>, offset: number, limit: number): Box | undefined {
  if (offset + BOX_HEADER_BYTES > limit) {
    return undefined;
  }
  const declaredLength = readUint32(data, offset);
  const type = readUint32(data, offset + 4);
  let payloadStart = offset + BOX_HEADER_BYTES;
  let boxEnd: number;
  if (declaredLength === BOX_LENGTH_EXTENDED) {
    const high = readUint32(data, payloadStart);
    const low = readUint32(data, payloadStart + 4);
    payloadStart += 8;
    // A box longer than 2^53 bytes cannot be addressed by a JS array anyway; treating it as running to the end of the data is both the only thing that can be done and what such a length would mean in practice.
    boxEnd = high === 0 ? offset + low : limit;
  } else if (declaredLength === BOX_LENGTH_TO_END) {
    boxEnd = limit;
  } else {
    boxEnd = offset + declaredLength;
  }
  if (boxEnd < payloadStart) {
    throw new Jpeg2000ParseError(`a JP2 box declares a length (${String(declaredLength)}) shorter than its own header`);
  }
  return { type, payloadStart, payloadEnd: Math.min(boxEnd, limit), nextBoxStart: Math.min(boxEnd, limit) };
}

function readImageHeader(data: Uint8Array<ArrayBuffer>, start: number, end: number): Jp2ImageHeader {
  if (end - start < 14) {
    throw new Jpeg2000ParseError('the JP2 image header box is shorter than the 14 bytes ISO/IEC 15444-1 I.5.3.1 defines');
  }
  const height = readUint32(data, start);
  const width = readUint32(data, start + 4);
  const componentCount = ((data[start + 8] ?? 0) << 8) | (data[start + 9] ?? 0);
  const bpc = data[start + 10] ?? 0;
  if (bpc === 0xff) {
    return { width, height, componentCount };
  }
  return { width, height, componentCount, bitDepth: (bpc & 0x7f) + 1, signed: (bpc & 0x80) !== 0 };
}

function readChannelDefinitions(data: Uint8Array<ArrayBuffer>, start: number, end: number): Jp2ChannelDefinition[] {
  if (end - start < 2) {
    return [];
  }
  const count = ((data[start] ?? 0) << 8) | (data[start + 1] ?? 0);
  const definitions: Jp2ChannelDefinition[] = [];
  for (let i = 0; i < count; i++) {
    const entry = start + 2 + i * 6;
    if (entry + 6 > end) {
      break;
    }
    definitions.push({
      channel: ((data[entry] ?? 0) << 8) | (data[entry + 1] ?? 0),
      type: ((data[entry + 2] ?? 0) << 8) | (data[entry + 3] ?? 0),
      association: ((data[entry + 4] ?? 0) << 8) | (data[entry + 5] ?? 0),
    });
  }
  return definitions;
}

interface HeaderBoxContents {
  imageHeader?: Jp2ImageHeader;
  colourSpace?: Jp2ColourSpace;
  iccProfile?: Uint8Array<ArrayBuffer>;
  hasPalette: boolean;
  channelDefinitions: Jp2ChannelDefinition[];
}

function readJp2HeaderBox(data: Uint8Array<ArrayBuffer>, start: number, end: number, into: HeaderBoxContents): void {
  let offset = start;
  for (;;) {
    const box = readBox(data, offset, end);
    if (box === undefined || box.nextBoxStart <= offset) {
      return;
    }
    if (box.type === BOX_IMAGE_HEADER) {
      into.imageHeader = readImageHeader(data, box.payloadStart, box.payloadEnd);
    } else if (box.type === BOX_COLOUR_SPECIFICATION && into.colourSpace === undefined && into.iccProfile === undefined) {
      // I.5.3.3: several colr boxes may be present, each an alternative description of the same data; the first is the one a reader is meant to prefer.
      readColourSpecification(data, box.payloadStart, box.payloadEnd, into);
    } else if (box.type === BOX_PALETTE || box.type === BOX_COMPONENT_MAPPING) {
      into.hasPalette = true;
    } else if (box.type === BOX_CHANNEL_DEFINITION) {
      into.channelDefinitions = readChannelDefinitions(data, box.payloadStart, box.payloadEnd);
    }
    // bpcc is deliberately not read: the codestream's own SIZ marker carries per-component depths authoritatively, and a bpcc box that disagreed with it would be the codestream's to win.
    offset = box.nextBoxStart;
  }
}

function readColourSpecification(data: Uint8Array<ArrayBuffer>, start: number, end: number, into: HeaderBoxContents): void {
  if (end - start < 3) {
    return;
  }
  const method = data[start] ?? 0;
  if (method === 1) {
    if (end - start >= 7) {
      into.colourSpace = ENUMERATED_COLOUR_SPACES.get(readUint32(data, start + 3));
    }
    return;
  }
  if (method === 2 && end - start > 3) {
    into.iccProfile = data.subarray(start + 3, end);
  }
}

export function parseJp2Container(data: Uint8Array<ArrayBuffer>): Jp2Container {
  if (looksLikeBareCodestream(data)) {
    return { codestream: data, hasBoxes: false, channelDefinitions: [] };
  }

  const contents: HeaderBoxContents = { hasPalette: false, channelDefinitions: [] };
  let codestream: Uint8Array<ArrayBuffer> | undefined;
  let offset = 0;
  let sawSignature = false;
  for (;;) {
    const box = readBox(data, offset, data.length);
    if (box === undefined || box.nextBoxStart <= offset) {
      break;
    }
    if (box.type === BOX_SIGNATURE) {
      sawSignature = true;
    } else if (box.type === BOX_JP2_HEADER) {
      readJp2HeaderBox(data, box.payloadStart, box.payloadEnd, contents);
    } else if (box.type === BOX_CONTIGUOUS_CODESTREAM && codestream === undefined) {
      codestream = data.subarray(box.payloadStart, box.payloadEnd);
    }
    // ftyp, bpcc, res, xml, uuid, and every other box carry nothing this codec acts on -- bpcc specifically because the codestream's own SIZ marker carries per-component depths authoritatively.
    offset = box.nextBoxStart;
  }

  if (codestream === undefined) {
    if (!sawSignature && data[0] !== 0x00) {
      throw new Jpeg2000ParseError('the data is neither a bare JPEG 2000 codestream nor a JP2 file (no SOC marker and no JP2 signature box)');
    }
    throw new Jpeg2000ParseError('the JP2 file carries no contiguous codestream (jp2c) box');
  }
  // A JPX (ISO/IEC 15444-2) file can spread one image across several codestream boxes with a composition instruction set; taking the first would silently render only part of it.
  if (contents.hasPalette) {
    throw new Jpeg2000UnsupportedError('the JP2 file carries a palette (pclr/cmap) box, which this decoder does not apply');
  }
  const base = { codestream, hasBoxes: true, channelDefinitions: contents.channelDefinitions };
  return {
    ...base,
    ...(contents.imageHeader !== undefined ? { imageHeader: contents.imageHeader } : {}),
    ...(contents.colourSpace !== undefined ? { colourSpace: contents.colourSpace } : {}),
    ...(contents.iccProfile !== undefined ? { iccProfile: contents.iccProfile } : {}),
  };
}
