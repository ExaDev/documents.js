// The images, figure/figcaption, passthrough and text-direction suites split from read.test.ts, carrying the PNG/GIF fixture builders they alone use.

import { describe, expect, it, vi } from "vitest";
import type { EpubDiagnostic, EpubDiagnosticSink } from "../diagnostics";
import { readXhtmlBody } from "./read";

const CONTENT_WIDTH_PT = 451.28;
// The first four bytes of a GIF signature ("GIF8", common to both GIF87a and GIF89a): neither PNG nor JPEG, so detectImageFormat rejects it.
const GIF_SIG_PREFIX = [0x47, 0x49, 0x46, 0x38];
const FAKE_IMAGE_WIDTH_PX = 96;
const FAKE_TALL_IMAGE_HEIGHT_PX = 192; // A4 minus 1in margins each side, matching src/read.ts's own default section geometry
function body(inner: string, attrs = ""): string {
  return `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"${attrs}><body>${inner}</body></html>`;
}
function read(
  xml: string,
  sink: (d: EpubDiagnostic) => void = () => undefined,
) {
  return readXhtmlBody(xml, {
    resolveImage: () => undefined,
    sink,
    sourceHref: "chapter1.xhtml",
    contentWidthPt: CONTENT_WIDTH_PT,
  }).blocks;
}

const PNG_SIG_HIGH_BIT_MARKER = 0x89;
const PNG_SIG_P = 0x50;
const PNG_SIG_N = 0x4e;
const PNG_SIG_G = 0x47;
const PNG_SIG_CR = 0x0d;
const PNG_SIG_LF = 0x0a;
const PNG_SIG_LINE_ENDING_DETECTOR = 0x1a;
const PNG_SIG = [
  PNG_SIG_HIGH_BIT_MARKER,
  PNG_SIG_P,
  PNG_SIG_N,
  PNG_SIG_G,
  PNG_SIG_CR,
  PNG_SIG_LF,
  PNG_SIG_LINE_ENDING_DETECTOR,
  PNG_SIG_LF,
];
const IHDR_TAG_I = 0x49;
const IHDR_TAG_H = 0x48;
const IHDR_TAG_D = 0x44;
const IHDR_TAG_R = 0x52;
const IHDR_TAG_BYTES = [IHDR_TAG_I, IHDR_TAG_H, IHDR_TAG_D, IHDR_TAG_R];
const UINT32_BYTES = 4;
const PNG_CHUNK_TYPE_OFFSET = PNG_SIG.length + UINT32_BYTES; // 12
const PNG_IHDR_WIDTH_OFFSET = PNG_CHUNK_TYPE_OFFSET + UINT32_BYTES; // 16
const PNG_IHDR_HEIGHT_OFFSET = PNG_IHDR_WIDTH_OFFSET + UINT32_BYTES; // 20
const PNG_HEADER_BYTES = PNG_IHDR_HEIGHT_OFFSET + UINT32_BYTES; // 24
const IHDR_TRAILING_FIELD_BYTES = 5;
const PNG_IHDR_CHUNK_DATA_BYTES =
  UINT32_BYTES + UINT32_BYTES + IHDR_TRAILING_FIELD_BYTES; // 13
const FAKE_PNG_TOTAL_BYTES =
  PNG_HEADER_BYTES + IHDR_TRAILING_FIELD_BYTES + UINT32_BYTES; // 33
const PNG_BIT_DEPTH_8 = 8;
const PNG_COLOUR_TYPE_TRUECOLOR_ALPHA = 6;

