import { describe, expect, it } from "vitest";
import { decodePdfString, parsePdfDate } from "./pdf-text";

describe("decodePdfString", () => {
  it("decodes a UTF-16BE-with-BOM string", () => {
    const bytes = Uint8Array.from([0xfe, 0xff, 0x00, 0x41, 0x00, 0x42]); // BOM + 'A' + 'B'
    expect(decodePdfString(bytes)).toBe("AB");
  });

  it("decodes a plain-ASCII PDFDocEncoding string byte-per-character", () => {
    const bytes = Uint8Array.from([0x48, 0x69]); // 'H', 'i' -- no BOM
    expect(decodePdfString(bytes)).toBe("Hi");
  });

  it("returns the empty string for zero bytes", () => {
    expect(decodePdfString(new Uint8Array(0))).toBe("");
  });
});

describe("parsePdfDate", () => {
  it("returns undefined for undefined input", () => {
    expect(parsePdfDate(undefined)).toBeUndefined();
  });

  it("returns undefined for a string that isn't a PDF date at all", () => {
    expect(parsePdfDate("not a date")).toBeUndefined();
  });

  it("parses a fully-specified date with an explicit UTC offset", () => {
    expect(parsePdfDate("D:20240115093045+05'30'")).toBe(
      "2024-01-15T09:30:45+05:30",
    );
  });

  it("parses a fully-specified date with a bare Z offset", () => {
    expect(parsePdfDate("D:20240115093045Z")).toBe("2024-01-15T09:30:45Z");
  });

  it("defaults every field after the year -- month, day, hour, minute, second, and the offset -- when the source date carries only the year", () => {
    // ISO 32000-1 7.9.4 makes every field after the year optional; a producer that writes only "D:2024" still names a valid date, and the spec's own reading is "the first moment of that year, UTC" -- exactly what every default below encodes.
    expect(parsePdfDate("D:2024")).toBe("2024-01-01T00:00:00Z");
  });

  it("defaults only the fields the source date omits, keeping every field it does supply", () => {
    // Month and day are supplied; hour/minute/second and the offset are not, so only those default while 03/17 stay exactly as given.
    expect(parsePdfDate("D:20240317")).toBe("2024-03-17T00:00:00Z");
  });

  it("defaults the timezone minute to 00 when a sign and hour are given but no minute", () => {
    expect(parsePdfDate("D:20240115093045-05")).toBe(
      "2024-01-15T09:30:45-05:00",
    );
  });
});
