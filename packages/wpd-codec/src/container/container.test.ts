import { writeCompoundFile } from "archive-codec";
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
    const input = genericHeaderBytes();
    const container = openWpdDocument(input);
    expect(container.compound).toBe(false);
    expect(container.documentAreaOffset).toBe(
      GENERIC_HEADER_DOCUMENT_AREA_OFFSET,
    );
    expect(container.documentAreaEnd).toBe(GENERIC_HEADER_SIZE);
    expect(container.packets).toHaveLength(4);
    // An ArrayBuffer-backed input is used as-is, not copied: the container's own bytes are the identical object, not merely an equal one.
    expect(container.bytes).toBe(input);
  });

  // document-schema.js's ContentCodec port types a read as taking a plain Uint8Array, whose backing buffer may be a SharedArrayBuffer rather than a plain ArrayBuffer. That case takes the one path this package ever copies bytes on, and no other test constructs a SharedArrayBuffer-backed input at all.
  it("copies a SharedArrayBuffer-backed input into a real ArrayBuffer rather than reading it in place", () => {
    const source = genericHeaderBytes();
    const shared = new Uint8Array(new SharedArrayBuffer(source.length));
    shared.set(source);
    const container = openWpdDocument(shared);
    expect(container.compound).toBe(false);
    expect(container.bytes).not.toBe(shared);
    expect(container.bytes.buffer).toBeInstanceOf(ArrayBuffer);
    expect(container.documentAreaEnd).toBe(GENERIC_HEADER_SIZE);
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

  // Only a stream nested under PerfectOffice_OBJECTS/ belongs in oleObjectStreams, keyed by the part of its path after that prefix -- a sibling top-level stream (here, a made-up SummaryInformation stream no test elsewhere carries alongside PerfectOffice_MAIN) must be excluded entirely, not merely mis-keyed.
  it("collects only the streams nested under PerfectOffice_OBJECTS, keyed by their name within it", () => {
    const objectBytes = new Uint8Array([1, 2, 3]);
    const compound = writeCompoundFile([
      { path: PERFECT_OFFICE_MAIN_STREAM, bytes: genericHeaderBytes() },
      { path: "PerfectOffice_OBJECTS/OLE1", bytes: objectBytes },
      { path: "SummaryInformation", bytes: new Uint8Array([9, 9]) },
    ]);
    const container = openWpdDocument(compound);
    expect(container.oleObjectStreams.size).toBe(1);
    expect(container.oleObjectStreams.get("OLE1")).toEqual(objectBytes);
  });

  it("rejects a compound file carrying no PerfectOffice_MAIN stream", () => {
    const wrapped = compoundFileWithStream(
      "WordDocument",
      genericHeaderBytes(),
    );
    expect(() => openWpdDocument(wrapped)).toThrow(WpdNotAWordPerfectFileError);
    expect(() => openWpdDocument(wrapped)).toThrow(
      "This OLE compound file carries no PerfectOffice_MAIN stream, so it holds no WordPerfect document.",
    );
  });

  it("rejects bytes that are neither a WordPerfect file nor a compound file", () => {
    expect(() =>
      openWpdDocument(Uint8Array.from([0x50, 0x4b, 0x03, 0x04])),
    ).toThrow(WpdNotAWordPerfectFileError);
    expect(() =>
      openWpdDocument(Uint8Array.from([0x50, 0x4b, 0x03, 0x04])),
    ).toThrow(
      "These bytes are neither a WordPerfect file (which opens with the file ID FF 57 50 43) nor an OLE compound file that could contain one.",
    );
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

  // The happy path documentAreaEnd exists for: a genuinely valid file size, strictly less than the buffer's own length (trailing bytes past the document's real end). Every other test either leaves the two equal or forces the fallback, so neither ever proves the field is actually honoured rather than the buffer's length being reported by coincidence.
  it("honours a valid file size shorter than the buffer, rather than falling back to the buffer's own end", () => {
    const source = genericHeaderBytes();
    const padded = new Uint8Array(source.length + 10);
    padded.set(source);
    expect(openWpdDocument(padded).documentAreaEnd).toBe(GENERIC_HEADER_SIZE);
  });

  it("treats an empty-string password identically to no password on an unencrypted document", () => {
    const container = openWpdDocument(genericHeaderBytes(), { password: "" });
    expect(container.documentAreaEnd).toBe(GENERIC_HEADER_SIZE);
  });
});
