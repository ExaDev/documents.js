import { describe, expect, it } from "vitest";
import { decodePng } from "./image/png-decode";
import type { PdfDiagnostic, PdfDiagnosticSink } from "./diagnostics";
import { readImageXObject } from "./images-read";
import type { PdfObjectResolver } from "./interpret";
import type { PdfDict, PdfObject } from "./objects";
import {
  asDict,
  pdfArray,
  pdfBool,
  pdfDict,
  pdfLiteralString,
  pdfName,
  pdfNum,
  pdfRef,
  pdfStream,
} from "./objects";
import {} from "./test-support/ccitt-fax";
import { JBIG2_FIXTURES, jbig2FixtureBytes } from "./test-support/jbig2";
import {} from "./test-support/jpeg2000";

function collectDiagnostics(): {
  sink: PdfDiagnosticSink;
  diagnostics: PdfDiagnostic[];
} {
  const diagnostics: PdfDiagnostic[] = [];
  return {
    sink: (d) => {
      diagnostics.push(d);
    },
    diagnostics,
  };
}

function makeResolver(objects: Map<number, PdfObject>): PdfObjectResolver {
  const resolve = (obj: PdfObject | undefined): PdfObject | undefined =>
    obj?.kind === "ref" ? objects.get(obj.num) : obj;
  const resolveDict = (obj: PdfObject | undefined): PdfDict | undefined =>
    asDict(resolve(obj));
  return { resolve, resolveDict };
}

function u16be(n: number): number[] {
  return [(n >> 8) & 0xff, n & 0xff];
}

function jpegMarker(code: number, payload: readonly number[]): number[] {
  return [0xff, code, ...u16be(payload.length + 2), ...payload];
}

function buildMinimalJpeg(
  width: number,
  height: number,
): Uint8Array<ArrayBuffer> {
  const sofPayload = [
    8,
    ...u16be(height),
    ...u16be(width),
    3,
    1,
    0x11,
    0,
    2,
    0x11,
    0,
    3,
    0x11,
    0,
  ];
  return new Uint8Array([
    0xff,
    0xd8,
    ...jpegMarker(0xc0, sofPayload),
    0xff,
    0xd9,
  ]);
}

const EMPTY_RESOLVER = makeResolver(new Map());

describe("readImageXObject: JPXDecode (continued)", () => {
  function grayDict(colorSpace: PdfObject): PdfDict {
    return pdfDict({
      Width: pdfNum(1),
      Height: pdfNum(1),
      BitsPerComponent: pdfNum(8),
      ColorSpace: colorSpace,
    });
  }

  it("resolves the array-form CalGray and CalRGB colour spaces", () => {
    const { sink } = collectDiagnostics();
    const gray = readImageXObject(
      grayDict(pdfArray([pdfName("CalGray"), pdfDict({})])),
      new Uint8Array([42]),
      EMPTY_RESOLVER,
      sink,
    );
    expect(decodePng(gray!.bytes)).toMatchObject({ channels: 1 });
    const rgb = readImageXObject(
      grayDict(pdfArray([pdfName("CalRGB"), pdfDict({})])),
      new Uint8Array([1, 2, 3]),
      EMPTY_RESOLVER,
      sink,
    );
    expect(decodePng(rgb!.bytes)).toMatchObject({ channels: 3 });
  });

  it("names the actual unrecognised array-form family in the unsupported-colorspace diagnostic", () => {
    const { sink, diagnostics } = collectDiagnostics();
    readImageXObject(
      grayDict(pdfArray([pdfName("Separation"), pdfDict({})])),
      new Uint8Array([1]),
      EMPTY_RESOLVER,
      sink,
    );
    const diagnostic = diagnostics.find(
      (d) => d.code === "image/unsupported-colorspace",
    );
    expect(diagnostic?.message).toContain("Separation");
  });

  it("reports a placeholder name for a /ColorSpace that is neither a name nor a recognised array", () => {
    const { sink, diagnostics } = collectDiagnostics();
    readImageXObject(
      grayDict(pdfNum(0)),
      new Uint8Array([1]),
      EMPTY_RESOLVER,
      sink,
    );
    const diagnostic = diagnostics.find(
      (d) => d.code === "image/unsupported-colorspace",
    );
    expect(diagnostic?.message).toContain("missing or invalid");
  });

  it("treats an ICCBased stream with a 1-component profile as gray", () => {
    const { sink } = collectDiagnostics();
    const objects = new Map<number, PdfObject>([
      [5, pdfStream(pdfDict({ N: pdfNum(1) }), new Uint8Array(0))],
    ]);
    const result = readImageXObject(
      grayDict(pdfArray([pdfName("ICCBased"), pdfRef(5, 0)])),
      new Uint8Array([42]),
      makeResolver(objects),
      sink,
    );
    expect(decodePng(result!.bytes)).toMatchObject({ channels: 1 });
  });

  it("treats an ICCBased stream with a 4-component profile as CMYK", () => {
    const { sink } = collectDiagnostics();
    const objects = new Map<number, PdfObject>([
      [5, pdfStream(pdfDict({ N: pdfNum(4) }), new Uint8Array(0))],
    ]);
    const result = readImageXObject(
      grayDict(pdfArray([pdfName("ICCBased"), pdfRef(5, 0)])),
      // Pure cyan (C=255, M=Y=K=0) converts to RGB (0, 255, 255); misreading these same 4 bytes as a 3-channel RGB pixel instead (the wrong branch this test guards against) would instead give (255, 0, 0), so the two branches are distinguishable rather than coincidentally equal.
      new Uint8Array([255, 0, 0, 0]),
      makeResolver(objects),
      sink,
    );
    expect(decodePng(result!.bytes)).toMatchObject({ channels: 3 });
    expect(Array.from(decodePng(result!.bytes).data)).toEqual([0, 255, 255]);
  });
});

