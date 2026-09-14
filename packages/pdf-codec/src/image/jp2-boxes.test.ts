import { describe, expect, it } from "vitest";
import {
  JPEG2000_FIXTURES,
  jpeg2000FixtureBytes,
} from "../test-support/jpeg2000";
import {
  Jpeg2000ParseError,
  Jpeg2000UnsupportedError,
} from "./jpeg2000-errors";
import { looksLikeBareCodestream, parseJp2Container } from "./jp2-boxes";

function fixture(name: string): Uint8Array<ArrayBuffer> {
  const found = JPEG2000_FIXTURES.find((candidate) => candidate.name === name);
  expect(found).toBeDefined();
  return jpeg2000FixtureBytes(found?.codestream ?? "");
}

// Builds a JP2 box: a 32-bit length, the four-character type, then the payload.
function box(type: string, payload: readonly number[]): number[] {
  const length = 8 + payload.length;
  return [
    (length >>> 24) & 0xff,
    (length >>> 16) & 0xff,
    (length >>> 8) & 0xff,
    length & 0xff,
    ...Array.from(type, (character) => character.charCodeAt(0)),
    ...payload,
  ];
}

const SIGNATURE_BOX = box("jP  ", [0x0d, 0x0a, 0x87, 0x0a]);
const MINIMAL_CODESTREAM = [0xff, 0x4f, 0xff, 0x51];

function imageHeaderPayload(
  height: number,
  width: number,
  components: number,
  bpc: number,
): number[] {
  return [
    (height >>> 24) & 0xff,
    (height >>> 16) & 0xff,
    (height >>> 8) & 0xff,
    height & 0xff,
    (width >>> 24) & 0xff,
    (width >>> 16) & 0xff,
    (width >>> 8) & 0xff,
    width & 0xff,
    (components >>> 8) & 0xff,
    components & 0xff,
    bpc,
    7, // Compression type: 7 is the only value ISO/IEC 15444-1 I.5.3.1 defines.
    0,
    0,
  ];
}

describe("looksLikeBareCodestream", () => {
  it("recognises SOC immediately followed by SIZ, and nothing else", () => {
    expect(
      looksLikeBareCodestream(Uint8Array.from([0xff, 0x4f, 0xff, 0x51, 0x00])),
    ).toBe(true);
    // A JP2 file always starts with the signature box's own length, 0x0000000C.
    expect(
      looksLikeBareCodestream(Uint8Array.from([0x00, 0x00, 0x00, 0x0c])),
    ).toBe(false);
    expect(looksLikeBareCodestream(Uint8Array.from([0xff, 0x4f]))).toBe(false);
  });

  it("rejects a four-byte prefix that is wrong in exactly one of its four bytes", () => {
    // Each byte isolated with the other three correct, so a mutant weakening any single comparison (or the && chain joining them) is caught by the one byte it stops checking.
    expect(
      looksLikeBareCodestream(Uint8Array.from([0x00, 0x4f, 0xff, 0x51])),
    ).toBe(false);
    expect(
      looksLikeBareCodestream(Uint8Array.from([0xff, 0x00, 0xff, 0x51])),
    ).toBe(false);
    expect(
      looksLikeBareCodestream(Uint8Array.from([0xff, 0x4f, 0x00, 0x51])),
    ).toBe(false);
    expect(
      looksLikeBareCodestream(Uint8Array.from([0xff, 0x4f, 0xff, 0x00])),
    ).toBe(false);
  });
});

