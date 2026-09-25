import {
  Jpeg2000ParseError,
  Jpeg2000UnsupportedError,
} from "./jpeg2000-errors";

// The JP2 file format of ISO/IEC 15444-1 Annex I: the box structure that wraps a JPEG 2000 codestream with its own image header and colour specification. A PDF /JPXDecode stream may be either a whole JP2 file or a bare codestream (ISO 32000-1 7.4.9 permits both), so this module's real job is to tell the two apart and hand back the codestream either way, along with whatever the boxes said about colour that the codestream itself does not carry.

// I.5.1: every box is a 4-byte length, a 4-byte type, and a payload; length 1 escapes to a 64-bit XLBox, and length 0 means the box runs to the end of the file.
const BOX_HEADER_BYTES = 8;
const BOX_LENGTH_EXTENDED = 1;
const BOX_LENGTH_TO_END = 0;

// Bits in one byte.
const BITS_PER_BYTE = 8;
// The multiplier that places a byte as the highest byte of a big-endian uint32 (2**24); readUint32 below multiplies rather than shifts (`b0 << 24`) because JS's `<<` operates on 32-bit SIGNED integers, and a byte >= 0x80 shifted into the sign bit would produce a negative result.
const BYTE_0_MULTIPLIER = 0x1000000;
const BYTE_1_SHIFT = 16;
// Width of the 32-bit big-endian field readUint32 assembles, and the offset of its last byte (offsets 0-2 need no name, exempt from this rule as structurally self-evident).
const UINT32_SIZE = 4;
const UINT32_LAST_BYTE_OFFSET = 3;

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
export type Jp2ColourSpace =
  "greyscale" | "srgb" | "sycc" | "cmyk" | "e-srgb" | "rommrgb" | "cielab";

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
  // Set when the colour specification box carried a restricted ICC profile rather than an enumerated space. The profile bytes are kept but never interpreted — this codec does no colour management.
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

// Every JPEG 2000 codestream marker shares this 0xFF prefix byte (ISO/IEC 15444-1 Annex A.2); SOC (Start Of Codestream) and SIZ (Image and Tile Size) are the two the bare-codestream check below matches on.
const JPEG2000_MARKER_PREFIX = 0xff;
const JPEG2000_SOC_LOW_BYTE = 0x4f;
const JPEG2000_SIZ_LOW_BYTE = 0x51;

// A bare codestream starts with SOC immediately followed by SIZ, which no JP2 file ever can (a JP2 file starts with the signature box's own length field, 0x0000000C). No separate `data.length >= 4` guard is needed: with noUncheckedIndexedAccess, an out-of-bounds index below reads as `undefined`, and `undefined === 0xff` is already false, so a shorter input fails the very same chain of comparisons on its own.
export function looksLikeBareCodestream(
  data: Uint8Array<ArrayBuffer>,
): boolean {
  return (
    data[0] === JPEG2000_MARKER_PREFIX &&
    data[1] === JPEG2000_SOC_LOW_BYTE &&
    data[2] === JPEG2000_MARKER_PREFIX &&
    data[3] === JPEG2000_SIZ_LOW_BYTE
  );
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
  const b3 = data[offset + UINT32_LAST_BYTE_OFFSET];
  if (
    b0 === undefined ||
    b1 === undefined ||
    b2 === undefined ||
    b3 === undefined
  ) {
    throw new Jpeg2000ParseError(
      "JP2 box structure ended in the middle of a 32-bit field",
    );
  }
  return (
    b0 * BYTE_0_MULTIPLIER + (b1 << BYTE_1_SHIFT) + (b2 << BITS_PER_BYTE) + b3
  );
}

