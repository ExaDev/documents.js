import { describe, expect, it } from "vitest";

import {
  BOF_TYPE_CHART,
  BOF_TYPE_WORKBOOK,
  BOF_TYPE_WORKSHEET,
  RECORD_BOF,
  RECORD_CONTINUE,
  RECORD_EOF,
  RECORD_SST,
} from "./record-types";
import { BiffFormatError, type BiffRecord } from "./records";
import { groupRecords, splitSubstreams } from "./substreams";

function bytes(...values: readonly number[]): Uint8Array<ArrayBuffer> {
  return new Uint8Array(values);
}

/** A BOF record's data as [MS-XLS] 2.4.21 lays it out, of which only vers and dt are read. */
function bofData(documentType: number): Uint8Array<ArrayBuffer> {
  return bytes(
    0x00,
    0x06,
    documentType & 0xff,
    (documentType >> 8) & 0xff,
    0x00,
    0x00,
    0xcc,
    0x07,
    0x00,
    0x00,
    0x00,
    0x00,
    0x06,
    0x00,
    0x00,
    0x00,
  );
}

/** Builds record fixtures carrying the stream offsets readRecords would have computed -- each record's own start, being four bytes of header plus its predecessor's data. */
function records(
  ...specs: readonly { type: number; data: Uint8Array<ArrayBuffer> }[]
): BiffRecord[] {
  let offset = 0;
  return specs.map((spec) => {
    const entry: BiffRecord = { ...spec, offset };
    offset += 4 + spec.data.length;
    return entry;
  });
}

describe("groupRecords", () => {
  it("keeps a record with no continuation as a single block", () => {
    const groups = groupRecords(records({ type: RECORD_SST, data: bytes(1) }));

    expect(groups).toEqual([
      { type: RECORD_SST, blocks: [bytes(1)], offset: 0 },
    ]);
  });

  it("attaches a Continue record to the record it continues", () => {
    const groups = groupRecords(
      records(
        { type: RECORD_SST, data: bytes(1) },
        { type: RECORD_CONTINUE, data: bytes(2) },
        { type: RECORD_CONTINUE, data: bytes(3) },
      ),
    );

    expect(groups).toEqual([
      {
        type: RECORD_SST,
        blocks: [bytes(1), bytes(2), bytes(3)],
        offset: 0,
      },
    ]);
  });

  it("starts a new group at the next non-Continue record", () => {
    const groups = groupRecords(
      records(
        { type: RECORD_SST, data: bytes(1) },
        { type: RECORD_CONTINUE, data: bytes(2) },
        { type: RECORD_EOF, data: bytes() },
      ),
    );

    expect(groups.map((group) => group.type)).toEqual([RECORD_SST, RECORD_EOF]);
    expect(groups[0]?.blocks).toHaveLength(2);
  });

  it("carries the base record's own offset, not a continuation's", () => {
    const groups = groupRecords(
      records(
        { type: RECORD_SST, data: bytes(1) },
        { type: RECORD_CONTINUE, data: bytes(2) },
      ),
    );

    expect(groups[0]?.offset).toBe(0);
  });

  it("rejects a Continue with no preceding record to continue", () => {
    expect(() =>
      groupRecords(records({ type: RECORD_CONTINUE, data: bytes(1) })),
    ).toThrow(BiffFormatError);
  });
});

describe("splitSubstreams", () => {
  // [MS-XLS] 2.1.3: every substream opens with a BOF naming its document type and closes with an EOF. https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/5e380e95-a9f5-4dfd-b6d9-c6998a9772f8

  it("splits the globals substream from a worksheet substream", () => {
    const substreams = splitSubstreams(
      groupRecords(
        records(
          { type: RECORD_BOF, data: bofData(BOF_TYPE_WORKBOOK) },
          { type: RECORD_SST, data: bytes(0) },
          { type: RECORD_EOF, data: bytes() },
          { type: RECORD_BOF, data: bofData(BOF_TYPE_WORKSHEET) },
          { type: RECORD_EOF, data: bytes() },
        ),
      ),
    );

    expect(substreams.map((sub) => sub.documentType)).toEqual([
      BOF_TYPE_WORKBOOK,
      BOF_TYPE_WORKSHEET,
    ]);
  });

  it("excludes the BOF and EOF from a substream's own records", () => {
    const substreams = splitSubstreams(
      groupRecords(
        records(
          { type: RECORD_BOF, data: bofData(BOF_TYPE_WORKBOOK) },
          { type: RECORD_SST, data: bytes(0) },
          { type: RECORD_EOF, data: bytes() },
        ),
      ),
    );

    expect(substreams[0]?.records.map((entry) => entry.type)).toEqual([
      RECORD_SST,
    ]);
  });

  it("records each substream's own ordinal position", () => {
    const substreams = splitSubstreams(
      groupRecords(
        records(
          { type: RECORD_BOF, data: bofData(BOF_TYPE_WORKBOOK) },
          { type: RECORD_EOF, data: bytes() },
          { type: RECORD_BOF, data: bofData(BOF_TYPE_CHART) },
          { type: RECORD_EOF, data: bytes() },
        ),
      ),
    );

    expect(substreams.map((sub) => sub.index)).toEqual([0, 1]);
  });

  it("records the stream offset of each substream's own BOF", () => {
    // BoundSheet8's lbPlyPos addresses a sheet's substream by exactly this offset, so it is what matches a sheet to its records.
    const substreams = splitSubstreams(
      groupRecords(
        records(
          { type: RECORD_BOF, data: bofData(BOF_TYPE_WORKBOOK) },
          { type: RECORD_EOF, data: bytes() },
          { type: RECORD_BOF, data: bofData(BOF_TYPE_WORKSHEET) },
          { type: RECORD_EOF, data: bytes() },
        ),
      ),
    );

    // The first BOF sits at 0 and spans 4 + 16 bytes; its EOF spans 4 more, so the second BOF starts at 24.
    expect(substreams.map((sub) => sub.offset)).toEqual([0, 24]);
  });

  it("tolerates a substream left unterminated at the end of the stream", () => {
    // A truncated final substream still carries every record it managed to write, and dropping them would lose real content over a missing two-byte record.
    const substreams = splitSubstreams(
      groupRecords(
        records(
          { type: RECORD_BOF, data: bofData(BOF_TYPE_WORKSHEET) },
          { type: RECORD_SST, data: bytes(0) },
        ),
      ),
    );

    expect(substreams).toHaveLength(1);
    expect(substreams[0]?.records).toHaveLength(1);
  });

  it("ignores records sitting outside any substream", () => {
    expect(
      splitSubstreams(
        groupRecords(records({ type: RECORD_EOF, data: bytes() })),
      ),
    ).toEqual([]);
  });

  it("rejects a BOF that does not declare BIFF8", () => {
    // [MS-XLS] 2.4.21: "The value MUST be 0x0600." A BIFF5 or BIFF7 workbook has a different record layout throughout, so reading on would produce confident nonsense.
    const biff5Bof = bytes(0x00, 0x05, 0x05, 0x00, 0x00, 0x00, 0xcc, 0x07);

    expect(() =>
      splitSubstreams(
        groupRecords(records({ type: RECORD_BOF, data: biff5Bof })),
      ),
    ).toThrow(BiffFormatError);
  });

  it("rejects a BOF too short to carry its own version and document type", () => {
    expect(() =>
      splitSubstreams(
        groupRecords(records({ type: RECORD_BOF, data: bytes(0) })),
      ),
    ).toThrow(BiffFormatError);
  });
});
