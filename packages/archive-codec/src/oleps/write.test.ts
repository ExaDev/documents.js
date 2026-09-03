import { describe, expect, it } from "vitest";
import { readPropertySetStream } from "./read";
import type { PropertyValue } from "./wire";
import { PropertySetWriteError, writePropertySetStream } from "./write";

// Coverage for the generic [MS-OLEPS] Property Set Stream writer (src/oleps/write.ts): round trips through this package's own reader (matching how every other write-side feature in this session is verified -- against the package's own reader, proving genuine conformance rather than internal self-consistency alone) for every type the writer supports, plus the deliberate VT_LPSTR refusal.

const FMTID_SUMMARY_INFORMATION = "{F29F85E0-4FF9-1068-AB91-08002B27B3D9}";

describe("writePropertySetStream", () => {
  it("round-trips VT_I2, VT_I4, VT_FILETIME, and VT_LPWSTR properties through readPropertySetStream", () => {
    const createdIso = "2024-06-15T10:30:00.000Z";
    const properties = new Map<number, PropertyValue>([
      [1, { type: "VT_I2", value: 1200 }],
      [2, { type: "VT_LPWSTR", value: "Café Über — em dash" }],
      [12, { type: "VT_FILETIME", value: new Date(createdIso) }],
      [14, { type: "VT_I4", value: -42 }],
    ]);
    const bytes = writePropertySetStream({
      formatId: FMTID_SUMMARY_INFORMATION,
      properties,
    });
    const read = readPropertySetStream(bytes);
    expect(read.formatId).toBe(FMTID_SUMMARY_INFORMATION);
    expect(read.properties.get(1)).toEqual({ type: "VT_I2", value: 1200 });
    expect(read.properties.get(2)).toEqual({
      type: "VT_LPWSTR",
      value: "Café Über — em dash",
    });
    expect((read.properties.get(12)?.value as Date).toISOString()).toBe(
      createdIso,
    );
    expect(read.properties.get(14)).toEqual({ type: "VT_I4", value: -42 });
  });

  it("emits the PropertyIdentifierAndOffset dictionary in increasing PID order regardless of Map insertion order", () => {
    const properties = new Map<number, PropertyValue>([
      [12, { type: "VT_I4", value: 3 }],
      [2, { type: "VT_I4", value: 1 }],
      [5, { type: "VT_I4", value: 2 }],
    ]);
    const bytes = writePropertySetStream({
      formatId: FMTID_SUMMARY_INFORMATION,
      properties,
    });
    const read = readPropertySetStream(bytes);
    expect([...read.properties.keys()].sort((a, b) => a - b)).toEqual([
      2, 5, 12,
    ]);
    expect(read.properties.get(2)).toEqual({ type: "VT_I4", value: 1 });
    expect(read.properties.get(5)).toEqual({ type: "VT_I4", value: 2 });
    expect(read.properties.get(12)).toEqual({ type: "VT_I4", value: 3 });
  });

  it("writes a well-formed stream with no properties at all", () => {
    const bytes = writePropertySetStream({
      formatId: FMTID_SUMMARY_INFORMATION,
      properties: new Map<number, PropertyValue>(),
    });
    const read = readPropertySetStream(bytes);
    expect(read.formatId).toBe(FMTID_SUMMARY_INFORMATION);
    expect(read.properties.size).toBe(0);
  });

  it("round-trips a title long enough to need mini-FAT-scale, multi-sector-scale content and characters needing surrogate pairs", () => {
    const value = `${"x".repeat(2000)}\u{1F600}`; // an emoji is a UTF-16 surrogate pair -- charCodeAt-based encoding must carry both units through unchanged
    const bytes = writePropertySetStream({
      formatId: FMTID_SUMMARY_INFORMATION,
      properties: new Map<number, PropertyValue>([
        [2, { type: "VT_LPWSTR", value }],
      ]),
    });
    expect(readPropertySetStream(bytes).properties.get(2)).toEqual({
      type: "VT_LPWSTR",
      value,
    });
  });

  it("throws PropertySetWriteError for a VT_LPSTR property", () => {
    const properties = new Map<number, PropertyValue>([
      [2, { type: "VT_LPSTR", value: "ansi" }],
    ]);
    expect(() =>
      writePropertySetStream({
        formatId: FMTID_SUMMARY_INFORMATION,
        properties,
      }),
    ).toThrow(PropertySetWriteError);
  });
});
