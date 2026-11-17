import { zlibSync } from "fflate";
import { ByteWriter } from "../bytes/writer";
import { FixtureBuilder, enc } from "./pdf";
import { seededRandom } from "./seeded-random";

// Picture-heavy PDF fixtures for the per-image reader (read-images.ts), built like every fixture in pdf.ts: by literal concatenation through FixtureBuilder, never through this package's own writer. Two shapes:
//
// - imageVarietyPdf: one small image of each kind the read path decodes differently (Flate RGB with a soft mask, PNG-predicted ICC RGB, inverted gray, indexed, 1-bit, CMYK, a JPEG passed through, an image inside a form XObject, an inline image), plus the cases the listing has to leave out or report as undecodable. Its objects are numbered in a fixed order (images from 3, image 0's soft mask straight after it, then the ICC profile and the form), which read-images.test.ts names them by. Its decoded bytes are pinned against pdf-codec 4.5.2's (image-heavy-pdf-golden.ts).
// - imageEdgeCasesPdf: one page of the cases a locator has to survive: an image named through a reference to its reference, an image whose soft mask is the wrong size to use, one whose dictionary declares more pixels than any image decodes to, and an inline stencil mask before an inline image.
// - pictureDeckPdf: shaped like a typical picture-heavy slide deck (20 pages, about a hundred distinct images, most of them Flate RGB with soft masks and the largest 2360x1309, the rest JPEG), generated from a seed. At full scale it is about 2.5 MB; `scale` shrinks every image's pixel size for a unit test that wants the same structure without the cost.

const PAGE_WIDTH_PT = 960;
const PAGE_HEIGHT_PT = 540;

interface FixtureImage {
  // The image XObject dictionary without /Length (FixtureBuilder.stream inserts it).
  readonly dict: string;
  readonly data: Uint8Array<ArrayBuffer>;
  // A soft mask the dictionary names as "/SMask <smaskObj> 0 R"; its object number is allocated by the builder.
  readonly smask?: {
    readonly dict: string;
    readonly data: Uint8Array<ArrayBuffer>;
  };
}

function flate(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const compressed = zlibSync(bytes);
  const copy = new Uint8Array(compressed.length);
  copy.set(compressed);
  return copy;
}

// Picture-like samples, cheaply: smooth gradients with seeded noise, optionally posterized into flat bands (as a chart, a diagram or a cut-out picture is), so Flate compresses them the way it compresses a real picture rather than to nothing.
function photoSamples(
  width: number,
  height: number,
  channels: number,
  seed: number,
  noise: number,
  posterize = 1,
): Uint8Array<ArrayBuffer> {
  const random = seededRandom(seed);
  const out = new Uint8Array(width * height * channels);
  const phase = random() * 6;
  let at = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < channels; c++) {
        const base =
          128 +
          90 *
            Math.sin((x / width) * 3 + phase + c) *
            Math.cos((y / height) * 2 + c);
        const value = base + (random() - 0.5) * noise;
        out[at++] = Math.max(
          0,
          Math.min(255, Math.round(value / posterize) * posterize),
        );
      }
    }
  }
  return out;
}

// An alpha channel with a soft edge: opaque in the middle, fading out towards the border, as a cut-out picture's mask does.
function softMaskSamples(
  width: number,
  height: number,
): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const edge = Math.min(x, y, width - 1 - x, height - 1 - y);
      out[y * width + x] = Math.min(255, edge * 16);
    }
  }
  return out;
}

// A JPEG the reader passes through untouched: SOI, a baseline SOF0 stating the size, a payload of seeded bytes standing in for the entropy-coded scan, and EOI. Nothing decodes the scan, so its content need not be real.
function fakeJpeg(
  width: number,
  height: number,
  payloadLength: number,
  seed: number,
): Uint8Array<ArrayBuffer> {
  const random = seededRandom(seed);
  const w = new ByteWriter();
  w.writeBytes(
    new Uint8Array([
      0xff,
      0xd8,
      0xff,
      0xc0,
      0x00,
      0x11,
      0x08,
      height >> 8,
      height & 0xff,
      width >> 8,
      width & 0xff,
      0x03,
      0x01,
      0x22,
      0x00,
      0x02,
      0x11,
      0x01,
      0x03,
      0x11,
      0x01,
      0xff,
      0xda,
    ]),
  );
  // The scan's bytes, kept free of 0xFF so no stray marker appears inside it.
  w.writeBytes(
    Uint8Array.from({ length: payloadLength }, () =>
      Math.floor(random() * 255),
    ),
  );
  w.writeBytes(new Uint8Array([0xff, 0xd9]));
  return w.toBytes();
}

