import { encodePng } from "byte-codec";
import { describe, expect, it } from "vitest";
import { type PptRecord, readRecordAt } from "../record/tree";
import {
  OfficeArtBStoreContainer,
  OfficeArtBlipJPEG,
  OfficeArtBlipPNG,
  OfficeArtDggContainer,
  OfficeArtFBSE,
  RT_Document,
  RT_DrawingGroup,
} from "../record/types";
import {
  concatBytes,
  u16le,
  u32le,
  u8,
  writeAtom as atom,
  writeContainer as container,
} from "../record/write";
import {
  blipForPib,
  readBlipStore,
  writeDrawingGroupContainer,
  type PptBlip,
} from "./blips";

// The blip store, tested against bytes hand-assembled from [MS-ODRAW]'s own field tables the same way every read-path fixture in this package is. A real 1x1 PNG (byte-codec's own encoder) and a tiny JPEG-correct magic prefix stand in for picture files: the reader takes the format from the FBSE's and blip's own record types, never from the payload's bytes, so the payload's only obligation is determinism.

const ZERO_DIGEST = new Uint8Array(16);

function pngBytes(): Uint8Array<ArrayBuffer> {
  return encodePng({
    width: 1,
    height: 1,
    // One white pixel: RGB, 3 bytes per pixel.
    channels: 3,
    data: new Uint8Array([0xff, 0xff, 0xff]),
  });
}

function jpegBytes(): Uint8Array<ArrayBuffer> {
  // A JPEG's own two-byte SOI marker as the payload -- enough to be an honest fixture (the reader never decodes it) without importing a JPEG encoder this package has no other use for.
  return new Uint8Array([0xff, 0xd8]);
}

// OfficeArtBlipPNG 2.2.28, recInstance 0x6E0 (one uid): rgbUid1, tag, then the file bytes.
function pngBlip(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  return atom(OfficeArtBlipPNG, concatBytes(ZERO_DIGEST, u8(0xff), bytes), {
    recInstance: 0x6e0,
  });
}

// OfficeArtBlipJPEG 2.2.27, recInstance 0x46A (RGB, one uid): rgbUid1, tag, then the file bytes.
function jpegBlip(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  return atom(OfficeArtBlipJPEG, concatBytes(ZERO_DIGEST, u8(0xff), bytes), {
    recInstance: 0x46a,
  });
}

// OfficeArtFBSE 2.2.32: the 36-byte fixed head (btWin32, btMacOS, rgbUid, tag, size, cRef, foDelay, three unused bytes, cbName), then the optional name, then the embedded blip. FoDelay 0 means the embedded blip is the payload; 0xFFFFFFFF means no delay-stream entry at all.
function fbse(options: {
  readonly blipType: number;
  readonly embedded: Uint8Array<ArrayBuffer> | undefined;
  readonly cRef?: number;
  readonly foDelay?: number;
}): Uint8Array<ArrayBuffer> {
  const { blipType, embedded } = options;
  const cRef = options.cRef ?? 1;
  const foDelay = options.foDelay ?? 0;
  return atom(
    OfficeArtFBSE,
    concatBytes(
      u8(blipType),
      u8(blipType),
      ZERO_DIGEST,
      u16le(0xff),
      u32le(embedded?.length ?? 0),
      u32le(cRef),
      u32le(foDelay),
      u8(0),
      u8(0),
      u8(0),
      u8(0),
      ...(embedded === undefined ? [] : [embedded]),
    ),
    { recVer: 0x2, recInstance: blipType },
  );
}

function documentWithStore(
  ...fbseRecords: readonly Uint8Array<ArrayBuffer>[]
): PptRecord {
  const document = container(RT_Document, [
    container(RT_DrawingGroup, [
      container(OfficeArtDggContainer, [
        container(OfficeArtBStoreContainer, fbseRecords),
      ]),
    ]),
  ]);
  return readRecordAt(document, 0);
}

