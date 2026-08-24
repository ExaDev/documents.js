import { describe, expect, it } from "vitest";
import {
  CsvParseError,
  DEFAULT_CSV_DELIMITER,
  TSV_DELIMITER,
  parseCsvRecords,
  quoteCsvField,
} from "./records";

describe("parseCsvRecords", () => {
  it("parses plain comma-delimited records", () => {
    expect(parseCsvRecords("a,b,c\r\n1,2,3\r\n")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("accepts CRLF, LF, and CR record breaks alike -- the writer always emits CRLF, but real-world files arrive LF-only or CR-only", () => {
    const expected = [
      ["a", "b"],
      ["1", "2"],
    ];
    expect(parseCsvRecords("a,b\r\n1,2\r\n")).toEqual(expected);
    expect(parseCsvRecords("a,b\n1,2\n")).toEqual(expected);
    expect(parseCsvRecords("a,b\r1,2\r")).toEqual(expected);
  });

  it("parses a quoted field containing the delimiter, and a doubled quote inside a quoted field as one literal quote (RFC 4180 2.7)", () => {
    expect(parseCsvRecords('"a,b",c\r\n"say ""hi""",d\r\n')).toEqual([
      ["a,b", "c"],
      ['say "hi"', "d"],
    ]);
  });

  it("parses a quoted field spanning a record break as one field with an embedded newline", () => {
    expect(parseCsvRecords('"line one\r\nline two",b\r\n')).toEqual([
      ["line one\r\nline two", "b"],
    ]);
  });

  it('takes a quote appearing mid-field as a literal character, matching what spreadsheet exporters emit for text like 5" drive', () => {
    expect(parseCsvRecords('5" drive,42\r\n')).toEqual([['5" drive', "42"]]);
  });

  it("drops a blank line entirely rather than yielding a one-empty-field record", () => {
    expect(parseCsvRecords("a,b\r\n\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("ends the final record at end of input even without a trailing record break", () => {
    expect(parseCsvRecords("a,b")).toEqual([["a", "b"]]);
  });

  it("parses with the TSV delimiter, where a comma is ordinary field text and a tab splits", () => {
    expect(parseCsvRecords("a,b\tc\r\n", TSV_DELIMITER)).toEqual([
      ["a,b", "c"],
    ]);
  });

  it("throws CsvParseError for an unterminated quoted field, naming the field so far", () => {
    expect(() => parseCsvRecords('"never closed,x\r\n')).toThrow(CsvParseError);
    expect(() => parseCsvRecords('"never closed,x\r\n')).toThrow(
      /unterminated quoted field/,
    );
  });

  it("throws CsvParseError for a multi-character or empty delimiter, which could never match the per-character scanner", () => {
    expect(() => parseCsvRecords("a;b\r\n", ";;")).toThrow(
      /delimiter must be exactly one character/,
    );
    expect(() => parseCsvRecords("a;b\r\n", "")).toThrow(
      /delimiter must be exactly one character/,
    );
  });
});

describe("parseCsvRecords/quoteCsvField round trips", () => {
  const fieldsCases: readonly (readonly string[])[] = [
    ["plain", "fields", "only"],
    ["contains,comma", "second"],
    ['say "hi"', 'doubled "" quote'],
    ["multi\r\nline", "field"],
    ['5" drive', "mid-field quote"],
    ["trailing empty", ""],
  ];

  it("every field case round-trips through quoteCsvField joined with CRLF and back", () => {
    // A record of one empty field alone is excluded: the parser drops blank records, so such a record cannot round-trip (documented behaviour, covered above).
    for (const fields of fieldsCases) {
      const encoded = `${fields.map((field) => quoteCsvField(field)).join(",")}\r\n`;
      expect(parseCsvRecords(encoded)).toEqual([fields]);
    }
  });

  it("round-trips under the TSV delimiter, quoting on tab rather than comma", () => {
    const fields = ["contains,comma", "contains\ttab", "plain"];
    const encoded = `${fields.map((field) => quoteCsvField(field, TSV_DELIMITER)).join(TSV_DELIMITER)}\r\n`;
    expect(encoded).toBe('contains,comma\t"contains\ttab"\tplain\r\n');
    expect(parseCsvRecords(encoded, TSV_DELIMITER)).toEqual([fields]);
  });
});

describe("quoteCsvField", () => {
  it("writes a field with no delimiter, quote, or line break bare", () => {
    expect(quoteCsvField("plain")).toBe("plain");
    expect(quoteCsvField("plain,with,commas", TSV_DELIMITER)).toBe(
      "plain,with,commas",
    );
  });

  it("wraps and doubles exactly when a bare field would re-parse as more than one field or a truncated one", () => {
    expect(quoteCsvField("a,b")).toBe('"a,b"');
    expect(quoteCsvField('say "hi"')).toBe('"say ""hi"""');
    expect(quoteCsvField("line\r\nbreak")).toBe('"line\r\nbreak"');
  });

  it("defaults to the package-wide csv delimiter constant", () => {
    expect(DEFAULT_CSV_DELIMITER).toBe(",");
    expect(quoteCsvField("a\tb")).toBe("a\tb");
  });
});
