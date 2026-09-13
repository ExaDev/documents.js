import { describe, expect, it } from "vitest";
import { readDocContent } from "./read";
import { readInlinePicture, skipPicName } from "./pictures";
import { buildDoc, buildInlinePictureBytes } from "./test-support/doc";
import { INLINE_PICTURE } from "./text/special";

/** One OfficeArt record header ([MS-ODRAW] 2.2.1's own recVer/recInstance/recType/recLen, RECORD_HEADER_SIZE(8) bytes). */
function recordHeader(
  recType: number,
  recInstance: number,
  recLen: number,
): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(8);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, recInstance << 4, true);
  view.setUint16(2, recType, true);
  view.setUint32(4, recLen, true);
  return bytes;
}

// One PICFAndOfficeArtData whose PICF states MFPF.mm as MM_SHAPEFILE (0x0066), the one case [MS-DOC] 2.9.181 gives PICF an extra cchPicName/stPicName pair (the source file's own name) before the OfficeArt container chain begins -- buildInlinePictureBytes' own fixture always states plain MM_SHAPE (0x0064) instead, so this is the only construction that exercises readInlinePicture's own cchPicName skip at all.
function shapefilePictureBytes(pngBytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const picName = new Uint8Array([0x41, 0x42, 0x43]); // "ABC" -- content is never read, only its own length skipped.
  const picf = new Uint8Array(68);
  new DataView(picf.buffer).setUint16(6, 0x0066, true); // mfpf.mm: MM_SHAPEFILE.

  const shapeHeader = recordHeader(0xf004, 0, 0);
  const uid = new Uint8Array(16);
  const blipHeader = recordHeader(
    0xf01e,
    0x06e0,
    uid.length + 1 + pngBytes.length,
  );

  const out = new Uint8Array(
    picf.length +
      1 +
      picName.length +
      shapeHeader.length +
      blipHeader.length +
      uid.length +
      1 +
      pngBytes.length,
  );
  let cursor = 0;
  out.set(picf, cursor);
  cursor += picf.length;
  out[cursor] = picName.length; // cchPicName.
  cursor += 1;
  out.set(picName, cursor); // stPicName -- never read, only skipped past.
  cursor += picName.length;
  out.set(shapeHeader, cursor);
  cursor += shapeHeader.length;
  out.set(blipHeader, cursor);
  cursor += blipHeader.length;
  cursor += uid.length; // rgbUid: left zero.
  cursor += 1; // tag byte: left zero.
  out.set(pngBytes, cursor);
  return out;
}

// Real MS-DOC producers always wrap even a plain bitmap in an OfficeArtInlineSpContainer ([MS-ODRAW] 2.2.15) regardless of PICF.mfpf.mm's own value, so these fixtures build one directly (buildInlinePictureBytes) rather than a bare PICF -- the same shape a real Word/LibreOffice-authored inline picture actually uses.

