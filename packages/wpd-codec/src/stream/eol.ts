// -- The End-of-Line group's semantics, per WPFF "D0 EOL Functions" --
//
// This is the single most useful table in the whole specification for a reader: alongside each of the twenty-nine End-of-Line subfunctions, the SDK prints a "Conversion/Search mappings" column giving exactly what a converting application should turn that subfunction into. Everything here is that column, transcribed -- not this package's interpretation of what a soft end of column ought to mean.
//
// The same twenty-nine codes appear in the document area two ways, and both must be handled: as the single-byte functions 180 (0xB4) through 207 (0xCF), and as subfunctions of the variable-length group 208 (0xD0). "WP 7.0 uses the deletable area of the multi-byte functions to store formatter data and will change between corresponding codes as needed. A program reading WP 7.0 documents must handle both the multi-byte and single-byte functions."
//
// The correspondence between the two spellings is a reversal, not an offset: subfunction 1 (Soft End of Line) is single-byte 0xCF, and subfunction 28 (Deletable Hard EOP) is single-byte 0xB4, so subfunction = 0xD0 - singleByteCode. Reading the two lists side by side confirms it entry for entry -- 0xC6 Table Cell against subfunction 10 Table Cell, 0xCC Hard EOL against subfunction 4 Hard End of Line, and so on for all twenty-eight. Subfunction 0 (Beginning of File) has no single-byte spelling, which is why the ranges differ in length by one.
//
// https://github.com/OneWingedShark/WordPerfect/blob/master/doc/SDK_Help/FileFormats/WPFF_D0-EOL.htm

// The SDK's own "Conversion/Search mappings" vocabulary, one member per distinct value that column takes.
export type WpdEolMapping =
  | "ignore"
  | "space"
  | "hardReturn"
  | "hardEndOfColumn"
  | "hardEndOfPage"
  | "tableCell"
  | "tableRow"
  | "hardTableRow"
  | "tableOff";

// Indexed by End-of-Line subfunction number, 0 through 28 (0x1C), in the SDK's own order.
const EOL_MAPPINGS: readonly WpdEolMapping[] = [
  "ignore", // 0  Beginning of File
  "space", // 1  Soft End of Line
  "space", // 2  Soft End of Column
  "space", // 3  Soft EOC at EOP
  "hardReturn", // 4  Hard End of Line
  "hardReturn", // 5  Hard EOL at EOC
  "hardReturn", // 6  Hard EOL at EOP
  "hardEndOfColumn", // 7  Hard End of Column
  "hardEndOfColumn", // 8  Hard EOC at EOP
  "hardEndOfPage", // 9  Hard End of Page
  "tableCell", // 10 Table Cell
  "tableRow", // 11 Table Row and Cell
  "tableRow", // 12 Table Row at EOC
  "tableRow", // 13 Table Row at EOP
  "hardTableRow", // 14 Table Row at Hard EOC
  "hardTableRow", // 15 Table Row at Hard EOC at EOP
  "hardTableRow", // 16 Table Row at Hard EOP
  "tableOff", // 17 Table Off
  "tableOff", // 18 Table Off at EOC
  "tableOff", // 19 Table Off at EOC at EOP
  "space", // 20 Deletable Soft EOL
  "space", // 21 Deletable Soft EOC
  "space", // 22 Deletable Soft EOC at EOP
  "hardReturn", // 23 Deletable Hard EOL
  "hardReturn", // 24 Deletable Hard EOL at EOC
  "hardReturn", // 25 Deletable Hard EOL at EOP
  "hardEndOfColumn", // 26 Deletable Hard EOC
  "hardEndOfColumn", // 27 Deletable Hard EOC at EOP
  "hardEndOfPage", // 28 Deletable Hard EOP
];

// The End-of-Line group's function code, and the bounds of its single-byte spelling.
export const EOL_GROUP = 0xd0;
export const FIRST_SINGLE_BYTE_EOL = 0xb4;
export const LAST_SINGLE_BYTE_EOL = 0xcf;

export function eolMappingForSubfunction(
  subfunction: number,
): WpdEolMapping | undefined {
  return EOL_MAPPINGS[subfunction];
}

// Converts a single-byte End-of-Line function code to the group subfunction it is interchangeable with, so both spellings resolve through one table rather than two that could drift apart.
export function subfunctionForSingleByteEol(code: number): number {
  return EOL_GROUP - code;
}

export function isSingleByteEol(code: number): boolean {
  return code >= FIRST_SINGLE_BYTE_EOL && code <= LAST_SINGLE_BYTE_EOL;
}