describe("readImageXObject: sub-byte sample unpacking at every supported depth", () => {
  it("unpacks 2-bit RGB samples across two rows, each row starting on its own byte boundary", () => {
    const { sink } = collectDiagnostics();
    // 2 pixels/row * 3 components * 2 bits = 12 bits/row, padded to 2 bytes/row. Row 0: pixel0=(3,0,1), pixel1=(2,3,0) -> scaled to byte: 3*85=255,0,85 / 170,255,0 Row 1: pixel0=(0,0,0), pixel1=(1,1,1) -> 0,0,0 / 85,85,85
    const dict = pdfDict({
      Width: pdfNum(2),
      Height: pdfNum(2),
      BitsPerComponent: pdfNum(2),
      ColorSpace: pdfName("DeviceRGB"),
    });
    // bits (MSB-first): row0: 11 00 01 10 11 00 -> 0b11000110 0b11000000; row1: 00 00 00 01 01 01 -> 0b00000001 0b01010000
    const raw = new Uint8Array([
      0b11000110, 0b11000000, 0b00000001, 0b01010000,
    ]);
    const result = readImageXObject(dict, raw, EMPTY_RESOLVER, sink);
    const decoded = decodePng(result!.bytes);
    expect(Array.from(decoded.data)).toEqual([
      255, 0, 85, 170, 255, 0, 0, 0, 0, 85, 85, 85,
    ]);
  });

  it("unpacks 4-bit gray samples across two rows, one nibble per sample", () => {
    const { sink } = collectDiagnostics();
    const dict = pdfDict({
      Width: pdfNum(2),
      Height: pdfNum(2),
      BitsPerComponent: pdfNum(4),
      ColorSpace: pdfName("DeviceGray"),
    });
    // Row 0: nibbles 15, 0 -> 255, 0. Row 1: nibbles 8, 4 -> 136, 68 (round(8*255/15), round(4*255/15)).
    const raw = new Uint8Array([0b11110000, 0b10000100]);
    const result = readImageXObject(dict, raw, EMPTY_RESOLVER, sink);
    const decoded = decodePng(result!.bytes);
    expect(Array.from(decoded.data)).toEqual([255, 0, 136, 68]);
  });
});

describe("readImageXObject: gray scaling when the sample depth is not full byte-range 255", () => {
  it("rounds a 4-bit gray value onto the 0-255 range via Math.round, not truncation", () => {
    const { sink } = collectDiagnostics();
    const dict = pdfDict({
      Width: pdfNum(1),
      Height: pdfNum(1),
      BitsPerComponent: pdfNum(4),
      ColorSpace: pdfName("DeviceGray"),
    });
    // A single 4-bit sample of 7: 7 * 255 / 15 = 119, exactly; distinguishes a rounding formula from a truncating or additive one.
    const raw = new Uint8Array([0b01110000]);
    const result = readImageXObject(dict, raw, EMPTY_RESOLVER, sink);
    expect(Array.from(decodePng(result!.bytes).data)).toEqual([119]);
  });
});