describe("readDocContent inline pictures", () => {
  it("reads an inline picture's own PNG bytes and its size from PICMID's dxaGoal/dyaGoal", () => {
    // Signature-led, as every real PNG blip's payload begins ([MS-ODRAW]'s OfficeArtBlipPNG carries raw file bytes); the reader validates the signature when locating the blip.
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5]);
    const picLocation = 0x40;
    const { dataStreamBytes, picLocationGrpprl } = buildInlinePictureBytes(
      picLocation,
      pngBytes,
      1440, // 72pt.
      720, // 36pt.
    );
    const document = readDocContent(
      buildDoc({
        paragraphs: [
          {
            runs: [
              {
                text: String.fromCharCode(INLINE_PICTURE),
                grpprl: picLocationGrpprl,
              },
            ],
          },
        ],
        data: dataStreamBytes,
      }),
    );
    if (document.kind !== "wordprocessing") {
      throw new Error("a .doc always reads as a wordprocessing document");
    }
    const block = document.sections[0]?.blocks[0];
    if (block?.kind !== "image") {
      throw new Error(`expected an image block, got '${block?.kind}'`);
    }
    expect(block.format).toBe("png");
    expect(
      Array.from(atob(block.base64), (char) => char.charCodeAt(0)),
    ).toEqual(Array.from(pngBytes));
    expect(block.widthPt).toBe(72);
    expect(block.heightPt).toBe(36);
  });

  it("splits a paragraph carrying real text around an inline picture into separate blocks", () => {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9, 9, 9]);
    const picLocation = 0x40;
    const { dataStreamBytes, picLocationGrpprl } = buildInlinePictureBytes(
      picLocation,
      pngBytes,
      100,
      100,
    );
    const document = readDocContent(
      buildDoc({
        paragraphs: [
          {
            runs: [
              { text: "before " },
              {
                text: String.fromCharCode(INLINE_PICTURE),
                grpprl: picLocationGrpprl,
              },
              { text: " after" },
            ],
          },
        ],
        data: dataStreamBytes,
      }),
    );
    if (document.kind !== "wordprocessing") {
      throw new Error("a .doc always reads as a wordprocessing document");
    }
    const blocks = document.sections[0]?.blocks ?? [];
    expect(blocks.map((block) => block.kind)).toEqual([
      "paragraph",
      "image",
      "paragraph",
    ]);
    const [before, , after] = blocks;
    if (before?.kind !== "paragraph" || after?.kind !== "paragraph") {
      throw new Error("expected paragraphs either side of the image");
    }
    expect(before.runs.map((run) => run.text)).toEqual(["before "]);
    expect(after.runs.map((run) => run.text)).toEqual([" after"]);
  });

  it("drops a picture anchor to an empty paragraph when the blip's own payload does not start with its format's own file signature", () => {
    // A well-formed OfficeArtBlipPNG header, but the payload bytes it wraps do not actually start with the PNG signature -- a genuine wrapper-byte false positive this reader's own signature check exists to refuse (see this module's own top-of-file locating note).
    const notReallyPng = new Uint8Array([1, 2, 3, 4, 5]);
    const picLocation = 0x40;
    const { dataStreamBytes, picLocationGrpprl } = buildInlinePictureBytes(
      picLocation,
      notReallyPng,
      100,
      100,
    );
    const document = readDocContent(
      buildDoc({
        paragraphs: [
          {
            runs: [
              {
                text: String.fromCharCode(INLINE_PICTURE),
                grpprl: picLocationGrpprl,
              },
            ],
          },
        ],
        data: dataStreamBytes,
      }),
    );
    if (document.kind !== "wordprocessing") {
      throw new Error("a .doc always reads as a wordprocessing document");
    }
    const blocks = document.sections[0]?.blocks ?? [];
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe("paragraph");
  });

  it("drops a picture anchor to an empty paragraph, exactly as before, when the container carries no Data stream", () => {
    const document = readDocContent(
      buildDoc({
        paragraphs: [
          {
            runs: [
              {
                text: String.fromCharCode(INLINE_PICTURE),
                grpprl: [0x03, 0x6a, 0, 0, 0, 0],
              },
            ],
          },
        ],
      }),
    );
    if (document.kind !== "wordprocessing") {
      throw new Error("a .doc always reads as a wordprocessing document");
    }
    const blocks = document.sections[0]?.blocks ?? [];
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe("paragraph");
    if (blocks[0]?.kind === "paragraph") {
      expect(blocks[0].runs).toEqual([]);
    }
  });
});

describe("readInlinePicture with MM_SHAPEFILE's own cchPicName/stPicName pair", () => {
  it("round-trips a picture whose PICF carries a source file name before the OfficeArt chain", () => {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 7, 7, 7]);
    const data = shapefilePictureBytes(pngBytes);
    const picture = readInlinePicture(data, 0);
    expect(picture?.format).toBe("png");
    expect(
      Array.from(atob(picture?.base64 ?? ""), (char) => char.charCodeAt(0)),
    ).toEqual(Array.from(pngBytes));
  });
});

