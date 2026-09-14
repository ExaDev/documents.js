import { describe, expect, it } from "vitest";
import type { LayoutImageAsset } from "pdf-codec";
import { encodePng } from "byte-codec";
import { registerImageBytes, spliceOut } from "./util";

// A minimal, spec-shaped baseline JPEG: SOI, an SOF0 frame header (4x3px, 3 components), EOI -- mirrors byte-codec's own readJpegInfo test fixture shape (that package's own image/jpeg-info.test.ts buildJpeg helper), restated inline here since this is the only place in documents.js that needs a real (not merely format-labelled) JPEG byte stream.
const JPEG_WIDTH = 4;
const JPEG_HEIGHT = 3;
const JPEG_BYTES = new Uint8Array([
  0xff,
  0xd8, // SOI
  0xff,
  0xc0,
  0x00,
  0x08,
  0x08,
  0x00,
  JPEG_HEIGHT,
  0x00,
  JPEG_WIDTH,
  0x03, // SOF0
  0xff,
  0xd9, // EOI
]);

const PNG_BYTES = encodePng({
  width: 2,
  height: 2,
  channels: 3,
  data: new Uint8Array(2 * 2 * 3),
});

describe("spliceOut", () => {
  it("removes the given node from the container", () => {
    const container = ["a", "b", "c"];
    spliceOut(container, "b");
    expect(container).toEqual(["a", "c"]);
  });

  it("leaves the container completely unchanged when the node is not present", () => {
    // If the index-not-found guard were skipped, Array.prototype.splice(-1, 1) would silently remove the container's own LAST element instead of doing nothing.
    const container = ["a", "b", "c"];
    spliceOut(container, "not present");
    expect(container).toEqual(["a", "b", "c"]);
  });
});

describe("registerImageBytes", () => {
  it("decodes real JPEG dimensions via readJpegInfo for format 'jpeg'", () => {
    const images: Record<string, LayoutImageAsset> = {};
    const imageId = registerImageBytes(JPEG_BYTES, "jpeg", images);
    expect(images[imageId]).toMatchObject({
      format: "jpeg",
      widthPx: JPEG_WIDTH,
      heightPx: JPEG_HEIGHT,
    });
  });

  it("decodes real PNG dimensions via decodePng for format 'png'", () => {
    const images: Record<string, LayoutImageAsset> = {};
    const imageId = registerImageBytes(PNG_BYTES, "png", images);
    expect(images[imageId]).toMatchObject({
      format: "png",
      widthPx: 2,
      heightPx: 2,
    });
  });

  it("does not re-decode or overwrite an already-registered image id", () => {
    const images: Record<string, LayoutImageAsset> = {};
    const imageId = registerImageBytes(PNG_BYTES, "png", images);
    // A sentinel value decodeImageDimensions could never itself produce -- if the "already registered" guard were skipped, the second call would overwrite it with the real decode.
    const sentinel: LayoutImageAsset = {
      format: "png",
      base64: "sentinel",
      widthPx: -1,
      heightPx: -1,
    };
    images[imageId] = sentinel;
    const secondId = registerImageBytes(PNG_BYTES, "png", images);
    expect(secondId).toBe(imageId);
    expect(images[imageId]).toBe(sentinel);
  });
});
