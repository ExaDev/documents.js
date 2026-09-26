// The image preparation family, split from write.ts: JPEG passthrough sniffing, PNG decode and bilevel packing, and the image/XObject dict builders, all pure functions over the bytes and geometry a page image carries.

export const BITS_PER_BYTE = 8;
const BYTE_SHIFT = Math.log2(BITS_PER_BYTE); // 3: shifting right by this divides by BITS_PER_BYTE, converting a bit position into a byte offset
export const BYTE_MASK = (1 << BITS_PER_BYTE) - 1; // 0xff: masks a value down to its low 8 bits; also the brightest possible sample an 8-bit channel can hold
const PACKED_BIT_MSB_MASK = 1 << (BITS_PER_BYTE - 1); // 0x80: the leftmost (most significant) pixel bit within a byte packed MSB-first
const BIT_INDEX_MASK = BITS_PER_BYTE - 1; // 7: x & this extracts which of the 8 bits within its byte a given pixel column occupies

export interface PreparedImage {
  readonly dict: PdfDict; // /SMask, if any, is added in place once the SMask object number is known
  readonly raw: Uint8Array<ArrayBuffer>;
  readonly alpha?: {
    readonly dict: PdfDict;
    readonly raw: Uint8Array<ArrayBuffer>;
  };
}
import { base64ToBytes } from "byte-codec";
import { deflate } from "./bytes/flate";
import { encodeCcittFax } from "./image/ccitt-encode";
import { decodePng } from "./image/png-decode";
import { readJpegInfo } from "./image/jpeg-info";
import type { LayoutImageAsset } from "./layout";
import type { PdfObject } from "./objects";
import type { PdfDict } from "./objects";
import { pdfArray, pdfBool, pdfDict, pdfName, pdfNum } from "./objects";
// A JPEG SOF marker's own component count (ISO/IEC 10918-1 B.2.2): 1 is grayscale, 3 is YCbCr/RGB, and 4 is CMYK, the shape a colour-managed CMYK scan or print workflow emits.
const JPEG_COMPONENTS_CMYK = 4;

export function prepareJpegImage(
  bytes: Uint8Array<ArrayBuffer>,
): PreparedImage {
  const info = readJpegInfo(bytes);
  const colorSpace =
    info.components === 1
      ? "DeviceGray"
      : info.components === JPEG_COMPONENTS_CMYK
        ? "DeviceCMYK"
        : "DeviceRGB";
  const entries = new Map<string, PdfObject>([
    ["Type", pdfName("XObject")],
    ["Subtype", pdfName("Image")],
    ["Width", pdfNum(info.width)],
    ["Height", pdfNum(info.height)],
    ["ColorSpace", pdfName(colorSpace)],
    ["BitsPerComponent", pdfNum(info.precision)],
    ["Filter", pdfName("DCTDecode")],
  ]);
  // A 4-component JPEG is CMYK data; Adobe's APP14 transform 2 (YCCK) or an untagged 4-component stream almost always needs this inversion to render with correct colours (see src/image/jpeg-info.ts's own note on adobeTransform) — transform 0 explicitly means "CMYK as-is", no inversion.
  if (
    info.components === JPEG_COMPONENTS_CMYK &&
    (info.adobeTransform === 2 || info.adobeTransform === undefined)
  ) {
    entries.set(
      "Decode",
      pdfArray([1, 0, 1, 0, 1, 0, 1, 0].map((n) => pdfNum(n))),
    );
  }
  return { dict: pdfDict(entries), raw: bytes };
}

export function pngImageDict(
  width: number,
  height: number,
  colorSpace: "DeviceGray" | "DeviceRGB",
  compress: boolean,
): PdfDict {
  const entries = new Map<string, PdfObject>([
    ["Type", pdfName("XObject")],
    ["Subtype", pdfName("Image")],
    ["Width", pdfNum(width)],
    ["Height", pdfNum(height)],
    ["ColorSpace", pdfName(colorSpace)],
    ["BitsPerComponent", pdfNum(BITS_PER_BYTE)],
  ]);
  if (compress) {
    entries.set("Filter", pdfName("FlateDecode"));
  }
  return pdfDict(entries);
}

// A bilevel (every sample 0 or 255) 8-bit grayscale decode re-packed to the 1-bit-per-pixel layout the CCITT encoder consumes: 255 -> 1 (white), 0 -> 0 (black), MSB first, rows padded to whole bytes. Undefined when any sample is intermediate — a genuinely greyscale image has no G4 spelling and stays on the Flate path.
//
// Driven by the sample array's own length rather than by width/height bounds: decodePng always returns exactly width*height samples, so an index past the array's end reads undefined, which the bilevel test below rejects — an off-by-one past the bound is visible as "not bilevel" instead of silently reading a phantom black pixel the packed array's own fixed size would then have dropped.
export function packBilevel(raw: {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}): Uint8Array | undefined {
  const rowBytes = (raw.width + BIT_INDEX_MASK) >> BYTE_SHIFT;
  const packed = new Uint8Array(rowBytes * raw.height);
  // Accumulated through a DataView so a byte already holding earlier bits is read back as a
  // plain number, never as the undefined an out-of-range typed-array read reports.
  const view = new DataView(packed.buffer);
  for (let index = 0; index < raw.data.length; index++) {
    const sample = raw.data[index];
    if (sample !== 0 && sample !== BYTE_MASK) {
      return undefined;
    }
    if (sample === BYTE_MASK) {
      const x = index % raw.width;
      const byteIndex =
        Math.floor(index / raw.width) * rowBytes + (x >> BYTE_SHIFT);
      view.setUint8(
        byteIndex,
        view.getUint8(byteIndex) |
          (PACKED_BIT_MSB_MASK >> (x & BIT_INDEX_MASK)),
      );
    }
  }
  return packed;
}