describe("readInlinePicture's own bounds labels", () => {
  it("names 'PICF in the Data stream' when picLocation runs past the Data stream's own end", () => {
    expect(() => readInlinePicture(new Uint8Array(10), 0)).toThrow(
      /PICF in the Data stream/,
    );
  });

  it("skips a candidate blip whose own declared recLen is too small to cover even uidBytes + the tag byte, rather than treating it as found", () => {
    // recLen one byte short of uidBytes(16) + BLIP_TAG_SIZE(1) = 17 -- a would-be blip whose signature bytes genuinely match, but whose own recLen cannot possibly be real. Bypassing this check would still "find" it, then throw computing a negative blipDataLength downstream; skipping it correctly instead just finds no valid blip at all.
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const data = shapefilePictureBytes(pngBytes);
    // The blip header's recLen sits 4 bytes into the header, itself 8 bytes past the shape-container header (recVer/recInstance(2) + recType(2) + recLen(4)) that immediately precedes it in shapefilePictureBytes' own layout.
    const blipHeaderOffset = 68 + 1 + 3 + 8; // PICF(68) + cchPicName(1) + "ABC"(3) + shapeHeader(8).
    new DataView(data.buffer).setUint32(blipHeaderOffset + 4, 16, true); // recLen 16, one short of uidBytes + BLIP_TAG_SIZE (17).
    expect(readInlinePicture(data, 0)).toBeUndefined();
  });

  it("also skips a candidate whose recLen lands exactly on uidBytes + the tag byte, leaving zero bytes for the payload itself", () => {
    // recLen exactly 17 (uidBytes(16) + BLIP_TAG_SIZE(1)) distinguishes the boundary's own > from a >=: real payload bytes with a genuine signature sit right where they always do, so only the recLen check itself, not a missing signature, can be what skips this candidate.
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const data = shapefilePictureBytes(pngBytes);
    const blipHeaderOffset = 68 + 1 + 3 + 8;
    new DataView(data.buffer).setUint32(blipHeaderOffset + 4, 17, true);
    expect(readInlinePicture(data, 0)).toBeUndefined();
  });

  it("names 'OfficeArtBlip file data in the Data stream' when the blip's own declared recLen runs past the Data stream", () => {
    // 4-byte PNG signature plus 10 bytes of padding: recLen (stated as uid + tag + pngBytes.length by shapefilePictureBytes) covers all 14, but truncating the Data stream by 5 bytes leaves only the signature itself intact -- enough for findBlipRecord's own signature check to still land on this blip, not enough for the full declared recLen the subsequent slice needs.
    const pngBytes = new Uint8Array([
      0x89,
      0x50,
      0x4e,
      0x47,
      ...new Array<number>(10).fill(0),
    ]);
    const data = shapefilePictureBytes(pngBytes);
    const truncated = new Uint8Array(data.subarray(0, data.length - 5));
    expect(() => readInlinePicture(truncated, 0)).toThrow(
      /OfficeArtBlip file data in the Data stream/,
    );
  });

  it("still finds a one-uid JPEG blip that consumes every one of the Data stream's own last bytes, with zero bytes to spare", () => {
    // The smallest a validated blip can ever be (ONE_UID_BYTES(16) + tag(1) + JPEG's own 2-byte signature = 19 bytes past the header), placed so the header itself starts at the very last position the scan's own bound admits -- distinguishes that bound's own <= from a <.
    const mm = 0x0064; // MM_SHAPE.
    const picf = new Uint8Array(68);
    new DataView(picf.buffer).setUint16(6, mm, true);
    const jpegBytes = new Uint8Array([0xff, 0xd8]); // JPEG's own signature, nothing past it.
    const header = recordHeader(0xf01d, 0x046a, 16 + 1 + jpegBytes.length);
    const uid = new Uint8Array(16);
    const tag = new Uint8Array(1);
    const data = new Uint8Array([
      ...picf,
      ...header,
      ...uid,
      ...tag,
      ...jpegBytes,
    ]);
    const picture = readInlinePicture(data, 0);
    expect(picture?.format).toBe("jpeg");
    expect(
      Array.from(atob(picture?.base64 ?? ""), (char) => char.charCodeAt(0)),
    ).toEqual(Array.from(jpegBytes));
  });

  it("skips a candidate whose recInstance names a real uid count but whose recType is not a blip, continuing on to the genuine one behind it", () => {
    // A shape-record-shaped header (not 0xf01d/0xf01e) that nonetheless carries a recognised one-uid recInstance and happens to have JPEG's own 2-byte signature sitting where its payload would start -- format is undefined for this header, so findBlipRecord's own format guard, not the recLen/signature check, is what has to skip it. Without that skip this bogus header would be returned as "found", and readInlinePicture's own format check on its bogus recType would then return undefined without ever reaching the real PNG right behind it.
    const mm = 0x0064; // MM_SHAPE.
    const picf = new Uint8Array(68);
    new DataView(picf.buffer).setUint16(6, mm, true);
    const bogusHeader = recordHeader(0xf000, 0x06e0, 30); // Not a blip recType, but recInstance 0x06e0 is a real one-uid value.
    const bogusUid = new Uint8Array(16);
    const bogusTag = new Uint8Array(1);
    const bogusPayload = new Uint8Array([0xff, 0xd8]); // JPEG's own signature, satisfied only if the format guard is bypassed.
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 5, 6, 7]);
    const realHeader = recordHeader(0xf01e, 0x06e0, 16 + 1 + pngBytes.length);
    const realUid = new Uint8Array(16);
    const realTag = new Uint8Array(1);
    const data = new Uint8Array([
      ...picf,
      ...bogusHeader,
      ...bogusUid,
      ...bogusTag,
      ...bogusPayload,
      ...realHeader,
      ...realUid,
      ...realTag,
      ...pngBytes,
    ]);
    const picture = readInlinePicture(data, 0);
    expect(picture?.format).toBe("png");
    expect(
      Array.from(atob(picture?.base64 ?? ""), (char) => char.charCodeAt(0)),
    ).toEqual(Array.from(pngBytes));
  });
});

describe("skipPicName", () => {
  const MM_SHAPE = 0x0064;
  const MM_SHAPEFILE = 0x0066;

  it("leaves the cursor exactly where it is for an ordinary MM_SHAPE picture", () => {
    expect(skipPicName(new Uint8Array(0), MM_SHAPE, 68)).toBe(68);
  });

  it("advances the cursor past exactly 1 + cchPicName bytes for MM_SHAPEFILE", () => {
    const dataStream = new Uint8Array([5, 0, 0, 0, 0, 0]); // cchPicName 5, then 5 filename bytes.
    expect(skipPicName(dataStream, MM_SHAPEFILE, 0)).toBe(1 + 5);
  });

  it("advances by exactly 1 byte when cchPicName is 0 (an empty file name)", () => {
    const dataStream = new Uint8Array([0]);
    expect(skipPicName(dataStream, MM_SHAPEFILE, 0)).toBe(1);
  });
});
