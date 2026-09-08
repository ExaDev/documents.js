import { uint16At } from "../bytes/view";
import { pointsFromWpu } from "./units";

// -- Boxes, per WPFF DF Box Functions and Prefix Packet Type 65 (0x41), "Graphics Box Style" --
//
// A box function (0xDF00-02) names its own contents through an override mechanism rather than positionally: "The order of the data depends on the order of the override bits" -- so which of a box's prefix IDs is its contents, its caption, its border or its fill is decided by walking the SAME box override flags word that also gates each bit's own inline override data. This module owns exactly that walk, far enough to answer two questions read.ts needs and no further: what content type and prefix ID does this box's own function-level override name, and what frame does it state.
//
// A box's TEMPLATE packet (type 0x41, resolved separately by read.ts through the box's own required first prefix ID) states rendering defaults and a box KIND (Figure/Table/Text/User/Equation/Button) but never real content -- "content prefix IDs (content rendering IDs, actual content not allowed)" -- so a box's real content, when it has any, is ALWAYS named through this function-level override, never the template. A box whose function carries no content override genuinely has no lifted content to offer.
//
// THE GENERIC OVERRIDE-BLOCK SHAPE, which is what makes this walk tractable without a real box-bearing file to check it against: every one of the eleven top-level override bits except bit 7 (HTML, whose data "will be in Prefix Packet" rather than inline) opens with "[total size of X override data] (not including this word)" before its own flag word and data -- so a bit this module does not otherwise care about is skipped by that size field alone, and a walk that stops caring after the bits it needs never risks drifting into a later bit's data misread as something else.
//
// https://github.com/OneWingedShark/WordPerfect/blob/master/doc/SDK_Help/FileFormats/WPFF_DF-BOX.htm https://github.com/OneWingedShark/WordPerfect/blob/master/doc/SDK_Help/FileFormats/WPFF_PrefixPkt65-82.htm

// Bits of the box's own override flags word (the one at the FUNCTION level -- WPFF_DF-BOX.htm's "Specific Format of Box Override Flags and Data").
const OVERRIDE_BIT_COUNTER = 15;
const OVERRIDE_BIT_POSITION = 14;
const OVERRIDE_BIT_CONTENT = 13;
const OVERRIDE_BIT_HTML = 7; // the one bit whose data is not inline

// Offsets into a box function's own `nonDeletable` bytes (tokenise.ts has already stripped the leading size field that names its own length): 14 reserved bytes, then the two "total size" words, then the override flags word itself.
const RESERVED_SIZE = 14;
const OVERRIDE_FLAGS_OFFSET = RESERVED_SIZE + 2 + 2;
const FIRST_OVERRIDE_BLOCK_OFFSET = OVERRIDE_FLAGS_OFFSET + 2;

// Walks the box function's own top-level override blocks, returning each SET bit's own data (everything after that bit's leading size field, exactly `size` bytes) -- undefined for any block whose stated size runs past the buffer, since a walk that cannot trust its own size fields cannot safely skip past what it does not understand to reach what it does.
function walkOverrideBlocks(
  nonDeletable: Uint8Array,
): { flags: number; blocks: ReadonlyMap<number, Uint8Array> } | undefined {
  if (nonDeletable.length < FIRST_OVERRIDE_BLOCK_OFFSET) {
    return undefined;
  }
  const flags = uint16At(nonDeletable, OVERRIDE_FLAGS_OFFSET);
  const blocks = new Map<number, Uint8Array>();
  let cursor = FIRST_OVERRIDE_BLOCK_OFFSET;
  for (let bit = 15; bit >= 5; bit -= 1) {
    if ((flags & (1 << bit)) === 0) {
      continue;
    }
    if (bit === OVERRIDE_BIT_HTML) {
      continue;
    }
    if (cursor + 2 > nonDeletable.length) {
      return undefined;
    }
    const size = uint16At(nonDeletable, cursor);
    cursor += 2;
    if (cursor + size > nonDeletable.length) {
      return undefined;
    }
    blocks.set(bit, nonDeletable.subarray(cursor, cursor + size));
    cursor += size;
  }
  return { flags, blocks };
}

// The content override block's own nested flags (WPFF_DF-BOX.htm, "bit 13: box content data"): [content override flags], then bit15 (PID flags, 2 bytes, no size prefix of its own) and bit14 (the content type byte itself). Bit 13 (rendering information) and bit 12 (alignment) are not read -- this module only needs the type, not how it renders.
function readContentType(contentBlock: Uint8Array): number | undefined {
  if (contentBlock.length < 2) {
    return undefined;
  }
  const flags = uint16At(contentBlock, 0);
  let cursor = 2;
  if ((flags & 0x8000) !== 0) {
    if (cursor + 2 > contentBlock.length) {
      return undefined;
    }
    cursor += 2;
  }
  if ((flags & 0x4000) === 0) {
    return undefined;
  }
  return contentBlock[cursor];
}