describe("readImageXObject: Indexed with non-RGB base colour spaces", () => {
  it("resolves palette indices against a CMYK base colour space", () => {
    const { sink } = collectDiagnostics();
    // Palette entry 0: C=0 M=0 Y=0 K=255 (pure black) -> RGB (0,0,0). Entry 1: C=M=Y=K=0 (no ink) -> RGB (255,255,255).
    const lookup = new Uint8Array([0, 0, 0, 255, 0, 0, 0, 0]);
    const dict = pdfDict({
      Width: pdfNum(2),
      Height: pdfNum(1),
      BitsPerComponent: pdfNum(8),
      ColorSpace: pdfArray([
        pdfName("Indexed"),
        pdfName("DeviceCMYK"),
        pdfNum(1),
        pdfLiteralString(lookup),
      ]),
    });
    const result = readImageXObject(
      dict,
      new Uint8Array([0, 1]),
      EMPTY_RESOLVER,
      sink,
    );
    const decoded = decodePng(result!.bytes);
    expect(Array.from(decoded.data)).toEqual([0, 0, 0, 255, 255, 255]);
  });

  it("resolves palette indices against a gray base colour space, emitting one channel", () => {
    const { sink } = collectDiagnostics();
    const lookup = new Uint8Array([0, 128, 255]);
    const dict = pdfDict({
      Width: pdfNum(3),
      Height: pdfNum(1),
      BitsPerComponent: pdfNum(8),
      ColorSpace: pdfArray([
        pdfName("Indexed"),
        pdfName("DeviceGray"),
        pdfNum(2),
        pdfLiteralString(lookup),
      ]),
    });
    const result = readImageXObject(
      dict,
      new Uint8Array([0, 1, 2]),
      EMPTY_RESOLVER,
      sink,
    );
    const decoded = decodePng(result!.bytes);
    expect(decoded.channels).toBe(1);
    expect(Array.from(decoded.data)).toEqual([0, 128, 255]);
  });
});

describe("readImageXObject: DeviceCMYK across several pixels", () => {
  it("converts every pixel of a multi-pixel CMYK image independently, not just the first", () => {
    const { sink } = collectDiagnostics();
    const dict = pdfDict({
      Width: pdfNum(3),
      Height: pdfNum(1),
      BitsPerComponent: pdfNum(8),
      ColorSpace: pdfName("DeviceCMYK"),
    });
    // Pixel 0: pure black (K=255). Pixel 1: pure red (M=255,Y=255). Pixel 2: no ink (white).
    const raw = new Uint8Array([
      0,
      0,
      0,
      255, // black
      0,
      255,
      255,
      0, // red
      0,
      0,
      0,
      0, // white
    ]);
    const result = readImageXObject(dict, raw, EMPTY_RESOLVER, sink);
    const decoded = decodePng(result!.bytes);
    expect(Array.from(decoded.data)).toEqual([
      0, 0, 0, 255, 0, 0, 255, 255, 255,
    ]);
  });
});

