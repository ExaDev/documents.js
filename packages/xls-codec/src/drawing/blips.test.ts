import { describe, expect, it } from "vitest";

import { readBlipStore } from "./blips";
import {
  bseEntry,
  embeddedBlip,
  escherAtom,
  escherContainer,
} from "../test-support/escher";

// A minimal but genuinely valid 1x1 PNG (a real signature, IHDR, IDAT, IEND chain) -- readBlipStore's own job is locating and slicing these bytes out of the surrounding Escher/BSE framing, not validating PNG structure, so a real image is what proves the slicing lands on the right byte offset rather than off by the header size.
const PNG_BYTES = [
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02,
  0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44,
  0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00, 0x00, 0x03, 0x01, 0x01,
  0x00, 0x18, 0xdd, 0x8d, 0xb0, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
  0xae, 0x42, 0x60, 0x82,
];

function drawingGroupBytes(
  bseEntries: readonly (readonly number[])[],
): Uint8Array<ArrayBuffer> {
  return new Uint8Array(
    escherContainer(0xf000, 0, [
      escherContainer(
        0xf001,
        0,
        bseEntries.map((entry) => escherAtom(0xf007, 0, entry)),
      ),
    ]),
  );
}

describe("readBlipStore", () => {
  it("resolves a PNG BSE entry to its own literal file bytes, 1-based", () => {
    const blip = embeddedBlip(0xf01e, 0x6e0, PNG_BYTES);
    const store = readBlipStore(drawingGroupBytes([bseEntry(blip)]));

    const image = store.get(1);
    expect(image?.format).toBe("png");
    expect(image === undefined ? undefined : atob(image.base64)).toBe(
      String.fromCharCode(...PNG_BYTES),
    );
  });

  it("resolves a JPEG BSE entry by its own recType", () => {
    const jpegBytes = [0xff, 0xd8, 0xff, 0xd9];
    const blip = embeddedBlip(0xf01d, 0x46a, jpegBytes);
    const store = readBlipStore(drawingGroupBytes([bseEntry(blip)]));

    expect(store.get(1)?.format).toBe("jpeg");
  });

  it("indexes multiple BSE entries in document order, 1-based", () => {
    const first = embeddedBlip(0xf01e, 0x6e0, PNG_BYTES);
    const second = embeddedBlip(0xf01d, 0x46a, [0xff, 0xd8]);
    const store = readBlipStore(
      drawingGroupBytes([bseEntry(first), bseEntry(second)]),
    );

    expect(store.get(1)?.format).toBe("png");
    expect(store.get(2)?.format).toBe("jpeg");
  });

  it("resolves a two-UID PNG blip, skipping the second rgbUid before the file bytes", () => {
    // recInstance 0x6e1 is PNG with TWO rgbUid fields ahead of the tag byte, unlike embeddedBlip's own single-UID shape (0x6e0), built directly here rather than through that helper.
    const blip = escherAtom(0xf01e, 0x6e1, [
      ...new Array<number>(16).fill(0), // rgbUid1
      ...new Array<number>(16).fill(0), // rgbUid2
      0xff, // tag
      ...PNG_BYTES,
    ]);
    const store = readBlipStore(drawingGroupBytes([bseEntry(blip)]));

    const image = store.get(1);
    expect(image?.format).toBe("png");
    expect(image === undefined ? undefined : atob(image.base64)).toBe(
      String.fromCharCode(...PNG_BYTES),
    );
  });

  it("recognises but does not materialise a DIB blip, which has no lossless target in ContentImageBlockSchema", () => {
    const blip = embeddedBlip(0xf01f, 0x7a8, [0, 1, 2, 3]);
    const store = readBlipStore(drawingGroupBytes([bseEntry(blip)]));

    expect(store.has(1)).toBe(false);
  });

  it("returns an empty store for an empty drawing group", () => {
    expect(readBlipStore(new Uint8Array()).size).toBe(0);
  });

  it("returns an empty store when the drawing group carries no Blip Store", () => {
    const bytes = new Uint8Array(escherContainer(0xf000, 0, []));
    expect(readBlipStore(bytes).size).toBe(0);
  });

  it("skips a BSE entry with no embedded blip (an externally-linked reference)", () => {
    const store = readBlipStore(drawingGroupBytes([bseEntry([])]));
    expect(store.size).toBe(0);
  });
});
