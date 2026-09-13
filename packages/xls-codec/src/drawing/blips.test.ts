import { afterEach, describe, expect, it, vi } from "vitest";

import { BlockCursor } from "../biff/cursor";
import { u32 } from "../test-support/biff";
import { readBlipStore } from "./blips";
import {
  bseEntry,
  embeddedBlip,
  escherAtom,
  escherContainer,
} from "../test-support/escher";
import { ESCHER_BLIP_JPEG_B, ESCHER_DGG_CONTAINER } from "./escher-constants";

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

  it("finds the drawing-group container by kind and recType together, skipping a container of the wrong recType and an atom carrying the right recType", () => {
    const wrongRecTypeContainer = escherContainer(0xf001, 0, []); // a real container, but not the DGG container
    const wrongKindAtom = escherAtom(ESCHER_DGG_CONTAINER, 0, []); // the right recType, but not a container at all
    const realDgg = escherContainer(ESCHER_DGG_CONTAINER, 0, [
      escherContainer(0xf001, 0, [
        escherAtom(0xf007, 0, bseEntry(embeddedBlip(0xf01e, 0x6e0, PNG_BYTES))),
      ]),
    ]);
    const bytes = new Uint8Array([
      ...wrongRecTypeContainer,
      ...wrongKindAtom,
      ...realDgg,
    ]);

    expect(readBlipStore(bytes).get(1)?.format).toBe("png");
  });

  it("skips every decoy root that is a container OR has the right recType but not both", () => {
    // If the dgg-container predicate ever collapsed its own `kind === "container" && recType === DGG` into an OR, either decoy below would be mistaken for the real dgg container -- both come first, so a wrongly-permissive predicate would pick one of them and never reach the real one that actually holds the image.
    const decoyContainer = escherContainer(0x1234, 0, []);
    const decoyAtom = escherAtom(ESCHER_DGG_CONTAINER, 0, []);
    const realDgg = escherContainer(ESCHER_DGG_CONTAINER, 0, [
      escherContainer(0xf001, 0, [
        escherAtom(0xf007, 0, bseEntry(embeddedBlip(0xf01e, 0x6e0, PNG_BYTES))),
      ]),
    ]);
    const bytes = new Uint8Array([...decoyContainer, ...decoyAtom, ...realDgg]);

    expect(readBlipStore(bytes).get(1)?.format).toBe("png");
  });

  describe("errors that are not malformed-record degrades", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("propagates a genuine bug reading a BSE entry's own fixed fields rather than absorbing it as a malformed record", () => {
      const bug = new TypeError("a genuine bug, not a malformed record");
      vi.spyOn(BlockCursor.prototype, "u8").mockImplementation(() => {
        throw bug;
      });
      const bytes = drawingGroupBytes([bseEntry([])]);

      expect(() => readBlipStore(bytes)).toThrow(bug);
    });
  });

  it("returns no image for a BSE entry too short to even reach cbName, rather than reading past the end", () => {
    const tooShort = new Array<number>(10).fill(0); // well short of BSE_FIXED_SIZE (36), and short of the 33 bytes preceding cbName
    const bytes = drawingGroupBytes([tooShort]);

    expect(readBlipStore(bytes).size).toBe(0);
  });

  it("skips exactly cbName's own nameData bytes before the embedded blip, distinguishing that skip from every other one", () => {
    // Every fixed field before cbName carries its own distinct, nonzero marker byte(s): dropping any single one of the reader's cursor.skip calls shifts every later read, so cbName -- and therefore where the embedded blip actually starts -- would be read from the wrong offset and fail to decode as the real PNG below.
    const embedded = embeddedBlip(0xf01e, 0x6e0, PNG_BYTES);
    const nameData = [0xa1, 0xa2, 0xa3, 0xa4, 0xa5];
    const bse = [
      0x11, // btWin32
      0x22, // btMacOS
      ...Array.from({ length: 16 }, (_, index) => 0x30 + index), // rgbUid
      0x40,
      0x41, // tag
      ...u32(0x50515253), // size
      ...u32(0x60616263), // cRef
      ...u32(0x70717273), // foDelay
      0x80, // unused1
      nameData.length, // cbName
      0x90, // unused2
      0x91, // unused3
      ...nameData,
      ...embedded,
    ];
    const store = readBlipStore(drawingGroupBytes([bse]));

    const image = store.get(1);
    expect(image?.format).toBe("png");
    expect(image === undefined ? undefined : atob(image.base64)).toBe(
      String.fromCharCode(...PNG_BYTES),
    );
  });

  it("resolves a JPEG blip carrying the JPEG_B recType, not just JPEG_A", () => {
    const blip = embeddedBlip(
      ESCHER_BLIP_JPEG_B,
      0x46a,
      [0xff, 0xd8, 0xff, 0xd9],
    );
    const store = readBlipStore(drawingGroupBytes([bseEntry(blip)]));

    expect(store.get(1)?.format).toBe("jpeg");
  });

  it("resolves no format for a recType that is neither PNG nor JPEG, even when its recInstance matches a valid JPEG UID count", () => {
    const blip = embeddedBlip(0x9999, 0x46a, [0xff, 0xd8, 0xff, 0xd9]);
    const store = readBlipStore(drawingGroupBytes([bseEntry(blip)]));

    expect(store.has(1)).toBe(false);
  });

  it("resolves no image for a blip record shorter than its own UID-plus-tag header", () => {
    // recInstance 0x6e0 needs a 16-byte rgbUid plus a 1-byte tag (17 bytes) before any file bytes at all.
    const blip = escherAtom(0xf01e, 0x6e0, new Array<number>(16).fill(0));
    const store = readBlipStore(drawingGroupBytes([bseEntry(blip)]));

    expect(store.has(1)).toBe(false);
  });

  it("still resolves an (empty) image at exactly the UID-plus-tag boundary, one byte above where it's refused", () => {
    // Exactly 16 bytes of rgbUid plus the 1-byte tag, with no file bytes at all -- the boundary a `<` vs `<=` mutation on the header-size check would disagree about.
    const blip = escherAtom(0xf01e, 0x6e0, new Array<number>(17).fill(0));
    const store = readBlipStore(drawingGroupBytes([bseEntry(blip)]));

    const image = store.get(1);
    expect(image?.format).toBe("png");
    expect(image === undefined ? undefined : atob(image.base64)).toBe("");
  });

  it("round-trips file bytes spanning several 0x8000-byte base64 chunks intact", () => {
    // Three full chunks' worth of a distinct, non-repeating byte pattern: a chunk boundary computed with the wrong arithmetic (an added instead of multiplied offset) or joined with a non-empty separator would corrupt or duplicate bytes right at a chunk seam, which a single-chunk fixture could never expose.
    const fileBytes = Array.from(
      { length: 0x8000 * 2 + 500 },
      (_, index) => index % 256,
    );
    const blip = embeddedBlip(0xf01e, 0x6e0, fileBytes);
    const store = readBlipStore(drawingGroupBytes([bseEntry(blip)]));

    const image = store.get(1);
    expect(image?.format).toBe("png");
    const decoded =
      image === undefined
        ? undefined
        : Array.from(atob(image.base64), (char) => char.charCodeAt(0));
    expect(decoded).toStrictEqual(fileBytes);
  });
});