// A minimal PNG carrying only what src/image/dimensions.ts reads: the 8-byte signature plus an IHDR chunk.
function fakePng(widthPx: number, heightPx: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(FAKE_PNG_TOTAL_BYTES);
  bytes.set(PNG_SIG, 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(PNG_SIG.length, PNG_IHDR_CHUNK_DATA_BYTES);
  bytes.set(IHDR_TAG_BYTES, PNG_CHUNK_TYPE_OFFSET);
  view.setUint32(PNG_IHDR_WIDTH_OFFSET, widthPx);
  view.setUint32(PNG_IHDR_HEIGHT_OFFSET, heightPx);
  bytes.set(
    [PNG_BIT_DEPTH_8, PNG_COLOUR_TYPE_TRUECOLOR_ALPHA, 0, 0, 0],
    PNG_HEADER_BYTES,
  );
  return bytes;
}
describe("images", () => {
  it("resolves a manifest image to base64 with pt dimensions derived from its pixel size", () => {
    const bytes = fakePng(FAKE_IMAGE_WIDTH_PX, FAKE_TALL_IMAGE_HEIGHT_PX);
    const { blocks } = readXhtmlBody(
      body('<p><img src="a.png" alt="a picture"/></p>'),
      {
        resolveImage: (href) => (href === "a.png" ? bytes : undefined),
        sink: () => undefined,
        sourceHref: "chapter1.xhtml",
        contentWidthPt: CONTENT_WIDTH_PT,
      },
    );
    const [block] = blocks;
    expect(block?.kind).toBe("image");
    if (block?.kind === "image") {
      expect(typeof block.base64).toBe("string");
      expect(block.base64.length).toBeGreaterThan(0);
      expect({ ...block, base64: undefined }).toEqual({
        kind: "image",
        format: "png",
        base64: undefined,
        widthPt: 72, // 96px * 72/96
        heightPt: 144,
        altText: "a picture",
      });
    }
  });

  it("carries no altText key at all for a resolved image with an empty alt attribute", () => {
    const bytes = fakePng(FAKE_IMAGE_WIDTH_PX, FAKE_TALL_IMAGE_HEIGHT_PX);
    const { blocks } = readXhtmlBody(body('<p><img src="a.png" alt=""/></p>'), {
      resolveImage: (href) => (href === "a.png" ? bytes : undefined),
      sink: () => undefined,
      sourceHref: "chapter1.xhtml",
      contentWidthPt: CONTENT_WIDTH_PT,
    });
    const [block] = blocks;
    if (block === undefined) {
      throw new Error("expected an image block");
    }
    expect(Object.hasOwn(block, "altText")).toBe(false);
  });

  it("degrades to alt text with a diagnostic when the manifest has no such part", () => {
    const sink = vi.fn<EpubDiagnosticSink>();
    const blocks = read(
      body('<img src="missing.png" alt="fallback text"/>'),
      sink,
    );
    expect(blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "fallback text" }] },
    ]);
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "epub/image-unresolved",
        message:
          '<img src="missing.png"> names no resolvable manifest part; degraded to its alt text',
      }),
    );
  });

  it("drops an unresolved image with an empty alt attribute entirely, rather than an empty paragraph", () => {
    const blocks = read(body('<img src="missing.png" alt=""/>'));
    expect(blocks).toEqual([]);
  });

  it("degrades to alt text with a diagnostic for a resolved but unsupported format", () => {
    const sink = vi.fn<EpubDiagnosticSink>();
    const { blocks } = readXhtmlBody(body('<img src="a.gif" alt="a gif"/>'), {
      resolveImage: () => new Uint8Array(GIF_SIG_PREFIX),
      sink,
      sourceHref: "chapter1.xhtml",
      contentWidthPt: CONTENT_WIDTH_PT,
    });
    expect(blocks).toEqual([{ kind: "paragraph", runs: [{ text: "a gif" }] }]);
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "epub/image-format-unsupported",
        message:
          '<img src="a.gif"> is neither a PNG nor a JPEG (document-schema.js\'s ContentImageBlock supports only those two); degraded to its alt text',
      }),
    );
  });

  it("drops a resolved but unsupported-format image with an empty alt attribute entirely, rather than an empty paragraph", () => {
    const { blocks } = readXhtmlBody(body('<img src="a.gif" alt=""/>'), {
      resolveImage: () => new Uint8Array(GIF_SIG_PREFIX),
      sink: () => undefined,
      sourceHref: "chapter1.xhtml",
      contentWidthPt: CONTENT_WIDTH_PT,
    });
    expect(blocks).toEqual([]);
  });

  it("degrades an <img> nested inside a <span> to its alt text with a diagnostic, instead of vanishing", () => {
    const sink = vi.fn<EpubDiagnosticSink>();
    const blocks = read(
      body('<p>before <span><img src="a.png" alt="nested"/></span> after</p>'),
      sink,
    );
    expect(blocks).toEqual([
      {
        kind: "paragraph",
        runs: [{ text: "before " }, { text: "nested" }, { text: " after" }],
      },
    ]);
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "epub/image-inline-unsupported",
      }),
    );
  });

  it("degrades an <img> nested inside an <a> to its alt text, carrying the same hyperlink", () => {
    const sink = vi.fn<EpubDiagnosticSink>();
    const blocks = read(
      body(
        '<p><a href="https://example.com"><img src="a.png" alt="linked"/></a></p>',
      ),
      sink,
    );
    expect(blocks).toEqual([
      {
        kind: "paragraph",
        runs: [{ text: "linked", hyperlink: "https://example.com" }],
      },
    ]);
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "epub/image-inline-unsupported",
      }),
    );
  });

  it("produces no run but still diagnoses an <img> nested inline with no alt text", () => {
    const sink = vi.fn<EpubDiagnosticSink>();
    const blocks = read(
      body('<p>before <span><img src="a.png"/></span> after</p>'),
      sink,
    );
    expect(blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "before " }, { text: " after" }] },
    ]);
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "epub/image-inline-unsupported",
      }),
    );
  });

  it("does not fabricate a src attribute in the diagnostic message for a nested <img> with no src at all", () => {
    let diagnostic: EpubDiagnostic | undefined;
    read(body('<p><span><img alt="no src at all"/></span></p>'), (d) => {
      diagnostic = d;
    });
    expect(diagnostic?.code).toBe("epub/image-inline-unsupported");
    expect(diagnostic?.message).toContain("<img> is reached");
    expect(diagnostic?.message).not.toContain('src=""');
  });
});

