// The RkNumber encoding ([MS-XLS] 2.5.217): four bytes standing in for a value that would otherwise need eight, which is why a real worksheet is mostly RK and MulRk records rather than Number records. https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/04fa5340-122f-49db-93ea-00cc75501efc
//
// Two flag bits in the low end of the word choose between four readings of the remaining 30:
//
// fInt = 1 -- num is a signed 30-bit integer. fInt = 0 -- num is the top 30 bits of an IEEE 754 double whose remaining 34 bits are all zero. fX100 = 1 -- whatever the above produced is divided by 100 (how a value like 12.34 stays an integer payload).
//
// Both readings hinge on details that are easy to get subtly wrong rather than obviously wrong: the integer's sign bit is bit 29 of the payload rather than bit 31 of the word, so a plain `>> 2` sign-extends from the wrong place; and the float's flag bits sit exactly where the double's bits 32 and 33 live, so they must be masked off rather than shifted away.

/** The two flag bits occupy the positions the double's own bits 32 and 33 would, and are cleared before the word is read as the high half of a double. */
const FLAG_MASK = 0x03;
const FLAG_X100 = 0x01;
const FLAG_INT = 0x02;

/** The payload is a signed 30-bit integer; 2^29 is its sign bit and 2^30 the modulus to subtract. */
const INT_SIGN_BIT = 0x20000000;
const INT_MODULUS = 0x40000000;

/** [MS-XLS] 2.5.217's own fX100 divisor. */
const X100_DIVISOR = 100;

/** Decodes the 32-bit word of an RkNumber ([MS-XLS] 2.5.217) into the number it stands for. */
export function decodeRkNumber(word: number): number {
  const bits = word >>> 0;
  const value =
    (bits & FLAG_INT) !== 0
      ? decodeSignedPayload(bits)
      : decodeTruncatedDouble(bits);
  return (bits & FLAG_X100) !== 0 ? value / X100_DIVISOR : value;
}

/** The payload read as a signed 30-bit integer: shifted down unsigned, then folded into its negative range from bit 29 rather than sign-extended from bit 31. */
function decodeSignedPayload(bits: number): number {
  const payload = (bits & ~FLAG_MASK) >>> 2;
  return (payload & INT_SIGN_BIT) !== 0 ? payload - INT_MODULUS : payload;
}

/** The payload read as the high 32 bits of a double whose low 32 bits are zero, with the two flag bits (the double's own bits 32 and 33, which the spec requires be zero) cleared first. */
function decodeTruncatedDouble(bits: number): number {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setUint32(0, (bits & ~FLAG_MASK) >>> 0, false);
  view.setUint32(4, 0, false);
  return view.getFloat64(0, false);
}
