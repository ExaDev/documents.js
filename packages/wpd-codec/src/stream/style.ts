import { uint16At, uint32At } from "../bytes/view";

// -- Styles and outline numbering, per WPFF "DD Style Functions" and "DA Display Number Functions" --
//
// WordPerfect states a style's IDENTITY twice: as a prefix ID naming a style packet whose contents are that style's own codes, and -- for a style the product itself defines rather than the user -- as a "system style number" in the function's own non-deletable data. The second is the one that carries meaning across formats: the SDK enumerates it, and its entries include "68 = heading level 1 style" through "75 = heading level 8 style", "52 = level 1 style (indented)" through "67 = level 8 style (not indented)", "48 = bullets" and "31 = list". That enumeration is the whole basis for this package's heading and list recovery -- a heading is a heading because the file says which system style it is, never because its text is short or its font is large.
//
// The style group's pairing comes from the flags byte, not from the subfunction names: "2 = Encased/paired function. Begin/On codes are mod 4=0 subfunctions (multiple-of-4 subfunctions) followed immediately by Begin/Off, End/On and End/Off codes numbered consecutively", and "3 = Encased function. Begin/On codes are even subfunctions and End/Off codes are the next odd subfunction". So subfunctions 0-3 are one quad (character style), 4-9 the paragraph style's own begin quad plus its end pair, and 10-11 the Global On/Off pair -- three regions, each opened by one subfunction and closed by another, which is exactly the shape a scope stack needs.
//
// https://github.com/OneWingedShark/WordPerfect/blob/master/doc/SDK_Help/FileFormats/WPFF_DD-Style.htm https://github.com/OneWingedShark/WordPerfect/blob/master/doc/SDK_Help/FileFormats/WPFF_DA-DisplayNumber.htm

export const STYLE_GROUP = 0xdd;
export const DISPLAY_NUMBER_GROUP = 0xda;

// The three subfunctions that OPEN a styled region, and the three that close the matching one. "Style Begin On" opens the character-style quad and "Style End Off" closes it; "Paragraph Style Begin On (Part 1)" opens the paragraph-style region and "Paragraph Style End Off" closes it; "Global On" and "Global Off" are the encased pair. The four intermediate subfunctions (Style Begin Off, Style End On, and the paragraph style's Part 2 pair) delimit the style's own before- and after-codes inside that region and open no scope of their own.
const STYLE_BEGIN_ON = 0x00;
const STYLE_END_OFF = 0x03;
const PARAGRAPH_STYLE_BEGIN_ON = 0x04;
const PARAGRAPH_STYLE_END_OFF = 0x09;
const GLOBAL_ON = 0x0a;
const GLOBAL_OFF = 0x0b;

const STYLE_SCOPE_OPENERS: ReadonlySet<number> = new Set([
  STYLE_BEGIN_ON,
  PARAGRAPH_STYLE_BEGIN_ON,
  GLOBAL_ON,
]);
const STYLE_SCOPE_CLOSERS: ReadonlySet<number> = new Set([
  STYLE_END_OFF,
  PARAGRAPH_STYLE_END_OFF,
  GLOBAL_OFF,
]);

export function isStyleScopeOpener(subfunction: number): boolean {
  return STYLE_SCOPE_OPENERS.has(subfunction);
}

export function isStyleScopeCloser(subfunction: number): boolean {
  return STYLE_SCOPE_CLOSERS.has(subfunction);
}

// All three openers share one non-deletable layout: "[size of non-deletable information = 3]", being "[hash of this Begin On]" then "<system style number>". The byte after the hash is therefore the system style number, wherever the region was opened from.
const SYSTEM_STYLE_NUMBER_OFFSET = 2;

// "<system style number (-1 if normal)>" on the Style and Paragraph Style openers, written into a single byte -- so the sentinel arrives as 0xFF. Global On instead enumerates 1 as normal, which needs no sentinel; either way a value this package assigns no structural meaning simply opens a scope that changes nothing.
const SYSTEM_STYLE_NONE = 0xff;

