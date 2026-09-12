import { describe, expect, it } from "vitest";
import type { ContentImageBlock } from "document-schema.js";
import { bytesToBase64 } from "./base64";
import { DocFormatError, DocUnsupportedError } from "./errors";
import { buildInlinePicture } from "./pictures-write";
import { readInlinePicture } from "./pictures";

// readInlinePicture only recognises a blip whose payload actually begins with its format's own real file signature (pictures.ts's own validated-blip locator), so a fixture round-tripping through it needs the real magic bytes, not arbitrary payload bytes.
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 9, 8, 7]);

function image(overrides: Partial<ContentImageBlock> = {}): ContentImageBlock {
  return {
    kind: "image",
    format: "png",
    base64: bytesToBase64(PNG_BYTES),
    widthPt: 100,
    heightPt: 50,
    ...overrides,
  };
}

describe("buildInlinePicture", () => {
  it("writes a PNG image readable back through readInlinePicture", () => {
    const { data } = buildInlinePicture(
      image({ format: "png", base64: bytesToBase64(PNG_BYTES) }),
    );
    const picture = readInlinePicture(data, 0);
    expect(picture?.format).toBe("png");
    expect(picture?.base64).toBe(bytesToBase64(PNG_BYTES));
  });

  it("writes a JPEG image readable back through readInlinePicture", () => {
    const { data } = buildInlinePicture(
      image({ format: "jpeg", base64: bytesToBase64(JPEG_BYTES) }),
    );
    const picture = readInlinePicture(data, 0);
    expect(picture?.format).toBe("jpeg");
    expect(picture?.base64).toBe(bytesToBase64(JPEG_BYTES));
  });

  it("refuses a format its own reader could never decode from a real OfficeArtBlip", () => {
    expect(() => buildInlinePicture(image({ format: "svg" }))).toThrow(
      DocUnsupportedError,
    );
    expect(() => buildInlinePicture(image({ format: "svg" }))).toThrow(
      /only write a 'png' or 'jpeg'/,
    );
  });

  it("round-trips the image's own width and height, converted to twips", () => {
    const { data } = buildInlinePicture(image({ widthPt: 72, heightPt: 36 }));
    const picture = readInlinePicture(data, 0);
    expect(picture?.widthPt).toBeCloseTo(72, 5);
    expect(picture?.heightPt).toBeCloseTo(36, 5);
  });

  it("accepts a width right at the signed-16-bit twips boundary", () => {
    // 0x7fff twips / 20 twips-per-point = 1637.75pt.
    expect(() =>
      buildInlinePicture(image({ widthPt: 0x7fff / 20 })),
    ).not.toThrow();
  });

  it("rejects a width one twip past the signed-16-bit boundary", () => {
    expect(() =>
      buildInlinePicture(image({ widthPt: (0x7fff + 1) / 20 })),
    ).toThrow(DocFormatError);
    expect(() =>
      buildInlinePicture(image({ widthPt: (0x7fff + 1) / 20 })),
    ).toThrow(/widthPt/);
  });

  it("rejects a negative height", () => {
    expect(() => buildInlinePicture(image({ heightPt: -1 }))).toThrow(
      /heightPt/,
    );
  });

  it("accepts zero width and height", () => {
    expect(() =>
      buildInlinePicture(image({ widthPt: 0, heightPt: 0 })),
    ).not.toThrow();
  });
});

describe("buildInlinePicture's own sprmCPicLocation grpprl", () => {
  it("encodes the data-stream offset as a signed little-endian 32-bit operand", () => {
    const { buildGrpprl } = buildInlinePicture(image());
    const grpprl = buildGrpprl(0x1234);
    expect(grpprl[0]).toBe(0x03);
    expect(grpprl[1]).toBe(0x6a);
    const operand = new Uint8Array(grpprl.slice(2));
    const view = new DataView(
      operand.buffer,
      operand.byteOffset,
      operand.byteLength,
    );
    expect(view.getInt32(0, true)).toBe(0x1234);
  });

  it("encodes a non-zero offset distinctly from a zero one", () => {
    const { buildGrpprl } = buildInlinePicture(image());
    expect(buildGrpprl(0)).not.toEqual(buildGrpprl(100));
  });
});
