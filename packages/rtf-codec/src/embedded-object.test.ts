import { describe, expect, it } from "vitest";
import {
  readCompoundFile,
  readOlePackage,
  writeCompoundFile,
  writeOlePackage,
} from "archive-codec";
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

// A real [MS-OLEDS] 2.2.5 EmbeddedObject: an ObjectHeader (2.2.4 -- OLEVersion, FormatID, ClassName/TopicName/ItemName), NativeDataSize and NativeData, then the mandatory fourth field, Presentation -- built byte-by-byte from the spec's own field layout, with `nativeData` (a real [MS-CFB] compound file) as NativeData's own payload and presentationObjectBytes() below as Presentation's.
function buildEmbeddedObjectBytes(options: {
  readonly formatId: number;
  readonly className: string;
  readonly nativeData: Uint8Array<ArrayBuffer>;
  readonly presentation?: readonly number[];
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
    ...(options.presentation ?? presentationObjectBytes()),
  ]);
}

// A real [MS-OLEDS] Presentation field: a StandardClipboardFormatPresentationObject (2.2.3.2) -- a ClipboardFormatHeader (2.2.3.1: a PresentationObjectHeader, then ClipboardFormat), then PresentationDataSize and PresentationData -- hand-built the same way buildEmbeddedObjectBytes is, independently of embedded-object.ts's own writer. PresentationData's own content is never read back by readEmbeddedObjectData, only its presence and framing, so four arbitrary bytes stand in for a real CF_DIB image here.
function presentationObjectBytes(): number[] {
  const header = [
    ...uint32Le(0x00000501), // PresentationObjectHeader.OLEVersion -- arbitrary, "MUST be ignored on processing"
    ...uint32Le(0x00000005), // PresentationObjectHeader.FormatID -- a ClassName follows
    ...lengthPrefixedAnsiString(""), // ClassName -- empty, neither "METAFILEPICT", "DIB" nor "BITMAP"
    ...uint32Le(0x00000008), // ClipboardFormatHeader.ClipboardFormat -- CF_DIB
  ];
  const presentationData = [0, 0, 0, 0];
  return [...header, ...uint32Le(presentationData.length), ...presentationData];
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

  it("writes real bytes after NativeData -- the mandatory Presentation field [MS-OLEDS] 2.2.5 requires as EmbeddedObject's own fourth field, not a payload that ends at NativeData", () => {
    const bytes = writeEmbeddedObjectData(embedded);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    // ObjectHeader (OLEVersion + FormatID + three empty LengthPrefixedAnsiStrings, each 4 bytes of zero length) is 8 + 4*3 = 20 bytes for this writer's own fixed ClassName/TopicName/ItemName shape ("Package"/""/"" -- ClassName's own length-prefixed bytes add "Package"'s own 8 characters including the terminating null).
    const classNameLength = "Package".length + 1;
    const objectHeaderLength = 8 + (4 + classNameLength) + 4 + 4;
    const nativeDataSize = view.getUint32(objectHeaderLength, true);
    const presentationStart = objectHeaderLength + 4 + nativeDataSize;
    // There must genuinely be bytes there -- a payload that ends exactly at NativeData (the pre-fix shape) would leave nothing here at all.
    expect(bytes.length).toBeGreaterThan(presentationStart);
    // Those bytes must themselves be a real, structurally valid Presentation field: a PresentationObjectHeader (OLEVersion, FormatID 0x00000005, an empty ClassName) then ClipboardFormat CF_DIB (0x00000008), matching what [MS-OLEDS] 2.2.3.1/2.2.3.2 require, not arbitrary filler of the right length.
    const presentationFormatId = view.getUint32(presentationStart + 4, true);
    expect(presentationFormatId).toBe(0x00000005);
    const presentationClassNameLength = view.getUint32(
      presentationStart + 8,
      true,
    );
    expect(presentationClassNameLength).toBe(0); // an empty ClassName -- see PRESENTATION_CLASS_NAME's own reasoning in embedded-object.ts
    const clipboardFormat = view.getUint32(presentationStart + 12, true);
    expect(clipboardFormat).toBe(0x00000008); // CF_DIB
  });

  it("writes ObjectHeader's OLEVersion and ClassName exactly, byte for byte", () => {
    const bytes = writeEmbeddedObjectData(embedded);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint32(0, true)).toBe(0x00000501); // OLEVersion
    expect(view.getUint32(4, true)).toBe(0x00000002); // FormatID -- EmbeddedObject
    const classNameLength = view.getUint32(8, true);
    expect(classNameLength).toBe("Package".length + 1); // + the terminating null character
    const classNameChars = Array.from(
      bytes.subarray(12, 12 + "Package".length),
    ).map((code) => String.fromCharCode(code));
    expect(classNameChars.join("")).toBe("Package"); // proves every character was copied, not a truncated or overrun prefix
    expect(bytes[12 + "Package".length]).toBe(0); // the terminating null character
  });

  it("writes writeMinimalDib's own DeviceIndependentBitmap Object exactly, field for field", () => {
    const bytes = writeEmbeddedObjectData(embedded);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const classNameLength = "Package".length + 1;
    const objectHeaderLength = 8 + (4 + classNameLength) + 4 + 4;
    const nativeDataSize = view.getUint32(objectHeaderLength, true);
    const presentationStart = objectHeaderLength + 4 + nativeDataSize;
    // PresentationObjectHeader (12: OLEVersion+FormatID+empty ClassName) + ClipboardFormat (4) + PresentationDataSize (4).
    const dibStart = presentationStart + 12 + 4 + 4;
    expect(view.getUint32(dibStart, true)).toBe(40); // BitmapInfoHeader's own fixed size
    expect(view.getInt32(dibStart + 4, true)).toBe(1); // Width
    expect(view.getInt32(dibStart + 8, true)).toBe(1); // Height
    expect(view.getUint16(dibStart + 12, true)).toBe(1); // Planes
    expect(view.getUint16(dibStart + 14, true)).toBe(1); // BitCount -- monochrome
    expect(view.getUint32(dibStart + 16, true)).toBe(0); // Compression -- BI_RGB
    expect(view.getUint32(dibStart + 20, true)).toBe(0); // ImageSize
    expect(view.getInt32(dibStart + 24, true)).toBe(0); // XPelsPerMeter
    expect(view.getInt32(dibStart + 28, true)).toBe(0); // YPelsPerMeter
    expect(view.getUint32(dibStart + 32, true)).toBe(2); // ColorUsed -- both entries of the 2-colour table
    expect(view.getUint32(dibStart + 36, true)).toBe(0); // ColorImportant
    // Two RGBQuad entries: black then white.
    expect(Array.from(bytes.subarray(dibStart + 40, dibStart + 44))).toEqual([
      0x00, 0x00, 0x00, 0x00,
    ]);
    expect(Array.from(bytes.subarray(dibStart + 44, dibStart + 48))).toEqual([
      0xff, 0xff, 0xff, 0x00,
    ]);
    // rowBytes (4, from the (Width*Planes*BitCount+31)&~31)/8 formula) * abs(Height) (1) = 4 bytes of packed monochrome pixel data, already all-zero -- the one pixel indexes colour 0 (black).
    expect(bytes.length - (dibStart + 48)).toBe(4);
    // The whole DIB is exactly HeaderSize(40) + 2 colours * 4 bytes + 4 bytes of pixel data = 52 bytes, and PresentationDataSize must declare exactly that.
    const presentationDataSize = view.getUint32(presentationStart + 16, true);
    expect(presentationDataSize).toBe(52);
    expect(bytes.length).toBe(dibStart + 52);
  });

  it("writes an empty sourcePath and tempPath into the Package stream, not arbitrary filler", () => {
    const bytes = writeEmbeddedObjectData(embedded);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const classNameLength = "Package".length + 1;
    const objectHeaderLength = 8 + (4 + classNameLength) + 4 + 4;
    const nativeDataSize = view.getUint32(objectHeaderLength, true);
    const nativeData = bytes.subarray(
      objectHeaderLength + 4,
      objectHeaderLength + 4 + nativeDataSize,
    );
    const streams = readCompoundFile(nativeData);
    const packageStream = streams.find((stream) => stream.path === "Package");
    if (packageStream === undefined) {
      throw new Error("expected a Package stream");
    }
    const olePackage = readOlePackage(packageStream.bytes);
    expect(olePackage.sourcePath).toBe("");
    expect(olePackage.tempPath).toBe("");
  });

  it("rejects a compound file with no stream named Package at all", () => {
    const nativeData = writeCompoundFile([
      { path: "NotPackage", bytes: new TextEncoder().encode("{}") },
    ]);
    const bytes = buildEmbeddedObjectBytes({
      formatId: 0x00000002,
      className: "Package",
      nativeData,
    });
    expect(readEmbeddedObjectData(bytes)).toBeUndefined();
  });

  it("rejects a payload whose bytes end exactly at NativeData, with no Presentation field at all", () => {
    // The pre-fix shape this writer used to produce: a real, decodable NativeData with nothing after it. EmbeddedObject's own fourth field is mandatory, so this is no longer spec-conformant \\objdata even though NativeData alone still decodes.
    const bytes = buildEmbeddedObjectBytes({
      formatId: 0x00000002,
      className: "Package",
      nativeData: packagedJson(embedded),
      presentation: [],
    });
    expect(readEmbeddedObjectData(bytes)).toBeUndefined();
  });

  it("rejects a Presentation field truncated mid-PresentationObjectHeader", () => {
    const bytes = buildEmbeddedObjectBytes({
      formatId: 0x00000002,
      className: "Package",
      nativeData: packagedJson(embedded),
      presentation: [...uint32Le(0x00000501)], // OLEVersion only -- FormatID never arrives
    });
    expect(readEmbeddedObjectData(bytes)).toBeUndefined();
  });

  it("rejects a PresentationObjectHeader.FormatID other than 0x00000005, even when otherwise well-formed", () => {
    const presentation = presentationObjectBytes();
    const buffer = Uint8Array.from(presentation);
    // FormatID is the 4 bytes right after OLEVersion.
    new DataView(buffer.buffer).setUint32(4, 0x00000000, true);
    const bytes = buildEmbeddedObjectBytes({
      formatId: 0x00000002,
      className: "Package",
      nativeData: packagedJson(embedded),
      presentation: Array.from(buffer),
    });
    expect(readEmbeddedObjectData(bytes)).toBeUndefined();
  });

  it("rejects a ClipboardFormat other than CF_DIB, even when otherwise well-formed", () => {
    const presentation = presentationObjectBytes();
    const buffer = Uint8Array.from(presentation);
    // ClipboardFormat is the 4 bytes right after PresentationObjectHeader (OLEVersion + FormatID + empty ClassName = 12 bytes).
    new DataView(buffer.buffer).setUint32(12, 0x00000002, true); // CF_BITMAP, not CF_DIB
    const bytes = buildEmbeddedObjectBytes({
      formatId: 0x00000002,
      className: "Package",
      nativeData: packagedJson(embedded),
      presentation: Array.from(buffer),
    });
    expect(readEmbeddedObjectData(bytes)).toBeUndefined();
  });

  it("rejects a Presentation field whose PresentationDataSize overruns the bytes actually present", () => {
    const presentation = presentationObjectBytes();
    const buffer = Uint8Array.from(presentation);
    // PresentationDataSize is the 4 bytes immediately before PresentationData (4 zero bytes); overwrite it to claim more than the buffer holds.
    new DataView(buffer.buffer).setUint32(
      presentation.length - 8,
      0xffffff,
      true,
    );
    const bytes = buildEmbeddedObjectBytes({
      formatId: 0x00000002,
      className: "Package",
      nativeData: packagedJson(embedded),
      presentation: Array.from(buffer),
    });
    expect(readEmbeddedObjectData(bytes)).toBeUndefined();
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
    // No Presentation field here at all -- isolating this test to the NativeDataSize/NativeData boundary specifically means the buffer's own last 4 bytes are unambiguously NativeDataSize when NativeData is empty, regardless of what a real EmbeddedObject would carry after it.
    const header = buildEmbeddedObjectBytes({
      formatId: 0x00000002,
      className: "Package",
      nativeData: new Uint8Array(0),
      presentation: [],
    });
    // Overwrite the NativeDataSize field (the 4 bytes immediately before the -- now empty -- NativeData) to claim far more data than exists.
    const withOverrun = header.slice();
    const view = new DataView(withOverrun.buffer);
    view.setUint32(withOverrun.length - 4, 0xffffff, true);
    expect(readEmbeddedObjectData(withOverrun)).toBeUndefined();
  });

  it("rejects a NativeDataSize declaring exactly one byte more than actually remains", () => {
    const realNativeData = packagedJson(embedded);
    const header = buildEmbeddedObjectBytes({
      formatId: 0x00000002,
      className: "Package",
      nativeData: realNativeData,
      presentation: [],
    });
    const withOffByOne = header.slice();
    new DataView(withOffByOne.buffer).setUint32(
      withOffByOne.length - realNativeData.length - 4,
      realNativeData.length + 1,
      true,
    );
    expect(readEmbeddedObjectData(withOffByOne)).toBeUndefined();
  });

  it("rejects a PresentationDataSize declaring exactly one byte more than actually remains", () => {
    const presentation = presentationObjectBytes();
    const dib = Uint8Array.from(presentation.slice(-4)); // the 4-byte PresentationData this helper always writes
    const withOffByOne = Uint8Array.from(presentation);
    new DataView(withOffByOne.buffer).setUint32(
      presentation.length - 4 - dib.length,
      dib.length + 1,
      true,
    );
    const bytes = buildEmbeddedObjectBytes({
      formatId: 0x00000002,
      className: "Package",
      nativeData: packagedJson(embedded),
      presentation: Array.from(withOffByOne),
    });
    expect(readEmbeddedObjectData(bytes)).toBeUndefined();
  });

  it("rejects bytes too short to hold even an ObjectHeader's own OLEVersion/FormatID pair", () => {
    expect(readEmbeddedObjectData(Uint8Array.from([1, 2, 3]))).toBeUndefined();
  });

  it("carries a legitimate SourceResidue source field through unchanged", () => {
    const withSource: ContentEmbeddedObject = {
      ...embedded,
      source: { format: "rtf", xml: "{\\object\\objemb ...}" },
    };
    const bytes = buildEmbeddedObjectBytes({
      formatId: 0x00000002,
      className: "Package",
      nativeData: packagedJson(withSource),
    });
    expect(readEmbeddedObjectData(bytes)).toEqual(withSource);
  });

  // isContentEmbeddedObject (the guard behind ContentEmbeddedObjectSchema.safeParse above) never inspects `source` at all, so a forged \objdata payload's `source` value reaches knownContentEmbeddedObjectFields exactly as a hostile author wrote it -- these shapes must all be dropped rather than carried through into the returned ContentEmbeddedObject, where a downstream same-format writer could otherwise be persuaded to re-emit them verbatim as if they were real quarantined residue.
  it.each([
    [
      "a format string SourceResidueSchema does not enumerate",
      { format: "not-a-real-format", xml: "<w:sdt/>" },
    ],
    ["a non-string xml field", { format: "docx", xml: 123 }],
    ["a missing xml field", { format: "docx" }],
    ["an array instead of an object", ["docx", "<w:sdt/>"]],
    ["a bare string", "just a string"],
    ["a bare number", 42],
  ])("drops an unvalidated source field: %s", (_description, hostileSource) => {
    const bytes = buildEmbeddedObjectBytes({
      formatId: 0x00000002,
      className: "Package",
      nativeData: packagedJson({ ...embedded, source: hostileSource }),
    });
    const result = readEmbeddedObjectData(bytes);
    expect(result).toBeDefined();
    expect(result).not.toHaveProperty("source");
    expect(result).toEqual(embedded);
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

  it("omits every optional field entirely when the source embed carries none of them", () => {
    const bytes = writeEmbeddedObjectData(embedded);
    const result = readEmbeddedObjectData(bytes);
    expect(result).not.toHaveProperty("anchorRow");
    expect(result).not.toHaveProperty("anchorColumn");
    expect(result).not.toHaveProperty("offsetXPt");
    expect(result).not.toHaveProperty("offsetYPt");
    expect(result).not.toHaveProperty("source");
  });

  it.each([
    ["a bare JSON null", "null"],
    ["a bare JSON array", "[]"],
    ["a bare JSON string", '"just a string"'],
    ["a bare JSON number", "42"],
  ])(
    "rejects a NativeData payload that decodes to %s rather than a JSON object",
    (_description, json) => {
      const packageBytes = writeOlePackage({
        label: "test.json",
        sourcePath: "",
        tempPath: "",
        fileBytes: new TextEncoder().encode(json),
      });
      const nativeData = writeCompoundFile([
        { path: "Package", bytes: packageBytes },
      ]);
      const bytes = buildEmbeddedObjectBytes({
        formatId: 0x00000002,
        className: "Package",
        nativeData,
      });
      expect(readEmbeddedObjectData(bytes)).toBeUndefined();
    },
  );
});
