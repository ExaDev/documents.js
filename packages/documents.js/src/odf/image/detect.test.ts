import type { Package } from "odf.js";
import { bytesToBase64, el } from "odf.js";
import { encodePng } from "byte-codec";
import { describe, expect, it } from "vitest";
import { collectImageFrames } from "./detect";

// A genuine, decodable 2x2 PNG (not just a bare magic-number stub) -- mirrors src/test-support/odp.ts's own tinyPngBase64 reasoning: readDrawImageBlock sniffs the actual bytes and returns undefined for anything it cannot recognise as a real image format.
function tinyPngBase64(): string {
  return bytesToBase64(
    encodePng({
      width: 2,
      height: 2,
      channels: 3,
      data: new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]),
    }),
  );
}

function packageWithImage(): Package {
  return {
    parts: {
      "Pictures/image1.png": { kind: "binary", base64: tinyPngBase64() },
    },
  };
}

describe("collectImageFrames", () => {
  it("recovers an as-char anchored draw:frame>draw:image as a ContentImageBlock, with a zero-origin frame", () => {
    const pkg = packageWithImage();
    const frame = el(
      "draw:frame",
      {
        "text:anchor-type": "as-char",
        "svg:width": "100pt",
        "svg:height": "50pt",
      },
      [el("draw:image", { "xlink:href": "Pictures/image1.png" })],
    );

    const [detected] = collectImageFrames([frame], pkg);
    expect(detected).toBeDefined();
    expect(detected!.frameElement).toBe(frame);
    expect(detected!.image).toMatchObject({
      kind: "image",
      format: "png",
      widthPt: 100,
      heightPt: 50,
    });
    // A flow-anchored frame (no svg:x/y) resolves via flowAnchoredFrameBox's own zero origin, which is exactly what readDrawImageBlock's own widthPt/heightPt (above) were resolved against.
  });

  it("recovers a frame nested inside a draw:text-box, deep inside a paragraph", () => {
    const pkg = packageWithImage();
    const imageFrame = el(
      "draw:frame",
      {
        "text:anchor-type": "as-char",
        "svg:width": "100pt",
        "svg:height": "50pt",
      },
      [el("draw:image", { "xlink:href": "Pictures/image1.png" })],
    );
    const textBoxFrame = el(
      "draw:frame",
      {
        "svg:x": "10pt",
        "svg:y": "10pt",
        "svg:width": "200pt",
        "svg:height": "100pt",
      },
      [el("draw:text-box", {}, [el("text:p", {}, [imageFrame])])],
    );

    const detected = collectImageFrames([textBoxFrame], pkg);
    expect(detected).toHaveLength(1);
    expect(detected[0]!.frameElement).toBe(imageFrame);
    expect(detected[0]!.image).toMatchObject({
      kind: "image",
      format: "png",
      widthPt: 100,
      heightPt: 50,
    });
  });

  it("never treats a formula frame's own sibling preview draw:image as a real image", () => {
    const pkg: Package = {
      parts: {
        "Pictures/image1.png": { kind: "binary", base64: tinyPngBase64() },
      },
    };
    // A real formula/embedded-object frame: draw:object plus its own GDI-metafile preview bitmap as a bare sibling draw:image -- never wrapped in a draw:frame of its own, exactly the shape a real ODF producer writes.
    const formulaFrame = el(
      "draw:frame",
      { "svg:width": "30pt", "svg:height": "20pt" },
      [
        el("draw:object", { "xlink:href": "./Object 1" }),
        el("draw:image", { "xlink:href": "Pictures/image1.png" }),
      ],
    );

    expect(collectImageFrames([formulaFrame], pkg)).toEqual([]);
  });

  it("recovers a real image frame sitting alongside an unrelated formula frame, without conflating the two", () => {
    const pkg: Package = {
      parts: {
        "Pictures/image1.png": { kind: "binary", base64: tinyPngBase64() },
      },
    };
    const formulaFrame = el(
      "draw:frame",
      { "svg:width": "30pt", "svg:height": "20pt" },
      [
        el("draw:object", { "xlink:href": "./Object 1" }),
        el("draw:image", { "xlink:href": "Pictures/image1.png" }),
      ],
    );
    const realImageFrame = el(
      "draw:frame",
      {
        "text:anchor-type": "as-char",
        "svg:width": "100pt",
        "svg:height": "50pt",
      },
      [el("draw:image", { "xlink:href": "Pictures/image1.png" })],
    );

    const detected = collectImageFrames([formulaFrame, realImageFrame], pkg);
    expect(detected).toHaveLength(1);
    expect(detected[0]!.frameElement).toBe(realImageFrame);
  });

  it("returns nothing for a package whose referenced part is not a recognisable image", () => {
    const pkg: Package = {
      parts: {
        "Pictures/image1.png": {
          kind: "binary",
          base64: bytesToBase64(new Uint8Array([1, 2, 3, 4])),
        },
      },
    };
    const frame = el(
      "draw:frame",
      {
        "text:anchor-type": "as-char",
        "svg:width": "100pt",
        "svg:height": "50pt",
      },
      [el("draw:image", { "xlink:href": "Pictures/image1.png" })],
    );
    expect(collectImageFrames([frame], pkg)).toEqual([]);
  });
});