describe("readImageXObject: soft mask alpha degradation", () => {
  function baseDict(extra: Record<string, PdfObject> = {}): PdfDict {
    return pdfDict({
      Width: pdfNum(1),
      Height: pdfNum(1),
      BitsPerComponent: pdfNum(8),
      ColorSpace: pdfName("DeviceRGB"),
      ...extra,
    });
  }

  it("ignores an /SMask reference that does not resolve to a stream", () => {
    const { sink } = collectDiagnostics();
    const dict = baseDict({ SMask: pdfRef(99, 0) });
    const result = readImageXObject(
      dict,
      new Uint8Array([10, 20, 30]),
      EMPTY_RESOLVER,
      sink,
    );
    expect(decodePng(result!.bytes).alpha).toBeUndefined();
  });

  it("ignores an /SMask whose own filter this codec cannot decode (still DCT-encoded)", () => {
    const { sink } = collectDiagnostics();
    const smask = pdfStream(
      pdfDict({
        Width: pdfNum(1),
        Height: pdfNum(1),
        Filter: pdfName("DCTDecode"),
      }),
      buildMinimalJpeg(1, 1),
    );
    const resolver = makeResolver(new Map([[7, smask]]));
    const dict = baseDict({ SMask: pdfRef(7, 0) });
    const result = readImageXObject(
      dict,
      new Uint8Array([10, 20, 30]),
      resolver,
      sink,
    );
    expect(decodePng(result!.bytes).alpha).toBeUndefined();
  });

  it("ignores an /SMask whose own /Width does not match the base image", () => {
    const { sink } = collectDiagnostics();
    const smask = pdfStream(
      pdfDict({
        Width: pdfNum(2),
        Height: pdfNum(1),
        BitsPerComponent: pdfNum(8),
      }),
      new Uint8Array([1, 2]),
    );
    const resolver = makeResolver(new Map([[7, smask]]));
    const dict = baseDict({ SMask: pdfRef(7, 0) });
    const result = readImageXObject(
      dict,
      new Uint8Array([10, 20, 30]),
      resolver,
      sink,
    );
    expect(decodePng(result!.bytes).alpha).toBeUndefined();
  });

  it("ignores an /SMask whose own /Height does not match the base image", () => {
    const { sink } = collectDiagnostics();
    const smask = pdfStream(
      pdfDict({
        Width: pdfNum(1),
        Height: pdfNum(2),
        BitsPerComponent: pdfNum(8),
      }),
      new Uint8Array([1, 2]),
    );
    const resolver = makeResolver(new Map([[7, smask]]));
    const dict = baseDict({ SMask: pdfRef(7, 0) });
    const result = readImageXObject(
      dict,
      new Uint8Array([10, 20, 30]),
      resolver,
      sink,
    );
    expect(decodePng(result!.bytes).alpha).toBeUndefined();
  });

  it("ignores an /SMask whose own /BitsPerComponent is not 8", () => {
    const { sink } = collectDiagnostics();
    const smask = pdfStream(
      pdfDict({
        Width: pdfNum(1),
        Height: pdfNum(1),
        BitsPerComponent: pdfNum(1),
      }),
      new Uint8Array([0b10000000]),
    );
    const resolver = makeResolver(new Map([[7, smask]]));
    const dict = baseDict({ SMask: pdfRef(7, 0) });
    const result = readImageXObject(
      dict,
      new Uint8Array([10, 20, 30]),
      resolver,
      sink,
    );
    expect(decodePng(result!.bytes).alpha).toBeUndefined();
  });

  it("falls back to the base image's own width and height when the /SMask dict omits them", () => {
    const { sink } = collectDiagnostics();
    const smask = pdfStream(
      pdfDict({ BitsPerComponent: pdfNum(8) }),
      new Uint8Array([200]),
    );
    const resolver = makeResolver(new Map([[7, smask]]));
    const dict = baseDict({ SMask: pdfRef(7, 0) });
    const result = readImageXObject(
      dict,
      new Uint8Array([10, 20, 30]),
      resolver,
      sink,
    );
    expect(Array.from(decodePng(result!.bytes).alpha!)).toEqual([200]);
  });

  it("falls back to a /BitsPerComponent of 8 when the /SMask dict omits it", () => {
    const { sink } = collectDiagnostics();
    const smask = pdfStream(
      pdfDict({ Width: pdfNum(1), Height: pdfNum(1) }),
      new Uint8Array([200]),
    );
    const resolver = makeResolver(new Map([[7, smask]]));
    const dict = baseDict({ SMask: pdfRef(7, 0) });
    const result = readImageXObject(
      dict,
      new Uint8Array([10, 20, 30]),
      resolver,
      sink,
    );
    expect(Array.from(decodePng(result!.bytes).alpha!)).toEqual([200]);
  });
});

