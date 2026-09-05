import type { BlockCursor } from "./cursor";

// BIFF8's three string shapes, which differ only in how the character count is carried and what optional payloads trail the characters:
//
//   * XLUnicodeString ([MS-XLS] 2.5.294) -- two-byte cch, flags, rgb. https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/36ca6de7-be16-48bc-aa5e-3eaf4942f671
//   * ShortXLUnicodeString ([MS-XLS] 2.5.240) -- the same with a ONE-byte cch. https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/05162858-0ca9-44cb-bb07-a720928f63f8
//   * XLUnicodeRichExtendedString ([MS-XLS] 2.5.293) -- two-byte cch plus optional formatting-run and phonetic payloads, and the one shape whose characters may continue across a Continue boundary. https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/173d9f51-e5d3-43da-8de2-be7f22e119b9
//
// In all three, cch counts CHARACTERS in the format's own UTF-16 sense (an astral code point counts as its two surrogate units, not as one), and fHighByte says how each is stored: clear means one byte per character holding the low half of a code unit whose high half is 0x00 -- so byte 0xE9 is U+00E9, a code point, never a code-page index -- and set means a full little-endian UTF-16 code unit per character.
//
// The continuation rule on the rich shape is the one thing here that a reader cannot afford to get wrong, and the reason for BlockCursor's existence. When a string's characters run past the end of the record they started in, the Continue that carries the rest opens with a re-stated fHighByte byte before resuming the character data, and that flag governs the REMAINDER rather than being a copy of the original -- a string genuinely can start compressed and finish uncompressed. A reader that concatenates the blocks and takes cch units instead reads that flag byte as a character and shifts everything after it, which corrupts every string past the first boundary while leaving small files looking perfect.

/** Bit 0 of a string's flags byte: set when each character occupies a full two-byte UTF-16 code unit. */
const FLAG_HIGH_BYTE = 0x01;
/** Bit 2 of an XLUnicodeRichExtendedString's flags byte: set when phonetic (ExtRst) data trails the characters. */
const FLAG_EXT_ST = 0x04;
/** Bit 3 of an XLUnicodeRichExtendedString's flags byte: set when formatting runs (rgRun) trail the characters. */
const FLAG_RICH_ST = 0x08;

/** [MS-XLS] 2.5.132: a FormatRun is four bytes (a character index and a font index). */
const FORMAT_RUN_SIZE = 4;

/**
 * Reads `count` characters, consuming the re-stated flag byte at every continuation boundary the run crosses.
 *
 * `startBlock` is the block the string's own header was read in, captured by the caller before reading cch. Comparing against that rather than against the cursor's position at entry is what makes the boundary-at-the-first-character case work: a string whose fixed fields fill their record exactly, leaving every character to the Continue, still opens that Continue with a flag byte, and a position captured after the header was read would already have settled onto the Continue and missed it.
 *
 * The boundary byte is consumed only when characters genuinely remain, so a string whose last character lands on the final byte of a block leaves the next block's first byte alone -- that byte belongs to whatever the record holds next, which for the SST is the following string's own cch.
 */
function readCharacters(
  cursor: BlockCursor,
  count: number,
  initialHighByte: boolean,
  startBlock: number,
): string {
  let highByte = initialHighByte;
  let block = startBlock;
  const units: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const currentBlock = cursor.blockPosition();
    if (currentBlock !== block) {
      // The run has crossed into a Continue: its first byte re-states fHighByte for everything that follows, which may legitimately differ from what the string started as.
      highByte = (cursor.u8() & FLAG_HIGH_BYTE) !== 0;
      // Set to the block just crossed into, deliberately not re-read from the cursor: a Continue carrying only this flag byte is now exhausted, and the next iteration must detect crossing out of it and consume the following Continue's own flag byte too.
      block = currentBlock;
    }
    // A two-byte character is never split across a boundary: [MS-XLS] 2.5.293 requires that "if fHighByte is 0x1 and rgb is extended with a Continue record the break MUST occur at the double-byte character boundary".
    units.push(highByte ? cursor.u16() : cursor.u8());
  }
  // Assembled in chunks rather than one spread call, so a very long string cannot exceed the argument-count limit String.fromCharCode(...units) would hit.
  const CHUNK = 4096;
  let text = "";
  for (let start = 0; start < units.length; start += CHUNK) {
    text += String.fromCharCode(...units.slice(start, start + CHUNK));
  }
  return text;
}

/** An XLUnicodeString ([MS-XLS] 2.5.294): a two-byte character count, a flags byte, then the characters. Continuable, since the String record ([MS-XLS] 2.4.268) carrying a formula's string result is one of these and its own production admits trailing Continues. */
export function readXLUnicodeString(cursor: BlockCursor): string {
  const startBlock = cursor.blockPosition();
  const cch = cursor.u16();
  const flags = cursor.u8();
  return readCharacters(
    cursor,
    cch,
    (flags & FLAG_HIGH_BYTE) !== 0,
    startBlock,
  );
}

/** An XLUnicodeStringNoCch ([MS-XLS] 2.5.295): a flags byte then the characters, with no character-count field of its own -- the containing structure states the count separately (SupBook's own `cch`, for its `virtPath` field), so the caller supplies it here rather than this function reading a fresh prefix. */
export function readXLUnicodeStringNoCch(
  cursor: BlockCursor,
  count: number,
): string {
  const startBlock = cursor.blockPosition();
  const flags = cursor.u8();
  return readCharacters(
    cursor,
    count,
    (flags & FLAG_HIGH_BYTE) !== 0,
    startBlock,
  );
}

/** A ShortXLUnicodeString ([MS-XLS] 2.5.240): as above, with a one-byte character count. */
export function readShortXLUnicodeString(cursor: BlockCursor): string {
  const startBlock = cursor.blockPosition();
  const cch = cursor.u8();
  const flags = cursor.u8();
  return readCharacters(
    cursor,
    cch,
    (flags & FLAG_HIGH_BYTE) !== 0,
    startBlock,
  );
}

/**
 * An XLUnicodeRichExtendedString ([MS-XLS] 2.5.293): the SST's own element shape.
 *
 * Only the text is returned. A rich string's per-run font changes and an extended string's phonetic guide data are read past rather than modelled: `ContentSheetCell.runs` could carry the former, but resolving a FormatRun's font index into real run formatting needs the globals substream's Font table threaded down here, and the phonetic data has no representation in the shared schema at all. Both payloads must still be CONSUMED exactly, because the SST is a packed array -- leaving a single byte of either behind would desynchronise every string after it.
 */
export function readRichExtendedString(cursor: BlockCursor): string {
  const startBlock = cursor.blockPosition();
  const cch = cursor.u16();
  const flags = cursor.u8();
  const rich = (flags & FLAG_RICH_ST) !== 0;
  const extended = (flags & FLAG_EXT_ST) !== 0;
  // Both counts precede the characters, and both must be read before them even though their payloads trail them.
  const runCount = rich ? cursor.u16() : 0;
  const extendedSize = extended ? cursor.i32() : 0;
  const text = readCharacters(
    cursor,
    cch,
    (flags & FLAG_HIGH_BYTE) !== 0,
    startBlock,
  );
  if (runCount > 0) {
    cursor.skip(runCount * FORMAT_RUN_SIZE);
  }
  if (extendedSize > 0) {
    cursor.skip(extendedSize);
  }
  return text;
}