function rgbImage(
  width: number,
  height: number,
  seed: number,
  noise: number,
  withSoftMask: boolean,
  posterize = 1,
): FixtureImage {
  return {
    dict: `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode >>`,
    data: flate(photoSamples(width, height, 3, seed, noise, posterize)),
    ...(withSoftMask
      ? {
          smask: {
            dict: `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode >>`,
            data: flate(softMaskSamples(width, height)),
          },
        }
      : {}),
  };
}

function jpegImage(
  width: number,
  height: number,
  payloadLength: number,
  seed: number,
): FixtureImage {
  return {
    dict: `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode >>`,
    data: fakeJpeg(width, height, payloadLength, seed),
  };
}

// A placement operator for the unit square: an image of the given size drawn at (x, y).
function drawAt(
  name: string,
  x: number,
  y: number,
  w: number,
  h: number,
): string {
  return `q ${w} 0 0 ${h} ${x} ${y} cm /${name} Do Q`;
}

interface FixturePage {
  // The page's /XObject resources: a name and the object it names, as a token assemble resolves (`@image:N` for image N of the list, `@extra:N` for extra object N).
  readonly xobjects: Readonly<Record<string, string>>;
  readonly content: Uint8Array<ArrayBuffer>;
  readonly extraPageEntries?: string;
}

interface FixtureObject {
  readonly dict: string;
  readonly data?: Uint8Array<ArrayBuffer>;
}

