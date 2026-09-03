import { describe, expect, it } from "vitest";
import { WpdNotAWordPerfectFileError } from "../errors";
import { compoundFileWithStream } from "../test-support/compound-file";
import {
  GENERIC_HEADER_DOCUMENT_AREA_OFFSET,
  GENERIC_HEADER_SIZE,
  genericHeaderBytes,
} from "../test-support/generic-header";
import { openWpdDocument, PERFECT_OFFICE_MAIN_STREAM } from "./container";

describe("openWpdDocument", () => {
  // The WordPerfect 6.x spelling: the prefix and document area written straight to disk, with the file ID at offset 0.
  it("opens a bare WordPerfect file", () => {
    const container = openWpdDocument(genericHeaderBytes());
    expect(container.compound).toBe(false);
    expect(container.documentAreaOffset).toBe(
      GENERIC_HEADER_DOCUMENT_AREA_OFFSET,
    );
    expect(container.documentAreaEnd).toBe(GENERIC_HEADER_SIZE);
    expect(container.packets).toHaveLength(4);
  });

  // The WP7-and-later spelling: the identical byte stream inside an OLE compound file's PerfectOffice_MAIN stream. Both must produce the same document, which is the point of deciding the container by inspecting bytes rather than by version.
  it("opens the same document through an OLE compound wrapper", () => {
    const wrapped = compoundFileWithStream(
      PERFECT_OFFICE_MAIN_STREAM,
      genericHeaderBytes(),
    );
    const container = openWpdDocument(wrapped);
    expect(container.compound).toBe(true);
    expect(container.header).toEqual(
      openWpdDocument(genericHeaderBytes()).header,
    );
    expect(container.documentAreaOffset).toBe(
      GENERIC_HEADER_DOCUMENT_AREA_OFFSET,
    );
    expect(container.documentAreaEnd).toBe(GENERIC_HEADER_SIZE);
  });

  it("rejects a compound file carrying no PerfectOffice_MAIN stream", () => {
    const wrapped = compoundFileWithStream(
      "WordDocument",
      genericHeaderBytes(),
    );
    expect(() => openWpdDocument(wrapped)).toThrow(WpdNotAWordPerfectFileError);
  });

  it("rejects bytes that are neither a WordPerfect file nor a compound file", () => {
    expect(() =>
      openWpdDocument(Uint8Array.from([0x50, 0x4b, 0x03, 0x04])),
    ).toThrow(WpdNotAWordPerfectFileError);
  });

  // The SDK warns that a third-party writer forgetting to update {file size} after adding text is a common real-world defect, and that the symptom is a document that "will appear ... to be blank". Trusting a stale field over the bytes in hand is exactly how that happens, so a file size that stops at the document area's own start is disregarded.
  it("falls back to the buffer's own end when the header's file size is stale", () => {
    const bytes = genericHeaderBytes();

    bytes[20] = GENERIC_HEADER_DOCUMENT_AREA_OFFSET & 0xff;
    bytes[21] = (GENERIC_HEADER_DOCUMENT_AREA_OFFSET >>> 8) & 0xff;
    bytes[22] = 0;
    bytes[23] = 0;
    expect(openWpdDocument(bytes).documentAreaEnd).toBe(bytes.length);
  });

  it("disregards a file size longer than the bytes actually present", () => {
    const bytes = genericHeaderBytes();
    bytes[23] = 0xff;
    expect(openWpdDocument(bytes).documentAreaEnd).toBe(bytes.length);
  });
});
