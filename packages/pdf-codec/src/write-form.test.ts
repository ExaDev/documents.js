import { describe, expect, it } from "vitest";
import { openPdfDocument } from "./document";
import type { LayoutDocument, LayoutFormField, LayoutItem } from "./layout";
import { LAYOUT_FORMAT_VERSION } from "./layout";
import type { PdfDict } from "./objects";
import { asArray, asName, asNumber, dictGet } from "./objects";
import { writePdf } from "./write";

const HELVETICA = {
  family: "Helvetica",
  weight: "normal",
  style: "normal",
} as const;
const BLACK = { r: 0, g: 0, b: 0 };

// The hex spelling this writer gives every literal string (writeObject serialises text as
// UTF-16BE-with-BOM for /Producer-style strings and plain hex for literal-string operands).

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

// A minimal, hand-built JPEG: SOI, a baseline SOF0 segment declaring 3x2 pixels / 3 components / 8-bit precision, then EOI. No huffman/quant tables or entropy-coded scan data — readJpegInfo only scans for the SOF marker and never decodes samples, so this is a fully valid input for it despite not being a real, viewable image.

// Same shape as tinyJpegAsset, generalised over component count and an optional Adobe APP14 marker (ISO 32000-1 has no opinion on this marker; it's a de facto Adobe convention every real CMYK JPEG carries), for exercising prepareJpegImage's colour-space and /Decode-inversion branches.

