import { describe, expect, it } from "vitest";
import { readDocContent } from "./read";
import { buildDoc, buildInlinePictureBytes } from "./test-support/doc";
import { INLINE_PICTURE } from "./text/special";

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