export function readSystemStyleNumber(
  nonDeletable: Uint8Array,
): number | undefined {
  // No separate undefined check is needed: value is already undefined when the byte is absent, so returning it as-is in that case already answers undefined -- exactly what an explicit check-and-return-undefined would do.
  const value = nonDeletable[SYSTEM_STYLE_NUMBER_OFFSET];
  return value === SYSTEM_STYLE_NONE ? undefined : value;
}

// The SDK's own enumeration, transcribed for the entries the shared content schema has a structural spelling for. Everything else it lists -- footnote and endnote number styles, box number styles, table-of-contents and index levels, header and footer styles, hypertext, captions -- names a region whose own construct this package does not lift, so those numbers open a scope that carries no heading level and no list level rather than being forced onto the nearest thing that fits.
const FIRST_HEADING_LEVEL_STYLE = 68; // "68 = heading level 1 style"
const LAST_HEADING_LEVEL_STYLE = 75; // "75 = heading level 8 style"
const FIRST_INDENTED_LEVEL_STYLE = 52; // "52 = level 1 style (indented)"
const LAST_INDENTED_LEVEL_STYLE = 59; // "59 = level 8 style (indented)"
const FIRST_PLAIN_LEVEL_STYLE = 60; // "60 = level 1 style (not indented)"
const LAST_PLAIN_LEVEL_STYLE = 67; // "67 = level 8 style (not indented)"
const LIST_STYLE = 31; // "31 = list"
const BULLETS_STYLE = 48; // "48 = bullets"

// What one system style number means structurally. A style is at most one of the two: the SDK's own numbering keeps headings and outline levels in disjoint ranges, so nothing can be both.
export interface WpdStyleSemantics {
  // 1 for the outermost heading, matching ContentParagraph.headingLevel's own convention and the SDK's own "heading level 1" through "heading level 8" naming.
  readonly headingLevel: number | undefined;
  // 0 for the outermost list level, matching ContentListMembership.level's own zero-based convention -- so the SDK's "level 1 style" is level 0 here.
  readonly listLevel: number | undefined;
}

export function styleSemanticsFor(
  systemStyleNumber: number,
): WpdStyleSemantics | undefined {
  if (
    systemStyleNumber >= FIRST_HEADING_LEVEL_STYLE &&
    systemStyleNumber <= LAST_HEADING_LEVEL_STYLE
  ) {
    return {
      headingLevel: systemStyleNumber - FIRST_HEADING_LEVEL_STYLE + 1,
      listLevel: undefined,
    };
  }
  if (
    systemStyleNumber >= FIRST_INDENTED_LEVEL_STYLE &&
    systemStyleNumber <= LAST_INDENTED_LEVEL_STYLE
  ) {
    return {
      headingLevel: undefined,
      listLevel: systemStyleNumber - FIRST_INDENTED_LEVEL_STYLE,
    };
  }
  if (
    systemStyleNumber >= FIRST_PLAIN_LEVEL_STYLE &&
    systemStyleNumber <= LAST_PLAIN_LEVEL_STYLE
  ) {
    return {
      headingLevel: undefined,
      listLevel: systemStyleNumber - FIRST_PLAIN_LEVEL_STYLE,
    };
  }
  if (systemStyleNumber === LIST_STYLE || systemStyleNumber === BULLETS_STYLE) {
    return { headingLevel: undefined, listLevel: 0 };
  }
  return undefined;
}

