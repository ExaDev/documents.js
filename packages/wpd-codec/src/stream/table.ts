import type { Alignment, Color } from "document-schema.js";
import { uint16At } from "../bytes/view";
import { pointsFromWpu } from "./units";

// -- Tables, per WPFF "D4 Character Functions" (the definition) and "D0 EOL Functions" (the cell and row boundaries) --
//
// A WordPerfect table is stated in two halves that sit in different function groups, and neither half is nested inside the other:
//
//   1. THE DEFINITION opens with Table Definition (0xD42A, "Table On"), is followed by one Table Column function (0xD42C) per column, and closes with Define Table End (0xD42B). Nothing here is content -- it is the grid's own shape: column widths, gutters, and per-column defaults.
//   2. THE CONTENT follows immediately, as ordinary document text delimited by End-of-Line group codes: subfunction 10 ends a cell, 11 through 16 end a cell and its row, and 17 through 19 end the table. That is why a reader with no table support at all still recovers a table's text in reading order -- every boundary is also a line break.
//
// The per-cell facts (spanning, justification, background fill, fixed row height) are not functions of their own: they ride INSIDE the End-of-Line function that ends the cell or row, as "embedded subfunctions" in its non-deletable data. That layout is unique to this group -- "This format is unique in that the non-deletable data area also contains deletable data" -- so the group's own non-deletable region opens with a size word for the deletable half, and the embedded subfunctions this module reads sit after it.
//
// https://github.com/OneWingedShark/WordPerfect/blob/master/doc/SDK_Help/FileFormats/WPFF_D4-Character.htm https://github.com/OneWingedShark/WordPerfect/blob/master/doc/SDK_Help/FileFormats/WPFF_D0-EOL.htm

// The three Character-group subfunctions that state a table's grid.
export const CHARACTER_TABLE_DEFINITION = 0x2a;
export const CHARACTER_DEFINE_TABLE_END = 0x2b;
export const CHARACTER_TABLE_COLUMN = 0x2c;

// -- Table Column (0xD42C) --
//
// "[size of non-deletable information = 17]": <flags> 1, [width] 2, [left gutter spacing (WPU)] 2, [right gutter spacing (WPU)] 2, [attribute word 1] 2, [attribute word 2] 2, <alignments> 1, [absolute position from right] 2, [number type] 2, <currency symbol index> 1. Seventeen exactly, which is what fixes the width at offset 1.
const COLUMN_WIDTH_OFFSET = 1;
const COLUMN_NON_DELETABLE_SIZE = 17;

// The column's width. The SDK writes it as a bare "[width]" where the two gutters immediately after it are tagged "(WPU)", and every other horizontal dimension in the format is a WordPerfect Unit, so it is read as one.
export function readTableColumnWidthPt(
  nonDeletable: Uint8Array,
): number | undefined {
  if (nonDeletable.length < COLUMN_NON_DELETABLE_SIZE) {
    return undefined;
  }
  const widthWpu = uint16At(nonDeletable, COLUMN_WIDTH_OFFSET);
  if (widthWpu <= 0) {
    return undefined;
  }
  return pointsFromWpu(widthWpu);
}

// -- The End-of-Line group's embedded subfunctions --
//
// Each is gated the way every multi-byte function is -- its own code at both ends -- and the SDK prints a size against each one. This table is that column, and it is what makes the walk safe: an embedded subfunction whose size is not stated here cannot be stepped over, so the walk stops at it rather than guessing a length and decoding the rest of the list as rubbish.
//
// 0x81 is the one variable-length member, and 0x8D the one with no end gate at all ("size = 1"); both are handled by the walker below rather than by this table.
const EMBEDDED_SUBFUNCTION_SIZES: ReadonlyMap<number, number> = new Map([
  [0x80, 5], // Row Information
  [0x82, 4], // New Top Gutter Spacing
  [0x83, 4], // New Bottom Gutter Spacing
  [0x84, 9], // Cell Information
  [0x85, 4], // Cell Spanning Information
  [0x86, 10], // Cell Fill Colors
  [0x87, 6], // Cell Line Color
  [0x88, 5], // Cell Number Type
  [0x89, 11], // Cell Floating Point Number
  [0x8b, 3], // Cell Prefix Flag
  [0x8c, 3], // Cell Recalculation Error Number
]);

// "New Cell Formula Embedded Subfunction ... <129 (0x81)> [size = variable] [length of formula] <tokenized formula> x length of formula [length] <129 (0x81)>" -- the code, the length word, the formula, the length word again, the code: six bytes of framing around the formula itself.
const CELL_FORMULA_SUBFUNCTION = 0x81;
const CELL_FORMULA_FRAMING_SIZE = 6;

