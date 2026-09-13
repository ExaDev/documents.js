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
    // Stronger than the property read above: an invalid date must leave the key entirely absent, not merely assign it the value undefined.
    expect("createdIso" in metadata).toBe(false);
  });

  it("ignores a date with a zero year but a real month and day", () => {
    const metadata = readDocumentSummary(
      new Uint8Array(
        group(14, DATE, dateField({ year: 0, month: 5, day: 10 })),
      ),
    );
    expect(metadata.createdIso).toBeUndefined();
  });

  it("ignores a date with a zero month but a real year and day", () => {
    const metadata = readDocumentSummary(
      new Uint8Array(
        group(14, DATE, dateField({ year: 1999, month: 0, day: 10 })),
      ),
    );
    expect(metadata.createdIso).toBeUndefined();
  });

  it("ignores a date with a zero day but a real year and month", () => {
    const metadata = readDocumentSummary(
      new Uint8Array(
        group(14, DATE, dateField({ year: 1999, month: 5, day: 0 })),
      ),
    );
    expect(metadata.createdIso).toBeUndefined();
  });

  // A date field whose every genuinely-read byte (year, month, day, hour, minute, second) is present, but whose three trailing, entirely-unread bytes (day of week, time zone, unused) fall past the packet's own end -- the length guard must still refuse it defensively, even though every byte the function actually consumes is there.
  it("refuses a date field cut off exactly after its last read byte, with none of the trailing unread padding present", () => {
    const dataOffset = 8; // 6-byte group header + 2-byte empty name
    const bytes = new Uint8Array([
      ...word(6 + 2 + 7),
      ...word(14),
      ...word(DATE),
      ...word(0), // empty name
      ...word(2001),
      1,
      1,
      9,
      30,
      0,
    ]);
    expect(bytes.length).toBe(dataOffset + 7);
    expect(readDocumentSummary(bytes).createdIso).toBeUndefined();
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

  // A group's stated size lying far beyond the packet must refuse the group outright -- not fall through and let the reader trust whatever real bytes happen to sit within the packet's own true bounds as if they belonged to this group's data.
  it("never lets a corrupted, oversized group borrow real bytes from beyond its own claimed extent", () => {
    const tail = [...word(0), ...wordString("HELLO")]; // empty name, then real word data
    const bytes = new Uint8Array([
      ...word(100), // claims 100 bytes, far more than the packet actually holds
      ...word(5), // TAG_AUTHOR
      ...word(SINGLE_LINE),
      ...tail,
    ]);
    expect(readDocumentSummary(bytes)).toEqual({});
  });

  // A group's stated size smaller than its own six-byte header is nonsensical and must stop the walk outright -- not advance the cursor by that bogus size and let the next iteration reinterpret real trailing bytes as a phantom group header.
  it("never lets a group smaller than its own header desynchronise the cursor onto later bytes", () => {
    const bytes = new Uint8Array([
      ...word(2), // size = 2, smaller than the six-byte header that already follows
      ...word(20), // only meaningful if desynchronised into a phantom group's [size]
      ...word(5), // only meaningful if desynchronised into a phantom group's [tag] (TAG_AUTHOR)
      ...word(SINGLE_LINE), // only meaningful if desynchronised into a phantom group's [type]
      ...word(0), // phantom group's empty name
      ...wordString("HELLO"),
    ]);
    expect(readDocumentSummary(bytes)).toEqual({});
  });

  // A group whose stated size is exactly the six-byte header (no room for any data) must still let the walk continue onto the next, genuinely well-formed group -- it is empty, not corrupt.
  it("passes over a header-only group and still reads the group that follows it", () => {
    const bytes = new Uint8Array([
      ...word(6), // an empty group: size exactly matches the six-byte header, [size] [tag] [type]
      ...word(999), // an unrecognised tag, irrelevant since there is no data anyway
      ...word(SINGLE_LINE),
      ...group(5, SINGLE_LINE, wordString("A. Writer")),
    ]);
    expect(readDocumentSummary(bytes).author).toBe("A. Writer");
  });

  // The two-word budget passed to decodeWordString for a group's data (availableWords minus the words the optional name consumed) must be exactly right: too generous, and a group with no null terminator of its own keeps reading real bytes that belong to the next group entirely.
  it("stops reading a group's data at its own true boundary, even with no null terminator of its own", () => {
    const rawChars = (value: string): number[] =>
      [...value].flatMap((character) => word(character.charCodeAt(0)));
    const bytes = new Uint8Array([
      ...group(46, SINGLE_LINE, rawChars("ABC")), // TAG_SUBJECT, data with no trailing null word
      ...group(5, SINGLE_LINE, wordString("ZZZZZ")), // TAG_AUTHOR
    ]);
    const metadata = readDocumentSummary(bytes);
    expect(metadata.subject).toBe("ABC");
    expect(metadata.author).toBe("ZZZZZ");
  });

  it("leaves author unset for a group whose data is empty text, rather than an empty string", () => {
    const metadata = readDocumentSummary(
      new Uint8Array(group(5, SINGLE_LINE, [])),
    );
    expect(metadata.author).toBeUndefined();
    expect("author" in metadata).toBe(false);
  });

  it("leaves keywords unset when every split entry is empty, rather than an empty array", () => {
    const metadata = readDocumentSummary(
      new Uint8Array(group(26, SINGLE_LINE, wordString(","))),
    );
    expect(metadata.keywords).toBeUndefined();
    expect("keywords" in metadata).toBe(false);
  });

  // A date-typed field carrying neither the creation nor the revision tag (an adversarial or simply unknown tag reusing the DATE type bit) must not be reported as either -- there is no third date slot in LayoutMetadata to fall back onto.
  it("reports neither created nor modified for a date-typed field under an unrecognised tag", () => {
    const metadata = readDocumentSummary(
      new Uint8Array(
        group(999, DATE, dateField({ year: 2001, month: 1, day: 1 })),
      ),
    );
    expect(metadata).toStrictEqual({});
  });

  // The hundred-group safety net (MAX_SUMMARY_GROUPS) must stop the walk exactly at its own bound: a document with more genuinely well-formed groups than that must not have its 101st group read.
  it("never reads a 101st group, even when every one of the first hundred is well-formed", () => {
    const filler = group(999, SINGLE_LINE, []); // an unrecognised tag, six bytes of header plus an empty name
    const bytes = new Uint8Array([
      ...Array.from({ length: 100 }, () => filler).flat(),
      ...group(5, SINGLE_LINE, wordString("A. Writer")), // the 101st group
    ]);
    expect(readDocumentSummary(bytes).author).toBeUndefined();
  });
});
