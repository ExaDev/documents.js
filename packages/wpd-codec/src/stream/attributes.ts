// -- Character attributes, per WPFF "Fixed-Length Multi-Byte Functions", 0xF2 Attribute On and 0xF3 Attribute Off --
//
// Both functions are three bytes -- gate, attribute, gate -- and carry one attribute number in bits 0-5 of the payload byte. Bit 6 is reserved. Bit 7 means "Ignore the attributed text on/off codes. Used when an attributed block of text becomes a subset of a larger attribute block of the same type, such as bolding a sentence that contains a word already bolded", so a code with that bit set changes nothing and is dropped.

export const ATTRIBUTE_ON = 0xf2;
export const ATTRIBUTE_OFF = 0xf3;

// Bit 7 of the payload byte: this code is nested inside a larger block of the same attribute and must not change state.
const ATTRIBUTE_IGNORE_BIT = 0x80;

// Bits 0-5 hold the attribute number; bit 6 is reserved.
const ATTRIBUTE_NUMBER_MASK = 0x3f;

// The SDK's attribute numbering, in full. Only the members the shared content schema's own ContentRun can express are consumed by the reader -- italics, double underline, bold, strikeout, underline -- but naming all eighteen keeps the table checkable against the specification rather than looking like an arbitrary subset.
export const WpdAttribute = {
  ExtraLarge: 0,
  VeryLarge: 1,
  Large: 2,
  SmallPrint: 3,
  FinePrint: 4,
  Superscript: 5,
  Subscript: 6,
  Outline: 7,
  Italics: 8,
  Shadow: 9,
  Redline: 10,
  DoubleUnderline: 11,
  Bold: 12,
  Strikeout: 13,
  Underline: 14,
  SmallCaps: 15,
  Blink: 16,
  ReverseVideo: 17,
} as const;

export interface WpdAttributeCode {
  readonly attribute: number;
  readonly ignore: boolean;
}

export function decodeAttributeByte(payload: number): WpdAttributeCode {
  return {
    attribute: payload & ATTRIBUTE_NUMBER_MASK,
    ignore: (payload & ATTRIBUTE_IGNORE_BIT) !== 0,
  };
}

// The active attribute numbers, as a set rather than one boolean per schema field. Two WordPerfect attributes map onto ContentRun's single `underline` (plain and double), so booleans would let an Underline Off silently clear a still-open Double Underline; a set keeps each attribute's own on/off pairing independent and derives the schema's flags from it.
export interface WpdRunAttributes {
  readonly bold: boolean;
  readonly italic: boolean;
  readonly underline: boolean;
  readonly strike: boolean;
}

export function runAttributesFrom(
  active: ReadonlySet<number>,
): WpdRunAttributes {
  return {
    bold: active.has(WpdAttribute.Bold),
    italic: active.has(WpdAttribute.Italics),
    underline:
      active.has(WpdAttribute.Underline) ||
      active.has(WpdAttribute.DoubleUnderline),
    strike: active.has(WpdAttribute.Strikeout),
  };
}
