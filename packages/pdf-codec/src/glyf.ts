import type { SfntFont } from './sfnt';
import { f2dot14, hasBytes, i16, sfntTableBytes, u16, u32, u8 } from './sfnt';

// The 'loca' and 'glyf' tables of a TrueType-outline font (ISO/IEC 14496-22 clauses 5.3.2 and 5.3.3): the glyph-offset index, each glyph's own header, and the component records of a composite glyph.
//
// The component walk is what makes subsetting a TrueType font safe. A composite glyph -- almost every accented Latin character in a real text font -- holds no outline of its own, only references to the glyph IDs of its base letter and its combining mark(s). Copying a composite's own 'glyf' entry into a subset without also copying every glyph it references produces a glyph that renders as nothing, or as whatever unrelated outline now sits at that ID. Components nest (a component may itself be composite), so a subsetter must take the transitive closure over this walk, not just one level of it.
//
// This module deliberately does not decode a simple glyph's own contours (the end-point/flag/coordinate arrays after the header): subsetting copies a glyph's bytes verbatim, and nothing in this package rasterises an outline, so parsing coordinates would be building a consumer that does not exist. Composite components are decoded because their glyph IDs must be followed, which is the one thing a byte-verbatim copy cannot do for you.

export interface GlyphHeader {
  readonly numberOfContours: number; // negative marks a composite glyph; zero or more is a simple glyph with that many contours
  readonly xMin: number;
  readonly yMin: number;
  readonly xMax: number;
  readonly yMax: number;
}

// One component record of a composite glyph. `flags` is exposed raw for the bits this interface does not decode (bit 9 USE_MY_METRICS, bit 10 OVERLAP_COMPOUND, bit 11 SCALED_COMPONENT_OFFSET, bit 12 UNSCALED_COMPONENT_OFFSET), none of which change where the record ends or which glyph it references.
export interface CompositeComponent {
  readonly flags: number;
  readonly glyphIndex: number;
  // When `argsAreXyValues` is true these are a signed x/y placement offset in design units; when it is false they are a pair of unsigned point indices (the component's point to align onto the already-placed composite's point).
  readonly argument1: number;
  readonly argument2: number;
  readonly argsAreXyValues: boolean;
  // The component's own 2x2 transform in F2Dot14 file order [xScale, scale01, scale10, yScale], or `undefined` where the record declares no transform at all (i.e. the identity).
  readonly transform: readonly [number, number, number, number] | undefined;
}

export interface GlyfTable {
  readonly numGlyphs: number;
  // A glyph's own 'glyf' bytes: an empty array for a glyph with no outline (a space, say -- its 'loca' entry legitimately has zero length), or `undefined` for a glyph ID outside the font or one whose 'loca' entry is malformed.
  glyphBytes(glyphId: number): Uint8Array<ArrayBuffer> | undefined;
  // `undefined` for a glyph with no outline at all, since such a glyph has no header to read, as well as for an unreadable one.
  glyphHeader(glyphId: number): GlyphHeader | undefined;
  // The component records of a composite glyph, or `undefined` where the glyph is simple, empty, unreadable, or has a truncated component list. Never a partial list: a subsetter acting on half a composite's components would emit a visibly broken glyph, so an incomplete walk reports that it failed rather than what it managed.
  compositeComponents(glyphId: number): readonly CompositeComponent[] | undefined;
}

export interface GlyfOptions {
  readonly numGlyphs: number; // from 'maxp'
  readonly indexToLocFormat: 0 | 1; // from 'head'
}

const LOCA_SHORT_ENTRY_SIZE = 2;
const LOCA_LONG_ENTRY_SIZE = 4;
// A short-format 'loca' stores each offset halved, so it can only address an even byte -- glyph data is padded to an even length for exactly this reason (clause 5.3.2).
const LOCA_SHORT_OFFSET_SCALE = 2;

// The 'loca' index: numGlyphs + 1 byte offsets into 'glyf', where glyph N occupies [offsets[N], offsets[N + 1]). Returned as the raw offset array rather than a lookup, since a subsetter rebuilding 'loca' needs the array itself.
export function parseLoca(font: SfntFont, options: GlyfOptions): readonly number[] | undefined {
  const bytes = sfntTableBytes(font, 'loca');
  if (bytes === undefined) {
    return undefined;
  }
  const entryCount = options.numGlyphs + 1;
  const entrySize = options.indexToLocFormat === 0 ? LOCA_SHORT_ENTRY_SIZE : LOCA_LONG_ENTRY_SIZE;
  if (!hasBytes(bytes, 0, entryCount * entrySize)) {
    return undefined;
  }
  const offsets: number[] = [];
  for (let i = 0; i < entryCount; i++) {
    offsets.push(options.indexToLocFormat === 0 ? u16(bytes, i * LOCA_SHORT_ENTRY_SIZE) * LOCA_SHORT_OFFSET_SCALE : u32(bytes, i * LOCA_LONG_ENTRY_SIZE));
  }
  return offsets;
}

const GLYPH_HEADER_SIZE = 10; // numberOfContours, xMin, yMin, xMax, yMax