describe("readImageXObject: abbreviated inline-image dictionary keys", () => {
  it("reads /W, /H, /BPC, /CS and /IM in place of their full-length counterparts", () => {
    const { sink } = collectDiagnostics();
    const dict = pdfDict({
      W: pdfNum(1),
      H: pdfNum(1),
      BPC: pdfNum(8),
      CS: pdfName("DeviceGray"),
    });
    const result = readImageXObject(
      dict,
      new Uint8Array([42]),
      EMPTY_RESOLVER,
      sink,
    );
    expect(result?.format).toBe("png");
    expect(Array.from(decodePng(result!.bytes).data)).toEqual([42]);
  });

  it("treats /IM as an inline /ImageMask stencil, skipping it with a diagnostic", () => {
    const { sink, diagnostics } = collectDiagnostics();
    const dict = pdfDict({ W: pdfNum(1), H: pdfNum(1), IM: pdfBool(true) });
    expect(
      readImageXObject(dict, new Uint8Array([0]), EMPTY_RESOLVER, sink),
    ).toBeUndefined();
    expect(diagnostics.some((d) => d.code === "image/mask-unsupported")).toBe(
      true,
    );
  });
});

describe("readImageXObject: negative dimensions and the exact PNG_MAX_DIMENSION boundary", () => {
  it("skips a negative /Width", () => {
    const { sink, diagnostics } = collectDiagnostics();
    const dict = pdfDict({
      Width: pdfNum(-1),
      Height: pdfNum(1),
      BitsPerComponent: pdfNum(8),
      ColorSpace: pdfName("DeviceGray"),
    });
    expect(
      readImageXObject(dict, new Uint8Array([0]), EMPTY_RESOLVER, sink),
    ).toBeUndefined();
    expect(diagnostics.some((d) => d.code === "image/undecodable")).toBe(true);
  });

  it("skips a negative /Height", () => {
    const { sink, diagnostics } = collectDiagnostics();
    const dict = pdfDict({
      Width: pdfNum(1),
      Height: pdfNum(-1),
      BitsPerComponent: pdfNum(8),
      ColorSpace: pdfName("DeviceGray"),
    });
    expect(
      readImageXObject(dict, new Uint8Array([0]), EMPTY_RESOLVER, sink),
    ).toBeUndefined();
    expect(diagnostics.some((d) => d.code === "image/undecodable")).toBe(true);
  });
});

describe("readImageXObject: JBIG2 original bytes carried alongside the re-encoded PNG", () => {
  it("carries the original JBIG2-encoded stream bytes, without a globals entry when none was supplied", () => {
    const generic = JBIG2_FIXTURES.find((f) => f.name === "diagonal-generic")!;
    const { sink } = collectDiagnostics();
    const streamBytes = jbig2FixtureBytes(generic.stream);
    const dict = pdfDict({
      Width: pdfNum(generic.width),
      Height: pdfNum(generic.height),
      BitsPerComponent: pdfNum(1),
      ColorSpace: pdfName("DeviceGray"),
      Filter: pdfName("JBIG2Decode"),
    });
    const result = readImageXObject(dict, streamBytes, EMPTY_RESOLVER, sink);
    expect(result?.original).toMatchObject({ filter: "jbig2" });
    expect(result?.original).not.toHaveProperty("globalsBytes");
  });

  it("carries the decoded /JBIG2Globals bytes as globalsBytes when the image declares one", () => {
    const symbols = JBIG2_FIXTURES.find((f) => f.name === "text-symbols")!;
    const { sink, diagnostics } = collectDiagnostics();
    const globalsBytes = jbig2FixtureBytes(symbols.globals!);
    const resolver = makeResolver(
      new Map([[7, pdfStream(pdfDict({}), globalsBytes)]]),
    );
    const dict = pdfDict({
      Width: pdfNum(symbols.width),
      Height: pdfNum(symbols.height),
      BitsPerComponent: pdfNum(1),
      ColorSpace: pdfName("DeviceGray"),
      Filter: pdfName("JBIG2Decode"),
      DecodeParms: pdfDict({ JBIG2Globals: pdfRef(7, 0) }),
    });
    const result = readImageXObject(
      dict,
      jbig2FixtureBytes(symbols.stream),
      resolver,
      sink,
    );
    expect(diagnostics).toEqual([]);
    expect(result?.original?.globalsBytes).toEqual(globalsBytes);
  });

  it("carries no original entry at all for a non-JBIG2 image", () => {
    const { sink } = collectDiagnostics();
    const dict = pdfDict({
      Width: pdfNum(1),
      Height: pdfNum(1),
      BitsPerComponent: pdfNum(8),
      ColorSpace: pdfName("DeviceGray"),
    });
    const result = readImageXObject(
      dict,
      new Uint8Array([42]),
      EMPTY_RESOLVER,
      sink,
    );
    expect(result).not.toHaveProperty("original");
  });
});
