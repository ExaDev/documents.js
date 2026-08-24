import { describe, expect, it } from "vitest";
import { HsqldbDataCursor, readHsqldbColumnValue } from "./rowformat";

// Isolated, synthetic-byte-sequence tests for readHsqldbColumnValue's own exactValue sidecar logic (document-schema.js's ContentCellValueSchema doc comment: "a producer should only set it when String(Number(exactValue)) would not round-trip back to exactValue exactly") -- hand-constructed against the exact documented byte shape (a 1-byte present-flag, then a big-endian int64 for BIGINT, or a length-prefixed two's-complement magnitude plus a big-endian scale for DECIMAL/NUMERIC), the same "isolated primitive, independent of the real-fixture end-to-end proof" convention src/firebird/reader.test.ts already uses for XdrReader. The real EMPLOYEES/DEPARTMENTS/ORDERS fixtures in src/hsqldb/cache.test.ts deliberately never carry a value beyond Number.MAX_SAFE_INTEGER (their own BIGINT column is documented as "near, but safely inside" it), so that boundary case is exercised here instead.

// BIGINT: present-flag(1) + 8-byte big-endian signed int64.
function bigintCursor(value: bigint): HsqldbDataCursor {
  const bytes = new Uint8Array(9);
  bytes[0] = 1;
  new DataView(bytes.buffer).setBigInt64(1, value, false);
  return new HsqldbDataCursor(bytes);
}

// DECIMAL/NUMERIC: present-flag(1) + int32 byteLength + that many two's-complement magnitude bytes + int32 scale.
function decimalCursor(unscaled: bigint, scale: number): HsqldbDataCursor {
  const isNegative = unscaled < 0n;
  let magnitude = isNegative ? -unscaled : unscaled;
  const digits: number[] = [];
  do {
    digits.unshift(Number(magnitude & 0xffn));
    magnitude >>= 8n;
  } while (magnitude > 0n);
  if (isNegative) {
    // Two's-complement negation across the byte array (java.math.BigInteger.toByteArray()'s own write-side convention -- see this module's own signedBigIntFromBytes for the read-side inverse).
    let carry = 1;
    for (let i = digits.length - 1; i >= 0; i--) {
      const inverted = (~digits[i]! & 0xff) + carry;
      digits[i] = inverted & 0xff;
      carry = inverted > 0xff ? 1 : 0;
    }
    if ((digits[0]! & 0x80) === 0) {
      digits.unshift(0xff);
    }
  } else if ((digits[0]! & 0x80) !== 0) {
    digits.unshift(0x00);
  }
  const magnitudeBytes = new Uint8Array(digits);
  const bytes = new Uint8Array(1 + 4 + magnitudeBytes.length + 4);
  const view = new DataView(bytes.buffer);
  bytes[0] = 1;
  view.setInt32(1, magnitudeBytes.length, false);
  bytes.set(magnitudeBytes, 5);
  view.setInt32(5 + magnitudeBytes.length, scale, false);
  return new HsqldbDataCursor(bytes);
}

const BIGINT_TYPE_CODE = -5;
const NUMERIC_TYPE_CODE = 2;

describe("readHsqldbColumnValue: exactValue sidecar for BIGINT", () => {
  it("attaches a real exactValue for a BIGINT value beyond Number.MAX_SAFE_INTEGER", () => {
    const value = 9223372036854775807n; // HSQLDB/Java Long.MAX_VALUE
    const cell = readHsqldbColumnValue(bigintCursor(value), BIGINT_TYPE_CODE);
    expect(cell.kind).toBe("number");
    if (cell.kind !== "number") return;
    expect(cell.value).toBe(Number(value));
    expect(cell.exactValue).toBe("9223372036854775807");
  });

  it("attaches a real exactValue for a negative BIGINT beyond -Number.MAX_SAFE_INTEGER", () => {
    const value = -9223372036854775808n; // Long.MIN_VALUE
    const cell = readHsqldbColumnValue(bigintCursor(value), BIGINT_TYPE_CODE);
    expect(cell.kind).toBe("number");
    if (cell.kind !== "number") return;
    expect(cell.exactValue).toBe("-9223372036854775808");
  });

  it("leaves exactValue unset for an ordinary BIGINT value that survives the round trip through Number() exactly", () => {
    const cell = readHsqldbColumnValue(
      bigintCursor(123456789012345n),
      BIGINT_TYPE_CODE,
    );
    expect(cell).toEqual({ kind: "number", value: 123456789012345 });
  });
});

describe("readHsqldbColumnValue: exactValue sidecar for DECIMAL/NUMERIC", () => {
  it("attaches a real exactValue for a scaled decimal with more significant digits than a double can carry", () => {
    // unscaled=100000000000000001, scale=2 -> 1000000000000000.01 -- 18 significant digits, genuinely beyond double precision.
    const cell = readHsqldbColumnValue(
      decimalCursor(100000000000000001n, 2),
      NUMERIC_TYPE_CODE,
    );
    expect(cell.kind).toBe("number");
    if (cell.kind !== "number") return;
    expect(cell.exactValue).toBe("1000000000000000.01");
    expect(cell.value).toBe(Number("1000000000000000.01"));
  });

  it("leaves exactValue unset for an ordinary DECIMAL(10,2) value Number() already represents exactly, even with a non-zero fractional part", () => {
    const cell = readHsqldbColumnValue(
      decimalCursor(12550n, 2),
      NUMERIC_TYPE_CODE,
    ); // 125.50
    expect(cell).toEqual({ kind: "number", value: 125.5 });
  });

  it("leaves exactValue unset for a whole-number-valued DECIMAL(10,2) cell -- trailing fractional zeros carry no extra precision", () => {
    const cell = readHsqldbColumnValue(
      decimalCursor(25000n, 2),
      NUMERIC_TYPE_CODE,
    ); // 250.00, matching the real EMPLOYEES.BONUS fixture's own row 3
    expect(cell).toEqual({ kind: "number", value: 250 });
  });

  it("leaves exactValue unset for a negative DECIMAL Number() already represents exactly", () => {
    const cell = readHsqldbColumnValue(
      decimalCursor(-25050n, 2),
      NUMERIC_TYPE_CODE,
    ); // -250.50, matching the real Firebird fixture's own BONUS row
    expect(cell).toEqual({ kind: "number", value: -250.5 });
  });
});