describe("readBlipStore", () => {
  it("reads embedded PNG and JPEG blips as a pib-indexed list", () => {
    const png = pngBytes();
    const store = readBlipStore(
      documentWithStore(
        fbse({ blipType: 0x06, embedded: pngBlip(png) }),
        fbse({ blipType: 0x05, embedded: jpegBlip(jpegBytes()) }),
      ),
      undefined,
    );
    expect(store).toHaveLength(2);
    expect(store[0]).toEqual({ format: "png", bytes: png });
    expect(store[1]).toEqual({ format: "jpeg", bytes: jpegBytes() });
  });

  it("resolves a delay-stream blip through the Pictures stream at foDelay", () => {
    const png = pngBytes();
    const blip = pngBlip(png);
    // The delay stream holds one padding record ahead of the blip so the offset genuinely matters.
    const padding = jpegBlip(jpegBytes());
    const picturesStream = concatBytes(padding, blip);
    const store = readBlipStore(
      documentWithStore(
        fbse({ blipType: 0x06, embedded: undefined, foDelay: padding.length }),
      ),
      picturesStream,
    );
    expect(store).toEqual([{ format: "png", bytes: png }]);
  });

  it("skips an empty slot (cRef 0) and an unsupported blip format without shifting the index", () => {
    // msoblipWMF (0x03) as an embedded blip: a metafile this package decodes none of, carried in an FBSE whose declared type matches.
    const wmfPayload = new Uint8Array([0x01, 0x00, 0x00, 0x00]);
    const wmfBlip = atom(
      0xf01b,
      concatBytes(ZERO_DIGEST, u8(0xff), wmfPayload),
      {
        recInstance: 0x217,
      },
    );
    const png = pngBytes();
    const store = readBlipStore(
      documentWithStore(
        fbse({ blipType: 0x06, embedded: pngBlip(png) }),
        fbse({
          blipType: 0x03,
          embedded: wmfBlip,
          cRef: 0,
          foDelay: 0xffffffff,
        }),
        fbse({ blipType: 0x05, embedded: jpegBlip(jpegBytes()) }),
      ),
      undefined,
    );
    // The empty WMF slot contributes nothing, and the JPEG after it stays the store's second entry -- pib 2.
    expect(store).toHaveLength(2);
    expect(store[0]?.format).toBe("png");
    expect(store[1]?.format).toBe("jpeg");
  });

  it("reads an absent store as empty rather than failing", () => {
    const empty = container(RT_Document, []);
    expect(readBlipStore(readRecordAt(empty, 0), undefined)).toEqual([]);
  });

  it("leaves a delay-stream blip unread when no Pictures stream was supplied", () => {
    const store = readBlipStore(
      documentWithStore(
        fbse({ blipType: 0x06, embedded: undefined, foDelay: 8 }),
      ),
      undefined,
    );
    expect(store).toEqual([]);
  });

  it("skips a cRef-0 empty slot even when its foDelay names a real Pictures-stream offset", () => {
    // cRef 0 and foDelay FO_DELAY_NONE are two independent reasons a slot contributes nothing -- this proves cRef alone is enough, distinctly from the combined case above.
    const store = readBlipStore(
      documentWithStore(
        fbse({ blipType: 0x06, embedded: undefined, cRef: 0, foDelay: 0 }),
      ),
      pngBlip(pngBytes()),
    );
    expect(store).toEqual([]);
  });

  it("skips a delay-stream FBSE stating FO_DELAY_NONE even when its cRef is nonzero", () => {
    const store = readBlipStore(
      documentWithStore(
        fbse({
          blipType: 0x06,
          embedded: undefined,
          cRef: 1,
          foDelay: 0xffffffff,
        }),
      ),
      pngBlip(pngBytes()),
    );
    expect(store).toEqual([]);
  });

  it("reads a bare blip record with no FBSE wrapper at all, the spelling the container permits", () => {
    const png = pngBytes();
    const document = container(RT_Document, [
      container(RT_DrawingGroup, [
        container(OfficeArtDggContainer, [
          container(OfficeArtBStoreContainer, [pngBlip(png)]),
        ]),
      ]),
    ]);
    expect(readBlipStore(readRecordAt(document, 0), undefined)).toEqual([
      { format: "png", bytes: png },
    ]);
  });

  it("rejects a blip record too short for its own uid(s) and tag", () => {
    const truncated = atom(
      OfficeArtBlipPNG,
      concatBytes(ZERO_DIGEST, u8(0xff)).subarray(0, 10),
      { recInstance: 0x6e0 },
    );
    expect(() =>
      readBlipStore(
        documentWithStore(fbse({ blipType: 0x06, embedded: truncated })),
        undefined,
      ),
    ).toThrow(
      "a blip record of type 0xf01e declares 6e0 as its instance (so 1 digest(s)) but carries only 10 bytes",
    );
  });
});

describe("blipForPib", () => {
  it("resolves pib 1 to the first store entry and treats 0 as the format's own ignored value", () => {
    const blips: readonly PptBlip[] = [
      { format: "png", bytes: pngBytes() },
      { format: "jpeg", bytes: jpegBytes() },
    ];
    expect(blipForPib(blips, 1)?.format).toBe("png");
    expect(blipForPib(blips, 2)?.format).toBe("jpeg");
    expect(blipForPib(blips, 0)).toBeUndefined();
    expect(blipForPib(blips, 3)).toBeUndefined();
  });
});

describe("writeDrawingGroupContainer / readBlipStore round trip", () => {
  it("round-trips every blip through the writer's own bytes", () => {
    const blips: readonly PptBlip[] = [
      { format: "png", bytes: pngBytes() },
      { format: "jpeg", bytes: jpegBytes() },
    ];
    const drawingGroup = writeDrawingGroupContainer(blips, {
      spidMax: 4,
      shapeCount: 3,
      drawingCount: 2,
    });
    const document = container(RT_Document, [drawingGroup]);
    expect(readBlipStore(readRecordAt(document, 0), undefined)).toEqual(blips);
  });

  it("writes no blip store at all for a picture-free document", () => {
    const drawingGroup = writeDrawingGroupContainer([], {
      spidMax: 2,
      shapeCount: 1,
      drawingCount: 1,
    });
    const document = container(RT_Document, [drawingGroup]);
    expect(readBlipStore(readRecordAt(document, 0), undefined)).toEqual([]);
  });
});