function readBox(
  data: Uint8Array<ArrayBuffer>,
  offset: number,
  limit: number,
): Box | undefined {
  if (offset + BOX_HEADER_BYTES > limit) {
    return undefined;
  }
  const declaredLength = readUint32(data, offset);
  const type = readUint32(data, offset + UINT32_SIZE);
  let payloadStart = offset + BOX_HEADER_BYTES;
  let boxEnd: number;
  if (declaredLength === BOX_LENGTH_EXTENDED) {
    const high = readUint32(data, payloadStart);
    const low = readUint32(data, payloadStart + UINT32_SIZE);
    // The two additional 32-bit fields (XLBox high + low halves) just read above.
    const XLBOX_EXTRA_BYTES = 8;
    payloadStart += XLBOX_EXTRA_BYTES;
    // A box longer than 2^53 bytes cannot be addressed by a JS array anyway; treating it as running to the end of the data is both the only thing that can be done and what such a length would mean in practice.
    boxEnd = high === 0 ? offset + low : limit;
  } else if (declaredLength === BOX_LENGTH_TO_END) {
    boxEnd = limit;
  } else {
    boxEnd = offset + declaredLength;
  }
  if (boxEnd < payloadStart) {
    throw new Jpeg2000ParseError(
      `a JP2 box declares a length (${String(declaredLength)}) shorter than its own header`,
    );
  }
  return {
    type,
    payloadStart,
    payloadEnd: Math.min(boxEnd, limit),
    nextBoxStart: Math.min(boxEnd, limit),
  };
}

function readImageHeader(
  data: Uint8Array<ArrayBuffer>,
  start: number,
  end: number,
): Jp2ImageHeader {
  // ISO/IEC 15444-1 I.5.3.1: HEIGHT (uint32) + WIDTH (uint32) + NC/component count (uint16) + BPC (uint8), the 14 bytes this box is defined to be.
  const JP2_IMAGE_HEADER_SIZE = 14;
  const IMAGE_HEADER_COMPONENT_COUNT_OFFSET = 8;
  const IMAGE_HEADER_BIT_DEPTH_OFFSET = 10;
  // BPC's own sentinel value meaning "components differ", per this file's Jp2ImageHeader.bitDepth doc comment.
  const IMAGE_HEADER_BPC_VARIES = 0xff;
  // BPC packs a 7-bit depth-minus-one in its low bits and a sign flag in its high bit.
  const BPC_DEPTH_MASK = 0x7f;
  const BPC_SIGNED_BIT = 0x80;
  if (end - start < JP2_IMAGE_HEADER_SIZE) {
    throw new Jpeg2000ParseError(
      "the JP2 image header box is shorter than the 14 bytes ISO/IEC 15444-1 I.5.3.1 defines",
    );
  }
  const height = readUint32(data, start);
  const width = readUint32(data, start + UINT32_SIZE);
  const componentCount =
    ((data[start + IMAGE_HEADER_COMPONENT_COUNT_OFFSET] ?? 0) <<
      BITS_PER_BYTE) |
    (data[start + IMAGE_HEADER_COMPONENT_COUNT_OFFSET + 1] ?? 0);
  const bpc = data[start + IMAGE_HEADER_BIT_DEPTH_OFFSET] ?? 0;
  if (bpc === IMAGE_HEADER_BPC_VARIES) {
    return { width, height, componentCount };
  }
  return {
    width,
    height,
    componentCount,
    bitDepth: (bpc & BPC_DEPTH_MASK) + 1,
    signed: (bpc & BPC_SIGNED_BIT) !== 0,
  };
}

