import { describe, expect, it } from "vitest";
import { readDocumentSummary } from "./summary";

function word(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff];
}

// A null-terminated WP word string of ASCII: "each character of a string takes up one short integer. The high byte is the number of the WordPerfect character set", and set 0 is ASCII.
function wordString(value: string): number[] {
  return [
    ...[...value].flatMap((character) => word(character.charCodeAt(0))),
    ...word(0),
  ];
}

// "10-Byte Date Structure: [year] <month> <day> <hour> <minute> <second> <day of week> (not implemented) <time zone> (not implemented) <unused>".
function dateField(options: {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour?: number;
  readonly minute?: number;
  readonly second?: number;
}): number[] {
  return [
    ...word(options.year),
    options.month,
    options.day,
    options.hour ?? 0,
    options.minute ?? 0,
    options.second ?? 0,
    0,
    0,
    0,
  ];
}

// One "[size] [tag] [type] [name] [data]" group, with the optional name written as the bare null terminator it reduces to when absent.
function group(tag: number, type: number, data: readonly number[]): number[] {
  const name = word(0);
  return [
    ...word(6 + name.length + data.length),
    ...word(tag),
    ...word(type),
    ...name,
    ...data,
  ];
}

const SINGLE_LINE = 0x01;
const MULTI_LINE = 0x02;
const DATE = 0x04;

describe("readDocumentSummary", () => {
  // WordPerfect's summary has no field called Title; "17 | Descriptive Name | Single line" is the one it offers for the same purpose.
  it("reads the Descriptive Name as the document's title", () => {
    const metadata = readDocumentSummary(
      new Uint8Array(group(17, SINGLE_LINE, wordString("Quarterly report"))),
    );
    expect(metadata.title).toBe("Quarterly report");
  });

  it("reads the author and subject", () => {
    const metadata = readDocumentSummary(
      new Uint8Array([
        ...group(5, SINGLE_LINE, wordString("A. Writer")),
        ...group(46, SINGLE_LINE, wordString("Revenue")),
      ]),
    );
    expect(metadata.author).toBe("A. Writer");
    expect(metadata.subject).toBe("Revenue");
  });

  // "26 | Keywords | Single line" -- one line, with no separator vocabulary of its own, so the comma every interface showing this field uses is the reading.
  it("splits the single-line Keywords field into keywords", () => {
    const metadata = readDocumentSummary(
      new Uint8Array(group(26, SINGLE_LINE, wordString("revenue, q3, draft"))),
    );
    expect(metadata.keywords).toEqual(["revenue", "q3", "draft"]);
  });

  it("drops empty entries from the Keywords field", () => {
    const metadata = readDocumentSummary(
      new Uint8Array(group(26, SINGLE_LINE, wordString("one,  , two,"))),
    );
    expect(metadata.keywords).toEqual(["one", "two"]);
  });

  // "14 | Creation Date | Date" and "39 | Revision Date | Date and read only", both carried in the ten-byte date structure rather than as text.
  it("reads the creation and revision dates", () => {
    const metadata = readDocumentSummary(
      new Uint8Array([
        ...group(
          14,
          DATE,
          dateField({ year: 1995, month: 3, day: 14, hour: 9, minute: 30 }),
        ),
        ...group(
          39,
          DATE,
          dateField({
            year: 2004,
            month: 11,
            day: 2,
            hour: 16,
            minute: 5,
            second: 7,
          }),
        ),
      ]),
    );
    expect(metadata.createdIso).toBe("1995-03-14T09:30:00");
    expect(metadata.modifiedIso).toBe("2004-11-02T16:05:07");
  });

  // The structure's own time-zone byte is documented as "not implemented", so the file states no zone and stamping one would invent an instant it never claimed.
  it("states no time zone, because the date structure carries none", () => {
    const metadata = readDocumentSummary(
      new Uint8Array(
        group(14, DATE, dateField({ year: 2001, month: 1, day: 1 })),
      ),
    );
    expect(metadata.createdIso?.endsWith("Z")).toBe(false);
  });

  it("ignores a zeroed date rather than reporting year zero", () => {
    const metadata = readDocumentSummary(
      new Uint8Array(group(14, DATE, dateField({ year: 0, month: 0, day: 0 }))),
    );
    expect(metadata.createdIso).toBeUndefined();
  });

  // A summary carrying a field this package has no LayoutMetadata home for -- "1 | Abstract | Multi-line" -- is stepped over by its own size, leaving the fields after it readable.
  it("steps over a field it has no home for and keeps reading", () => {
    const metadata = readDocumentSummary(
      new Uint8Array([
        ...group(1, MULTI_LINE, wordString("A long abstract.")),
        ...group(5, SINGLE_LINE, wordString("A. Writer")),
      ]),
    );
    expect(metadata.author).toBe("A. Writer");
  });

  it("reads a field whose optional name is present", () => {
    const name = wordString("Author");
    const data = wordString("A. Writer");
    const metadata = readDocumentSummary(
      new Uint8Array([
        ...word(6 + name.length + data.length),
        ...word(5),
        ...word(SINGLE_LINE),
        ...name,
        ...data,
      ]),
    );
    expect(metadata.author).toBe("A. Writer");
  });

  it("answers an empty envelope for a packet with no groups", () => {
    expect(readDocumentSummary(new Uint8Array(0))).toEqual({});
  });

  // A group whose own size runs past the packet ends the walk: the rest of a summary whose framing has gone out of step is guesswork.
  it("stops at a group whose size overruns the packet", () => {
    expect(
      readDocumentSummary(
        new Uint8Array([...word(400), ...word(5), ...word(SINGLE_LINE)]),
      ),
    ).toEqual({});
  });
});
