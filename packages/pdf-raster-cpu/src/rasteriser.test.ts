import { describe, expect, it } from "vitest";
import { ByteWriter, decodePng, deflate } from "byte-codec";
import type { RawImage } from "byte-codec";
import { createFontRegistry, writePdf } from "pdf-codec";
import { renderPdfPage } from "pdf-codec/raster";
import type { RenderPdfPageOptions } from "pdf-codec/raster";
import { COVERAGE_DENOMINATOR } from "./coverage";
import { CpuRasteriser, createCpuRasteriser } from "./rasteriser";
import type { CpuRasteriserOptions, RasterCpuDiagnostic } from "./rasteriser";

// The backend's own contract, pinned on pixels: every test here renders through renderPdfPage with createCpuRasteriser (the composition a real consumer uses) and asserts on the PNG's decoded pixels, which decodePng reconstructs exactly from either of encodePng's output representations -- so the assertions are about raster output, never about one encoder spelling. pdf-codec's own raster suite already pins the op stream's geometry; what these tests add is that this backend turns those ops into the right pixels, deterministically, with the right refusals.
//
// The small fixtures are built by literal byte concatenation on the same independence principle pdf-codec's own suites state (a fixture built by the package under test would let a writer bug hide from the renderer test); the one deliberate exception is the embedded-font text fixture, which IS built by writePdf -- there, the port's own geometry is already pinned by pdf-codec's suite against inline fixtures, and what needs proving here is that real embedded outlines reach real pixels, which the writer's mainstream-shaped output (Type0 + Identity-H + CIDFontType2 + FontFile2) exercises better than any hand-built equivalent.

// --- Fixtures: the same minimal classic-xref shape pdf-codec's own raster suite builds, over byte-codec's ByteWriter. ---

class SmallFixture {
  private readonly writer = new ByteWriter();
  private readonly offsets = new Map<number, number>();

  constructor() {
    this.writer.writeAscii("%PDF-1.7\n");
  }

  object(num: number, body: string): this {
    this.offsets.set(num, this.writer.length);
    this.writer.writeAscii(`${num} 0 obj\n${body}\nendobj\n`);
    return this;
  }

  stream(
    num: number,
    dictWithoutLength: string,
    raw: Uint8Array<ArrayBuffer>,
  ): this {
    this.offsets.set(num, this.writer.length);
    const dict = dictWithoutLength.replace(
      />>\s*$/,
      ` /Length ${raw.length} >>`,
    );
    this.writer.writeAscii(`${num} 0 obj\n${dict}\nstream\n`);
    this.writer.writeBytes(raw);
    this.writer.writeAscii("\nendstream\nendobj\n");
    return this;
  }

  classicXrefAndTrailer(
    maxObjNum: number,
    trailerExtra: string,
  ): Uint8Array<ArrayBuffer> {
    const xrefOffset = this.writer.length;
    this.writer.writeAscii(`xref\n0 ${maxObjNum + 1}\n`);
    this.writer.writeAscii("0000000000 65535 f \n");
    for (let n = 1; n <= maxObjNum; n++) {
      const offset = this.offsets.get(n);
      this.writer.writeAscii(
        offset === undefined
          ? "0000000000 00000 f \n"
          : `${offset.toString().padStart(10, "0")} 00000 n \n`,
      );
    }
    this.writer.writeAscii(
      `trailer\n<< /Size ${maxObjNum + 1} ${trailerExtra} >>\nstartxref\n${xrefOffset}\n%%EOF`,
    );
    return this.writer.toBytes();
  }
}

function enc(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text);
}