// -- Outline numbering: the Display Number Reference group (0xDA) --
//
// "The subfunctions in this list are paired so that the even-numbered codes are the On functions and the odd numbered codes are the Off functions. Each instance of a subfunction will consist of the On subfunction, the associated information, and the Off subfunction." The associated information between the pair is the counter's RENDERED text -- the number or bullet a reader sees -- and the On function's own non-deletable data is "[size of non-deletable information = 1] <level number to display (0 - n)>".
//
// Paragraph Number Display is the member that carries document structure: a paragraph whose flow opens with one is an outline item at the level it names. Its rendered digits are generated content rather than typed text, so they are dropped in favour of the list membership that regenerates them -- the same trade every list-aware writer in this family makes, and reported through the diagnostic sink so the substitution is visible rather than silent. The other members (page, chapter, volume, box, footnote and endnote numbers) display a counter inside running text and carry no structure, so their digits stay exactly where they are.
const PARAGRAPH_NUMBER_DISPLAY_ON = 0x0c;
const PARAGRAPH_NUMBER_DISPLAY_OFF = 0x0d;

export function isParagraphNumberDisplayOn(subfunction: number): boolean {
  return subfunction === PARAGRAPH_NUMBER_DISPLAY_ON;
}

export function isParagraphNumberDisplayOff(subfunction: number): boolean {
  return subfunction === PARAGRAPH_NUMBER_DISPLAY_OFF;
}

export function readDisplayNumberLevel(
  nonDeletable: Uint8Array,
): number | undefined {
  return nonDeletable[0];
}

// -- Resolving a style packet's own definitions, per WPFF Prefix Packet Type 48 (0x30), "Normal Style" --
//
// A style's identity is stated twice: as a system style number in the opening function's own non-deletable data (readSystemStyleNumber above), and as a prefix ID naming this packet -- "the prefix ID referred to ... is the standard WP Text packet"-shaped record whose own text blocks carry the style's before- and after-codes. Bit 7 of the opening function's own flags names the PID (WpdVariableFunctionToken.prefixIds, from the tokeniser), so a style scope this package cannot classify by system style number may still resolve real direct formatting through its own packet.
//
// "[number of text blocks = 4] {relative offset of 1st text block} {paragraph text size} {beginning style text size} {end style text size} {extra style text size}" -- four LONG-sized regions laid out consecutively starting at the stated relative offset, exactly the "General WP Text" packet's own block layout (container/prefix.ts's neighbouring packet types), except every size here is a 32-bit long rather than a 16-bit short. Only the "beginning style text size" block is read: it is the region WordPerfect inserts at the START of the styled text, the paired-style analogue of a Font Face Change or Attribute On function typed directly into the document, and applying it the same way those apply is what resolves the style's own direct formatting onto the runs the scope encloses.
export const PACKET_TYPE_NORMAL_STYLE = 0x30;

const PID_COUNT_OFFSET = 0;
const TEXT_BLOCK_HEADER_SIZE = 2 + 4 * 4; // [number of text blocks] then four LONG sizes/offsets

export function readStyleBeginBlock(
  packet: Uint8Array,
): Uint8Array | undefined {
  // uint16At throws (via byteAt) rather than returning undefined for a read that runs past packet's own end, caught below -- so the PID count word itself needs no separate room check ahead of reading it. The afterPids + TEXT_BLOCK_HEADER_SIZE guard just below stays a plain comparison, not a throw-and-catch substitute: it checks room for the whole four-LONG text-block header even though only three of those four longs are ever read here, so a bare throw on the actual reads alone cannot stand in for it.
  try {
    const pidCount = uint16At(packet, PID_COUNT_OFFSET);
    const afterPids = 2 + pidCount * 2;
    if (afterPids + TEXT_BLOCK_HEADER_SIZE > packet.length) {
      return undefined;
    }
    const relativeOffset = uint32At(packet, afterPids + 2);
    const paragraphTextSize = uint32At(packet, afterPids + 6);
    const beginningStyleTextSize = uint32At(packet, afterPids + 10);
    if (beginningStyleTextSize === 0) {
      return undefined;
    }
    const start = relativeOffset + paragraphTextSize;
    const end = start + beginningStyleTextSize;
    // No separate start < 0 guard is needed: relativeOffset and paragraphTextSize are both unsigned 32-bit reads, so start can never be negative.
    if (end > packet.length) {
      return undefined;
    }
    return packet.subarray(start, end);
  } catch {
    return undefined;
  }
}