describe("figure/figcaption", () => {
  it("reads the caption as a plain paragraph following the image", () => {
    const bytes = new Uint8Array([1]);
    const { blocks } = readXhtmlBody(
      body(
        '<figure><img src="a.png" alt="alt text"/><figcaption>Caption text</figcaption></figure>',
      ),
      {
        resolveImage: () => bytes,
        sink: () => undefined,
        sourceHref: "chapter1.xhtml",
        contentWidthPt: CONTENT_WIDTH_PT,
      },
    );
    // The fake single-byte image is neither a real PNG nor JPEG, so it degrades to its alt text — this test is about figure/figcaption structure, not image decoding (covered separately).
    expect(blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "alt text" }] },
      { kind: "paragraph", runs: [{ text: "Caption text" }] },
    ]);
  });

  // <figcaption> is Flow content (ExaDev/documents.js#1023): a direct-child <img> now splits into its own real ContentImageBlock via readContainerChildren, the same treatment a <p>'s own direct-child <img> already gets, rather than being flattened to alt text as if <figcaption> had no block list of its own to insert it into.
  it("splits a figcaption's own direct-child <img> into its own real image block, not flattened to alt text", () => {
    const bytes = fakePng(FAKE_IMAGE_WIDTH_PX, FAKE_IMAGE_WIDTH_PX);
    const { blocks } = readXhtmlBody(
      body(
        '<figure><figcaption>Caption <img src="a.png" alt="inline pic"/></figcaption></figure>',
      ),
      {
        resolveImage: (href) => (href === "a.png" ? bytes : undefined),
        sink: () => undefined,
        sourceHref: "chapter1.xhtml",
        contentWidthPt: CONTENT_WIDTH_PT,
      },
    );
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({
      kind: "paragraph",
      runs: [{ text: "Caption " }],
    });
    expect(blocks[1]).toMatchObject({ kind: "image" });
  });

  it("keeps a footnote reference construct carried by a <figcaption>'s own inline content, rather than discarding it", () => {
    const blocks = read(
      body(
        '<figure><figcaption>Caption<a epub:type="noteref" href="#fn1">1</a></figcaption></figure>' +
          '<aside epub:type="footnote" id="fn1"><p>Note body.</p></aside>',
      ),
    );
    expect(blocks[0]).toEqual({
      kind: "paragraph",
      runs: [{ text: "Caption" }, { text: "1" }],
      constructs: [
        {
          descriptor: { kind: "anchor", anchorType: "footnote", name: "fn1" },
          startRun: 1,
          endRun: 2,
        },
      ],
    });
  });
});

