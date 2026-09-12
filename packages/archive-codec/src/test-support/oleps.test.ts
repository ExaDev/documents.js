import { describe, expect, it } from "vitest";
import { readPropertySetStream } from "../oleps/read";
import { propertySetStream } from "./oleps";

// Direct coverage for propertySetStream (src/test-support/oleps.ts) itself, beyond what the reader's own test suite exercises in passing: its FMTID/CLSID encoding, its VT_I4 and VT_FILETIME field builders (both under-exercised elsewhere -- every other reader test either corrupts them afterward or never checks their decoded value at all), and its own Characters-field padding.

describe("propertySetStream", () => {
  it("round-trips a FMTID with a distinct byte in every position", () => {
    // Every one of Data1/Data2/Data3/Data4's bytes differs from its neighbours, so a slice/offset arithmetic error in the GUID encoder moves a real byte into the wrong slot rather than duplicating an already-matching one.
    const formatId = "{01234567-89AB-CDEF-0123-456789ABCDEF}";
    const bytes = propertySetStream(formatId, []);
    expect(readPropertySetStream(bytes).formatId).toBe(formatId);
  });

  it("round-trips a VT_I4 field's own value, not merely its type after corruption", () => {
    const bytes = propertySetStream("{F29F85E0-4FF9-1068-AB91-08002B27B3D9}", [
      { pid: 20, value: { type: "VT_I4", value: -12345 } },
    ]);
    expect(readPropertySetStream(bytes).properties.get(20)).toEqual({
      type: "VT_I4",
      value: -12345,
    });
  });

  it("round-trips a VT_FILETIME field's low and high 32-bit halves, both non-zero", () => {
    // Both halves deliberately non-zero and distinct from each other: a byte-order or field-offset mistake in either one shows up as a wrong date rather than coincidentally reproducing the correct one.
    const bytes = propertySetStream("{F29F85E0-4FF9-1068-AB91-08002B27B3D9}", [
      {
        pid: 21,
        value: { type: "VT_FILETIME", low: 0xa1d01600, high: 0x01c68e4e },
      },
    ]);
    const property = readPropertySetStream(bytes).properties.get(21);
    expect(property?.type).toBe("VT_FILETIME");
    // The exact FILETIME -> Date epoch conversion is oleps/wire.ts's own concern (covered there); this only needs to prove the raw low/high 32-bit halves this builder wrote survive the round trip undamaged.
    expect((property?.value as Date).toISOString()).toBe(
      "2006-06-12T18:33:00.000Z",
    );
  });

  it("pads a VT_LPWSTR Characters field out to exactly the next 4-byte boundary, no further", () => {
    // A round trip alone tolerates over-padding (the reader locates the next property by dictionary offset, not fixed layout), so this measures the real byte gap between two adjacent properties directly.
    const bytes = propertySetStream("{F29F85E0-4FF9-1068-AB91-08002B27B3D9}", [
      { pid: 2, value: { type: "VT_LPWSTR", value: "ab" } }, // Characters: (2 + 1) * 2 = 6 bytes, padded to 8
      { pid: 5, value: { type: "VT_I4", value: 0 } },
    ]);
    const HEADER_SIZE = 48;
    const view = new DataView(bytes.buffer);
    const dictionaryStart = HEADER_SIZE + 8;
    const firstOffset = view.getUint32(dictionaryStart + 4, true);
    const secondOffset = view.getUint32(dictionaryStart + 8 + 4, true);
    // Type+Padding(4) + Size(4) + the padded 8-byte Characters field.
    expect(secondOffset - firstOffset).toBe(4 + 4 + 8);
  });
});