describe("writePdf: AcroForm fields (#967)", () => {
  it("round-trips terminal fields, widgets, choices, and groups", async () => {
    const doc: LayoutDocument = {
      formatVersion: LAYOUT_FORMAT_VERSION,
      metadata: {},
      pages: [{ widthPt: 200, heightPt: 100, items: [] }],
      images: {},
      form: [
        {
          name: "email",
          fieldType: "text",
          value: "a@b.c",
          alias: "Email address",
          widgets: [
            { pageIndex: 0, xPt: 10, yPt: 60, widthPt: 80, heightPt: 12 },
          ],
          children: [],
        },
        {
          name: "subscribe",
          fieldType: "checkbox",
          checked: true,
          widgets: [
            { pageIndex: 0, xPt: 10, yPt: 40, widthPt: 10, heightPt: 10 },
          ],
          children: [],
        },
        {
          name: "contact",
          fieldType: "group",
          widgets: [],
          children: [
            {
              name: "contact.reason",
              fieldType: "combobox",
              value: "billing",
              options: ["billing", "support"],
              widgets: [
                { pageIndex: 0, xPt: 10, yPt: 20, widthPt: 60, heightPt: 12 },
                { pageIndex: 0, xPt: 10, yPt: 5, widthPt: 60, heightPt: 12 },
              ],
              children: [],
            },
          ],
        },
      ],
    };
    const { readPdf } = await import("./read");
    const reread = readPdf(writePdf(doc));
    expect(reread.form).toEqual([
      {
        name: "email",
        fieldType: "text",
        value: "a@b.c",
        alias: "Email address",
        widgets: [
          { pageIndex: 0, xPt: 10, yPt: 60, widthPt: 80, heightPt: 12 },
        ],
        children: [],
      },
      {
        name: "subscribe",
        fieldType: "checkbox",
        checked: true,
        value: "Yes",
        widgets: [
          { pageIndex: 0, xPt: 10, yPt: 40, widthPt: 10, heightPt: 10 },
        ],
        children: [],
      },
      {
        name: "contact",
        fieldType: "group",
        widgets: [],
        children: [
          {
            name: "contact.reason",
            fieldType: "combobox",
            value: "billing",
            options: ["billing", "support"],
            widgets: [
              { pageIndex: 0, xPt: 10, yPt: 20, widthPt: 60, heightPt: 12 },
              { pageIndex: 0, xPt: 10, yPt: 5, widthPt: 60, heightPt: 12 },
            ],
            children: [],
          },
        ],
      },
    ]);
  });

  it("never splits a group field into per-widget kid objects, even one that carries more than one widget", () => {
    // Multi-widget object-splitting is a TERMINAL-field concept (12.7.4's own /Kids-as-widgets spelling); a group field's own /Kids are its child FIELDS, never widget annotations, so this must stay a single object regardless of how many widgets it happens to carry.
    const doc: LayoutDocument = {
      formatVersion: LAYOUT_FORMAT_VERSION,
      metadata: {},
      pages: [{ widthPt: 200, heightPt: 100, items: [] }],
      images: {},
      form: [
        {
          name: "oddGroup",
          fieldType: "group",
          widgets: [
            { pageIndex: 0, xPt: 10, yPt: 60, widthPt: 10, heightPt: 10 },
            { pageIndex: 0, xPt: 10, yPt: 40, widthPt: 10, heightPt: 10 },
          ],
          children: [
            {
              name: "oddGroup.child",
              fieldType: "text",
              value: "x",
              widgets: [
                { pageIndex: 0, xPt: 10, yPt: 20, widthPt: 60, heightPt: 12 },
              ],
              children: [],
            },
          ],
        },
      ],
    };
    const text = decode(writePdf(doc, { compress: false }));
    // Exactly 2 field objects (the group itself, plus its one terminal child) — if the group's own 2 widgets were wrongly split into their own kid objects, a third and fourth "/Subtype /Widget" object would exist beyond the child's own.
    expect(text.match(/\/Subtype \/Widget/g)).toHaveLength(1);
  });

  it("maps radio, button, and signature field types to their own /FT value", () => {
    const doc: LayoutDocument = {
      formatVersion: LAYOUT_FORMAT_VERSION,
      metadata: {},
      pages: [{ widthPt: 200, heightPt: 100, items: [] }],
      images: {},
      form: [
        {
          name: "choice",
          fieldType: "radio",
          widgets: [
            { pageIndex: 0, xPt: 10, yPt: 60, widthPt: 10, heightPt: 10 },
          ],
          children: [],
        },
        {
          name: "submit",
          fieldType: "button",
          widgets: [
            { pageIndex: 0, xPt: 10, yPt: 40, widthPt: 40, heightPt: 12 },
          ],
          children: [],
        },
        {
          name: "sig",
          fieldType: "signature",
          widgets: [
            { pageIndex: 0, xPt: 10, yPt: 20, widthPt: 40, heightPt: 12 },
          ],
          children: [],
        },
      ],
    };
    const text = decode(writePdf(doc, { compress: false }));
    expect(text).toContain("/FT /Btn");
    expect(text).toContain("/FT /Sig");
    // radio and button both map to Btn, so distinguishing them isn't possible from /FT alone — but exactly two Btn fields and one Sig field must exist.
    expect(text.match(/\/FT \/Btn/g)).toHaveLength(2);
  });

  it("sets /Ff bits for read-only, pushbutton, radio, and combo, each independently and combined", () => {
    const fieldFor = (
      overrides: Partial<LayoutFormField> & { name: string },
    ): LayoutFormField => ({
      fieldType: "text",
      widgets: [{ pageIndex: 0, xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 }],
      children: [],
      ...overrides,
    });
    const doc: LayoutDocument = {
      formatVersion: LAYOUT_FORMAT_VERSION,
      metadata: {},
      pages: [{ widthPt: 200, heightPt: 100, items: [] }],
      images: {},
      form: [
        fieldFor({ name: "plain" }), // no flags at all — no /Ff entry
        fieldFor({ name: "locked", readOnly: true }), // 1
        fieldFor({ name: "push", fieldType: "button" }), // 4
        fieldFor({ name: "choice", fieldType: "radio" }), // 32768
        fieldFor({ name: "combo", fieldType: "combobox" }), // 131072
        fieldFor({ name: "lockedPush", fieldType: "button", readOnly: true }), // 1 | 4 = 5
      ],
    };
    const text = decode(writePdf(doc, { compress: false }));
    for (const ff of ["1", "4", "32768", "131072", "5"]) {
      expect(text).toContain(`/Ff ${ff}`);
    }
    // "plain" carries no flag bits at all — no /Ff entry for it, distinct from the others which each have their own combination. Field names are written as hex strings, so "plain" (0x706c61696e) identifies its own object's line.
    const plainLine = text
      .split("\n")
      .find((line) => line.includes("<706c61696e>"));
    expect(plainLine).toBeDefined();
    expect(plainLine).not.toContain("/Ff");
  });

  it.each([
    { checked: true, value: undefined, expected: "Yes" },
    { checked: false, value: undefined, expected: "Off" },
    { checked: undefined, value: undefined, expected: "Off" },
    { checked: false, value: "onValue", expected: "onValue" }, // an explicit export value wins regardless of checked
    { checked: true, value: "onValue", expected: "onValue" },
  ] as const)(
    "gives a checkbox its own /V export value for checked=$checked, value=$value",
    ({ checked, value, expected }) => {
      const doc: LayoutDocument = {
        formatVersion: LAYOUT_FORMAT_VERSION,
        metadata: {},
        pages: [{ widthPt: 200, heightPt: 100, items: [] }],
        images: {},
        form: [
          {
            name: "box",
            fieldType: "checkbox",
            ...(checked === undefined ? {} : { checked }),
            ...(value === undefined ? {} : { value }),
            widgets: [
              { pageIndex: 0, xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
            ],
            children: [],
          },
        ],
      };
      const text = decode(writePdf(doc, { compress: false }));
      expect(text).toContain(`/V /${expected}`);
    },
  );

  it("writes no /AcroForm for a document with no fields", () => {
    const bytes = writePdf({
      formatVersion: LAYOUT_FORMAT_VERSION,
      metadata: {},
      pages: [],
      images: {},
    });
    const text = new TextDecoder("latin1").decode(bytes);
    expect(text).not.toContain("/AcroForm");
  });

  it("writes no /AcroForm for a document whose form array is present but empty", () => {
    const bytes = writePdf({
      formatVersion: LAYOUT_FORMAT_VERSION,
      metadata: {},
      pages: [],
      images: {},
      form: [],
    });
    const text = new TextDecoder("latin1").decode(bytes);
    expect(text).not.toContain("/AcroForm");
  });

  it("lists every widget annotation in its page's /Annots as the field tree's own objects", () => {
    // A single-widget field merges into its field dict, so its page /Annots entry is that very object; a multi-widget field's widgets are separate kid objects, each listed in /Annots AND in the field's /Kids — the same annotation object in both places, the spelling real Acrobat files carry (ISO 32000-1 12.5.1: a page's /Annots holds indirect references to its annotations, and 12.7.4 hangs the widgets under the field). A viewer rendering only page-level /Annots sees every field widget without walking the AcroForm tree.
    const doc: LayoutDocument = {
      formatVersion: LAYOUT_FORMAT_VERSION,
      metadata: {},
      pages: [
        { widthPt: 200, heightPt: 100, items: [] },
        { widthPt: 200, heightPt: 100, items: [] },
      ],
      images: {},
      form: [
        {
          name: "email",
          fieldType: "text",
          widgets: [
            { pageIndex: 0, xPt: 10, yPt: 60, widthPt: 80, heightPt: 12 },
          ],
          children: [],
        },
        {
          name: "reason",
          fieldType: "listbox",
          widgets: [
            { pageIndex: 0, xPt: 10, yPt: 40, widthPt: 60, heightPt: 10 },
            { pageIndex: 0, xPt: 10, yPt: 20, widthPt: 60, heightPt: 10 },
          ],
          children: [],
        },
        {
          name: "sign",
          fieldType: "checkbox",
          widgets: [
            { pageIndex: 1, xPt: 10, yPt: 60, widthPt: 10, heightPt: 10 },
          ],
          children: [],
        },
      ],
    };
    const document = openPdfDocument(writePdf(doc), () => {});
    const pages = document.pages();
    const annotNums = (page: PdfDict): number[] =>
      (asArray(dictGet(page, "Annots")) ?? []).map((entry) =>
        entry.kind === "ref" ? entry.num : -1,
      );
    // Page 0 carries the merged email dict plus the reason field's two widget kids, in field order; page 1 carries the merged sign dict.
    expect(annotNums(pages[0]!)).toHaveLength(3);
    expect(annotNums(pages[1]!)).toHaveLength(1);

    // Every /Annots entry resolves to a widget: the merged dicts carry /Subtype /Widget alongside their field keys, the kid objects are plain widget annotations.
    for (const entry of asArray(dictGet(pages[0]!, "Annots")) ?? []) {
      expect(asName(dictGet(document.resolveDict(entry)!, "Subtype"))).toBe(
        "Widget",
      );
    }

    // The multi-widget field's /Kids and the page /Annots name the SAME two objects, not copies. /AcroForm /Fields lists the document's fields in model order, so the reason field is the second one.
    const acroForm = document.resolveDict(
      dictGet(document.catalog, "AcroForm"),
    )!;
    const reasonField = document.resolveDict(
      asArray(dictGet(acroForm, "Fields"))![1],
    )!;
    const kidsOfReason = (asArray(dictGet(reasonField, "Kids")) ?? [])
      .map((entry) => (entry.kind === "ref" ? entry.num : -1))
      .sort((a, b) => a - b);
    expect(kidsOfReason).toEqual(
      annotNums(pages[0]!)
        .slice(1)
        .sort((a, b) => a - b),
    );

    // The rect a viewer reads off the page's first annotation is the model's email widget: same object, same placement.
    const emailAnnot = document.resolveDict(
      asArray(dictGet(pages[0]!, "Annots"))![0],
    )!;
    expect(
      asArray(dictGet(emailAnnot, "Rect"))?.map((n) => asNumber(n)),
    ).toEqual([10, 60, 90, 72]);
    expect(asName(dictGet(emailAnnot, "FT"))).toBe("Tx");
  });
});

describe("writePdf: the tagged structure tree (#967)", () => {
  it("round-trips the element tree and each item's owning element", async () => {
    const heading = {
      kind: "text",
      text: "Title",
      xPt: 10,
      yPt: 80,
      font: HELVETICA,
      sizePt: 14,
      color: BLACK,
      structure: "e-h1",
    } as const;
    const body = {
      kind: "text",
      text: "Body",
      xPt: 10,
      yPt: 60,
      font: HELVETICA,
      sizePt: 10,
      color: BLACK,
      structure: "e-p",
    } as const;
    const doc: LayoutDocument = {
      formatVersion: LAYOUT_FORMAT_VERSION,
      metadata: {},
      pages: [{ widthPt: 200, heightPt: 100, items: [heading, body] }],
      images: {},
      structure: [
        {
          id: "e-root",
          type: "Document",
          children: [
            {
              id: "e-h1",
              type: "H1",
              title: "The heading",
              language: "en-GB",
              children: [],
            },
            { id: "e-p", type: "P", alt: "a paragraph", children: [] },
          ],
        },
      ],
    };
    const bytes = writePdf(doc, { compress: false });
    const rawText = new TextDecoder("latin1").decode(bytes);
    expect(rawText).toContain("/Type /StructElem");
    // A childless element carries no /K array at all, never an empty one.
    expect(rawText).not.toContain("/K []");
    expect(rawText).toContain("/P ");
    expect(rawText).toContain("/Lang");
    const { readPdf } = await import("./read");
    const reread = readPdf(bytes);
    const tree = reread.structure!;
    // Element ids are reader-minted in document order, so identity is positional: the first H1 under the root owns the heading item.
    expect(tree).toEqual([
      {
        id: tree[0]!.id,
        type: "Document",
        children: [
          expect.objectContaining({ type: "H1", title: "The heading" }),
          expect.objectContaining({ type: "P", alt: "a paragraph" }),
        ],
      },
    ]);
    const h1Id = tree[0]!.children[0]!.id;
    const pId = tree[0]!.children[1]!.id;
    const rereadItems = reread.pages[0]!.items;
    const rereadHeading = rereadItems.find(
      (item): item is Extract<LayoutItem, { kind: "text" }> =>
        item.kind === "text" && item.text === "Title",
    );
    const rereadBody = rereadItems.find(
      (item): item is Extract<LayoutItem, { kind: "text" }> =>
        item.kind === "text" && item.text === "Body",
    );
    expect(rereadHeading?.structure).toBe(h1Id);
    expect(rereadBody?.structure).toBe(pId);
  });

  it("writes no /StructTreeRoot for a document with no structure", () => {
    const bytes = writePdf({
      formatVersion: LAYOUT_FORMAT_VERSION,
      metadata: {},
      pages: [],
      images: {},
    });
    const text = new TextDecoder("latin1").decode(bytes);
    expect(text).not.toContain("/StructTreeRoot");
  });
});

describe("writePdf: package-level residue (#967)", () => {
  it("restores restorable rows and the XMP packet verbatim", async () => {
    const doc: LayoutDocument = {
      formatVersion: LAYOUT_FORMAT_VERSION,
      metadata: {},
      pages: [],
      images: {},
      source: {
        "page-mode": { format: "pdf", xml: "/UseOutlines" },
        "viewer-preferences": { format: "pdf", xml: "<< /HideToolbar true >>" },
        xmp: {
          format: "pdf",
          xml: '<?xpacket begin="" id="W1234"?> <x:xmpmeta/> <?xpacket end="w"?>',
        },
      },
    };
    const { readPdf } = await import("./read");
    const reread = readPdf(writePdf(doc));
    expect(reread.source?.["page-mode"]?.xml).toBe("/UseOutlines");
    expect(reread.source?.["viewer-preferences"]?.xml).toContain(
      "/HideToolbar true",
    );
    expect(reread.source?.xmp?.xml).toBe(doc.source?.xmp?.xml);
  });

  it("does not restore a row whose serialisation references source-file objects", async () => {
    const doc: LayoutDocument = {
      formatVersion: LAYOUT_FORMAT_VERSION,
      metadata: {},
      pages: [],
      images: {},
      source: {
        "output-intents": { format: "pdf", xml: "[ 12 0 R /Fit]" },
      },
    };
    const { readPdf } = await import("./read");
    const reread = readPdf(writePdf(doc));
    // A dangling "12 0 R" has no target in the new file; the row restores as nothing rather than corrupting the Catalog.
    expect(reread.source?.["output-intents"]).toBeUndefined();
  });

  it("does not restore a row whose serialisation is a dict that CONTAINS a reference, not just a bare array of one", async () => {
    const doc: LayoutDocument = {
      formatVersion: LAYOUT_FORMAT_VERSION,
      metadata: {},
      pages: [],
      images: {},
      source: {
        "piece-info": { format: "pdf", xml: "<< /Private 3 0 R >>" },
      },
    };
    const { readPdf } = await import("./read");
    const reread = readPdf(writePdf(doc));
    expect(reread.source?.["piece-info"]).toBeUndefined();
  });

  it("does not restore a row whose serialisation is a stream whose OWN dict contains a reference", async () => {
    const doc: LayoutDocument = {
      formatVersion: LAYOUT_FORMAT_VERSION,
      metadata: {},
      pages: [],
      images: {},
      source: {
        "piece-info": {
          format: "pdf",
          xml: "<< /Length 5 /Extra 3 0 R >>\nstream\nhello\nendstream",
        },
      },
    };
    const { readPdf } = await import("./read");
    const reread = readPdf(writePdf(doc));
    expect(reread.source?.["piece-info"]).toBeUndefined();
  });

  it("never restores the open-action row, including an inline action", async () => {
    // /OpenAction is active content: a viewer executes an inline JavaScript/Launch/URI action on open, so restoring it verbatim from a source file would re-arm attacker-supplied behaviour in the rewritten output. The row restores as nothing whether its serialisation is reference-free or not.
    const doc: LayoutDocument = {
      formatVersion: LAYOUT_FORMAT_VERSION,
      metadata: {},
      pages: [],
      images: {},
      source: {
        "open-action": {
          format: "pdf",
          xml: "<< /S /JavaScript /JS (app.alert(1)) >>",
        },
      },
    };
    const { readPdf } = await import("./read");
    const bytes = writePdf(doc);
    const text = new TextDecoder("latin1").decode(bytes);
    expect(text).not.toContain("/OpenAction");
    expect(readPdf(bytes).source?.["open-action"]).toBeUndefined();
  });
});

// options.formulas is writePdf's own side channel for embedded-math-font content (see this module's own top comment for why a formula cannot travel as an ordinary LayoutItem) — exercised here through writePdf itself, not just through math-content-write.ts/math-font-write.ts's own unit tests, since only this integration proves the allocation, the resource dict, and the emitted content stream actually agree on object numbers.
