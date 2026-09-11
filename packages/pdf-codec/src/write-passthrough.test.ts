import { describe, expect, it } from "vitest";
import { decodePng } from "byte-codec";
import { base64ToBytes, bytesToBase64 } from "./util/base64";
import type { LayoutDocument, LayoutImageAsset } from "./layout";
import { LAYOUT_FORMAT_VERSION } from "./layout";
import { readImageXObject } from "./images-read";
import { readPdf } from "./read";
import { writePdf } from "./write";
import type { Jbig2Fixture } from "./test-support/jbig2";
import { JBIG2_FIXTURES, jbig2FixtureBytes } from "./test-support/jbig2";
import type { Jpeg2000Fixture } from "./test-support/jpeg2000";
import {
  JPEG2000_FIXTURES,
  jpeg2000FixtureBytes,
} from "./test-support/jpeg2000";
import type { PdfObject } from "./objects";
import { asDict, pdfDict, pdfName, pdfNum, pdfStream } from "./objects";

// The write side's verbatim passthrough of a no-encoder filter's original stream: an asset carrying `original` (which only the read side of a JBIG2/JPX source mints) must re-embed those bytes under their own filter rather than re-encoding the decoded pixels through Flate or Group 4, so a pdf-to-pdf round trip pays zero generation loss for exactly the two filters this package cannot re-encode. Each test builds the asset the way the reader really does -- through readImageXObject over the fixture, so the decoded canonical and the original come from one genuine extraction rather than a hand-assembled pair -- then writes, re-reads, and checks both halves: the written bytes carry the original stream (and the /JBIG2Globals object a symbol-dictionary stream needs), and the re-read image decodes back to the same pixels.

function emptySink(): void {
  // The fixtures decode cleanly; a diagnostic here is a test bug worth seeing as a failure.
}

function jbig2Asset(
  fixture: Jbig2Fixture,
  globalsObjNum?: number,
): { asset: LayoutImageAsset; pixels: Uint8Array } | undefined {
  const entries = new Map<string, PdfObject>([
    ["Type", pdfName("XObject")],
    ["Subtype", pdfName("Image")],
    ["Width", pdfNum(fixture.width)],
    ["Height", pdfNum(fixture.height)],
    ["ColorSpace", pdfName("DeviceGray")],
    ["BitsPerComponent", pdfNum(1)],
    ["Filter", pdfName("JBIG2Decode")],
  ]);
  if (globalsObjNum !== undefined) {
    entries.set(
      "DecodeParms",
      pdfDict({
        JBIG2Globals: {
          kind: "ref",
          num: globalsObjNum,
          gen: 0,
        } as PdfObject,
      }),
    );
  }
  const dict = pdfDict(entries);
  const globalsObjects =
    globalsObjNum !== undefined && fixture.globals !== undefined
      ? new Map<number, PdfObject>([
          [
            globalsObjNum,
            pdfStream(pdfDict({}), jbig2FixtureBytes(fixture.globals)),
          ],
        ])
      : undefined;
  const resolver = {
    resolve: (obj: PdfObject | undefined) =>
      obj?.kind === "ref" ? (globalsObjects?.get(obj.num) ?? obj) : obj,
    resolveDict: (obj: PdfObject | undefined) =>
      asDict(obj?.kind === "ref" ? (globalsObjects?.get(obj.num) ?? obj) : obj),
  };
  const extracted = readImageXObject(
    dict,
    jbig2FixtureBytes(fixture.stream),
    resolver,
    emptySink,
  );
  if (extracted === undefined) {
    return undefined;
  }
  return {
    asset: {
      format: extracted.format,
      base64: bytesToBase64(extracted.bytes),
      widthPx: extracted.widthPx,
      heightPx: extracted.heightPx,
      ...(extracted.original !== undefined
        ? {
            original: {
              filter: extracted.original.filter,
              base64: bytesToBase64(extracted.original.bytes),
              ...(extracted.original.globalsBytes !== undefined
                ? {
                    jbig2GlobalsBase64: bytesToBase64(
                      extracted.original.globalsBytes,
                    ),
                  }
                : {}),
            },
          }
        : {}),
    },
    pixels: decodePng(extracted.bytes).data,
  };
}

function jpeg2000Asset(
  fixture: Jpeg2000Fixture,
): { asset: LayoutImageAsset; pixels: Uint8Array } | undefined {
  const dict = pdfDict(
    new Map<string, PdfObject>([
      ["Type", pdfName("XObject")],
      ["Subtype", pdfName("Image")],
      ["Width", pdfNum(fixture.width)],
      ["Height", pdfNum(fixture.height)],
      ["Filter", pdfName("JPXDecode")],
    ]),
  );
  const extracted = readImageXObject(
    dict,
    jpeg2000FixtureBytes(fixture.codestream),
    {
      resolve: (obj: PdfObject | undefined) => obj,
      resolveDict: (obj: PdfObject | undefined) => asDict(obj),
    },
    emptySink,
  );
  if (extracted === undefined) {
    return undefined;
  }
  return {
    asset: {
      format: extracted.format,
      base64: bytesToBase64(extracted.bytes),
      widthPx: extracted.widthPx,
      heightPx: extracted.heightPx,
      ...(extracted.original !== undefined
        ? {
            original: {
              filter: extracted.original.filter,
              base64: bytesToBase64(extracted.original.bytes),
            },
          }
        : {}),
    },
    pixels: decodePng(extracted.bytes).data,
  };
}

