import { describe, expect, it } from "vitest";
import { decodePng } from "./image/png-decode";
import type { PdfDiagnostic, PdfDiagnosticSink } from "./diagnostics";
import { readImageXObject } from "./images-read";
import type { PdfObjectResolver } from "./interpret-types";
import type { PdfDict, PdfObject } from "./objects";
import {
  asDict,
  pdfArray,
  pdfDict,
  pdfName,
  pdfNum,
  pdfRef,
  pdfStream,
} from "./objects";
import {
  CCITT_FAX_FIXTURES,
  ccittFixtureBitmap,
  ccittFixtureBytes,
} from "./test-support/ccitt-fax";
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

const EMPTY_RESOLVER = makeResolver(new Map());

describe("readImageXObject: soft mask alpha", () => {
  it("attaches an /SMask as the alpha channel when dimensions and bit depth match", () => {
    const { sink } = collectDiagnostics();
    const smask = pdfStream(
      pdfDict({
        Width: pdfNum(1),
        Height: pdfNum(1),
        BitsPerComponent: pdfNum(8),
        ColorSpace: pdfName("DeviceGray"),
      }),
      new Uint8Array([128]),
    );
    const objects = new Map<number, PdfObject>([[7, smask]]);
    const dict = pdfDict({
      Width: pdfNum(1),
      Height: pdfNum(1),
      BitsPerComponent: pdfNum(8),
      ColorSpace: pdfName("DeviceRGB"),
      SMask: pdfRef(7, 0),
    });
    const result = readImageXObject(
      dict,
      new Uint8Array([10, 20, 30]),
      makeResolver(objects),
      sink,
    );
    const decoded = decodePng(result!.bytes);
    expect(decoded.alpha).toBeDefined();
    expect(Array.from(decoded.alpha!)).toEqual([128]);
  });
});

describe("readImageXObject: CCITTFaxDecode", () => {
  const fixture = CCITT_FAX_FIXTURES.find((f) => f.name === "diagonal")!;

  it("decodes a Group 4 fax image into a PNG with the original black and white pixels", () => {
    const { sink, diagnostics } = collectDiagnostics();
    const dict = pdfDict({
      Width: pdfNum(fixture.columns),
      Height: pdfNum(fixture.rows),
      BitsPerComponent: pdfNum(1),
      ColorSpace: pdfName("DeviceGray"),
      Filter: pdfName("CCITTFaxDecode"),
      DecodeParms: pdfDict({
        K: pdfNum(-1),
        Columns: pdfNum(fixture.columns),
        Rows: pdfNum(fixture.rows),
      }),
    });
    const result = readImageXObject(
      dict,
      ccittFixtureBytes(fixture.encodings.group4),
      EMPTY_RESOLVER,
      sink,
    );
    expect(diagnostics).toEqual([]);
    expect(result).toMatchObject({
      format: "png",
      widthPx: fixture.columns,
      heightPx: fixture.rows,
    });
    const decoded = decodePng(result!.bytes);
    expect(decoded).toMatchObject({
      width: fixture.columns,
      height: fixture.rows,
      channels: 1,
    });
    // /BlackIs1 defaulting to false puts black in the 0 bit, which a 1-bit /DeviceGray sample scales straight to 0.
    expect(Array.from(decoded.data)).toEqual(
      ccittFixtureBitmap(fixture).map((black) => (black ? 0 : 255)),
    );
  });

  it("inverts with a /Decode array, the same as any other 1-bit gray image", () => {
    const { sink } = collectDiagnostics();
    const dict = pdfDict({
      Width: pdfNum(fixture.columns),
      Height: pdfNum(fixture.rows),
      BitsPerComponent: pdfNum(1),
      ColorSpace: pdfName("DeviceGray"),
      Decode: pdfArray([pdfNum(1), pdfNum(0)]),
      Filter: pdfName("CCITTFaxDecode"),
      DecodeParms: pdfDict({
        K: pdfNum(-1),
        Columns: pdfNum(fixture.columns),
        Rows: pdfNum(fixture.rows),
      }),
    });
    const result = readImageXObject(
      dict,
      ccittFixtureBytes(fixture.encodings.group4),
      EMPTY_RESOLVER,
      sink,
    );
    expect(Array.from(decodePng(result!.bytes).data)).toEqual(
      ccittFixtureBitmap(fixture).map((black) => (black ? 255 : 0)),
    );
  });
});