// Lays out catalog, pages, every image (and its soft mask) as an indirect object, any extra objects, then each page and its content stream. Every dictionary may name another object by token (`@image:N`, `@extra:N`), replaced with its reference once every object is numbered, so one XObject drawn on several pages is one object.
function assemble(
  images: readonly FixtureImage[],
  pages: readonly FixturePage[],
  extraObjects: readonly FixtureObject[] = [],
): Uint8Array<ArrayBuffer> {
  const b = new FixtureBuilder().header("1.7");
  let next = 3;
  const imageObjects: number[] = [];
  const smaskObjects = new Map<number, number>();
  for (const [index, image] of images.entries()) {
    imageObjects.push(next++);
    if (image.smask !== undefined) {
      smaskObjects.set(index, next++);
    }
  }
  const extraObjectNumbers = extraObjects.map(() => next++);
  const pageObjects = pages.map(() => {
    const page = next;
    next += 2;
    return page;
  });
  const resolve = (dict: string): string =>
    dict.replace(/@(image|extra):(\d+)/g, (_, kind: string, index: string) => {
      const num = (kind === "image" ? imageObjects : extraObjectNumbers)[
        Number(index)
      ];
      if (num === undefined) {
        throw new Error(`fixture token @${kind}:${index} names no object`);
      }
      return `${num} 0 R`;
    });
  b.object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  b.object(
    2,
    `<< /Type /Pages /Kids [${pageObjects.map((n) => `${n} 0 R`).join(" ")}] /Count ${pages.length} >>`,
  );
  for (const [index, image] of images.entries()) {
    const smaskObj = smaskObjects.get(index);
    const dict =
      smaskObj === undefined
        ? image.dict
        : image.dict.replace(/>>\s*$/, ` /SMask ${smaskObj} 0 R >>`);
    b.stream(imageObjects[index]!, resolve(dict), image.data);
    if (smaskObj !== undefined && image.smask !== undefined) {
      b.stream(smaskObj, image.smask.dict, image.smask.data);
    }
  }
  for (const [index, extra] of extraObjects.entries()) {
    const num = extraObjectNumbers[index]!;
    if (extra.data === undefined) {
      b.object(num, resolve(extra.dict));
    } else {
      b.stream(num, resolve(extra.dict), extra.data);
    }
  }
  for (const [index, page] of pages.entries()) {
    const pageObj = pageObjects[index]!;
    const xobjects = Object.entries(page.xobjects)
      .map(([name, token]) => `/${name} ${token}`)
      .join(" ");
    b.object(
      pageObj,
      resolve(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH_PT} ${PAGE_HEIGHT_PT}] /Resources << /XObject << ${xobjects} >> /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents ${pageObj + 1} 0 R${page.extraPageEntries ?? ""} >>`,
      ),
    );
    b.stream(pageObj + 1, "<< >>", page.content);
  }
  b.classicXrefAndTrailer(next - 1, "/Root 1 0 R");
  return b.bytes();
}

// Each row prefixed with the PNG Sub filter's type byte and filtered by it, as a PDF /Predictor 15 stream's rows are (ISO 32000-1 7.4.4.4).
function pngSubPredicted(
  samples: Uint8Array<ArrayBuffer>,
  rowBytes: number,
  bytesPerPixel: number,
): Uint8Array<ArrayBuffer> {
  const rows = samples.length / rowBytes;
  const out = new Uint8Array(rows * (rowBytes + 1));
  for (let row = 0; row < rows; row++) {
    const from = row * rowBytes;
    const to = row * (rowBytes + 1);
    out[to] = 1;
    for (let i = 0; i < rowBytes; i++) {
      const left = i >= bytesPerPixel ? samples[from + i - bytesPerPixel]! : 0;
      out[to + 1 + i] = (samples[from + i]! - left) & 0xff;
    }
  }
  return out;
}

/**
 * One small image of every kind the read path decodes differently, on two pages (the second rotated and cropped), plus an inline image, an image inside a form XObject, an /ImageMask stencil (never listed), an image drawn only outside the crop box (never listed), and one with an unsupported bit depth (listed, not decodable).
 * @returns The PDF bytes.
 */
export function imageVarietyPdf(): Uint8Array<ArrayBuffer> {
  const indexedPalette = Array.from({ length: 16 }, (_, i) =>
    [i * 16, 255 - i * 16, (i * 37) % 256]
      .map((v) => v.toString(16).padStart(2, "0"))
      .join(""),
  ).join("");
  const iccProfile = {
    dict: "<< /N 3 /Alternate /DeviceRGB >>",
    data: enc("not a real profile"),
  };
  const iccRgb = photoSamples(31, 9, 3, 11, 40);
  const images: FixtureImage[] = [
    // 0: Flate RGB with a soft mask
    rgbImage(64, 48, 1, 60, true),
    // 1: inverted gray (/Decode [1 0])
    {
      dict: "<< /Type /XObject /Subtype /Image /Width 40 /Height 30 /ColorSpace /DeviceGray /BitsPerComponent 8 /Decode [1 0] /Filter /FlateDecode >>",
      data: flate(photoSamples(40, 30, 1, 2, 30)),
    },
    // 2: indexed, four bits per index
    {
      dict: `<< /Type /XObject /Subtype /Image /Width 33 /Height 17 /ColorSpace [/Indexed /DeviceRGB 15 <${indexedPalette}>] /BitsPerComponent 4 /Filter /FlateDecode >>`,
      data: flate(
        Uint8Array.from({ length: 17 * 17 }, (_, i) => (i * 29) & 0xff),
      ),
    },
    // 3: one bit per pixel, uncompressed
    {
      dict: "<< /Type /XObject /Subtype /Image /Width 50 /Height 20 /ColorSpace /DeviceGray /BitsPerComponent 1 >>",
      data: Uint8Array.from({ length: 7 * 20 }, (_, i) => (i * 73) & 0xff),
    },
    // 4: CMYK
    {
      dict: "<< /Type /XObject /Subtype /Image /Width 20 /Height 20 /ColorSpace /DeviceCMYK /BitsPerComponent 8 /Filter /FlateDecode >>",
      data: flate(photoSamples(20, 20, 4, 4, 50)),
    },
    // 5: a JPEG, passed through
    jpegImage(120, 80, 900, 5),
    // 6: ICC-based RGB under a PNG predictor (ICC profile is extra object 0)
    {
      dict: "<< /Type /XObject /Subtype /Image /Width 31 /Height 9 /ColorSpace [/ICCBased @extra:0] /BitsPerComponent 8 /Filter /FlateDecode /DecodeParms << /Predictor 15 /Colors 3 /Columns 31 >> >>",
      data: flate(pngSubPredicted(iccRgb, 31 * 3, 3)),
    },
    // 7: an /ImageMask stencil, which neither readPdf nor the listing reports as an image
    {
      dict: "<< /Type /XObject /Subtype /Image /Width 8 /Height 8 /ImageMask true /BitsPerComponent 1 >>",
      data: new Uint8Array(8).fill(0xaa),
    },
    // 8: drawn only outside the crop box, so never visible
    rgbImage(10, 10, 8, 20, false),
    // 9: an unsupported bit depth
    {
      dict: "<< /Type /XObject /Subtype /Image /Width 4 /Height 4 /ColorSpace /DeviceGray /BitsPerComponent 16 >>",
      data: new Uint8Array(32),
    },
    // 10: drawn only inside the form XObject (extra object 1)
    rgbImage(16, 12, 10, 80, false),
  ];
  const inline = new ByteWriter();
  inline.writeAscii("q 30 0 0 20 300 300 cm BI /W 2 /H 2 /CS /RGB /BPC 8 ID ");
  inline.writeBytes(
    new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]),
  );
  inline.writeAscii(" EI Q");
  const page0 = [
    drawAt("Im0", 10, 10, 128, 96),
    drawAt("Im0", 400, 10, 64, 48),
    drawAt("Im1", 150, 10, 80, 60),
    drawAt("Im2", 250, 10, 66, 34),
    drawAt("Im3", 330, 10, 100, 40),
    drawAt("Im4", 10, 200, 40, 40),
    drawAt("Im5", 60, 200, 120, 80),
    drawAt("Im6", 200, 200, 62, 18),
    drawAt("Im7", 300, 200, 16, 16),
    drawAt("Im9", 340, 200, 8, 8),
    "q 1 0 0 1 500 300 cm /Fm1 Do Q",
    "BT /F1 12 Tf 10 500 Td (Pictures) Tj ET",
  ].join("\n");
  const pages: FixturePage[] = [
    {
      xobjects: {
        Im0: "@image:0",
        Im1: "@image:1",
        Im2: "@image:2",
        Im3: "@image:3",
        Im4: "@image:4",
        Im5: "@image:5",
        Im6: "@image:6",
        Im7: "@image:7",
        Im9: "@image:9",
        Fm1: "@extra:1",
      },
      content: enc(page0),
    },
    {
      xobjects: { Im0: "@image:0", Im8: "@image:8" },
      content: (() => {
        const w = new ByteWriter();
        w.writeAscii(
          `${drawAt("Im0", 100, 100, 200, 150)}\n${drawAt("Im8", 2000, 2000, 20, 20)}\n`,
        );
        w.writeBytes(inline.toBytes());
        return w.toBytes();
      })(),
      extraPageEntries: " /Rotate 90 /CropBox [50 50 900 500]",
    },
  ];
  return assemble(images, pages, [
    iccProfile,
    {
      dict: "<< /Type /XObject /Subtype /Form /BBox [0 0 48 36] /Resources << /XObject << /Inner @image:10 >> >> >>",
      data: enc(drawAt("Inner", 0, 0, 48, 36)),
    },
  ]);
}

/**
 * One page of the edge cases per-image reading has to handle, numbered for read-images.test.ts:
 *
 * - 3: a 2x1 Flate RGB image, drawn as /A and again as /B through object 6, which holds only a reference to 3.
 * - 4: a 2x1 Flate RGB image whose soft mask (object 5) declares 4000x4000, a size readImageXObject does not resample, so it is never used.
 * - 7: a Flate gray image whose dictionary declares 10001x10000 (past encodePng's pixel ceiling) over a stream of about 100 KB.
 * - two inline images: a stencil mask (`/IM true`, occurrence 0, never listed) and a 1x1 RGB image (occurrence 1).
 * @returns The PDF.
 */
export function imageEdgeCasesPdf(): Uint8Array<ArrayBuffer> {
  const images: FixtureImage[] = [
    rgbImage(2, 1, 1, 0, false),
    {
      ...rgbImage(2, 1, 2, 0, false),
      smask: {
        dict: "<< /Type /XObject /Subtype /Image /Width 4000 /Height 4000 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode >>",
        data: flate(new Uint8Array(4)),
      },
    },
  ];
  const content = new ByteWriter();
  content.writeAscii(
    [
      drawAt("A", 0, 0, 20, 10),
      drawAt("B", 30, 0, 20, 10),
      drawAt("C", 60, 0, 20, 10),
      drawAt("D", 90, 0, 20, 10),
      "q 8 0 0 1 120 0 cm BI /IM true /W 8 /H 1 ID U EI Q",
      "q 10 0 0 10 150 0 cm BI /W 1 /H 1 /CS /RGB /BPC 8 ID abc EI Q\n",
    ].join("\n"),
  );
  return assemble(
    images,
    [
      {
        xobjects: {
          A: "@image:0",
          B: "@extra:0",
          C: "@image:1",
          D: "@extra:1",
        },
        content: content.toBytes(),
      },
    ],
    [
      { dict: "@image:0" },
      {
        dict: "<< /Type /XObject /Subtype /Image /Width 10001 /Height 10000 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode >>",
        data: flate(photoSamples(320, 320, 1, 5, 255)),
      },
    ],
  );
}

/** The picture-deck fixture's options. */
export interface PictureDeckOptions {
  /** Multiplies every image's pixel width and height (default 1, the full-size shape). */
  readonly scale?: number;
}

/**
 * The shape of a real picture-heavy slide deck: 20 pages, 108 distinct images (81 Flate RGB, most with soft masks and the largest 2360x1309, and 27 JPEGs), several drawn on more than one page. About 2.5 MB at full scale. Generated from fixed seeds, so the same bytes every run.
 * @param options - The scale.
 * @returns The PDF bytes.
 */
export function pictureDeckPdf(
  options?: PictureDeckOptions,
): Uint8Array<ArrayBuffer> {
  const scale = options?.scale ?? 1;
  const px = (n: number): number => Math.max(1, Math.round(n * scale));
  const random = seededRandom(700);
  const images: FixtureImage[] = [];
  // The large pictures: a 2360x1309 hero image and a run of decreasing slide-sized ones, all with soft masks.
  const large: readonly (readonly [number, number])[] = [
    [2360, 1309],
    [1920, 1080],
    [1600, 900],
    [1280, 720],
    [1280, 720],
    [1024, 768],
    [960, 540],
    [800, 600],
  ];
  for (const [index, [w, h]] of large.entries()) {
    images.push(rgbImage(px(w), px(h), 100 + index, 0, true, 3));
  }
  // Medium and small Flate RGB pictures (icons, logos, charts), most with soft masks.
  for (let i = 0; i < 73; i++) {
    const w = 64 + Math.floor(random() * 540);
    const h = 48 + Math.floor(random() * 380);
    images.push(rgbImage(px(w), px(h), 200 + i, 0, i % 4 !== 3, 8));
  }
  // Photographs kept as JPEG.
  for (let i = 0; i < 27; i++) {
    const w = 400 + Math.floor(random() * 1200);
    const h = 300 + Math.floor(random() * 700);
    images.push(
      jpegImage(
        px(w),
        px(h),
        Math.round((8000 + random() * 22000) * scale * scale),
        300 + i,
      ),
    );
  }
  const pages: FixturePage[] = [];
  const pageCount = 20;
  for (let page = 0; page < pageCount; page++) {
    const xobjects: Record<string, string> = {};
    const draws: string[] = [];
    // Each image appears on page (index mod 20); every fifth also reappears on the next page, as a logo or a repeated chart does.
    for (let index = 0; index < images.length; index++) {
      const onPage =
        index % pageCount === page ||
        (index % 5 === 0 && (index + 1) % pageCount === page);
      if (!onPage) {
        continue;
      }
      const name = `Im${index}`;
      xobjects[name] = `@image:${index}`;
      const slot = draws.length;
      draws.push(
        drawAt(
          name,
          20 + (slot % 4) * 230,
          20 + Math.floor(slot / 4) * 170,
          220,
          160,
        ),
      );
    }
    draws.push(`BT /F1 18 Tf 20 510 Td (Slide ${page + 1}) Tj ET`);
    pages.push({ xobjects, content: enc(draws.join("\n")) });
  }
  return assemble(images, pages);
}