// "Don't End a Paragraph Style for this Hard Return ... <141 (0x8D)> (size = 1)" -- the whole subfunction is its own code, with no payload and no closing gate. The only member of the list shaped that way.
const DONT_END_PARAGRAPH_STYLE_SUBFUNCTION = 0x8d;

export const ROW_INFORMATION_SUBFUNCTION = 0x80;
export const CELL_INFORMATION_SUBFUNCTION = 0x84;
export const CELL_SPANNING_SUBFUNCTION = 0x85;
export const CELL_FILL_COLORS_SUBFUNCTION = 0x86;

export interface WpdEmbeddedSubfunction {
  readonly code: number;
  // The payload between the two gates, or an empty view for the one gateless member.
  readonly data: Uint8Array;
}

export interface WpdEmbeddedSubfunctions {
  readonly subfunctions: readonly WpdEmbeddedSubfunction[];
  // True when the walk stopped early on a subfunction code the SDK states no size for. Everything before it is still valid; everything after it is unreachable, because a list of self-sized records offers no way past a record of unknown length.
  readonly truncated: boolean;
}

// Splits an End-of-Line function's non-deletable region into its embedded subfunctions.
//
// The region does not begin with them: "[size of deletable and non-deletable subfunctions]" is the size word the tokeniser already consumed as this function's non-deletable size, and the region it delimits opens with "[size of deletable subfunction data]" followed by the deletable subfunctions themselves. The non-deletable ones -- the documented half, and the only half this package reads -- come after both.
export function readEmbeddedSubfunctions(
  nonDeletable: Uint8Array,
): WpdEmbeddedSubfunctions {
  if (nonDeletable.length < 2) {
    return { subfunctions: [], truncated: false };
  }
  const deletableSize = uint16At(nonDeletable, 0);
  let cursor = 2 + deletableSize;
  if (cursor > nonDeletable.length) {
    // A deletable size that overruns its own function is a malformed record rather than a stream that has gone out of step -- the tokeniser already verified this function's gates and duplicated size -- so the cell simply carries no readable attributes.
    return { subfunctions: [], truncated: true };
  }

  const subfunctions: WpdEmbeddedSubfunction[] = [];
  while (cursor < nonDeletable.length) {
    const code = nonDeletable[cursor];
    if (code === undefined) {
      break;
    }
    if (code === DONT_END_PARAGRAPH_STYLE_SUBFUNCTION) {
      subfunctions.push({ code, data: new Uint8Array(0) });
      cursor += 1;
      continue;
    }
    const size =
      code === CELL_FORMULA_SUBFUNCTION
        ? cursor + 3 <= nonDeletable.length
          ? uint16At(nonDeletable, cursor + 1) + CELL_FORMULA_FRAMING_SIZE
          : undefined
        : EMBEDDED_SUBFUNCTION_SIZES.get(code);
    if (size === undefined || cursor + size > nonDeletable.length) {
      return { subfunctions, truncated: true };
    }
    if (nonDeletable[cursor + size - 1] !== code) {
      // Every embedded subfunction but 0x8D repeats its own code as an end gate, exactly as the enclosing function does. A gate that does not match means the walk is out of step, so it stops here rather than reporting attributes read from the wrong offsets.
      return { subfunctions, truncated: true };
    }
    subfunctions.push({
      code,
      data: nonDeletable.subarray(cursor + 1, cursor + size - 1),
    });
    cursor += size;
  }
  return { subfunctions, truncated: false };
}

export function findEmbeddedSubfunction(
  subfunctions: readonly WpdEmbeddedSubfunction[],
  code: number,
): Uint8Array | undefined {
  return subfunctions.find((subfunction) => subfunction.code === code)?.data;
}

// -- Row Information (0xD080), "(size = 5)": <row flags> then [row height if fixed (WPU)] --

export interface WpdRowInformation {
  readonly headerRow: boolean;
  // Present only when the row's own flags say its height is fixed; an automatic-height row states no height at all, and reporting the field's contents anyway would turn a formatter's scratch value into a claim about the document.
  readonly heightPt: number | undefined;
}

const ROW_FLAG_FIXED_HEIGHT = 0x02;
const ROW_FLAG_HEADER_ROW = 0x04;

export function readRowInformation(
  data: Uint8Array,
): WpdRowInformation | undefined {
  const flags = data[0];
  if (flags === undefined || data.length < 3) {
    return undefined;
  }
  const heightWpu = uint16At(data, 1);
  const fixedHeight = (flags & ROW_FLAG_FIXED_HEIGHT) !== 0;
  return {
    headerRow: (flags & ROW_FLAG_HEADER_ROW) !== 0,
    heightPt:
      fixedHeight && heightWpu > 0 ? pointsFromWpu(heightWpu) : undefined,
  };
}

// -- Cell Information (0xD084), "(size = 9)": <flag> <justification> <alignment> [attribute word 1] [attribute word 2] --