describe("parseJp2Container", () => {
  it("hands a bare codestream straight back with no box information", () => {
    const bare = fixture("ramp-basic");
    const container = parseJp2Container(bare);
    expect(container.hasBoxes).toBe(false);
    expect(container.codestream).toBe(bare);
    expect(container.imageHeader).toBeUndefined();
    expect(container.colourSpace).toBeUndefined();
  });

  it("reads a real JP2 file produced by OpenJPEG", () => {
    const container = parseJp2Container(fixture("jp2-container"));
    expect(container.hasBoxes).toBe(true);
    expect(container.imageHeader).toEqual({
      width: 32,
      height: 24,
      componentCount: 3,
      bitDepth: 8,
      signed: false,
    });
    expect(container.colourSpace).toBe("srgb");
    expect(container.iccProfile).toBeUndefined();
    // The extracted codestream is the jp2c payload, which begins with its own SOC marker.
    expect(Array.from(container.codestream.subarray(0, 2))).toEqual([
      0xff, 0x4f,
    ]);
  });

  it("reads an image header whose per-component depths differ", () => {
    // A BPC of 255 means the components differ and a bpcc box carries the real depths; the codestream's own SIZ marker is authoritative either way, so no depth is reported here.
    const data = Uint8Array.from([
      ...SIGNATURE_BOX,
      ...box("jp2h", box("ihdr", imageHeaderPayload(4, 5, 3, 0xff))),
      ...box("jp2c", MINIMAL_CODESTREAM),
    ]);
    expect(parseJp2Container(data).imageHeader).toEqual({
      width: 5,
      height: 4,
      componentCount: 3,
    });
  });

  it("keeps a restricted ICC profile without interpreting it", () => {
    const colr = box("colr", [2, 0, 0, 0xde, 0xad, 0xbe, 0xef]);
    const data = Uint8Array.from([
      ...SIGNATURE_BOX,
      ...box("jp2h", [...box("ihdr", imageHeaderPayload(4, 5, 1, 7)), ...colr]),
      ...box("jp2c", MINIMAL_CODESTREAM),
    ]);
    const container = parseJp2Container(data);
    expect(Array.from(container.iccProfile ?? [])).toEqual([
      0xde, 0xad, 0xbe, 0xef,
    ]);
    expect(container.colourSpace).toBeUndefined();
  });

  it("reads channel definitions so an alpha channel is distinguishable from a colour one", () => {
    const cdef = box("cdef", [0, 2, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0]);
    const data = Uint8Array.from([
      ...SIGNATURE_BOX,
      ...box("jp2h", [...box("ihdr", imageHeaderPayload(4, 5, 2, 7)), ...cdef]),
      ...box("jp2c", MINIMAL_CODESTREAM),
    ]);
    expect(parseJp2Container(data).channelDefinitions).toEqual([
      { channel: 0, type: 0, association: 0 },
      { channel: 1, type: 1, association: 0 },
    ]);
  });

  it("treats a box declaring length zero as running to the end of the file", () => {
    const trailing = [
      0,
      0,
      0,
      0,
      ...Array.from("jp2c", (character) => character.charCodeAt(0)),
      ...MINIMAL_CODESTREAM,
    ];
    const container = parseJp2Container(
      Uint8Array.from([...SIGNATURE_BOX, ...trailing]),
    );
    expect(Array.from(container.codestream)).toEqual(MINIMAL_CODESTREAM);
  });

  it("follows a 64-bit extended length", () => {
    // Length 1 escapes to an eight-byte XLBox that sits between the type and the payload, so the box header is sixteen bytes rather than eight.
    const length = 16 + MINIMAL_CODESTREAM.length;
    const extended = [
      0,
      0,
      0,
      1,
      ...Array.from("jp2c", (character) => character.charCodeAt(0)),
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      length,
      ...MINIMAL_CODESTREAM,
    ];
    const container = parseJp2Container(
      Uint8Array.from([...SIGNATURE_BOX, ...extended]),
    );
    expect(Array.from(container.codestream)).toEqual(MINIMAL_CODESTREAM);
  });

  it("refuses a palette rather than handing back raw indices as if they were colour", () => {
    const data = Uint8Array.from([
      ...SIGNATURE_BOX,
      ...box("jp2h", [
        ...box("ihdr", imageHeaderPayload(4, 5, 1, 7)),
        ...box("pclr", [0, 2, 1, 7]),
      ]),
      ...box("jp2c", MINIMAL_CODESTREAM),
    ]);
    expect(() => parseJp2Container(data)).toThrow(Jpeg2000UnsupportedError);
    expect(() => parseJp2Container(data)).toThrow(/palette/);
  });

  it("rejects a JP2 file with no contiguous codestream box", () => {
    const data = Uint8Array.from([
      ...SIGNATURE_BOX,
      ...box("jp2h", box("ihdr", imageHeaderPayload(4, 5, 1, 7))),
    ]);
    expect(() => parseJp2Container(data)).toThrow(Jpeg2000ParseError);
    expect(() => parseJp2Container(data)).toThrow(/jp2c/);
  });

  it("rejects data that is neither a codestream nor a box structure", () => {
    expect(() =>
      parseJp2Container(
        Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ),
    ).toThrow(Jpeg2000ParseError);
    expect(() =>
      parseJp2Container(
        Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ),
    ).toThrow(/neither/);
  });

  it("reports the codestream-missing message, not the format-unrecognised one, once a real signature box was seen even beyond the data actually provided", () => {
    // A box whose declared length's top byte is nonzero (so the array's own first byte is nonzero, the condition the format-unrecognised message also keys off) but which is otherwise truncated to far less than that declared length -- readBox clamps the box to the data actually present, exactly as a genuinely truncated PDF stream would look.
    const hugeLength = 0x01000010;
    const data = Uint8Array.from([
      (hugeLength >>> 24) & 0xff,
      (hugeLength >>> 16) & 0xff,
      (hugeLength >>> 8) & 0xff,
      hugeLength & 0xff,
      ...Array.from("jP  ", (character) => character.charCodeAt(0)),
      0x0d,
      0x0a,
      0x87,
      0x0a,
    ]);
    expect(() => parseJp2Container(data)).toThrow(Jpeg2000ParseError);
    expect(() => parseJp2Container(data)).toThrow(/jp2c/);
  });

  it("reports the format-unrecognised message when the only box present is not the signature box, even with a nonzero leading byte", () => {
    const hugeLength = 0x01000010;
    const data = Uint8Array.from([
      (hugeLength >>> 24) & 0xff,
      (hugeLength >>> 16) & 0xff,
      (hugeLength >>> 8) & 0xff,
      hugeLength & 0xff,
      ...Array.from("free", (character) => character.charCodeAt(0)),
    ]);
    expect(() => parseJp2Container(data)).toThrow(Jpeg2000ParseError);
    expect(() => parseJp2Container(data)).toThrow(/neither/);
  });

  it("reads a box whose 8-byte header ends exactly at the end of the data, with an empty payload", () => {
    const data = Uint8Array.from([...SIGNATURE_BOX, ...box("jp2c", [])]);
    const container = parseJp2Container(data);
    expect(container.codestream).toHaveLength(0);
  });

  it("rejects an extended (64-bit) box length that leaves fewer than 8 bytes for the XLBox field", () => {
    const truncated = [
      0,
      0,
      0,
      1, // declared length 1 escapes to a 64-bit XLBox
      ...Array.from("jp2c", (character) => character.charCodeAt(0)),
      0,
      0, // only 2 of the 8 XLBox bytes are actually present
    ];
    const data = Uint8Array.from([...SIGNATURE_BOX, ...truncated]);
    expect(() => parseJp2Container(data)).toThrow(Jpeg2000ParseError);
    expect(() => parseJp2Container(data)).toThrow(/32-bit field/);
  });

  it("follows a 64-bit extended length correctly when a further box trails it", () => {
    // Distinguishes reading the XLBox's low word from its own field position rather than from the 4 bytes before it (which here are the box's own type, "uuid ").
    const uuidPayload = [1, 2, 3, 4];
    const low = 16 + uuidPayload.length;
    const extended = [
      0,
      0,
      0,
      1,
      ...Array.from("uuid", (character) => character.charCodeAt(0)),
      0,
      0,
      0,
      0, // high word
      (low >>> 24) & 0xff,
      (low >>> 16) & 0xff,
      (low >>> 8) & 0xff,
      low & 0xff,
      ...uuidPayload,
    ];
    const data = Uint8Array.from([
      ...SIGNATURE_BOX,
      ...extended,
      ...box("jp2c", MINIMAL_CODESTREAM),
    ]);
    const container = parseJp2Container(data);
    expect(Array.from(container.codestream)).toEqual(MINIMAL_CODESTREAM);
  });

  it("treats a 64-bit extended length whose high word is nonzero as running to the end of the data", () => {
    const extended = [
      0,
      0,
      0,
      1,
      ...Array.from("jp2c", (character) => character.charCodeAt(0)),
      0,
      0,
      0,
      1, // high word nonzero: unaddressable in practice, so this box runs to the data's own end
      0,
      0,
      0,
      0,
      ...MINIMAL_CODESTREAM,
    ];
    const data = Uint8Array.from([...SIGNATURE_BOX, ...extended]);
    const container = parseJp2Container(data);
    expect(Array.from(container.codestream)).toEqual(MINIMAL_CODESTREAM);
  });

  it("rejects a box declaring a length shorter than its own 8-byte header", () => {
    const tooShort = [
      0,
      0,
      0,
      4, // 4 is less than the 8-byte header this length is supposed to include
      ...Array.from("jp2c", (character) => character.charCodeAt(0)),
    ];
    const data = Uint8Array.from([...SIGNATURE_BOX, ...tooShort]);
    expect(() => parseJp2Container(data)).toThrow(Jpeg2000ParseError);
    expect(() => parseJp2Container(data)).toThrow(
      /shorter than its own header/,
    );
  });

  it("rejects an image header box shorter than the 14 bytes ISO/IEC 15444-1 I.5.3.1 requires", () => {
    const data = Uint8Array.from([
      ...SIGNATURE_BOX,
      ...box("jp2h", box("ihdr", [0, 0, 0, 4, 0, 0, 0, 5, 0, 3, 8, 7, 0])),
      ...box("jp2c", MINIMAL_CODESTREAM),
    ]);
    expect(() => parseJp2Container(data)).toThrow(Jpeg2000ParseError);
    expect(() => parseJp2Container(data)).toThrow(/14 bytes/);
  });

  it("reads a component count spanning both bytes of its field", () => {
    const data = Uint8Array.from([
      ...SIGNATURE_BOX,
      ...box("jp2h", box("ihdr", imageHeaderPayload(4, 5, 260, 7))),
      ...box("jp2c", MINIMAL_CODESTREAM),
    ]);
    expect(parseJp2Container(data).imageHeader?.componentCount).toBe(260);
  });

  it("reports a signed component depth when the sign bit of BPC is set", () => {
    const data = Uint8Array.from([
      ...SIGNATURE_BOX,
      ...box("jp2h", box("ihdr", imageHeaderPayload(4, 5, 1, 0x87))),
      ...box("jp2c", MINIMAL_CODESTREAM),
    ]);
    expect(parseJp2Container(data).imageHeader).toEqual({
      width: 5,
      height: 4,
      componentCount: 1,
      bitDepth: 8,
      signed: true,
    });
  });

  it("returns no channel definitions when a cdef box declares entries but carries no room for even one", () => {
    // Count field only (2 bytes): entry + 6 always exceeds the box's own end here, so the loop must break before pushing anything -- distinguishes the break's own `>` from both `<` and a reversed arithmetic offset, which would instead read past this box into whatever data follows it.
    const data = Uint8Array.from([
      ...SIGNATURE_BOX,
      ...box("jp2h", [
        ...box("ihdr", imageHeaderPayload(4, 5, 1, 7)),
        ...box("cdef", [0, 1]),
      ]),
      ...box("jp2c", MINIMAL_CODESTREAM),
    ]);
    expect(parseJp2Container(data).channelDefinitions).toEqual([]);
  });

  it("does not let a colour space box overwrite a profile an earlier colr box already recorded", () => {
    const colr1 = box("colr", [2, 0, 0, 0xaa, 0xbb, 0xcc, 0xdd]); // method 2: records an ICC profile
    const colr2 = box("colr", [1, 0, 0, 0, 0, 0, 16]); // method 1: would set colourSpace to srgb if allowed to run
    const data = Uint8Array.from([
      ...SIGNATURE_BOX,
      ...box("jp2h", [
        ...box("ihdr", imageHeaderPayload(4, 5, 1, 7)),
        ...colr1,
        ...colr2,
      ]),
      ...box("jp2c", MINIMAL_CODESTREAM),
    ]);
    const container = parseJp2Container(data);
    expect(container.colourSpace).toBeUndefined();
    expect(Array.from(container.iccProfile ?? [])).toEqual([
      0xaa, 0xbb, 0xcc, 0xdd,
    ]);
  });

  it("does not read channel definitions from a box that is not the cdef type", () => {
    // If misread as a cdef box, these bytes would parse as one all-zero channel definition.
    const notCdef = box("res ", [0, 1, 0, 0, 0, 0, 0, 0]);
    const data = Uint8Array.from([
      ...SIGNATURE_BOX,
      ...box("jp2h", [
        ...box("ihdr", imageHeaderPayload(4, 5, 1, 7)),
        ...notCdef,
      ]),
      ...box("jp2c", MINIMAL_CODESTREAM),
    ]);
    expect(parseJp2Container(data).channelDefinitions).toEqual([]);
  });

  it("does not record anything from a colr box whose method is neither 1 nor 2", () => {
    const data = Uint8Array.from([
      ...SIGNATURE_BOX,
      ...box("jp2h", [
        ...box("ihdr", imageHeaderPayload(4, 5, 1, 7)),
        ...box("colr", [3, 0, 0, 0xaa, 0xbb, 0xcc, 0xdd]),
      ]),
      ...box("jp2c", MINIMAL_CODESTREAM),
    ]);
    const container = parseJp2Container(data);
    expect(container.colourSpace).toBeUndefined();
    expect(container.iccProfile).toBeUndefined();
  });

  it("reports the 'no contiguous codestream' message, not the format-unrecognised one, when there is no signature box but the data is still box-shaped", () => {
    // No SIGNATURE_BOX prefix, so sawSignature is genuinely false; the leading bytes are jp2h's own small length field, so data[0] is genuinely 0x00 -- the one combination that distinguishes this branch's real condition from a mutant that forces it true regardless.
    const data = Uint8Array.from([
      ...box("jp2h", box("ihdr", imageHeaderPayload(4, 5, 1, 7))),
    ]);
    expect(() => parseJp2Container(data)).toThrow(Jpeg2000ParseError);
    expect(() => parseJp2Container(data)).toThrow(/jp2c/);
  });

  it("reads exactly the declared channel-definition count, not a byte from the box's own header", () => {
    // The count field's low byte would coincide with the tail of the cdef box's own type ('cdef') if the read drifted by one byte, so the payload deliberately provides far more capacity than the declared count needs -- a wrong, larger count would visibly read past the 3 real entries into the padding.
    const realCount = 3;
    const capacity = 200;
    const payload = [(realCount >> 8) & 0xff, realCount & 0xff];
    for (let i = 0; i < capacity; i++) {
      payload.push(0, 0, 0, 0, 0, 0);
    }
    const data = Uint8Array.from([
      ...SIGNATURE_BOX,
      ...box("jp2h", [
        ...box("ihdr", imageHeaderPayload(4, 5, 1, 7)),
        ...box("cdef", payload),
      ]),
      ...box("jp2c", MINIMAL_CODESTREAM),
    ]);
    expect(parseJp2Container(data).channelDefinitions).toHaveLength(realCount);
  });

  it("reads a channel definition's type value spanning both bytes of its field", () => {
    const cdef = box("cdef", [0, 1, 0, 0, 1, 2, 0, 0]);
    const data = Uint8Array.from([
      ...SIGNATURE_BOX,
      ...box("jp2h", [...box("ihdr", imageHeaderPayload(4, 5, 1, 7)), ...cdef]),
      ...box("jp2c", MINIMAL_CODESTREAM),
    ]);
    expect(parseJp2Container(data).channelDefinitions).toEqual([
      { channel: 0, type: 258, association: 0 },
    ]);
  });

  it("keeps the first contiguous codestream box when more than one jp2c box is present", () => {
    const data = Uint8Array.from([
      ...SIGNATURE_BOX,
      ...box("jp2c", MINIMAL_CODESTREAM),
      ...box("jp2c", [0xff, 0x4f, 0xff, 0x51, 0x99]),
    ]);
    const container = parseJp2Container(data);
    expect(Array.from(container.codestream)).toEqual(MINIMAL_CODESTREAM);
  });

  it("prefers the first colr box when more than one is present", () => {
    const colr1 = box("colr", [1, 0, 0, 0, 0, 0, 16]); // srgb
    const colr2 = box("colr", [1, 0, 0, 0, 0, 0, 17]); // greyscale, should be ignored
    const data = Uint8Array.from([
      ...SIGNATURE_BOX,
      ...box("jp2h", [
        ...box("ihdr", imageHeaderPayload(4, 5, 1, 7)),
        ...colr1,
        ...colr2,
      ]),
      ...box("jp2c", MINIMAL_CODESTREAM),
    ]);
    expect(parseJp2Container(data).colourSpace).toBe("srgb");
  });

  it("recognises a component-mapping box alone as requiring palette support this decoder refuses", () => {
    const data = Uint8Array.from([
      ...SIGNATURE_BOX,
      ...box("jp2h", [
        ...box("ihdr", imageHeaderPayload(4, 5, 1, 7)),
        ...box("cmap", [0, 0, 0, 0]),
      ]),
      ...box("jp2c", MINIMAL_CODESTREAM),
    ]);
    expect(() => parseJp2Container(data)).toThrow(Jpeg2000UnsupportedError);
  });

  it("ignores a colr box too short to carry even a method byte", () => {
    const data = Uint8Array.from([
      ...SIGNATURE_BOX,
      ...box("jp2h", [
        ...box("ihdr", imageHeaderPayload(4, 5, 1, 7)),
        ...box("colr", [1]),
      ]),
      ...box("jp2c", MINIMAL_CODESTREAM),
    ]);
    const container = parseJp2Container(data);
    expect(container.colourSpace).toBeUndefined();
    expect(container.iccProfile).toBeUndefined();
  });

  it("does not record a colour space when a method-1 colr box is too short to carry the enumerated value", () => {
    const data = Uint8Array.from([
      ...SIGNATURE_BOX,
      ...box("jp2h", [
        ...box("ihdr", imageHeaderPayload(4, 5, 1, 7)),
        ...box("colr", [1, 0, 0]),
      ]),
      ...box("jp2c", MINIMAL_CODESTREAM),
    ]);
    expect(parseJp2Container(data).colourSpace).toBeUndefined();
  });

  it("reads an enumerated colour space from the minimum 7-byte method-1 colr box", () => {
    const data = Uint8Array.from([
      ...SIGNATURE_BOX,
      ...box("jp2h", [
        ...box("ihdr", imageHeaderPayload(4, 5, 1, 7)),
        ...box("colr", [1, 0, 0, 0, 0, 0, 16]),
      ]),
      ...box("jp2c", MINIMAL_CODESTREAM),
    ]);
    expect(parseJp2Container(data).colourSpace).toBe("srgb");
  });

  it("does not record an ICC profile when a method-2 colr box carries no profile bytes", () => {
    const data = Uint8Array.from([
      ...SIGNATURE_BOX,
      ...box("jp2h", [
        ...box("ihdr", imageHeaderPayload(4, 5, 1, 7)),
        ...box("colr", [2, 0, 0]),
      ]),
      ...box("jp2c", MINIMAL_CODESTREAM),
    ]);
    expect(parseJp2Container(data).iccProfile).toBeUndefined();
  });

  it("omits optional container fields entirely, rather than setting them to undefined, when nothing supplied them", () => {
    const data = Uint8Array.from([
      ...SIGNATURE_BOX,
      ...box("jp2c", MINIMAL_CODESTREAM),
    ]);
    const container = parseJp2Container(data);
    expect(Object.hasOwn(container, "imageHeader")).toBe(false);
    expect(Object.hasOwn(container, "colourSpace")).toBe(false);
    expect(Object.hasOwn(container, "iccProfile")).toBe(false);
  });

  it("includes optional container fields as real own properties when something supplied them", () => {
    const data = Uint8Array.from([
      ...SIGNATURE_BOX,
      ...box("jp2h", [
        ...box("ihdr", imageHeaderPayload(4, 5, 1, 7)),
        ...box("colr", [1, 0, 0, 0, 0, 0, 16]),
      ]),
      ...box("jp2c", MINIMAL_CODESTREAM),
    ]);
    const container = parseJp2Container(data);
    expect(Object.hasOwn(container, "imageHeader")).toBe(true);
    expect(Object.hasOwn(container, "colourSpace")).toBe(true);
  });
});