const ARG_1_AND_2_ARE_WORDS = 0x0001;
const ARGS_ARE_XY_VALUES = 0x0002;
const WE_HAVE_A_SCALE = 0x0008;
const MORE_COMPONENTS = 0x0020;
const WE_HAVE_AN_X_AND_Y_SCALE = 0x0040;
const WE_HAVE_A_TWO_BY_TWO = 0x0080;

const COMPONENT_RECORD_HEADER_SIZE = 4; // flags + glyphIndex

function signedByte(value: number): number {
  return value >= 0x80 ? value - 0x100 : value;
}

function readComponents(glyph: Uint8Array<ArrayBuffer>): readonly CompositeComponent[] | undefined {
  const components: CompositeComponent[] = [];
  let offset = GLYPH_HEADER_SIZE;
  for (;;) {
    if (!hasBytes(glyph, offset, COMPONENT_RECORD_HEADER_SIZE)) {
      return undefined;
    }
    const flags = u16(glyph, offset);
    const glyphIndex = u16(glyph, offset + 2);
    offset += COMPONENT_RECORD_HEADER_SIZE;

    const argsAreWords = (flags & ARG_1_AND_2_ARE_WORDS) !== 0;
    const argsAreXyValues = (flags & ARGS_ARE_XY_VALUES) !== 0;
    const argsSize = argsAreWords ? 4 : 2;
    if (!hasBytes(glyph, offset, argsSize)) {
      return undefined;
    }
    let argument1: number;
    let argument2: number;
    if (argsAreWords) {
      // Word-sized arguments are signed offsets when they are x/y values and unsigned point indices when they are not.
      argument1 = argsAreXyValues ? i16(glyph, offset) : u16(glyph, offset);
      argument2 = argsAreXyValues ? i16(glyph, offset + 2) : u16(glyph, offset + 2);
    } else {
      argument1 = argsAreXyValues ? signedByte(u8(glyph, offset)) : u8(glyph, offset);
      argument2 = argsAreXyValues ? signedByte(u8(glyph, offset + 1)) : u8(glyph, offset + 1);
    }
    offset += argsSize;

    let transform: readonly [number, number, number, number] | undefined;
    if ((flags & WE_HAVE_A_SCALE) !== 0) {
      if (!hasBytes(glyph, offset, 2)) {
        return undefined;
      }
      const scale = f2dot14(glyph, offset);
      transform = [scale, 0, 0, scale];
      offset += 2;
    } else if ((flags & WE_HAVE_AN_X_AND_Y_SCALE) !== 0) {
      if (!hasBytes(glyph, offset, 4)) {
        return undefined;
      }
      transform = [f2dot14(glyph, offset), 0, 0, f2dot14(glyph, offset + 2)];
      offset += 4;
    } else if ((flags & WE_HAVE_A_TWO_BY_TWO) !== 0) {
      if (!hasBytes(glyph, offset, 8)) {
        return undefined;
      }
      transform = [f2dot14(glyph, offset), f2dot14(glyph, offset + 2), f2dot14(glyph, offset + 4), f2dot14(glyph, offset + 6)];
      offset += 8;
    }

    components.push({ flags, glyphIndex, argument1, argument2, argsAreXyValues, transform });

    if ((flags & MORE_COMPONENTS) === 0) {
      return components;
    }
    // Every iteration advances `offset` by at least COMPONENT_RECORD_HEADER_SIZE and is bounds-checked against the glyph's own length, so a crafted glyph whose MORE_COMPONENTS bit never clears terminates by running out of bytes rather than looping.
  }
}

export function parseGlyf(font: SfntFont, options: GlyfOptions): GlyfTable | undefined {
  const glyfBytes = sfntTableBytes(font, 'glyf');
  const loca = parseLoca(font, options);
  if (glyfBytes === undefined || loca === undefined) {
    return undefined;
  }

  const glyphBytes = (glyphId: number): Uint8Array<ArrayBuffer> | undefined => {
    if (!Number.isInteger(glyphId) || glyphId < 0 || glyphId >= options.numGlyphs) {
      return undefined;
    }
    const start = loca[glyphId]!;
    const end = loca[glyphId + 1]!;
    if (end < start || !hasBytes(glyfBytes, start, end - start)) {
      return undefined;
    }
    return glyfBytes.subarray(start, end);
  };

  const glyphHeader = (glyphId: number): GlyphHeader | undefined => {
    const glyph = glyphBytes(glyphId);
    if (glyph === undefined || !hasBytes(glyph, 0, GLYPH_HEADER_SIZE)) {
      return undefined;
    }
    return {
      numberOfContours: i16(glyph, 0),
      xMin: i16(glyph, 2),
      yMin: i16(glyph, 4),
      xMax: i16(glyph, 6),
      yMax: i16(glyph, 8),
    };
  };

  return {
    numGlyphs: options.numGlyphs,
    glyphBytes,
    glyphHeader,
    compositeComponents(glyphId: number): readonly CompositeComponent[] | undefined {
      const header = glyphHeader(glyphId);
      if (header === undefined || header.numberOfContours >= 0) {
        return undefined;
      }
      const glyph = glyphBytes(glyphId);
      return glyph === undefined ? undefined : readComponents(glyph);
    },
  };
}
