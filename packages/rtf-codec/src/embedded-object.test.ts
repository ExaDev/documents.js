import { describe, expect, it } from "vitest";
import { writeCompoundFile, writeOlePackage } from "archive-codec";
import type { ContentEmbeddedObject } from "document-schema.js";
import {
  readEmbeddedObjectData,
  writeEmbeddedObjectData,
} from "./embedded-object";

// A LengthPrefixedAnsiString, hand-built from [MS-OLEDS] 2.1.4's own definition rather than by calling anything embedded-object.ts exports -- these tests exist precisely to prove the reader parses the real, independently-specified wire format, not merely its own writer's output.
function lengthPrefixedAnsiString(value: string): number[] {
  if (value.length === 0) {
    return [0, 0, 0, 0];
  }
  const length = value.length + 1; // + the terminating null character
  return [
    length & 0xff,
    (length >>> 8) & 0xff,
    (length >>> 16) & 0xff,
    (length >>> 24) & 0xff,
    ...[...value].map((char) => char.charCodeAt(0)),
    0,
  ];
}

function uint32Le(value: number): number[] {
  return [
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ];
}

// A real [MS-OLEDS] 2.2.5 EmbeddedObject: an ObjectHeader (2.2.4 -- OLEVersion, FormatID, ClassName/TopicName/ItemName), then NativeDataSize and NativeData -- built byte-by-byte from the spec's own field layout, with `nativeData` (a real [MS-CFB] compound file) as the payload it wraps.
function buildEmbeddedObjectBytes(options: {
  readonly formatId: number;
  readonly className: string;
  readonly nativeData: Uint8Array<ArrayBuffer>;
}): Uint8Array<ArrayBuffer> {
  const header = [
    ...uint32Le(0x00000501), // OLEVersion -- "any arbitrary value ... MUST be ignored on receipt"
    ...uint32Le(options.formatId),
    ...lengthPrefixedAnsiString(options.className),
    ...lengthPrefixedAnsiString(""), // TopicName -- empty for an EmbeddedObject
    ...lengthPrefixedAnsiString(""), // ItemName -- empty for an EmbeddedObject
  ];
  return Uint8Array.from([
    ...header,
    ...uint32Le(options.nativeData.length),
    ...options.nativeData,
  ]);
}

function packagedJson(value: unknown): Uint8Array<ArrayBuffer> {
  const packageBytes = writeOlePackage({
    label: "test.json",
    sourcePath: "",
    tempPath: "",
    fileBytes: new TextEncoder().encode(JSON.stringify(value)),
  });
  return writeCompoundFile([{ path: "Package", bytes: packageBytes }]);
}

describe("readEmbeddedObjectData", () => {
  const embedded: ContentEmbeddedObject = {
    objectKind: "spreadsheet",
    document: { kind: "spreadsheet", metadata: { title: "Sheet" }, sheets: [] },
    frame: { xPt: 1, yPt: 2, widthPt: 3, heightPt: 4 },
  };

  it("reads a spec-conformant ObjectHeader-framed payload built independently of this package's own writer", () => {
    const bytes = buildEmbeddedObjectBytes({
      formatId: 0x00000002, // EmbeddedObject, per MS-OLEDS 2.2.4's own FormatID table
      className: "Package",
      nativeData: packagedJson(embedded),
    });
    expect(readEmbeddedObjectData(bytes)).toEqual(embedded);
  });

  it("reads its own writer's output, whose [MS-CFB] magic bytes now sit behind the ObjectHeader/NativeDataSize envelope rather than at the payload's start", () => {
    const bytes = writeEmbeddedObjectData(embedded);
    // D0 CF 11 E0 is the [MS-CFB] header magic -- it must NOT be the payload's first four bytes any more, since ObjectHeader/NativeDataSize now precede it.
    expect(Array.from(bytes.subarray(0, 4))).not.toEqual([
      0xd0, 0xcf, 0x11, 0xe0,
    ]);
    expect(readEmbeddedObjectData(bytes)).toEqual(embedded);
  });

  it("tolerates a LinkedObject-shaped FormatID (0x00000001) as a deliberate leniency, not a spec requirement of this context", () => {
    // [MS-OLEDS] 2.2.4's own generic ObjectHeader definition allows either 0x00000001 or 0x00000002 structurally -- but 2.2.5's EmbeddedObject, the specific structure readEmbeddedObjectData decodes, narrows that: "The FormatID field of the Header MUST be set to 0x00000002." A genuine FormatID 0x00000001 marks a LinkedObject (2.2.6) instead, whose Header is followed by NetworkName/Reserved1/LinkUpdateOption, not NativeDataSize/NativeData -- fields this reader would misread as NativeDataSize/NativeData for a real LinkedObject. readObjectHeader accepts both values anyway, as a leniency matching ObjectHeader's own generic definition rather than a spec requirement for this context; the NativeData still decodes as this package's own payload here only because the test built it that way (real LinkedObject bytes in NativeData's place would simply fail the CFB/JSON decode below and degrade to undefined, exactly like any other foreign payload).
    const bytes = buildEmbeddedObjectBytes({
      formatId: 0x00000001,
      className: "Package",
      nativeData: packagedJson(embedded),
    });
    expect(readEmbeddedObjectData(bytes)).toEqual(embedded);
  });

  it("rejects a FormatID that is neither 0x00000001 nor 0x00000002", () => {
    const bytes = buildEmbeddedObjectBytes({
      formatId: 0x00000099,
      className: "Package",
      nativeData: packagedJson(embedded),
    });
    expect(readEmbeddedObjectData(bytes)).toBeUndefined();
  });

  it("rejects a bare [MS-CFB] compound file with no ObjectHeader/NativeDataSize envelope at all", () => {
    // This is the shape the pre-fix writer produced and the pre-fix reader accepted: the compound file handed directly as \objdata, with no ObjectHeader in front of it. The fix's whole point is that this shape is not spec-conformant \objdata, so it must no longer round-trip.
    const bareCompoundFile = packagedJson(embedded);
    expect(readEmbeddedObjectData(bareCompoundFile)).toBeUndefined();
  });

  it("rejects a NativeDataSize that overruns the bytes actually present", () => {
    const header = buildEmbeddedObjectBytes({
      formatId: 0x00000002,
      className: "Package",
      nativeData: new Uint8Array(0),
    });
    // Overwrite the NativeDataSize field (the 4 bytes immediately before the -- now empty -- NativeData) to claim far more data than exists.
    const withOverrun = header.slice();
    const view = new DataView(withOverrun.buffer);
    view.setUint32(withOverrun.length - 4, 0xffffff, true);
    expect(readEmbeddedObjectData(withOverrun)).toBeUndefined();
  });

  it("rejects bytes too short to hold even an ObjectHeader's own OLEVersion/FormatID pair", () => {
    expect(readEmbeddedObjectData(Uint8Array.from([1, 2, 3]))).toBeUndefined();
  });

  it("round-trips every optional field the envelope carries alongside a spreadsheet-anchored embed", () => {
    const anchored: ContentEmbeddedObject = {
      objectKind: "formula",
      document: {
        kind: "formula",
        metadata: {},
        formula: { mathml: [] },
      },
      frame: { xPt: 0, yPt: 0, widthPt: 20, heightPt: 10 },
      anchorRow: 2,
      anchorColumn: 3,
      offsetXPt: 1.5,
      offsetYPt: 0.5,
    };
    const bytes = writeEmbeddedObjectData(anchored);
    expect(readEmbeddedObjectData(bytes)).toEqual(anchored);
  });
});