function docWithImage(asset: LayoutImageAsset): LayoutDocument {
  return {
    formatVersion: LAYOUT_FORMAT_VERSION,
    metadata: {},
    pages: [
      {
        widthPt: 200,
        heightPt: 200,
        items: [
          {
            kind: "image",
            imageId: "img0",
            xPt: 10,
            yPt: 10,
            widthPt: 100,
            heightPt: 100,
          },
        ],
      },
    ],
    images: { img0: asset },
  };
}

// Contiguous subsequence search over raw bytes -- the verbatim claim is that the source's own compressed stream appears inside the written file, not merely that some JBIG2-looking bytes do.
function containsSubsequence(
  haystack: Uint8Array,
  needle: Uint8Array,
): boolean {
  outer: for (
    let start = 0;
    start + needle.length <= haystack.length;
    start++
  ) {
    for (let i = 0; i < needle.length; i++) {
      if (haystack[start + i] !== needle[i]) {
        continue outer;
      }
    }
    return true;
  }
  return false;
}

function pixelsOf(doc: LayoutDocument): Uint8Array | undefined {
  const asset = Object.values(doc.images)[0];
  if (asset === undefined) {
    return undefined;
  }
  return decodePng(base64ToBytes(asset.base64)).data;
}

describe("writePdf: verbatim passthrough of no-encoder image filters", () => {
  it("re-embeds a JBIG2 image's own stream under /JBIG2Decode, decoding back to the same pixels", () => {
    const generic = JBIG2_FIXTURES.find((f) => f.name === "diagonal-generic");
    expect(generic).toBeDefined();
    const built = jbig2Asset(generic!);
    expect(built).toBeDefined();
    expect(built!.asset.original).toMatchObject({ filter: "jbig2" });

    const bytes = writePdf(docWithImage(built!.asset), { compress: false });
    const text = new TextDecoder("latin1").decode(bytes);
    expect(text).toContain("/JBIG2Decode");
    expect(containsSubsequence(bytes, jbig2FixtureBytes(generic!.stream))).toBe(
      true,
    );

    const reread = readPdf(bytes);
    const repixels = pixelsOf(reread);
    expect(repixels).toBeDefined();
    expect(Array.from(repixels!)).toEqual(Array.from(built!.pixels));
    // And the re-read still carries an original of its own, so the passthrough composes across further round trips.
    expect(Object.values(reread.images)[0]?.original).toMatchObject({
      filter: "jbig2",
    });
  });

  it("writes the /JBIG2Globals stream and its /DecodeParms reference for a symbol-dictionary image", () => {
    const symbols = JBIG2_FIXTURES.find((f) => f.name === "text-symbols");
    expect(symbols).toBeDefined();
    const built = jbig2Asset(symbols!, 7);
    expect(built).toBeDefined();
    expect(built!.asset.original).toMatchObject({ filter: "jbig2" });
    expect(typeof built!.asset.original?.jbig2GlobalsBase64).toBe("string");

    const bytes = writePdf(docWithImage(built!.asset), { compress: false });
    const text = new TextDecoder("latin1").decode(bytes);
    expect(text).toContain("/JBIG2Decode");
    expect(text).toContain("/JBIG2Globals");
    expect(containsSubsequence(bytes, jbig2FixtureBytes(symbols!.stream))).toBe(
      true,
    );
    expect(
      containsSubsequence(bytes, jbig2FixtureBytes(symbols!.globals!)),
    ).toBe(true);

    const reread = readPdf(bytes);
    const repixels = pixelsOf(reread);
    expect(Array.from(repixels!)).toEqual(Array.from(built!.pixels));
  });

  it("re-embeds a JPEG 2000 codestream under /JPXDecode, decoding back to the same pixels", () => {
    const fixture = JPEG2000_FIXTURES.find((f) => f.lossless);
    expect(fixture).toBeDefined();
    const built = jpeg2000Asset(fixture!);
    expect(built).toBeDefined();
    expect(built!.asset.original).toMatchObject({ filter: "jpeg2000" });

    const bytes = writePdf(docWithImage(built!.asset), { compress: false });
    const text = new TextDecoder("latin1").decode(bytes);
    expect(text).toContain("/JPXDecode");
    expect(
      containsSubsequence(bytes, jpeg2000FixtureBytes(fixture!.codestream)),
    ).toBe(true);

    const reread = readPdf(bytes);
    const repixels = pixelsOf(reread);
    expect(Array.from(repixels!)).toEqual(Array.from(built!.pixels));
  });
});
