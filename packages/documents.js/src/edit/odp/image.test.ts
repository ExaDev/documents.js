import { describe, expect, it } from "vitest";
import { createEmptyOdpPackage } from "./scaffold";
import { insertImageFrameMedia } from "./image";
import { OdpShape } from "./shape";

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4,
]);

describe("insertImageFrameMedia", () => {
  it("adds a Pictures/ media part and returns a draw:frame referencing it at the given frame", () => {
    const pkg = createEmptyOdpPackage();
    const frame = { xPt: 0, yPt: 0, widthPt: 50, heightPt: 50 };
    const frameElement = insertImageFrameMedia({ pkg }, frame, {
      format: "png",
      bytes: PNG_BYTES,
    });
    const shape = new OdpShape([frameElement], frameElement, pkg);
    expect(shape.frame).toEqual(frame);

    const mediaParts = Object.keys(pkg.parts).filter((p) =>
      p.startsWith("Pictures/"),
    );
    expect(mediaParts).toHaveLength(1);
    const image = frameElement.children.find(
      (c) => c.type === "element" && c.tag === "draw:image",
    );
    expect(
      image?.type === "element" ? image.attributes : undefined,
    ).toContainEqual({ name: "xlink:href", value: mediaParts[0] });
  });

  it("adding two images allocates distinct Pictures/ part paths", () => {
    const pkg = createEmptyOdpPackage();
    insertImageFrameMedia(
      { pkg },
      { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
      { format: "png", bytes: PNG_BYTES },
    );
    insertImageFrameMedia(
      { pkg },
      { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
      { format: "png", bytes: PNG_BYTES },
    );
    const mediaParts = Object.keys(pkg.parts).filter((p) =>
      p.startsWith("Pictures/"),
    );
    expect(mediaParts).toHaveLength(2);
    expect(new Set(mediaParts).size).toBe(2);
  });
});