// "bits 0-2: justification: 0 = left, 1 = full, 2 = center, 3 = right, 4 = all (kinto waritsuke), 5 = decimal align" -- the same six-member vocabulary the paragraph group's own Set Justification Mode uses, and mapped onto the shared schema's four-member Alignment the same way: full-all-lines is a justification variant the schema does not distinguish from justify, and decimal alignment is a numeric-column concern with no paragraph-level spelling, so it takes the left a cell's text defaults to.
const CELL_JUSTIFICATION: readonly Alignment[] = [
  "left",
  "justify",
  "center",
  "right",
  "justify",
  "left",
];

const CELL_FLAG_USE_JUSTIFICATION = 0x02;
const CELL_JUSTIFICATION_MASK = 0x07;

export interface WpdCellInformation {
  // Present only when the cell's own flag says its justification is its own ("bit 1: 1 = use cell justification"); otherwise the cell inherits, and stating a value here would override an inheritance the file deliberately left open.
  readonly alignment: Alignment | undefined;
}

export function readCellInformation(
  data: Uint8Array,
): WpdCellInformation | undefined {
  const flag = data[0];
  const justification = data[1];
  if (flag === undefined || justification === undefined) {
    return undefined;
  }
  if ((flag & CELL_FLAG_USE_JUSTIFICATION) === 0) {
    return { alignment: undefined };
  }
  return {
    alignment: CELL_JUSTIFICATION[justification & CELL_JUSTIFICATION_MASK],
  };
}

// -- Cell Spanning Information (0xD085), "(size = 4)": <number of cells spanned horizontally> <number of cells spanned vertically> --
//
// "bit 7 is set if spanned from left" / "bit 7 is set if spanned from above" -- so the byte carries two facts at once: the low seven bits are the span count, and the high bit marks a cell that is COVERED by an earlier cell's span rather than the one doing the spanning. The shared schema states a table as one entry per originating cell with colSpan/rowSpan on it and no entry at all for a covered position, so a covered cell is dropped rather than emitted with a span of its own.

const SPAN_COVERED_FLAG = 0x80;
const SPAN_COUNT_MASK = 0x7f;

export interface WpdCellSpanning {
  readonly columnSpan: number;
  readonly rowSpan: number;
  readonly coveredFromLeft: boolean;
  readonly coveredFromAbove: boolean;
}

export function readCellSpanning(
  data: Uint8Array,
): WpdCellSpanning | undefined {
  const horizontal = data[0];
  const vertical = data[1];
  if (horizontal === undefined || vertical === undefined) {
    return undefined;
  }
  return {
    columnSpan: horizontal & SPAN_COUNT_MASK,
    rowSpan: vertical & SPAN_COUNT_MASK,
    coveredFromLeft: (horizontal & SPAN_COVERED_FLAG) !== 0,
    coveredFromAbove: (vertical & SPAN_COVERED_FLAG) !== 0,
  };
}

// -- Cell Fill Colors (0xD086), "(size = 10)": <foreground color (RGBS)> x 4, <background color (RGBS)> x 4 --
//
// RGBS is four bytes: red, green, blue, and a shading percentage. "Each color takes one byte with a range from 0 to 255 (0xFF) where 255 is 100%", the same statement the character-colour function rests on, so each component divides by 255 into the shared schema's 0..1 Color.
//
// The BACKGROUND colour is the one a cell's fill means in the shared schema's ContentTableCell.background. WordPerfect's foreground/background pair with a shading percentage describes a two-colour pattern fill, which a single flat colour cannot express -- so a cell whose shading says it is a genuine blend is reported rather than flattened to whichever half looks closer.

const COLOR_COMPONENT_MAX = 255;
const RGBS_SIZE = 4;
const SHADE_OFFSET = 3;
const FULL_SHADE = 255;

export interface WpdCellFill {
  readonly background: Color;
  // True when the fill's own shading percentage is neither fully opaque nor fully absent, so the rendered colour is a blend of the pair rather than either one of them.
  readonly blended: boolean;
}

function colorAt(data: Uint8Array, offset: number): Color | undefined {
  const r = data[offset];
  const g = data[offset + 1];
  const b = data[offset + 2];
  if (r === undefined || g === undefined || b === undefined) {
    return undefined;
  }
  return {
    r: r / COLOR_COMPONENT_MAX,
    g: g / COLOR_COMPONENT_MAX,
    b: b / COLOR_COMPONENT_MAX,
  };
}

export function readCellFill(data: Uint8Array): WpdCellFill | undefined {
  const background = colorAt(data, RGBS_SIZE);
  if (background === undefined) {
    return undefined;
  }
  const backgroundShade = data[RGBS_SIZE + SHADE_OFFSET];
  return {
    background,
    blended: backgroundShade !== undefined && backgroundShade !== FULL_SHADE,
  };
}
