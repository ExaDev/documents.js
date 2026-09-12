import { describe, expect, it } from "vitest";

import { bofData, record } from "./test-support/biff";
import { compoundFile } from "./test-support/cfb";
import { BiffFormatError } from "./biff/records";
import { RECORD_BOF, RECORD_EOF, BOF_TYPE_WORKBOOK } from "./biff/record-types";
import { isXlsFile, readWorkbookStreams } from "./container";

/** A minimal but readable BOF+EOF workbook stream, just enough for readWorkbookStreams to succeed past the container layer -- the container's own concern is stream selection, not BIFF record content. */
function minimalWorkbookStream(): Uint8Array<ArrayBuffer> {
  return new Uint8Array([
    ...record(RECORD_BOF, bofData(BOF_TYPE_WORKBOOK)),
    ...record(RECORD_EOF, []),
  ]);
}

describe("readWorkbookStreams", () => {
  it("reads the Workbook stream's own bytes", () => {
    const workbook = minimalWorkbookStream();
    const bytes = compoundFile([{ path: "Workbook", bytes: workbook }]);

    expect(readWorkbookStreams(bytes).workbook).toStrictEqual(workbook);
  });

  it("carries the SummaryInformation stream's bytes when present", () => {
    const workbook = minimalWorkbookStream();
    const summary = new Uint8Array([1, 2, 3, 4]);
    const bytes = compoundFile([
      { path: "Workbook", bytes: workbook },
      { path: "\x05SummaryInformation", bytes: summary },
    ]);

    expect(readWorkbookStreams(bytes).metadata).toStrictEqual(summary);
  });

  it("reports no metadata when the container carries no SummaryInformation stream", () => {
    const bytes = compoundFile([
      { path: "Workbook", bytes: minimalWorkbookStream() },
    ]);

    expect(readWorkbookStreams(bytes).metadata).toBeUndefined();
  });

  it("collects an MBD<hex>/Package embedding storage's bytes keyed by its storage id", () => {
    const packageBytes = new Uint8Array([9, 9, 9]);
    const bytes = compoundFile([
      { path: "Workbook", bytes: minimalWorkbookStream() },
      { path: "MBD00000001/Package", bytes: packageBytes },
    ]);

    const { embeddingStreams } = readWorkbookStreams(bytes);
    expect(embeddingStreams.size).toBe(1);
    expect(embeddingStreams.get(1)).toStrictEqual(packageBytes);
  });

  it("reports no embedding streams when the container carries none", () => {
    const bytes = compoundFile([
      { path: "Workbook", bytes: minimalWorkbookStream() },
    ]);

    expect(readWorkbookStreams(bytes).embeddingStreams.size).toBe(0);
  });

  it("ignores a stream whose path merely resembles an MBD embedding storage without matching exactly", () => {
    const bytes = compoundFile([
      { path: "Workbook", bytes: minimalWorkbookStream() },
      { path: "MBD1/Package", bytes: new Uint8Array([1]) }, // too few hex digits
      { path: "MBD00000002/Extra", bytes: new Uint8Array([2]) }, // wrong trailing segment
    ]);

    expect(readWorkbookStreams(bytes).embeddingStreams.size).toBe(0);
  });

  it("refuses bytes with no compound-file signature", () => {
    expect(() =>
      readWorkbookStreams(new Uint8Array([0x50, 0x4b, 0x03, 0x04])),
    ).toThrow(BiffFormatError);
  });

  it("refuses a compound file holding a legacy 'Book' stream rather than 'Workbook'", () => {
    const bytes = compoundFile([
      { path: "Book", bytes: minimalWorkbookStream() },
    ]);

    expect(() => readWorkbookStreams(bytes)).toThrow(/BIFF5\/BIFF7 workbook/);
  });

  it("refuses a compound file holding neither a Workbook nor a Book stream", () => {
    const bytes = compoundFile([
      { path: "WordDocument", bytes: new Uint8Array([1]) },
    ]);

    expect(() => readWorkbookStreams(bytes)).toThrow(
      /holds no 'Workbook' stream/,
    );
  });

  it("wraps a structurally malformed compound file's own CompoundFileFormatError", () => {
    // The eight-byte compound-file signature with nothing else: past isCompoundFile's own byte check, but far too short for readCompoundFile's fixed-size header, so it throws archive-codec's own CompoundFileFormatError.
    const bytes = new Uint8Array([
      0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
    ]);

    expect(() => readWorkbookStreams(bytes)).toThrow(BiffFormatError);
    expect(() => readWorkbookStreams(bytes)).toThrow(
      /compound-file container could not be read/,
    );
  });
});

describe("isXlsFile", () => {
  it("is true for a compound file carrying a Workbook stream", () => {
    const bytes = compoundFile([
      { path: "Workbook", bytes: minimalWorkbookStream() },
    ]);

    expect(isXlsFile(bytes)).toBe(true);
  });

  it("is false for a compound file carrying no Workbook stream", () => {
    const bytes = compoundFile([
      { path: "WordDocument", bytes: new Uint8Array([1]) },
    ]);

    expect(isXlsFile(bytes)).toBe(false);
  });

  it("is false for bytes with no compound-file signature", () => {
    expect(isXlsFile(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe(false);
  });

  it("is false for a compound-file signature too short to parse structurally", () => {
    const bytes = new Uint8Array([
      0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
    ]);

    expect(isXlsFile(bytes)).toBe(false);
  });
});
