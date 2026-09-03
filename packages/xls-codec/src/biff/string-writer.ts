import { RecordBuilder } from "./builder";
import { BiffWriteError } from "./write-errors";

// The write-side mirror of biff/strings.ts: BIFF8's three string shapes, encoded rather than decoded. Unlike the reader, this writer never has to handle a Continue boundary -- every string this package writes fits inside one record's own 8224-byte data ceiling, checked by biff/record-writer.ts's writeRecord once the field is assembled, so there is no fHighByte-per-boundary case to get right here.
//
// cch counts UTF-16 code units, exactly as the reader documents: an astral character occupies two units, each written as its own 16-bit value in the uncompressed encoding. A string is written compressed (one byte per unit, fHighByte clear) when every unit fits in a low byte, and uncompressed (two bytes per unit, fHighByte set) otherwise -- the same choice a real producer makes, and the smaller of the two whenever it is legal.

/** Bit 0 of a string's flags byte: set when each character occupies a full two-byte UTF-16 code unit ([MS-XLS] 2.5.293/2.5.294/2.5.240's own fHighByte). */
const FLAG_HIGH_BYTE = 0x01;

/** The largest character count a ShortXLUnicodeString's one-byte cch can name. */
const MAX_SHORT_STRING_LENGTH = 0xff;

/** The largest character count an XLUnicodeString/XLUnicodeRichExtendedString's two-byte cch can name. */
const MAX_STRING_LENGTH = 0xffff;

interface EncodedCharacters {
  readonly highByte: boolean;
  readonly units: Uint8Array<ArrayBuffer>;
}

/** Whether every UTF-16 code unit in `text` fits in a single byte -- the compressed-encoding eligibility test, checked per code UNIT rather than per code point so an astral character (whose two surrogate units are each above 0xFF) is correctly ruled ineligible. */
function encodeCharacters(text: string): EncodedCharacters {
  let needsHighByte = false;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) > 0xff) {
      needsHighByte = true;
      break;
    }
  }
  const builder = new RecordBuilder();
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (needsHighByte) {
      builder.u16(unit);
    } else {
      builder.u8(unit);
    }
  }
  return { highByte: needsHighByte, units: builder.build() };
}

function checkedLength(text: string, max: number, shape: string): number {
  if (text.length > max) {
    throw new BiffWriteError(
      `${shape} cannot hold ${text.length} UTF-16 code units, above its own ${max}-unit limit (text: ${JSON.stringify(text.length > 40 ? `${text.slice(0, 40)}...` : text)})`,
    );
  }
  return text.length;
}

/** An XLUnicodeString ([MS-XLS] 2.5.294): a two-byte character count, a flags byte, then the characters. */
export function writeXLUnicodeString(text: string): Uint8Array<ArrayBuffer> {
  const cch = checkedLength(text, MAX_STRING_LENGTH, "XLUnicodeString");
  const { highByte, units } = encodeCharacters(text);
  return new RecordBuilder()
    .u16(cch)
    .u8(highByte ? FLAG_HIGH_BYTE : 0x00)
    .bytes(units)
    .build();
}

/** A ShortXLUnicodeString ([MS-XLS] 2.5.240): as above, with a one-byte character count. */
export function writeShortXLUnicodeString(
  text: string,
): Uint8Array<ArrayBuffer> {
  const cch = checkedLength(
    text,
    MAX_SHORT_STRING_LENGTH,
    "ShortXLUnicodeString",
  );
  const { highByte, units } = encodeCharacters(text);
  return new RecordBuilder()
    .u8(cch)
    .u8(highByte ? FLAG_HIGH_BYTE : 0x00)
    .bytes(units)
    .build();
}

/**
 * An XLUnicodeRichExtendedString ([MS-XLS] 2.5.293): the SST's own element shape.
 *
 * Always written with no formatting runs and no phonetic payload -- this package reads a shared string's text only (see biff/strings.ts's own readRichExtendedString), so there is never run or phonetic data to re-emit. The rich/extended flag bits are left clear accordingly.
 */
export function writeRichExtendedString(text: string): Uint8Array<ArrayBuffer> {
  const cch = checkedLength(
    text,
    MAX_STRING_LENGTH,
    "XLUnicodeRichExtendedString",
  );
  const { highByte, units } = encodeCharacters(text);
  return new RecordBuilder()
    .u16(cch)
    .u8(highByte ? FLAG_HIGH_BYTE : 0x00)
    .bytes(units)
    .build();
}