export function preparePngImage(
  bytes: Uint8Array<ArrayBuffer>,
  compress: boolean,
): PreparedImage {
  const raw = decodePng(bytes);
  const colorSpace = raw.channels === 1 ? "DeviceGray" : "DeviceRGB";
  // A bilevel grayscale image with no soft mask is the exact shape CCITT Group 4 was built for (a fax or a 1-bit scan): when the G4 encoding comes out smaller than Flate over the same pixels — which for real bilevel content it does by an order of magnitude — the image is written as /CCITTFaxDecode with K -1, recovering the compression a scanned-document source originally carried instead of regressing it to Flate (#975). Whichever encoding is smaller wins, deterministically, so noise-heavy bilevel images where Flate happens to win keep it.
  if (compress && raw.channels === 1 && raw.alpha === undefined) {
    const bilevel = packBilevel(raw);
    if (bilevel !== undefined) {
      // Flate first, and G4 under Flate's own byte count as an abort budget: the moment the G4 stream grows past the size it is being compared against, it can no longer win and the encoder stops — an adversarial bilevel image (a checkerboard, G4's worst case) otherwise makes the encoder emit a losing multi-megabyte candidate in full before the caller discards it.
      const flate = deflate(raw.data);
      const g4 = encodeCcittFax(bilevel, {
        columns: raw.width,
        rows: raw.height,
        maxBytes: flate.length,
      });
      if (g4 !== undefined) {
        return {
          dict: pdfDict(
            new Map<string, PdfObject>([
              ["Type", pdfName("XObject")],
              ["Subtype", pdfName("Image")],
              ["Width", pdfNum(raw.width)],
              ["Height", pdfNum(raw.height)],
              ["ColorSpace", pdfName("DeviceGray")],
              ["BitsPerComponent", pdfNum(1)],
              ["Filter", pdfName("CCITTFaxDecode")],
              [
                "DecodeParms",
                pdfDict(
                  new Map<string, PdfObject>([
                    ["K", pdfNum(-1)],
                    ["Columns", pdfNum(raw.width)],
                    ["Rows", pdfNum(raw.height)],
                    ["BlackIs1", pdfBool(false)],
                  ]),
                ),
              ],
            ]),
          ),
          raw: g4,
          alpha: undefined,
        };
      }
      return {
        dict: pngImageDict(raw.width, raw.height, colorSpace, true),
        raw: flate,
        alpha: undefined,
      };
    }
  }
  const dict = pngImageDict(raw.width, raw.height, colorSpace, compress);
  const data = compress ? deflate(raw.data) : raw.data;
  const alpha =
    raw.alpha === undefined
      ? undefined
      : {
          dict: pngImageDict(raw.width, raw.height, "DeviceGray", compress),
          raw: compress ? deflate(raw.alpha) : raw.alpha,
        };
  return { dict, raw: data, alpha };
}

// Verbatim re-embedding of a no-encoder filter's original stream (JBIG2, JPEG 2000): the asset's own decoded canonical never reaches the file at all — these bytes are the compressed stream as the source carried it, re-emitted under the same filter, so a pdf-to-pdf round trip pays zero generation loss for exactly the two filters this package cannot re-encode. Width/Height still come from the asset (a viewer needs them whatever the stream says). A JBIG2 image is 1-bit /DeviceGray by construction (T.88's bitmap inverted into PDF's 0-is-black convention at decode), stated explicitly; a JPEG 2000 stream's component count and sample depth are the codestream's own to state (ISO 32000-1 7.4.9: /BitsPerComponent "shall not be present", /ColorSpace optional), so neither is written. /DecodeParms with the /JBIG2Globals reference is added in place at emission, once the globals stream's own object number is known — the identical late-binding the SMask reference already uses. A source soft mask still re-emits: the decoded canonical's alpha is extracted through the ordinary PNG prepare path and rides along as a generated /SMask, since the original compressed stream does not encode it.
export function preparePassthroughImage(
  asset: LayoutImageAsset,
  original: Readonly<NonNullable<LayoutImageAsset["original"]>>,
  compress: boolean,
): PreparedImage {
  const png = preparePngImage(base64ToBytes(asset.base64), compress);
  const entries = new Map<string, PdfObject>([
    ["Type", pdfName("XObject")],
    ["Subtype", pdfName("Image")],
    ["Width", pdfNum(asset.widthPx)],
    ["Height", pdfNum(asset.heightPx)],
    [
      "Filter",
      pdfName(original.filter === "jbig2" ? "JBIG2Decode" : "JPXDecode"),
    ],
  ]);
  if (original.filter === "jbig2") {
    entries.set("ColorSpace", pdfName("DeviceGray"));
    entries.set("BitsPerComponent", pdfNum(1));
  }
  return {
    dict: pdfDict(entries),
    raw: base64ToBytes(original.base64),
    // Stated directly rather than conditionally spread: an undefined alpha is exactly what every
    // consumer already tests for (`prepared.alpha === undefined`), so an absent property and an
    // explicitly-undefined one mean the same thing here.
    alpha: png.alpha,
  };
}

export function prepareImage(
  asset: LayoutImageAsset,
  compress: boolean,
): PreparedImage {
  if (asset.original !== undefined) {
    return preparePassthroughImage(asset, asset.original, compress);
  }
  const bytes = base64ToBytes(asset.base64);
  return asset.format === "jpeg"
    ? prepareJpegImage(bytes)
    : preparePngImage(bytes, compress);
}
