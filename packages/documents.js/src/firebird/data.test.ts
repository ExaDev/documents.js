import { describe, expect, it } from "vitest";
import type { FirebirdField } from "./schema";
import { decodeRowValues } from "./data";

// Isolated, synthetic-byte-sequence tests for decodeRowValues' own exactValue sidecar logic (document-schema.js's ContentCellValueSchema doc comment: "a producer should only set it when String(Number(exactValue)) would not round-trip back to exactValue exactly") — hand-constructed against the documented XDR wire shape (reader.ts's own top-of-file note: every value widened to a 4-byte-aligned unit, an int64 as two big-endian 32-bit words), the same "isolated primitive, independent of the real-fixture end-to-end proof" convention src/firebird/reader.test.ts already uses for XdrReader itself. The real RICH_FIXTURE's own BONUS/BUDGET columns (src/firebird/backup.test.ts) never carry a value beyond double precision, so that boundary case is exercised here instead, without fabricating a full gbak backup stream (which src/firebird/backup.test.ts's own module comment deliberately avoids for the outer format's own framing/compression — this only exercises the already-documented, already-tested XDR value encoding plus the new decimal-exactness logic layered on top of it).

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

// One int64 field's own row payload: an 8-byte big-endian value (XdrReader.readInt64's own high-word-first shape — a plain DataView.setBigInt64 big-endian write already produces exactly that), followed by the trailing null-flag pass decodeRowValues itself performs (one XDR short per stored field, wire-widened to a full 4-byte int32, 0 = not null).
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
    // field.scale=-2 (Firebird's own convention: 0 or negative) — stored*10^-2 = 92233720368547758.07, 20 significant digits.
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

  it("leaves exactValue unset for a whole-number-valued scaled cell — trailing fractional zeros carry no extra precision, matching the real RICH_FIXTURE's own BUDGET row", () => {
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

describe("decodeRowValues: every stored physical type on the wire", () => {
  interface WireField {
    readonly field: FirebirdField;
    readonly write: (view: DataView, offset: number) => number;
    readonly returns: number;
  }

  function field(
    name: string,
    physicalType: FirebirdField["physicalType"],
    lengthBytes = 4,
  ): FirebirdField {
    return {
      name,
      physicalType,
      lengthBytes,
      scale: 0,
      characterLength: undefined,
      subType: 0,
      fieldNumber: 1,
      typeLabel: physicalType.toUpperCase(),
      computed: false,
    };
  }

  function payloadOf(
    wire: readonly WireField[],
    nullFlags?: readonly number[],
  ): Uint8Array<ArrayBuffer> {
    // The reader always performs the trailing null-flag pass, one 4-byte short per field, so a payload without explicit flags carries all-zero ones.
    const flags = nullFlags ?? wire.map(() => 0);
    const bytes = new ArrayBuffer(256);
    const view = new DataView(bytes);
    let offset = 0;
    for (const w of wire) {
      offset = w.write(view, offset);
    }
    for (const flag of flags) {
      view.setInt32(offset, flag, false);
      offset += 4;
    }
    return new Uint8Array(bytes, 0, offset);
  }

  const i32 = (value: number) => (view: DataView, offset: number) => {
    view.setInt32(offset, value, false);
    return offset + 4;
  };

  it("decodes short, long, real, and double from their 4-byte-aligned wire units", () => {
    const [a, b, c, d] = decodeRowValues(
      [
        field("S", "short"),
        field("L", "long"),
        field("R", "real"),
        field("D", "double"),
      ],
      payloadOf([
        { field: field("S", "short"), write: i32(42), returns: 1 },
        { field: field("L", "long"), write: i32(-7), returns: 1 },
        {
          field: field("R", "real"),
          write: (view, offset) => {
            view.setFloat32(offset, 1.5, false);
            return offset + 4;
          },
          returns: 1,
        },
        {
          field: field("D", "double"),
          write: (view, offset) => {
            view.setFloat64(offset, 2.25, false);
            return offset + 8;
          },
          returns: 1,
        },
      ]),
    );
    expect(a).toEqual({ kind: "number", value: 42 });
    expect(b).toEqual({ kind: "number", value: -7 });
    expect(c).toEqual({ kind: "number", value: 1.5 });
    expect(d).toEqual({ kind: "number", value: 2.25 });
  });

  it("decodes sql_date, sql_time, and timestamp from days and ticks", () => {
    const days = Math.round(
      (Date.UTC(2024, 11, 31) - Date.UTC(1858, 10, 17)) / 86400000,
    );
    const ticks = (9 * 3600 + 5 * 60 + 1) * 10000;
    const [date, time, stamp] = decodeRowValues(
      [field("D", "sql_date"), field("T", "sql_time"), field("S", "timestamp")],
      payloadOf([
        { field: field("D", "sql_date"), write: i32(days), returns: 1 },
        { field: field("T", "sql_time"), write: i32(ticks), returns: 1 },
        { field: field("S", "timestamp"), write: i32(days), returns: 1 },
        { field: field("S", "timestamp"), write: i32(ticks), returns: 1 },
      ]),
    );
    expect(date).toEqual({ kind: "date", value: "2024-12-31" });
    expect(time).toEqual({ kind: "time", value: "09:05:01.000" });
    expect(stamp).toEqual({ kind: "date", value: "2024-12-31 09:05:01.000" });
  });

  it("decodes fixed text with its trailing blanks stripped, and varying/cstring by their length prefixes", () => {
    const textBytes = (value: string) =>
      Array.from(value, (ch) => ch.charCodeAt(0));
    const [fixed, varying] = decodeRowValues(
      [field("F", "text", 8), field("V", "varying")],
      payloadOf([
        {
          field: field("F", "text", 8),
          write: (view, offset) => {
            for (const [i, code] of textBytes("AB   ").entries()) {
              view.setUint8(offset + i, code);
            }
            view.setUint8(offset + 5, 0x20);
            view.setUint8(offset + 6, 0x20);
            view.setUint8(offset + 7, 0x20);
            return offset + 8;
          },
          returns: 1,
        },
        { field: field("V", "varying"), write: i32(2), returns: 1 },
        {
          field: field("V", "varying"),
          write: (view, offset) => {
            view.setUint8(offset, 0x68);
            view.setUint8(offset + 1, 0x69);
            return offset + 4;
          },
          returns: 1,
        },
      ]),
    );
    expect(fixed).toEqual({ kind: "string", value: "AB" });
    expect(varying).toEqual({ kind: "string", value: "hi" });
  });

  it("decodes boolean from its padded byte, and blob/quad as alignment-only placeholders", () => {
    const [yes, no, blob, quad] = decodeRowValues(
      [
        field("B", "boolean", 1),
        field("N", "boolean", 1),
        field("L", "blob"),
        field("Q", "quad"),
      ],
      payloadOf([
        {
          field: field("B", "boolean", 1),
          write: (view, offset) => {
            view.setUint8(offset, 1);
            return offset + 4;
          },
          returns: 1,
        },
        {
          field: field("N", "boolean", 1),
          write: (view, offset) => {
            view.setUint8(offset, 0);
            return offset + 4;
          },
          returns: 1,
        },
        { field: field("L", "blob"), write: i32(1), returns: 1 },
        { field: field("L", "blob"), write: i32(2), returns: 1 },
        { field: field("Q", "quad"), write: i32(3), returns: 1 },
        { field: field("Q", "quad"), write: i32(4), returns: 1 },
      ]),
    );
    expect(yes).toEqual({ kind: "boolean", value: true });
    expect(no).toEqual({ kind: "boolean", value: false });
    expect(blob).toEqual({ kind: "empty" });
    expect(quad).toEqual({ kind: "empty" });
  });

  it("a non-zero null flag empties whatever value that field just decoded", () => {
    const cells = decodeRowValues(
      [field("L", "long")],
      payloadOf(
        [{ field: field("L", "long"), write: i32(99), returns: 1 }],
        [-1],
      ),
    );
    expect(cells).toEqual([{ kind: "empty" }]);
  });

  it("a scaled short divides by its scale through the exact-value helper", () => {
    const scaled: FirebirdField = { ...field("S", "short"), scale: -1 };
    const [cell] = decodeRowValues(
      [scaled],
      payloadOf([{ field: scaled, write: i32(250), returns: 1 }]),
    );
    expect(cell).toEqual({ kind: "number", value: 25 });
  });
});