// The position override block's own nested flags (WPFF_DF-BOX.htm, "bit 14: Box positioning data"), read only for bit 11 (width) and bit 10 (height) -- both unconditionally in WPU -- and bits 13/12 (horizontal/vertical offset), accepted only when their own alignment-type bits state "absolute from page edge" (type 0), the one case whose offset is unambiguously the box's own page-space position rather than a value relative to margins or columns this module has no page geometry in hand to resolve against.
function readPositionOverride(
  positionBlock: Uint8Array,
):
  | { widthWpu?: number; heightWpu?: number; xWpu?: number; yWpu?: number }
  | undefined {
  if (positionBlock.length < 2) {
    return undefined;
  }
  const flags = uint16At(positionBlock, 0);
  let cursor = 2;
  let widthWpu: number | undefined;
  let heightWpu: number | undefined;
  let xWpu: number | undefined;
  let yWpu: number | undefined;

  const need = (bytes: number): boolean =>
    cursor + bytes <= positionBlock.length;

  if ((flags & 0x8000) !== 0) {
    // bit 15: PID flags, 2 bytes.
    if (!need(2)) return undefined;
    cursor += 2;
  }
  if ((flags & 0x4000) !== 0) {
    // bit 14: general positioning flags, 2 bytes.
    if (!need(2)) return undefined;
    cursor += 2;
  }
  if ((flags & 0x2000) !== 0) {
    // bit 13: horizontal positioning, 5 bytes -- <flags>[offset]<leftcol><rightcol>.
    if (!need(5)) return undefined;
    const horizontalFlags = positionBlock[cursor];
    const offset = uint16At(positionBlock, cursor + 1);
    if (horizontalFlags !== undefined && (horizontalFlags & 0x03) === 0) {
      xWpu = offset;
    }
    cursor += 5;
  }
  if ((flags & 0x1000) !== 0) {
    // bit 12: vertical positioning, 3 bytes -- <flags>[offset].
    if (!need(3)) return undefined;
    const verticalFlags = positionBlock[cursor];
    const offset = uint16At(positionBlock, cursor + 1);
    if (verticalFlags !== undefined && (verticalFlags & 0x03) === 0) {
      yWpu = offset;
    }
    cursor += 3;
  }
  if ((flags & 0x0800) !== 0) {
    // bit 11: width, 3 bytes -- <flags>[width].
    if (!need(3)) return undefined;
    widthWpu = uint16At(positionBlock, cursor + 1);
    cursor += 3;
  }
  if ((flags & 0x0400) !== 0) {
    // bit 10: height, 3 bytes -- <flags>[height].
    if (!need(3)) return undefined;
    heightWpu = uint16At(positionBlock, cursor + 1);
    cursor += 3;
  }
  return { widthWpu, heightWpu, xWpu, yWpu };
}

export interface WpdBoxFrame {
  readonly xPt: number;
  readonly yPt: number;
  readonly widthPt: number;
  readonly heightPt: number;
  // False when the horizontal or vertical position could not be resolved as an absolute page-space offset, so xPt/yPt default to 0 rather than a value this module could not confirm.
  readonly positionResolved: boolean;
}

export interface WpdBoxContent {
  // The box content type byte (WPFF Prefix Packet Type 65's own enumeration): 0 empty, 1 text, 2 linked text, 3 image, 4 equation, 5 presentation, 6 video, 7 macro, 8 sound, 128 external.
  readonly contentType: number;
  readonly contentPrefixId: number;
  readonly frame: WpdBoxFrame | undefined;
}

// The box content type enumeration's own two structural-text members: a box whose content type is 1 or 2 holds a WP text stream (a "WP 7.0 document" per the template packet's own wording), the same shape a General WP Text prefix packet (type 0x08) already carries for headers, footers, notes, and box captions.
export const BOX_CONTENT_TYPE_TEXT = 1;
export const BOX_CONTENT_TYPE_LINKED_TEXT = 2;
export const BOX_CONTENT_TYPE_IMAGE = 3;
export const BOX_CONTENT_TYPE_EQUATION = 4;

// Resolves a box function's own content type, content prefix ID, and frame from its function-level override -- the ONLY place real box content is ever named (see this module's own top comment). Returns undefined for a box with no content override at all: a box relying entirely on its template's own rendering defaults, with no override naming what fills it, has nothing this reader can lift.
export function readBoxContent(
  nonDeletable: Uint8Array,
  prefixIds: readonly number[],
): WpdBoxContent | undefined {
  const walk = walkOverrideBlocks(nonDeletable);
  if (walk === undefined) {
    return undefined;
  }
  const { flags, blocks } = walk;
  const contentBlock = blocks.get(OVERRIDE_BIT_CONTENT);
  if (contentBlock === undefined) {
    return undefined;
  }
  const contentType = readContentType(contentBlock);
  if (contentType === undefined) {
    return undefined;
  }

  // The PID list order is exactly the order of the SET override bits with a PID slot, per WPFF_DF-BOX.htm's own base list: the required template PID first, then the counter PID (bit 15) if present, then the contents PID (bit 13) -- position (bit 14) names no PID of its own, since its data is entirely inline offsets and flags.
  const counterPidPresent = (flags & (1 << OVERRIDE_BIT_COUNTER)) !== 0;
  const contentPidIndex = 1 + (counterPidPresent ? 1 : 0);
  const contentPrefixId = prefixIds[contentPidIndex];
  if (contentPrefixId === undefined) {
    return undefined;
  }

  const positionBlock = blocks.get(OVERRIDE_BIT_POSITION);
  const position =
    positionBlock === undefined
      ? undefined
      : readPositionOverride(positionBlock);
  const frame: WpdBoxFrame | undefined =
    position?.widthWpu === undefined || position.heightWpu === undefined
      ? undefined
      : {
          xPt: pointsFromWpu(position.xWpu ?? 0),
          yPt: pointsFromWpu(position.yWpu ?? 0),
          widthPt: pointsFromWpu(position.widthWpu),
          heightPt: pointsFromWpu(position.heightWpu),
          positionResolved:
            position.xWpu !== undefined && position.yWpu !== undefined,
        };

  return { contentType, contentPrefixId, frame };
}
