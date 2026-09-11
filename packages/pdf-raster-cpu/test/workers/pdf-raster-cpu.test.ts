import { describe, expect, it } from "vitest";
import { ByteWriter, decodePng } from "byte-codec";
import { renderPdfPage } from "pdf-codec/raster";
import { createCpuRasteriser } from "../../src";

// Proves pdf-raster-cpu executes inside a Cloudflare Workers isolate (workerd, via @cloudflare/vitest-pool-workers) with no Node-only APIs: the rasteriser itself, byte-codec's PNG encode/decode behind it, and pdf-codec's page walk through the pdf-codec/raster entry all run end to end and produce the same pinned pixels the node suite asserts -- so "runs identically under Node and workerd" is a checked fact rather than an assertion in a README. The fixture is built inline (workerd exposes no node:fs) by literal byte concatenation, the same construction the node suite explains. Byte-level determinism is additionally pinned inside the isolate: two renders of the same bytes produce identical PNGs, the property OCR-style consumers pipeline against.

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

  finish(maxObjNum: number, trailerExtra: string): Uint8Array<ArrayBuffer> {
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

function fixturePdf(): Uint8Array<ArrayBuffer> {
  const b = new SmallFixture();
  b.object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  b.object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  b.object(
    3,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
  );
  b.object(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  b.stream(
    5,
    "<< >>",
    new TextEncoder().encode(
      "1 0 0 rg 10 20 30 40 re f 0 0 0 RG 2 w 10 10 m 90 10 l S 0 0 0 rg 100 10 m 130 10 l 115 40 l h f",
    ),
  );
  return b.finish(5, "/Root 1 0 R");
}

function pixelAt(
  image: { readonly width: number; readonly data: Uint8Array<ArrayBuffer> },
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

describe("pdf-raster-cpu under the Cloudflare Workers runtime", () => {
  it("renders a page to the same pinned pixels the node suite asserts (no Node API)", () => {
    const png = renderPdfPage(fixturePdf(), 0, {}, createCpuRasteriser());
    if (png instanceof Promise) {
      throw new Error("CpuRasteriser.finish never returns a promise");
    }
    expect(png).toBeInstanceOf(Uint8Array);
    const image = decodePng(png);
    expect(image.width).toBe(200);
    expect(image.height).toBe(100);
    expect(image.channels).toBe(3);
    // The rect: red interior, white outside (page y 20..60 -> device rows 40..80).
    expect(pixelAt(image, 25, 60)).toEqual([255, 0, 0]);
    expect(pixelAt(image, 5, 5)).toEqual([255, 255, 255]);
    // The stroked line: exactly device rows 89 and 90.
    expect(pixelAt(image, 50, 89)).toEqual([0, 0, 0]);
    expect(pixelAt(image, 50, 90)).toEqual([0, 0, 0]);
    expect(pixelAt(image, 50, 91)).toEqual([255, 255, 255]);
    // The filled triangle: ink inside, none above it.
    expect(pixelAt(image, 115, 75)).toEqual([0, 0, 0]);
    expect(pixelAt(image, 115, 55)).toEqual([255, 255, 255]);
  });

  it("produces byte-identical PNGs for identical draw ops inside the isolate", () => {
    const first = renderPdfPage(fixturePdf(), 0, {}, createCpuRasteriser());
    const second = renderPdfPage(fixturePdf(), 0, {}, createCpuRasteriser());
    if (first instanceof Promise || second instanceof Promise) {
      throw new Error("CpuRasteriser.finish never returns a promise");
    }
    expect([...second]).toEqual([...first]);
  });
});
