import { describe, expect, it } from "vitest";
import type { FirebirdField } from "./schema";
import { decodeRowValues } from "./data";

// Isolated, synthetic-byte-sequence tests for decodeRowValues' own exactValue sidecar logic (document-schema.js's ContentCellValueSchema doc comment: "a producer should only set it when String(Number(exactValue)) would not round-trip back to exactValue exactly") -- hand-constructed against the documented XDR wire shape (reader.ts's own top-of-file note: every value widened to a 4-byte-aligned unit, an int64 as two big-endian 32-bit words), the same "isolated primitive, independent of the real-fixture end-to-end proof" convention src/firebird/reader.test.ts already uses for XdrReader itself. The real RICH_FIXTURE's own BONUS/BUDGET columns (src/firebird/backup.test.ts) never carry a value beyond double precision, so that boundary case is exercised here instead, without fabricating a full gbak backup stream (which src/firebird/backup.test.ts's own module comment deliberately avoids for the outer format's own framing/compression -- this only exercises the already-documented, already-tested XDR value encoding plus the new decimal-exactness logic layered on top of it).

function int64Field(scale: number): FirebirdField {
  return {
    name: "AMOUNT",
    physicalType: "int64",
    lengthBytes: 8,
    scale,
    characterLength: undefined,
    subType: 0,
    fieldNumber: 1,
    typeLabel: scale === 0 ? "BIGINT" : `NUMERIC(18,${-scale})`,
    computed: false,
  };
}

// One int64 field's own row payload: an 8-byte big-endian value (XdrReader.readInt64's own high-word-first shape -- a plain DataView.setBigInt64 big-endian write already produces exactly that), followed by the trailing null-flag pass decodeRowValues itself performs (one XDR short per stored field, wire-widened to a full 4-byte int32, 0 = not null).
function int64RowPayload(value: bigint): Uint8Array<ArrayBuffer> {
  const buffer = new ArrayBuffer(12);
  const view = new DataView(buffer);
  view.setBigInt64(0, value, false);
  view.setInt32(8, 0, false);
  return new Uint8Array(buffer);
}

describe("decodeRowValues: exactValue sidecar for an int64 (BIGINT-equivalent, scale 0) field", () => {
  it("attaches a real exactValue for a value beyond Number.MAX_SAFE_INTEGER", () => {
    const value = 9223372036854775807n; // Firebird BIGINT max
    const [cell] = decodeRowValues([int64Field(0)], int64RowPayload(value));
    expect(cell?.kind).toBe("number");
    if (cell?.kind !== "number") return;
    expect(cell.value).toBe(Number(value));
    expect(cell.exactValue).toBe("9223372036854775807");
  });

  it("leaves exactValue unset for an ordinary value that survives the round trip through Number() exactly", () => {
    const [cell] = decodeRowValues([int64Field(0)], int64RowPayload(42n));
    expect(cell).toEqual({ kind: "number", value: 42 });
  });
});

describe("decodeRowValues: exactValue sidecar for a scaled int64 (DECIMAL/NUMERIC-equivalent) field", () => {
  it("attaches a real exactValue for a scaled value with more significant digits than a double can carry", () => {
    // field.scale=-2 (Firebird's own convention: 0 or negative) -- stored*10^-2 = 92233720368547758.07, 20 significant digits.
    const [cell] = decodeRowValues(
      [int64Field(-2)],
      int64RowPayload(9223372036854775807n),
    );
    expect(cell?.kind).toBe("number");
    if (cell?.kind !== "number") return;
    expect(cell.exactValue).toBe("92233720368547758.07");
  });

  it("leaves exactValue unset for a scaled value Number() already represents exactly, matching the real RICH_FIXTURE's own BONUS row", () => {
    const [cell] = decodeRowValues([int64Field(-2)], int64RowPayload(150025n)); // 1500.25
    expect(cell).toEqual({ kind: "number", value: 1500.25 });
  });

  it("leaves exactValue unset for a whole-number-valued scaled cell -- trailing fractional zeros carry no extra precision, matching the real RICH_FIXTURE's own BUDGET row", () => {
    const [cell] = decodeRowValues(
      [int64Field(-2)],
      int64RowPayload(50000000n),
    ); // 500000.00
    expect(cell).toEqual({ kind: "number", value: 500000 });
  });

  it("leaves exactValue unset for a negative scaled value Number() already represents exactly, matching the real RICH_FIXTURE's own negative BONUS row", () => {
    const [cell] = decodeRowValues([int64Field(-2)], int64RowPayload(-25050n)); // -250.50
    expect(cell).toEqual({ kind: "number", value: -250.5 });
  });
});