describe("div/section passthrough", () => {
  it("reads a div's children transparently", () => {
    const blocks = read(body("<div><p>inside</p></div>"));
    expect(blocks).toEqual([{ kind: "paragraph", runs: [{ text: "inside" }] }]);
  });
});

describe("text direction (the dir attribute)", () => {
  it("maps a block container's own dir onto every paragraph it produces", () => {
    const blocks = read(
      body(
        '<p dir="rtl">one</p><h2 dir="ltr">two</h2><pre dir="rtl">three</pre>',
      ),
    );
    expect(
      blocks.map((b) => (b.kind === "paragraph" ? b.direction : undefined)),
    ).toEqual(["rtl", "ltr", "rtl"]);
  });

  it("inherits a container's dir into arbitrarily nested paragraphs, with the nearest stated dir winning", () => {
    // XHTML's dir attribute inherits: a <div dir="rtl"> governs its descendants until one states a dir of its own.
    const blocks = read(
      body(
        '<div dir="rtl"><p>inherited</p><p dir="ltr">overridden</p>' +
          "<div><section><p>still inherited</p></section></div></div>" +
          "<p>outside</p>",
      ),
    );
    expect(
      blocks.map((b) => (b.kind === "paragraph" ? b.direction : undefined)),
    ).toEqual(["rtl", "ltr", "rtl", undefined]);
  });

  it("carries the dir of an li, a dt/dd, and a table cell onto their own paragraphs", () => {
    const blocks = read(
      body(
        '<ul><li dir="rtl">item</li></ul>' +
          '<dl><dt dir="rtl">term</dt><dd dir="ltr">definition</dd></dl>',
      ),
    );
    expect(
      blocks.map((b) => (b.kind === "paragraph" ? b.direction : undefined)),
    ).toEqual(["rtl", "rtl", "ltr"]);
    const table = read(
      body('<table><tr><td dir="rtl">cell</td></tr></table>'),
    ).find((b) => b.kind === "table");
    if (table === undefined) {
      throw new Error("expected a table block");
    }
    const cellParagraph = table.rows[0]?.cells[0]?.blocks[0];
    expect(
      cellParagraph?.kind === "paragraph" ? cellParagraph.direction : undefined,
    ).toBe("rtl");
  });

  it('leaves dir="auto" unmapped rather than guessing a direction for it', () => {
    // dir="auto" resolves at render time from the content's own first strong character — a fact ContentParagraph.direction's closed ltr/rtl vocabulary has no member for.
    const blocks = read(body('<p dir="auto">words</p>'));
    expect(blocks[0]).toEqual({ kind: "paragraph", runs: [{ text: "words" }] });
  });

  it("never sets a direction key at all when nothing in scope ever stated a dir", () => {
    // toEqual alone would pass even if decorateParagraph always attached a `direction: undefined` property (toEqual ignores undefined-valued keys), so this checks key presence directly.
    const blocks = read(body("<p>plain</p>"));
    expect(Object.hasOwn(blocks[0] as object, "direction")).toBe(false);
  });
});
