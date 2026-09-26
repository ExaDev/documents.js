import { bytesToBase64, encodePng } from "byte-codec";
import { describe, expect, it } from "vitest";
import type {
  LayoutDocument,
  LayoutFormField,
  LayoutImageAsset,
  LayoutItem,
  LayoutPage,
} from "./layout";
import { LAYOUT_FORMAT_VERSION } from "./layout";
import { writePdf } from "./write";

const HELVETICA = {
  family: "Helvetica",
  weight: "normal",
  style: "normal",
} as const;
const BLACK = { r: 0, g: 0, b: 0 };

// The hex spelling this writer gives every literal string (writeObject serialises text as
// UTF-16BE-with-BOM for /Producer-style strings and plain hex for literal-string operands).
function hexOf(text: string): string {
  return [...new TextEncoder().encode(text)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function docWithPages(
  pages: readonly LayoutPage[],
  images: Record<string, LayoutImageAsset> = {},
): LayoutDocument {
  return {
    formatVersion: LAYOUT_FORMAT_VERSION,
    metadata: {},
    pages: [...pages],
    images,
  };
}

function docWithItems(items: readonly LayoutItem[]): LayoutDocument {
  return docWithPages([{ widthPt: 612, heightPt: 792, items: [...items] }]);
}

// A minimal, hand-built JPEG: SOI, a baseline SOF0 segment declaring 3x2 pixels / 3 components / 8-bit precision, then EOI. No huffman/quant tables or entropy-coded scan data — readJpegInfo only scans for the SOF marker and never decodes samples, so this is a fully valid input for it despite not being a real, viewable image.

// Same shape as tinyJpegAsset, generalised over component count and an optional Adobe APP14 marker (ISO 32000-1 has no opinion on this marker; it's a de facto Adobe convention every real CMYK JPEG carries), for exercising prepareJpegImage's colour-space and /Decode-inversion branches.

describe("writePdf: bilevel and greyscale PNG images", () => {
  function pngAsset(
    data: Uint8Array<ArrayBuffer>,
    alpha?: Uint8Array<ArrayBuffer>,
  ): LayoutImageAsset {
    const width = 8;
    const height = 8;
    const bytes = encodePng({ width, height, channels: 1, data, alpha });
    return {
      format: "png",
      base64: bytesToBase64(bytes),
      widthPx: width,
      heightPx: height,
    };
  }

  // One white row atop seven black rows: vertically coherent, exactly the content G4 compresses
  // far below Flate.
  const bilevelData = new Uint8Array(64).fill(0);
  bilevelData.fill(255, 0, 8);

  it("states the G4 image's /DecodeParms exactly: K -1, the pixel dimensions, and BlackIs1 false", () => {
    const doc = docWithItems([
      { kind: "image", imageId: "i", xPt: 0, yPt: 0, widthPt: 8, heightPt: 8 },
    ]);
    doc.images.i = pngAsset(bilevelData);
    const text = decode(writePdf(doc));
    expect(text).toContain("/Filter /CCITTFaxDecode");
    expect(text).toContain("/K -1");
    expect(text).toContain("/Columns 8");
    expect(text).toContain("/Rows 8");
    expect(text).toContain("/BlackIs1 false");
  });

  it("keeps Flate, not Group 4, for a greyscale image whose samples are not all bilevel", () => {
    const grey = new Uint8Array(64).fill(128);
    const doc = docWithItems([
      { kind: "image", imageId: "i", xPt: 0, yPt: 0, widthPt: 8, heightPt: 8 },
    ]);
    doc.images.i = pngAsset(grey);
    const text = decode(writePdf(doc, { compress: false }));
    expect(text).not.toContain("/CCITTFaxDecode");
    // A 1-channel decode is /DeviceGray whatever the samples hold.
    expect(text).toContain("/DeviceGray");
  });

  it("keeps Flate and a generated /SMask for a bilevel image carrying a soft mask", () => {
    const doc = docWithItems([
      { kind: "image", imageId: "i", xPt: 0, yPt: 0, widthPt: 8, heightPt: 8 },
    ]);
    doc.images.i = pngAsset(bilevelData, new Uint8Array(64).fill(255));
    const text = decode(writePdf(doc));
    // The soft mask is what disqualifies the G4 path, and it is re-emitted as its own /SMask
    // XObject beside the Flate image.
    expect(text).not.toContain("/CCITTFaxDecode");
    expect(text).toContain("/Filter /FlateDecode");
    expect(text).toContain("/SMask ");
  });
});

describe("writePdf: standard-14 font flags", () => {
  it("marks Courier faces fixed-pitch by their family prefix, so Courier-Bold carries the bit too", () => {
    const doc = docWithItems([
      {
        kind: "text",
        text: "x",
        xPt: 0,
        yPt: 0,
        font: { family: "Courier", weight: "bold", style: "normal" },
        sizePt: 12,
        color: BLACK,
      },
    ]);
    const text = decode(writePdf(doc, { compress: false }));
    // Nonsymbolic (32) + fixed pitch (1) + force bold (262144).
    expect(text).toContain("/Flags 262177");
  });
});

describe("writePdf: resources and per-page optional keys", () => {
  it("writes no /Font and no /XObject at all for a page using neither", () => {
    const doc = docWithItems([
      {
        kind: "rect",
        xPt: 10,
        yPt: 10,
        widthPt: 30,
        heightPt: 20,
        fill: BLACK,
      },
    ]);
    const text = decode(writePdf(doc, { compress: false }));
    expect(text).not.toContain("/Font");
    expect(text).not.toContain("/XObject");
  });

  it("writes no /StructParents for a page whose items carry no structure marks", () => {
    const text = decode(writePdf(docWithItems([]), { compress: false }));
    expect(text).not.toContain("/StructParents");
  });

  it("writes no annotation for a page whose notes string is empty", () => {
    const doc = docWithPages([
      { widthPt: 100, heightPt: 100, items: [], notes: "" },
    ]);
    const text = decode(writePdf(doc, { compress: false }));
    expect(text).not.toContain("/Annots");
    expect(text).not.toContain("/Subtype /Text");
  });
});

describe("writePdf: the outline's own dictionary shape", () => {
  function objectTextOf(pdfText: string, num: number): string {
    const start = pdfText.indexOf(`${String(num)} 0 obj`);
    const end = pdfText.indexOf("endobj", start);
    if (start < 0 || end < 0) {
      throw new Error(`object ${String(num)} not found in the written PDF`);
    }
    return pdfText.slice(start, end);
  }

  it("chains single-level siblings with /Prev and /Next and never a /Next past the last", () => {
    const doc: LayoutDocument = {
      formatVersion: LAYOUT_FORMAT_VERSION,
      metadata: {},
      pages: [{ widthPt: 100, heightPt: 100, items: [] }],
      images: {},
      outline: [
        { title: "One", destination: undefined, children: [] },
        { title: "Two", destination: undefined, children: [] },
      ],
    };
    const text = decode(writePdf(doc, { compress: false }));
    const first = objectTextOf(text, 7);
    const second = objectTextOf(text, 8);
    expect(first).toContain(`/Title <${hexOf("One")}>`);
    expect(first).toContain("/Parent 6 0 R");
    expect(first).toContain("/Next 8 0 R");
    expect(first).not.toContain("/Count");
    expect(second).toContain(`/Title <${hexOf("Two")}>`);
    expect(second).toContain("/Prev 7 0 R");
    expect(second).not.toContain("/Next");
  });

  it("gives a parent item /First, /Last and a /Count of its children", () => {
    const doc: LayoutDocument = {
      formatVersion: LAYOUT_FORMAT_VERSION,
      metadata: {},
      pages: [{ widthPt: 100, heightPt: 100, items: [] }],
      images: {},
      outline: [
        {
          title: "Root",
          destination: undefined,
          children: [{ title: "Child", destination: undefined, children: [] }],
        },
      ],
    };
    const text = decode(writePdf(doc, { compress: false }));
    // Page 4, contents 5, root 6, parent item 7, child item 8.
    expect(text).toContain("/Size 9 ");
    const parent = objectTextOf(text, 7);
    expect(parent).toContain("/First 8 0 R");
    expect(parent).toContain("/Last 8 0 R");
    expect(parent).toContain("/Count 1");
  });

  it("names the offending construct when an outline destination is not in the destinations table", () => {
    const doc: LayoutDocument = {
      formatVersion: LAYOUT_FORMAT_VERSION,
      metadata: {},
      pages: [{ widthPt: 100, heightPt: 100, items: [] }],
      images: {},
      outline: [{ title: "Broken", destination: "nowhere", children: [] }],
    };
    expect(() => writePdf(doc)).toThrow(
      /outline item "Broken" names destination "nowhere"/,
    );
  });
});

describe("writePdf: internal link destinations", () => {
  const page = { widthPt: 100, heightPt: 100, items: [] } as const;

  it("names the link when its destination is missing from the destinations table", () => {
    const doc: LayoutDocument = {
      formatVersion: LAYOUT_FORMAT_VERSION,
      metadata: {},
      pages: [
        {
          ...page,
          items: [
            {
              kind: "internalLink",
              xPt: 0,
              yPt: 0,
              widthPt: 10,
              heightPt: 10,
              destination: "missing",
            },
          ],
        },
      ],
      images: {},
    };
    expect(() => writePdf(doc)).toThrow(
      /internal link names destination "missing"/,
    );
  });

  it("refuses a destination whose page index is beyond the document's own pages", () => {
    const doc: LayoutDocument = {
      formatVersion: LAYOUT_FORMAT_VERSION,
      metadata: {},
      pages: [
        {
          ...page,
          items: [
            {
              kind: "internalLink",
              xPt: 0,
              yPt: 0,
              widthPt: 10,
              heightPt: 10,
              destination: "away",
            },
          ],
        },
      ],
      images: {},
      destinations: [{ name: "away", pageIndex: 4, target: { kind: "fit" } }],
    };
    expect(() => writePdf(doc)).toThrow(
      /destination "away" names page index 4, which is beyond the document's own pages/,
    );
  });
});

describe("writePdf: form field values and names", () => {
  interface FieldCase {
    readonly label: string;
    readonly field: LayoutFormField;
    readonly assertions: readonly [string | RegExp, boolean][];
  }

  function textField(overrides: Partial<LayoutFormField>): LayoutFormField {
    return {
      name: "f",
      fieldType: "text",
      widgets: [{ pageIndex: 0, xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 }],
      children: [],
      ...overrides,
    };
  }

  function writeFieldText(field: LayoutFormField): string {
    const doc: LayoutDocument = {
      formatVersion: LAYOUT_FORMAT_VERSION,
      metadata: {},
      pages: [{ widthPt: 100, heightPt: 100, items: [] }],
      images: {},
      form: [field],
    };
    return decode(writePdf(doc, { compress: false }));
  }

  // The /V spelling a viewer actually reads, for each corner of the value/checked/type matrix:
  // text-family fields export their value as a literal string, buttons as a NAME, and a value-less
  // button falls back to Yes/Off from its own checked state.
  const cases: FieldCase[] = [
    {
      label: "a text field with a value exports it as a literal string",
      field: textField({ fieldType: "text", value: "Yes" }),
      assertions: [
        [`/V <${hexOf("Yes")}>`, true],
        ["/V /Yes", false],
      ],
    },
    {
      label: "a text field without a value carries no /V at all",
      field: textField({ fieldType: "text" }),
      assertions: [[/\/V/, false]],
    },
    {
      label: "a listbox field with a value exports it as a literal string",
      field: textField({ fieldType: "listbox", value: "first" }),
      assertions: [[`/V <${hexOf("first")}>`, true]],
    },
    {
      label: "a checked checkbox with no value exports /Yes",
      field: textField({ fieldType: "checkbox", checked: true }),
      assertions: [[/\/V \/Yes/, true]],
    },
    {
      label: "an unchecked checkbox with no value exports /Off",
      field: textField({ fieldType: "checkbox", checked: false }),
      assertions: [[/\/V \/Off/, true]],
    },
    {
      label: "an unchecked checkbox carrying its own value exports that value",
      field: textField({
        fieldType: "checkbox",
        checked: false,
        value: "Maybe",
      }),
      assertions: [["/V /Maybe", true]],
    },
    {
      label: "a radio field carrying a value exports it as a NAME",
      field: textField({ fieldType: "radio", value: "choice2" }),
      assertions: [
        [`/V <${hexOf("choice2")}>`, false],
        ["/V /choice2", true],
      ],
    },
  ];

  for (const { label, field, assertions } of cases) {
    it(`writes ${label}`, () => {
      const text = writeFieldText(field);
      for (const [expected, present] of assertions) {
        expect(
          typeof expected === "string"
            ? text.includes(expected)
            : expected.test(text),
        ).toBe(present);
      }
    });
  }

  it("writes no /V for a push-button or signature field carrying a value", () => {
    // The button family's export-value spelling covers checkbox and radio only: a push button
    // and a signature have no checked state to export and no /V at all.
    for (const fieldType of ["button", "signature"] as const) {
      const text = writeFieldText(textField({ fieldType, value: "x" }));
      expect(text).not.toContain("/V ");
    }
  });

  it("maps every choice family field type to /FT /Ch", () => {
    for (const fieldType of ["listbox", "combobox"] as const) {
      const text = writeFieldText(textField({ fieldType }));
      expect(text).toContain("/FT /Ch");
    }
  });

  it("decomposes a nested field's fully-qualified name into the /T chain", () => {
    const doc: LayoutDocument = {
      formatVersion: LAYOUT_FORMAT_VERSION,
      metadata: {},
      pages: [{ widthPt: 100, heightPt: 100, items: [] }],
      images: {},
      form: [
        {
          name: "shipping",
          fieldType: "group",
          widgets: [],
          children: [
            textField({ name: "shipping.address", fieldType: "text" }),
            textField({ name: "invoice", fieldType: "text" }),
          ],
        },
      ],
    };
    const text = decode(writePdf(doc, { compress: false }));
    expect(text).toContain(`/T <${hexOf("shipping")}>`);
    expect(text).toContain(`/T <${hexOf("address")}>`);
    expect(text).toContain(`/T <${hexOf("invoice")}>`);
  });

  it("carries a root-level field's whole name verbatim, however nested it looks", () => {
    // A root field has no parent to decompose against, so even a name that reads as
    // "parent.segment" or starts with a dot is the field's own /T in full.
    const doc: LayoutDocument = {
      formatVersion: LAYOUT_FORMAT_VERSION,
      metadata: {},
      pages: [{ widthPt: 100, heightPt: 100, items: [] }],
      images: {},
      form: [
        textField({ name: "undefined.x", fieldType: "text" }),
        textField({ name: ".weird", fieldType: "text" }),
        textField({ name: "", fieldType: "text" }),
      ],
    };
    const text = decode(writePdf(doc, { compress: false }));
    expect(text).toContain(`/T <${hexOf("undefined.x")}>`);
    expect(text).toContain(`/T <${hexOf(".weird")}>`);
    // An empty name writes no /T entry at all rather than an empty one.
    expect(text).not.toContain("/T <>");
  });

  it("merges a single-widget field's widget into its own dict", () => {
    const text = writeFieldText(textField({ name: "solo", fieldType: "text" }));
    // One widget means the field dict IS the annotation: /Subtype, /Rect and /P sit beside /FT,
    // and no /Kids entry exists to point anywhere else.
    expect(text).toContain("/Subtype /Widget");
    expect(text).toContain("/Rect [0 0 10 10]");
    expect(text).toContain("/P 4 0 R");
    // (The Pages tree's own /Kids is unrelated; what must not exist is one on the field.)
    expect(text).not.toContain("/Kids []");
  });

  it("never splits a zero-widget or multi-widget field the wrong way", () => {
    const doc: LayoutDocument = {
      formatVersion: LAYOUT_FORMAT_VERSION,
      metadata: {},
      pages: [{ widthPt: 100, heightPt: 100, items: [] }],
      images: {},
      form: [
        textField({ name: "bare", fieldType: "text", widgets: [] }),
        textField({
          name: "multi",
          fieldType: "text",
          widgets: [
            { pageIndex: 0, xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
            { pageIndex: 0, xPt: 0, yPt: 20, widthPt: 10, heightPt: 10 },
          ],
        }),
      ],
    };
    const text = decode(writePdf(doc, { compress: false }));
    // The zero-widget field is a bare field dict: no merged widget keys, no empty /Kids.
    expect(text).not.toContain("/Kids []");
    // A field with several widgets emits them as kid objects listed under /Kids.
    expect(text).toMatch(/\/Kids \[\d+ 0 R \d+ 0 R\s*\]/);
  });
});

describe("writePdf: the structure tree's own dictionary shape", () => {
  it("carries each optional element attribute and the parent reference in the element dict", () => {
    const heading = {
      kind: "text",
      text: "T",
      xPt: 10,
      yPt: 80,
      font: HELVETICA,
      sizePt: 10,
      color: BLACK,
      structure: "e-h",
    } as const;
    const doc: LayoutDocument = {
      formatVersion: LAYOUT_FORMAT_VERSION,
      metadata: {},
      pages: [{ widthPt: 200, heightPt: 100, items: [heading] }],
      images: {},
      structure: [
        {
          id: "e-root",
          type: "Document",
          actualText: "the whole document",
          children: [
            { id: "e-h", type: "H1", actualText: "the heading", children: [] },
          ],
        },
      ],
    };
    const bytes = writePdf(doc, { compress: false });
    const rawText = new TextDecoder("latin1").decode(bytes);
    expect(rawText).toContain(`/ActualText <${hexOf("the heading")}>`);
    expect(rawText).toContain(`/ActualText <${hexOf("the whole document")}>`);
    expect(rawText).toContain("/Type /StructElem");
    // The page's one standard-14 face takes font 4 and descriptor 5, page 6 and contents 7 come
    // next, elements 8 and 9 follow, then the root 10: each element's /P names its parent, the
    // root for top-level ones.
    expect(rawText).toContain("/P 10 0 R");
    expect(rawText).toContain("/Type /StructTreeRoot");
    // Two marked items on the page give the parent tree an entry whose array covers the highest
    // MCID, every slot either a reference or an explicit null.
    expect(rawText).toContain("/ParentTree 11 0 R");
  });
});

describe("writePdf: package-level residue round 2", () => {
  function residueDoc(rows: Record<string, { readonly xml: string }>): {
    readonly text: string;
  } {
    const doc = {
      formatVersion: LAYOUT_FORMAT_VERSION,
      metadata: {},
      pages: [],
      images: {},
      source: rows,
    } as unknown as LayoutDocument;
    return { text: decode(writePdf(doc, { compress: false })) };
  }

  it("restores the trailer /ID row verbatim into the written trailer", () => {
    const { text } = residueDoc({
      "trailer-id": { xml: "[<aabb> <ccdd>]" },
    });
    expect(text).toContain("/ID [<aabb> <ccdd>]");
  });

  it("skips a row whose dict merely CONTAINS a reference among other values, not only all-ref ones", () => {
    const { text } = residueDoc({
      "viewer-preferences": { xml: "<< /HideToolbar true /VP 5 0 R >>" },
    });
    expect(text).not.toContain("/ViewerPreferences");
  });

  it("restores nothing for a row whose serialisation does not parse at all, without failing the write", () => {
    const { text } = residueDoc({
      "viewer-preferences": { xml: "%%% not a PDF object" },
    });
    expect(text).not.toContain("/ViewerPreferences");
    expect(text).toContain("%%EOF");
  });

  it("writes the restored XMP packet as a /Metadata stream with the XML subtype", () => {
    const { text } = residueDoc({
      xmp: { xml: "<x:xmpmeta/>" },
    });
    expect(text).toContain("/Type /Metadata");
    expect(text).toContain("/Subtype /XML");
  });
});

describe("writePdf: encoding-choice and dictionary-shape edge cases", () => {
  function docWithPng(
    data: Uint8Array<ArrayBuffer>,
    alpha?: Uint8Array<ArrayBuffer>,
  ): LayoutDocument {
    const bytes = encodePng({ width: 8, height: 8, channels: 1, data, alpha });
    const doc = docWithItems([
      { kind: "image", imageId: "i", xPt: 0, yPt: 0, widthPt: 8, heightPt: 8 },
    ]);
    doc.images.i = {
      format: "png",
      base64: bytesToBase64(bytes),
      widthPx: 8,
      heightPx: 8,
    };
    return doc;
  }

  it("keeps Flate for a bilevel image whose G4 encoding would not come out smaller", () => {
    // A checkerboard is G4's worst case (every pixel a transition) while Flate's LZ77 matches the
    // repetition: the deterministic smaller-wins rule keeps Flate, with its /Filter stated.
    const checkerboard = new Uint8Array(64);
    for (let i = 0; i < 64; i++) {
      checkerboard[i] = ((i + Math.floor(i / 8)) % 2) * 255;
    }
    const bytes = writePdf(docWithPng(checkerboard));
    const text = decode(bytes);
    // The Flate assertion sits on the image XObject's own dictionary: the content stream is
    // Flate-compressed too, so a file-wide search would pass even without the image's /Filter.
    const imageObject = text.slice(
      text.indexOf("4 0 obj"),
      text.indexOf("endobj", text.indexOf("4 0 obj")),
    );
    expect(imageObject).toContain("/Filter /FlateDecode");
    expect(text).not.toContain("/CCITTFaxDecode");
  });

  it("numbers the generated /SMask as its own object beside the image", () => {
    const data = new Uint8Array(64).fill(0);
    data.fill(255, 0, 8);
    const text = decode(
      writePdf(docWithPng(data, new Uint8Array(64).fill(255))),
    );
    expect(text).toContain("/SMask 5 0 R");
    // And the numbering walk stays whole: image 4, /SMask 5, page 6, contents 7 — an xref of 8.
    expect(text).toContain("/Size 8 ");
  });
});

describe("writePdf: optional-content group objects", () => {
  it("states each layer's own /Type /OCG and /Name", () => {
    const doc: LayoutDocument = {
      formatVersion: LAYOUT_FORMAT_VERSION,
      metadata: {},
      pages: [{ widthPt: 100, heightPt: 100, items: [] }],
      images: {},
      layers: [{ name: "Background", visible: true }],
    };
    const text = decode(writePdf(doc, { compress: false }));
    expect(text).toContain("/Type /OCG");
    expect(text).toContain(`/Name <${hexOf("Background")}>`);
  });
});