function readChannelDefinitions(
  data: Uint8Array<ArrayBuffer>,
  start: number,
  end: number,
): Jp2ChannelDefinition[] {
  // No separate "is there room for a count field" guard is needed: a payload under 2 bytes still computes some count value below (from whatever adjacent bytes or `?? 0` fallbacks lie at `start`/`start + 1`), but every entry needs 6 more bytes than the 2-byte count field leaves room for here, so the loop's own `entry + 6 > end` check breaks before pushing anything regardless of what that count came out to.
  // One Cdef entry (ISO/IEC 15444-1 I.5.3.6): Cn/channel index, Typ/type, Asoc/association, each a uint16, 6 bytes total.
  const CHANNEL_DEFINITION_ENTRY_SIZE = 6;
  const CHANNEL_DEFINITION_TYPE_OFFSET = 2;
  const CHANNEL_DEFINITION_ASSOCIATION_OFFSET = 4;
  const count = ((data[start] ?? 0) << BITS_PER_BYTE) | (data[start + 1] ?? 0);
  const definitions: Jp2ChannelDefinition[] = [];
  for (let i = 0; i < count; i++) {
    const entry = start + 2 + i * CHANNEL_DEFINITION_ENTRY_SIZE;
    if (entry + CHANNEL_DEFINITION_ENTRY_SIZE > end) {
      break;
    }
    definitions.push({
      channel: ((data[entry] ?? 0) << BITS_PER_BYTE) | (data[entry + 1] ?? 0),
      type:
        ((data[entry + CHANNEL_DEFINITION_TYPE_OFFSET] ?? 0) << BITS_PER_BYTE) |
        (data[entry + CHANNEL_DEFINITION_TYPE_OFFSET + 1] ?? 0),
      association:
        ((data[entry + CHANNEL_DEFINITION_ASSOCIATION_OFFSET] ?? 0) <<
          BITS_PER_BYTE) |
        (data[entry + CHANNEL_DEFINITION_ASSOCIATION_OFFSET + 1] ?? 0),
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

function readJp2HeaderBox(
  data: Uint8Array<ArrayBuffer>,
  start: number,
  end: number,
  into: HeaderBoxContents,
): void {
  let offset = start;
  for (;;) {
    const box = readBox(data, offset, end);
    // No separate "did this box actually advance" check is needed: readBox only ever returns a box whose own header fit before `end`, and it throws rather than returning one whose declared length undercuts that header — so a returned box's nextBoxStart is always past the offset it started from.
    if (box === undefined) {
      return;
    }
    if (box.type === BOX_IMAGE_HEADER) {
      into.imageHeader = readImageHeader(
        data,
        box.payloadStart,
        box.payloadEnd,
      );
    } else if (
      box.type === BOX_COLOUR_SPECIFICATION &&
      into.colourSpace === undefined &&
      into.iccProfile === undefined
    ) {
      // I.5.3.3: several colr boxes may be present, each an alternative description of the same data; the first is the one a reader is meant to prefer.
      readColourSpecification(data, box.payloadStart, box.payloadEnd, into);
    } else if (box.type === BOX_PALETTE || box.type === BOX_COMPONENT_MAPPING) {
      into.hasPalette = true;
    } else if (box.type === BOX_CHANNEL_DEFINITION) {
      into.channelDefinitions = readChannelDefinitions(
        data,
        box.payloadStart,
        box.payloadEnd,
      );
    }
    // bpcc is deliberately not read: the codestream's own SIZ marker carries per-component depths authoritatively, and a bpcc box that disagreed with it would be the codestream's to win.
    offset = box.nextBoxStart;
  }
}

function readColourSpecification(
  data: Uint8Array<ArrayBuffer>,
  start: number,
  end: number,
  into: HeaderBoxContents,
): void {
  // No separate "is there room for a method byte" guard is needed: a payload under 3 bytes still computes some `method` value below, but both branches that act on it require at least 7 (method 1) or more than 3 (method 2) bytes, so neither can assign anything when `end - start` is already under 3.
  // Colour Specification box payload (I.5.3.3): METH (uint8) + PREC (int8) + APPROX (uint8) precede either an EnumCS (uint32, method 1) or a raw ICC profile (method 2).
  const COLOUR_SPEC_PAYLOAD_PREFIX_SIZE = 3;
  // Table I.10's own enumerated colour-space codes, each used exactly once below as a Map key.
  const JP2_ENUM_CS_CMYK = 12;
  const JP2_ENUM_CS_CIELAB = 14;
  const JP2_ENUM_CS_SRGB = 16;
  const JP2_ENUM_CS_GREYSCALE = 17;
  const JP2_ENUM_CS_SYCC = 18;
  const JP2_ENUM_CS_E_SRGB = 20;
  const JP2_ENUM_CS_ROMMRGB = 24;
  const method = data[start] ?? 0;
  if (method === 1) {
    if (end - start >= COLOUR_SPEC_PAYLOAD_PREFIX_SIZE + UINT32_SIZE) {
      // I.5.3.3 Table I.10: the enumerated colour spaces this codec recognises by number. Anything else is reported by its raw value rather than guessed at. Built inside this function rather than as a module-level constant so a mutation to one of its entries is attributed, by Stryker's per-test coverage analysis, to the tests that actually call this function — a module-level `const` here would run once at import time as a static mutant, which Stryker tests against a single arbitrary covering test rather than the full set that genuinely exercises this map.
      const enumeratedColourSpaces = new Map<number, Jp2ColourSpace>([
        [JP2_ENUM_CS_CMYK, "cmyk"],
        [JP2_ENUM_CS_CIELAB, "cielab"],
        [JP2_ENUM_CS_SRGB, "srgb"],
        [JP2_ENUM_CS_GREYSCALE, "greyscale"],
        [JP2_ENUM_CS_SYCC, "sycc"],
        [JP2_ENUM_CS_E_SRGB, "e-srgb"],
        [JP2_ENUM_CS_ROMMRGB, "rommrgb"],
      ]);
      into.colourSpace = enumeratedColourSpaces.get(
        readUint32(data, start + COLOUR_SPEC_PAYLOAD_PREFIX_SIZE),
      );
    }
    return;
  }
  if (method === 2 && end - start > COLOUR_SPEC_PAYLOAD_PREFIX_SIZE) {
    into.iccProfile = data.subarray(
      start + COLOUR_SPEC_PAYLOAD_PREFIX_SIZE,
      end,
    );
  }
}

export function parseJp2Container(data: Uint8Array<ArrayBuffer>): Jp2Container {
  if (looksLikeBareCodestream(data)) {
    return { codestream: data, hasBoxes: false, channelDefinitions: [] };
  }

  const contents: HeaderBoxContents = {
    hasPalette: false,
    channelDefinitions: [],
  };
  let codestream: Uint8Array<ArrayBuffer> | undefined;
  let offset = 0;
  let sawSignature = false;
  for (;;) {
    const box = readBox(data, offset, data.length);
    // Same non-advancement case as readJp2HeaderBox's identical loop above: readBox never returns a box that fails to advance past its own offset.
    if (box === undefined) {
      break;
    }
    if (box.type === BOX_SIGNATURE) {
      sawSignature = true;
    } else if (box.type === BOX_JP2_HEADER) {
      readJp2HeaderBox(data, box.payloadStart, box.payloadEnd, contents);
    } else if (
      box.type === BOX_CONTIGUOUS_CODESTREAM &&
      codestream === undefined
    ) {
      codestream = data.subarray(box.payloadStart, box.payloadEnd);
    }
    // ftyp, bpcc, res, xml, uuid, and every other box carry nothing this codec acts on — bpcc specifically because the codestream's own SIZ marker carries per-component depths authoritatively.
    offset = box.nextBoxStart;
  }

  if (codestream === undefined) {
    if (!sawSignature && data[0] !== 0x00) {
      throw new Jpeg2000ParseError(
        "the data is neither a bare JPEG 2000 codestream nor a JP2 file (no SOC marker and no JP2 signature box)",
      );
    }
    throw new Jpeg2000ParseError(
      "the JP2 file carries no contiguous codestream (jp2c) box",
    );
  }
  // A JPX (ISO/IEC 15444-2) file can spread one image across several codestream boxes with a composition instruction set; taking the first would silently render only part of it.
  if (contents.hasPalette) {
    throw new Jpeg2000UnsupportedError(
      "the JP2 file carries a palette (pclr/cmap) box, which this decoder does not apply",
    );
  }
  const base = {
    codestream,
    hasBoxes: true,
    channelDefinitions: contents.channelDefinitions,
  };
  return {
    ...base,
    ...(contents.imageHeader !== undefined
      ? { imageHeader: contents.imageHeader }
      : {}),
    ...(contents.colourSpace !== undefined
      ? { colourSpace: contents.colourSpace }
      : {}),
    ...(contents.iccProfile !== undefined
      ? { iccProfile: contents.iccProfile }
      : {}),
  };
}