// One page, 200 x 100 pt, with the caller's content stream and optional extra resource entries.
function onePagePdf(
  content: string,
  options: { readonly pageResources?: string } = {},
): Uint8Array<ArrayBuffer> {
  const b = new SmallFixture();
  b.object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  b.object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  b.object(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] ${options.pageResources ?? "/Resources << /Font << /F1 4 0 R >> >>"} /Contents 5 0 R >>`,
  );
  b.object(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  b.stream(5, "<< >>", enc(content));
  return b.classicXrefAndTrailer(5, "/Root 1 0 R");
}

// --- Helpers: render through the real composition and read pixels back. ---

function drive(
  bytes: Uint8Array<ArrayBuffer>,
  pageIndex: number,
  options: RenderPdfPageOptions,
  backendOptions?: CpuRasteriserOptions,
): Uint8Array<ArrayBuffer> {
  const result = renderPdfPage(
    bytes,
    pageIndex,
    options,
    createCpuRasteriser(backendOptions),
  );
  if (result instanceof Promise) {
    throw new Error("CpuRasteriser.finish never returns a promise");
  }
  return result;
}

function renderPixels(
  bytes: Uint8Array<ArrayBuffer>,
  options: RenderPdfPageOptions = {},
): RawImage {
  return decodePng(drive(bytes, 0, options));
}

function pixelAt(
  image: RawImage,
  x: number,
  y: number,
): readonly [number, number, number] {
  const index = (y * image.width + x) * 3;
  return [
    image.data[index] ?? 0,
    image.data[index + 1] ?? 0,
    image.data[index + 2] ?? 0,
  ];
}

const WHITE: readonly [number, number, number] = [255, 255, 255];
const BLACK: readonly [number, number, number] = [0, 0, 0];

function regionAll(
  image: RawImage,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): readonly [number, number, number][] {
  const pixels: [number, number, number][] = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      pixels.push([...pixelAt(image, x, y)] as [number, number, number]);
    }
  }
  return pixels;
}

// The bounding box of every non-white pixel, for the ink-scaling assertions.
function inkBounds(image: RawImage): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const [r, g, b] = pixelAt(image, x, y);
      if (r < 250 || g < 250 || b < 250) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  if (minX === Infinity) {
    throw new Error("fixture setup: no ink found to bound");
  }
  return { minX, minY, maxX, maxY };
}

// --- The rasteriser's own page-state contract, driven directly. ---

describe("CpuRasteriser page state", () => {
  it("refuses draw and finish before beginPage, naming the operation", () => {
    const rasteriser = new CpuRasteriser();
    expect(() => {
      rasteriser.draw({
        kind: "fillRect",
        xPx: 0,
        yPx: 0,
        widthPx: 1,
        heightPx: 1,
        color: { r: 0, g: 0, b: 0 },
      });
    }).toThrow(/CpuRasteriser.draw\(\) was called before beginPage/);
    expect(() => rasteriser.finish()).toThrow(
      /CpuRasteriser.finish\(\) was called before beginPage/,
    );
  });

  it("renders any number of pages sequentially on one instance", () => {
    const b = new SmallFixture();
    b.object(1, "<< /Type /Catalog /Pages 2 0 R >>");
    b.object(2, "<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>");
    b.object(
      3,
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 20 20] /Resources << >> /Contents 4 0 R >>",
    );
    b.stream(4, "<< >>", enc("1 0 0 rg 5 5 10 10 re f"));
    b.object(
      6,
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 20 20] /Resources << >> /Contents 7 0 R >>",
    );
    b.stream(7, "<< >>", enc("0 0 1 rg 5 5 10 10 re f"));
    const bytes = b.classicXrefAndTrailer(7, "/Root 1 0 R");

    const rasteriser = createCpuRasteriser();
    const first = renderPdfPage(bytes, 0, {}, rasteriser);
    const second = renderPdfPage(bytes, 1, {}, rasteriser);
    expect(first).toBeInstanceOf(Uint8Array);
    const firstImage = decodePng(first);
    const secondImage = decodePng(second);
    expect(pixelAt(firstImage, 10, 10)).toEqual([255, 0, 0]);
    expect(pixelAt(secondImage, 10, 10)).toEqual([0, 0, 255]);
  });
});

// --- fillRect: analytic coverage. ---

describe("fillRect pixels", () => {
  it("paints the rect's interior exactly and leaves everything outside white", () => {
    const image = renderPixels(onePagePdf("1 0 0 rg 10 20 30 40 re f"));
    expect(image.width).toBe(200);
    expect(image.height).toBe(100);
    expect(image.channels).toBe(3);
    // Page y 20..60 maps to device y 40..80 (the y flip): interior pixel (25, 60) is red, corners outside are white.
    expect(pixelAt(image, 25, 60)).toEqual([255, 0, 0]);
    expect(pixelAt(image, 39, 79)).toEqual([255, 0, 0]);
    expect(pixelAt(image, 5, 5)).toEqual(WHITE);
    expect(pixelAt(image, 45, 60)).toEqual(WHITE);
    expect(pixelAt(image, 25, 85)).toEqual(WHITE);
  });

  it("blends a fractional edge at the exact analytic fraction", () => {
    // A rect starting at x 10.5: column 10 is covered from 10.5, an exact 0.5 overlap, so a 50%-grey red fill lands at exactly the half-blend of (128, 0, 0) over white.
    const image = renderPixels(onePagePdf("0.5 0 0 rg 10.5 20 30 40 re f"));
    expect(pixelAt(image, 10, 60)).toEqual([192, 128, 128]);
    expect(pixelAt(image, 40, 60)).toEqual([192, 128, 128]);
    expect(pixelAt(image, 25, 60)).toEqual([128, 0, 0]);
    expect(pixelAt(image, 9, 60)).toEqual(WHITE);
  });

  it("clamps a rect straddling the page edge instead of painting outside the canvas", () => {
    // Page rect (-10, -10)-(20, 20) straddles the bottom-left corner: device y 80..110 clamps to 80..100, x -10..20 clamps to 0..20.
    const image = renderPixels(onePagePdf("0 0 0 rg -10 -10 30 30 re f"));
    expect(pixelAt(image, 0, 80)).toEqual(BLACK);
    expect(pixelAt(image, 19, 99)).toEqual(BLACK);
    expect(pixelAt(image, 0, 79)).toEqual(WHITE);
    expect(pixelAt(image, 20, 80)).toEqual(WHITE);
  });

  it("renders an empty page as an exactly all-white canvas", () => {
    const image = renderPixels(onePagePdf(""));
    expect(image.data).toEqual(
      new Uint8Array(image.width * image.height * 3).fill(255),
    );
  });
});

// --- Determinism: the same draw ops produce byte-identical PNGs. ---

describe("deterministic output", () => {
  const content =
    "1 0 0 rg 10 20 30 40 re f 0 0 0 RG 2 w 10 10 m 90 10 l S 0 0 0 rg 100 10 m 130 10 l 115 40 l h f";

  it("produces byte-identical PNGs across renders", () => {
    const first = drive(onePagePdf(content), 0, {});
    const second = drive(onePagePdf(content), 0, {});
    expect([...second]).toEqual([...first]);
  });

  it("emits a real PNG file whose decoded dimensions are the page geometry", () => {
    const png = drive(onePagePdf(content), 0, {});
    expect(png[0]).toBe(0x89);
    expect(png[1]).toBe(0x50);
    expect(png[2]).toBe(0x4e);
    expect(png[3]).toBe(0x47);
    const image = decodePng(png);
    expect(image.width).toBe(200);
    expect(image.height).toBe(100);
  });

  it("scales the canvas by the requested factor", () => {
    const scaled = renderPixels(onePagePdf(content), { scale: 2 });
    expect(scaled.width).toBe(400);
    expect(scaled.height).toBe(200);
  });
});

// --- Path fills through the scanline coverage pass. ---

describe("path fill pixels", () => {
  it("keeps a same-wound inner ring filled under nonzero and holed under evenodd", () => {
    // Two concentric rects in one path, same winding direction: nonzero fills the inner ring too (winding 2 is still nonzero); evenodd (f*) cuts it out as a hole. Page y 10..70 -> device y 30..90, so the sampled interior points flip accordingly.
    const nonzero = renderPixels(
      onePagePdf("0 0 0 rg 10 10 60 60 re 20 20 40 40 re f"),
    );
    expect(pixelAt(nonzero, 15, 85)).toEqual(BLACK);
    expect(pixelAt(nonzero, 40, 60)).toEqual(BLACK);
    const evenodd = renderPixels(
      onePagePdf("0 0 0 rg 10 10 60 60 re 20 20 40 40 re f*"),
    );
    expect(pixelAt(evenodd, 15, 85)).toEqual(BLACK);
    expect(pixelAt(evenodd, 40, 60)).toEqual(WHITE);
    expect(pixelAt(evenodd, 21, 79)).toEqual(WHITE);
    expect(pixelAt(evenodd, 59, 41)).toEqual(WHITE);
  });

  it("fills an open subpath as implicitly closed", () => {
    // A triangle with no h before f: the port's fill semantics treat the open subpath as closed.
    const image = renderPixels(
      onePagePdf("0 0 0 rg 100 10 m 130 10 l 115 40 l f"),
    );
    // Device space: page y 10..40 -> device y 60..90; the triangle's interior centrecolumn is at device x ~115.
    expect(pixelAt(image, 115, 75)).toEqual(BLACK);
    expect(pixelAt(image, 115, 55)).toEqual(WHITE);
    expect(pixelAt(image, 90, 75)).toEqual(WHITE);
  });

  it("fills a four-cubic ellipse at its centre and not outside it", () => {
    const k = 0.5523;
    const cy = 40;
    const cx = 70;
    const rx = 30;
    const ry = 20;
    const content = [
      "0 0 0 rg",
      `${cx + rx} ${cy} m`,
      `${cx + rx} ${cy + ry * k} ${cx + rx * k} ${cy + ry} ${cx} ${cy + ry} c`,
      `${cx - rx * k} ${cy + ry} ${cx - rx} ${cy + ry * k} ${cx - rx} ${cy} c`,
      `${cx - rx * k} ${cy - ry} ${cx - rx} ${cy - ry * k} ${cx} ${cy - ry} c`,
      `${cx + rx * k} ${cy - ry} ${cx + rx} ${cy - ry * k} ${cx + rx} ${cy} c`,
      "h f",
    ].join("\n");
    const image = renderPixels(onePagePdf(content));
    // Centre page (70, 40) -> device (70, 60); a point outside the ellipse's shorter radius: page (70, 62) -> device (70, 38) is above the ellipse top (page y 60).
    expect(pixelAt(image, 70, 60)).toEqual(BLACK);
    expect(pixelAt(image, 70, 38)).toEqual(WHITE);
    expect(pixelAt(image, 38, 60)).toEqual(WHITE);
    expect(pixelAt(image, 102, 60)).toEqual(WHITE);
  });

  it("antialiases a fill edge at the 1/16 coverage quantum", () => {
    // A triangle whose diagonal edge crosses pixel columns at a non-half fraction: coverage steps by 1/16 per subsample, so some boundary column holds a strictly intermediate blend. Pinning that an intermediate value exists (rather than one exact value) keeps this robust to flattening while still proving supersampling happened.
    const image = renderPixels(
      onePagePdf("0 0 0 rg 10 10 m 100 10 l 10 90 l h f"),
    );
    const intermediates = regionAll(image, 10, 20, 90, 85).filter(
      ([r, g, b]) => r !== 0 && r !== 255 && g === r && b === r,
    );
    expect(intermediates.length).toBeGreaterThan(10);
    // Every intermediate value must be a multiple of the coverage quantum over black-and-white: 255 * k / 16 rounded.
    for (const [r] of intermediates) {
      const expected = Math.round(
        (255 * Math.round((r / 255) * COVERAGE_DENOMINATOR)) /
          COVERAGE_DENOMINATOR,
      );
      expect(Math.abs(r - expected)).toBeLessThanOrEqual(8);
    }
  });
});

// --- Strokes: quads, joins, dashes, and the zero-width clamp. ---

describe("stroke pixels", () => {
  it("paints a 2pt horizontal line as exactly its two centred device rows", () => {
    // Page y 10 -> device y 90; half-width 1 puts the band over device rows 89 and 90 exactly.
    const image = renderPixels(onePagePdf("0 0 0 RG 2 w 10 10 m 90 10 l S"));
    expect(pixelAt(image, 50, 89)).toEqual(BLACK);
    expect(pixelAt(image, 50, 90)).toEqual(BLACK);
    expect(pixelAt(image, 50, 88)).toEqual(WHITE);
    expect(pixelAt(image, 50, 91)).toEqual(WHITE);
    expect(pixelAt(image, 9, 89)).toEqual(WHITE); // butt cap: nothing before the start point
    expect(pixelAt(image, 89, 89)).toEqual(BLACK); // ...and nothing past the end point
    expect(pixelAt(image, 90, 89)).toEqual(WHITE);
  });

  it("miters an L-corner so the outer corner quadrant is fully covered", () => {
    // Vertical up then horizontal right, corner at page (10, 60) -> device (10, 40): the miter wedge must fill the outer quadrant device x [9,10) x y [39,40) completely, and the inner overlap quadrant [10,11) x [40,41) is covered by the quads themselves.
    const image = renderPixels(
      onePagePdf("0 0 0 RG 2 w 10 10 m 10 60 l 60 60 l S"),
    );
    expect(pixelAt(image, 9, 39)).toEqual(BLACK);
    expect(pixelAt(image, 10, 40)).toEqual(BLACK);
    expect(pixelAt(image, 9, 38)).toEqual(WHITE);
    expect(pixelAt(image, 8, 39)).toEqual(WHITE);
  });

  it("dashes with the pattern's on/off lengths", () => {
    const image = renderPixels(
      onePagePdf("[6 6] 0 d 2 w 0 0 0 RG 10 80 m 190 80 l S"),
    );
    expect(pixelAt(image, 12, 20)).toEqual(BLACK); // first on run: x 10..16
    expect(pixelAt(image, 19, 20)).toEqual(WHITE); // first off run: x 16..22
    expect(pixelAt(image, 24, 20)).toEqual(BLACK); // second on run: x 22..28
  });

  it("clamps a zero-width stroke to one device pixel", () => {
    // "the thinnest possible width" (ISO 32000-1 8.4.3.2): a 1px band centred on device row 89.5 covers rows 89 and 90 at half coverage each -- 128 grey on both, white beyond.
    const image = renderPixels(onePagePdf("0 0 0 RG 0 w 10 10 m 90 10 l S"));
    expect(pixelAt(image, 50, 89)).toEqual([128, 128, 128]);
    expect(pixelAt(image, 50, 90)).toEqual([128, 128, 128]);
    expect(pixelAt(image, 50, 88)).toEqual(WHITE);
    expect(pixelAt(image, 50, 91)).toEqual(WHITE);
  });
});

// --- Images: bilinear sampling under the placement quad's coverage. ---

describe("image pixels", () => {
  function imageXobjectPdf(cm: string): Uint8Array<ArrayBuffer> {
    // A 2x2 FlateDecode RGB XObject: row 0 red/green, row 1 blue/white.
    const pixels = new Uint8Array([
      255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255,
    ]);
    const b = new SmallFixture();
    b.object(1, "<< /Type /Catalog /Pages 2 0 R >>");
    b.object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
    b.object(
      3,
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /XObject << /Im0 6 0 R >> >> /Contents 5 0 R >>",
    );
    b.stream(5, "<< >>", enc(`q ${cm} /Im0 Do Q`));
    b.stream(
      6,
      "<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode >>",
      deflate(pixels),
    );
    return b.classicXrefAndTrailer(6, "/Root 1 0 R");
  }

  it("copies a 1:1 placement exactly: destination centres land on texel centres", () => {
    // 2x2 source placed at 2x2 device pixels, page rect (10, 60)-(12, 62) -> device (10, 38)-(12, 40): row 38 is the image's own top row.
    const image = renderPixels(imageXobjectPdf("2 0 0 2 10 60 cm"));
    expect(pixelAt(image, 10, 38)).toEqual([255, 0, 0]);
    expect(pixelAt(image, 11, 38)).toEqual([0, 255, 0]);
    expect(pixelAt(image, 10, 39)).toEqual([0, 0, 255]);
    expect(pixelAt(image, 11, 39)).toEqual([255, 255, 255]);
    expect(pixelAt(image, 12, 38)).toEqual(WHITE);
    expect(pixelAt(image, 10, 40)).toEqual(WHITE);
  });

  it("samples the edge texels exactly at a 40x20 placement's corners", () => {
    // Page rect (10, 60)-(50, 80) -> device (10, 20)-(50, 40): corner pixel centres clamp to the corner texels; the exact centre lands strictly between all four.
    const image = renderPixels(imageXobjectPdf("40 0 0 20 10 60 cm"));
    expect(pixelAt(image, 10, 20)).toEqual([255, 0, 0]);
    expect(pixelAt(image, 49, 20)).toEqual([0, 255, 0]);
    expect(pixelAt(image, 10, 39)).toEqual([0, 0, 255]);
    expect(pixelAt(image, 49, 39)).toEqual([255, 255, 255]);
    const centre = pixelAt(image, 30, 30);
    // The bilinear formula, spelled out: u = 0.5125, v = 0.525 against the 2x2 red/green/blue/white texels.
    const fx = 0.5125 * 2 - 0.5;
    const fy = 0.525 * 2 - 0.5;
    const lerp = (t0: number, t1: number, f: number): number =>
      t0 + (t1 - t0) * f;
    const corners: readonly (readonly [number, number, number])[] = [
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
      [255, 255, 255],
    ];
    const expected = [0, 1, 2].map((channel) => {
      const [c0, c1, c2, c3] = corners;
      if (
        c0 === undefined ||
        c1 === undefined ||
        c2 === undefined ||
        c3 === undefined
      ) {
        throw new Error("fixture setup: corner list incomplete");
      }
      return Math.round(
        lerp(
          lerp(c0[channel], c1[channel], fx),
          lerp(c2[channel], c3[channel], fx),
          fy,
        ),
      );
    });
    expect([...centre]).toEqual(expected);
  });

  it("declines a JPEG image by name and still renders the rest of the page", () => {
    // SOI + SOF0 (1x1, 1 component, no sampling) + EOI: enough for the port's own JPEG recovery (a marker scan), and never decoded here.
    const jpeg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01,
      0x01, 0x11, 0x00, 0xff, 0xd9,
    ]);
    const b = new SmallFixture();
    b.object(1, "<< /Type /Catalog /Pages 2 0 R >>");
    b.object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
    b.object(
      3,
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /XObject << /Im0 6 0 R >> >> /Contents 5 0 R >>",
    );
    b.stream(
      5,
      "<< >>",
      enc("0 0 0 rg 10 10 30 10 re f q 20 0 0 20 100 40 cm /Im0 Do Q"),
    );
    b.stream(
      6,
      "<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode >>",
      jpeg,
    );
    const bytes = b.classicXrefAndTrailer(6, "/Root 1 0 R");

    const diagnostics: RasterCpuDiagnostic[] = [];
    const image = decodePng(
      drive(bytes, 0, {}, { onDiagnostic: (d) => diagnostics.push(d) }),
    );
    expect(diagnostics.map((d) => d.code)).toEqual([
      "raster-cpu/jpeg-image-undecoded",
    ]);
    // The rect on the same page still painted (page y 10..20 -> device rows 80..90); the image's placement area stayed white.
    expect(pixelAt(image, 25, 85)).toEqual(BLACK);
    expect(pixelAt(image, 110, 40)).toEqual(WHITE);
  });
});

// --- Text: real embedded sfnt outlines to real pixels, via the writer's own dominant font shape. ---

describe("text pixels through embedded outlines", () => {
  function calibriTextPdf(): Uint8Array<ArrayBuffer> {
    return writePdf(
      {
        formatVersion: 1,
        metadata: {},
        images: {},
        pages: [
          {
            widthPt: 200,
            heightPt: 100,
            items: [
              {
                kind: "text",
                text: "H",
                xPt: 20,
                yPt: 50,
                font: { family: "Calibri", weight: "normal", style: "normal" },
                sizePt: 24,
                color: { r: 0, g: 0, b: 0 },
              },
            ],
          },
        ],
      },
      { fonts: createFontRegistry() },
    );
  }

  it("renders glyph ink between baseline and cap height, and nothing elsewhere", () => {
    const image = renderPixels(calibriTextPdf());
    // Baseline at page y 50 -> device row 50; cap height at 24pt is roughly 17pt, so ink lives in device rows ~33..50 and columns ~20..37.
    const ink = regionAll(image, 18, 30, 40, 52).filter(([r]) => r < 128);
    expect(ink.length).toBeGreaterThan(20);
    // Above the cap, below the baseline, and either side of the glyph: white.
    expect(regionAll(image, 0, 0, 200, 25)).toEqual(
      Array(200 * 25).fill(WHITE),
    );
    expect(regionAll(image, 0, 55, 200, 100)).toEqual(
      Array(200 * 45).fill(WHITE),
    );
    expect(regionAll(image, 0, 25, 15, 55)).toEqual(Array(15 * 30).fill(WHITE));
    expect(regionAll(image, 45, 25, 200, 55)).toEqual(
      Array(155 * 30).fill(WHITE),
    );
  });

  it("doubles the ink bounding box at scale 2", () => {
    const one = renderPixels(calibriTextPdf());
    const two = renderPixels(calibriTextPdf(), { scale: 2 });
    expect(two.width).toBe(2 * one.width);
    expect(two.height).toBe(2 * one.height);
    const box1 = inkBounds(one);
    const box2 = inkBounds(two);
    expect(box2.minX).toBeGreaterThanOrEqual(2 * box1.minX - 1);
    expect(box2.minX).toBeLessThanOrEqual(2 * box1.minX + 1);
    expect(box2.maxX).toBeGreaterThanOrEqual(2 * box1.maxX - 1);
    expect(box2.maxX).toBeLessThanOrEqual(2 * box1.maxX + 1);
    expect(box2.minY).toBeGreaterThanOrEqual(2 * box1.minY - 1);
    expect(box2.minY).toBeLessThanOrEqual(2 * box1.minY + 1);
    expect(box2.maxY).toBeGreaterThanOrEqual(2 * box1.maxY - 1);
    expect(box2.maxY).toBeLessThanOrEqual(2 * box1.maxY + 1);
  });

  it("renders just the clip region, re-origined at its own top-left", () => {
    const image = renderPixels(calibriTextPdf(), {
      clipPt: { xPt: 15, yPt: 45, widthPt: 30, heightPt: 30 },
    });
    expect(image.width).toBe(30);
    expect(image.height).toBe(30);
    const ink = regionAll(image, 0, 0, 30, 30).filter(([r]) => r < 128);
    expect(ink.length).toBeGreaterThan(10);
    // The clip band sits between device rows 25..55 globally, so every ink pixel's own rows here come from that band -- and the band's first rows (above cap height inside the clip) stay white.
    expect(regionAll(image, 0, 0, 30, 6)).toEqual(Array(30 * 6).fill(WHITE));
  });
});
