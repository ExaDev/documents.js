import { describe, expect, it } from "vitest";
import type { ContentDocument, ContentVector } from "document-schema.js";

import type { SvgDiagnostic } from "./diagnostics";
import { readSvgContent } from "./read";
import { buildSvgText } from "./write";
import {
  SvgMultiPageNotSpecifiedError,
  SvgPageNotFoundError,
  SvgUnsupportedDocumentKindError,
} from "./write";
import {
  decodeSvgText,
  encodeSvgText,
  SvgUndecodableTextError,
  SvgUnsupportedEncodingError,
} from "./text";

// The read tests below want an identity root map — width/height in pt equal to the viewBox extents — so every user-unit coordinate lands in the page-point space unchanged and assertions read the SVG's own numbers back.
const IDENTITY_ROOT =
  '<svg xmlns="http://www.w3.org/2000/svg" width="100pt" height="60pt" viewBox="0 0 100 60">';
const svg = (inner: string, root = IDENTITY_ROOT): string =>
  `${root}${inner}</svg>`;

function drawingDocument(
  pages: readonly { readonly vectors: readonly ContentVector[] }[],
  title?: string,
): ContentDocument {
  return {
    kind: "drawing",
    metadata: title === undefined ? {} : { title },
    pages: pages.map((page) => ({
      size: { widthPt: 100, heightPt: 60 },
      shapes: [],
      vectors: [...page.vectors],
    })),
  };
}

describe("buildSvgText", () => {
  it("writes each vector kind as its own shape element at 1:1 page points", () => {
    const text = buildSvgText(
      drawingDocument([
        {
          vectors: [
            {
              kind: "rect",
              frame: { xPt: 10, yPt: 20, widthPt: 30, heightPt: 40 },
              fill: { r: 1, g: 0, b: 0 },
              paintOrder: 0,
            },
            {
              kind: "ellipse",
              frame: { xPt: 10, yPt: 20, widthPt: 30, heightPt: 40 },
              paintOrder: 1,
            },
            {
              kind: "line",
              from: { xPt: 0, yPt: 0 },
              to: { xPt: 10, yPt: 10 },
              stroke: { color: { r: 0, g: 0, b: 1 }, widthPt: 1 },
              paintOrder: 2,
            },
            {
              kind: "path",
              frame: { xPt: 10, yPt: 20, widthPt: 20, heightPt: 20 },
              subpaths: [
                {
                  start: { xPt: 0, yPt: 0 },
                  closed: true,
                  segments: [{ kind: "line", to: { xPt: 20, yPt: 20 } }],
                },
              ],
              fill: { r: 1, g: 1, b: 0 },
              paintOrder: 3,
            },
          ],
        },
      ]),
    );
    expect(text).toContain(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100pt" height="60pt" viewBox="0 0 100 60">',
    );
    expect(text).toContain(
      '<rect x="10" y="20" width="30" height="40" fill="#ff0000"/>',
    );
    // An ellipse without a fill writes fill="none", since an absent fill paints nothing rather than SVG's black default — which would change the drawing's appearance.
    expect(text).toContain(
      '<ellipse cx="25" cy="40" rx="15" ry="20" fill="none"/>',
    );
    expect(text).toContain(
      '<line x1="0" y1="0" x2="10" y2="10" stroke="#0000ff" stroke-width="1"/>',
    );
    expect(text).toContain('<path d="M10 20 L30 40 Z" fill="#ffff00"/>');
  });

  it("writes the stroke styles, and reports double as solid under a diagnostic", () => {
    const diagnostics: SvgDiagnostic[] = [];
    const text = buildSvgText(
      drawingDocument([
        {
          vectors: [
            {
              kind: "line",
              from: { xPt: 0, yPt: 0 },
              to: { xPt: 10, yPt: 0 },
              stroke: {
                color: { r: 0, g: 0, b: 0 },
                widthPt: 1,
                style: "dashed",
              },
              paintOrder: 0,
            },
            {
              kind: "line",
              from: { xPt: 0, yPt: 5 },
              to: { xPt: 10, yPt: 5 },
              stroke: {
                color: { r: 0, g: 0, b: 0 },
                widthPt: 1,
                style: "dotted",
              },
              paintOrder: 1,
            },
            {
              kind: "line",
              from: { xPt: 0, yPt: 10 },
              to: { xPt: 10, yPt: 10 },
              stroke: {
                color: { r: 0, g: 0, b: 0 },
                widthPt: 1,
                style: "double",
              },
              paintOrder: 2,
            },
          ],
        },
      ]),
      {
        onSvgDiagnostic: (diagnostic) => {
          diagnostics.push(diagnostic);
        },
      },
    );
    expect(text).toContain('stroke-dasharray="6 4"');
    expect(text).toContain('stroke-dasharray="1 3" stroke-linecap="round"');
    expect(text).not.toContain('stroke-dasharray="double"');
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "svg/stroke-style-unsupported",
    ]);
  });

  it("writes rotationDeg as a rotate() transform about the frame's own centre", () => {
    const text = buildSvgText(
      drawingDocument([
        {
          vectors: [
            {
              kind: "rect",
              frame: { xPt: 10, yPt: 20, widthPt: 30, heightPt: 20 },
              rotationDeg: 30,
              paintOrder: 0,
            },
          ],
        },
      ]),
    );
    expect(text).toContain('transform="rotate(30 25 30)"');
  });

  it("writes metadata.title as an escaped title element and omits it when absent", () => {
    expect(
      buildSvgText(drawingDocument([{ vectors: [] }]), undefined),
    ).not.toContain("<title>");
    const titled = buildSvgText(
      drawingDocument([{ vectors: [] }], "A & B <drawing>"),
    );
    expect(titled).toContain("<title>A &amp; B &lt;drawing&gt;</title>");
  });

  it("throws SvgUnsupportedDocumentKindError for a non-drawing ContentDocument", () => {
    const wordprocessing: ContentDocument = {
      kind: "wordprocessing",
      metadata: {},
      sections: [],
    };
    expect(() => buildSvgText(wordprocessing)).toThrow(
      SvgUnsupportedDocumentKindError,
    );
  });

  it("requires a page index for a multi-page document, naming the count, and writes the selected page", () => {
    const document = drawingDocument([
      {
        vectors: [
          {
            kind: "rect",
            frame: { xPt: 0, yPt: 0, widthPt: 5, heightPt: 5 },
            paintOrder: 0,
          },
        ],
      },
      {
        vectors: [
          {
            kind: "rect",
            frame: { xPt: 50, yPt: 30, widthPt: 5, heightPt: 5 },
            paintOrder: 0,
          },
        ],
      },
    ]);
    expect(() => buildSvgText(document)).toThrow(SvgMultiPageNotSpecifiedError);
    try {
      buildSvgText(document);
    } catch (error) {
      if (error instanceof SvgMultiPageNotSpecifiedError) {
        expect(error.pageCount).toBe(2);
      }
    }
    expect(buildSvgText(document, { page: 1 })).toContain(
      '<rect x="50" y="30" width="5" height="5"',
    );
  });

  it("throws SvgPageNotFoundError for an out-of-range index and for a document with no pages", () => {
    const document = drawingDocument([{ vectors: [] }]);
    expect(() => buildSvgText(document, { page: 5 })).toThrow(
      SvgPageNotFoundError,
    );
    const empty: ContentDocument = { kind: "drawing", metadata: {}, pages: [] };
    expect(() => buildSvgText(empty)).toThrow(SvgPageNotFoundError);
  });

  it("reports draw:frame content through svg/shape-unsupported rather than silently dropping it", () => {
    const diagnostics: SvgDiagnostic[] = [];
    const document: ContentDocument = {
      kind: "drawing",
      metadata: {},
      pages: [
        {
          size: { widthPt: 100, heightPt: 60 },
          shapes: [
            {
              name: "TextBox 1",
              frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
              insetLeftPt: 0,
              insetTopPt: 0,
              insetRightPt: 0,
              insetBottomPt: 0,
              blocks: [],
            },
          ],
          vectors: [],
        },
      ],
    };
    buildSvgText(document, {
      onSvgDiagnostic: (diagnostic) => {
        diagnostics.push(diagnostic);
      },
    });
    expect(diagnostics).toEqual([
      {
        code: "svg/shape-unsupported",
        detail:
          "TextBox 1: draw:frame text/image/table content has no SVG vector representation",
      },
    ]);
  });

  it("falls back to the literal 'shape' when a diagnostic's own shape has neither a name nor a sourcePath", () => {
    const diagnostics: SvgDiagnostic[] = [];
    const document: ContentDocument = {
      kind: "drawing",
      metadata: {},
      pages: [
        {
          size: { widthPt: 100, heightPt: 60 },
          shapes: [
            {
              frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
              insetLeftPt: 0,
              insetTopPt: 0,
              insetRightPt: 0,
              insetBottomPt: 0,
              blocks: [],
            },
          ],
          vectors: [],
        },
      ],
    };
    buildSvgText(document, {
      onSvgDiagnostic: (diagnostic) => {
        diagnostics.push(diagnostic);
      },
    });
    expect(diagnostics[0]?.detail).toMatch(/^shape:/);
  });

  it('writes a fill-rule="evenodd" attribute on a path vector whose own fillRule is evenodd', () => {
    const document: ContentDocument = {
      kind: "drawing",
      metadata: {},
      pages: [
        {
          size: { widthPt: 100, heightPt: 60 },
          shapes: [],
          vectors: [
            {
              kind: "path",
              frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
              fillRule: "evenodd",
              subpaths: [
                {
                  start: { xPt: 0, yPt: 0 },
                  segments: [],
                  closed: true,
                },
              ],
            },
          ],
        },
      ],
    };
    const text = buildSvgText(document);
    expect(text).toContain('fill-rule="evenodd"');
  });
});

describe("readSvgContent -> buildSvgText round trip", () => {
  it("round-trips the vector set exactly, rotation included, since write emits a 1:1 viewBox the reader maps through the identity", () => {
    const source = svg(`
      <rect x="10" y="5" width="30" height="20" fill="#ff0000"/>
      <rect x="40" y="5" width="20" height="10" transform="rotate(30 50 10)" fill="#00ff00"/>
      <ellipse cx="30" cy="40" rx="15" ry="10" fill="none" stroke="#0000ff" stroke-width="2"/>
      <line x1="0" y1="0" x2="90" y2="55" stroke="#000000" stroke-dasharray="6 4"/>
      <path d="M 10 10 L 50 10 L 50 30 Z" fill="#ffff00"/>
    `);
    const first = readSvgContent(source);
    const written = buildSvgText(first);
    const second = readSvgContent(written);
    if (first.kind !== "drawing" || second.kind !== "drawing") {
      throw new Error("expected drawing ContentDocuments");
    }
    expect(second.pages[0]?.vectors).toEqual(first.pages[0]?.vectors);
    expect(second.pages[0]?.size).toEqual(first.pages[0]?.size);
    expect(second.metadata).toEqual(first.metadata);
  });
});

// Latin-1 (0x00-0xFF) byte values for a string holding only characters in that range: JS's own charCodeAt already gives the exact byte value for every character both ISO-8859-1 and windows-1252 assign to that same code point, which is every character these fixtures use: accented Latin letters, never one of the five bytes (0x81/0x8D/0x8F/0x90/0x9D) the two encodings disagree on.
function latin1Bytes(text: string): number[] {
  return Array.from(text, (character) => character.charCodeAt(0));
}

// UTF-16LE bytes for a string holding only BMP characters (no surrogate pairs), with no byte order mark of its own; callers prepend one where the test wants it present.
function utf16leBytes(text: string): number[] {
  return Array.from(text, (character) => {
    const unit = character.charCodeAt(0);
    return [unit & 0xff, unit >> 8];
  }).flat();
}

describe("decodeSvgText / encodeSvgText", () => {
  it("round-trips text through the byte boundary, decoding as UTF-8 by default when the bytes carry no declaration or byte order mark", () => {
    expect(
      decodeSvgText(
        encodeSvgText('<svg xmlns="http://www.w3.org/2000/svg">café — ☃</svg>'),
      ),
    ).toBe('<svg xmlns="http://www.w3.org/2000/svg">café — ☃</svg>');
  });

  it("throws SvgUndecodableTextError on malformed UTF-8 rather than producing U+FFFD replacement characters", () => {
    const malformed = new Uint8Array([0xff, 0x00]);
    expect(() => decodeSvgText(malformed)).toThrow(SvgUndecodableTextError);
    let caught: unknown;
    try {
      decodeSvgText(malformed);
    } catch (error) {
      caught = error;
    }
    expect((caught as Error).name).toBe("SvgUndecodableTextError");
    expect((caught as SvgUndecodableTextError).encoding).toBe("utf-8");
    expect((caught as Error).message).toContain("not well-formed utf-8");
  });

  it("reads a non-UTF-8 encoding the XML prolog declares and decodes accordingly", () => {
    const text =
      '<?xml version="1.0" encoding="ISO-8859-1"?><svg xmlns="http://www.w3.org/2000/svg"><title>café</title></svg>';
    const bytes = Uint8Array.from(latin1Bytes(text));
    expect(decodeSvgText(bytes)).toBe(text);
  });

  it("decodes bytes behind a byte order mark even with no XML declaration naming an encoding", () => {
    const text =
      '<svg xmlns="http://www.w3.org/2000/svg"><title>hello</title></svg>';
    const bytes = Uint8Array.from([0xff, 0xfe, ...utf16leBytes(text)]);
    expect(decodeSvgText(bytes)).toBe(text);
  });

  it("throws SvgUnsupportedEncodingError when the XML prolog declares an encoding outside decodeText's own bounded set", () => {
    const bytes = Uint8Array.from(
      latin1Bytes(
        '<?xml version="1.0" encoding="Shift_JIS"?><svg xmlns="http://www.w3.org/2000/svg"/>',
      ),
    );
    expect(() => decodeSvgText(bytes)).toThrow(SvgUnsupportedEncodingError);
    let caught: unknown;
    try {
      decodeSvgText(bytes);
    } catch (error) {
      caught = error;
    }
    expect((caught as SvgUnsupportedEncodingError).name).toBe(
      "SvgUnsupportedEncodingError",
    );
    expect((caught as SvgUnsupportedEncodingError).label).toBe("Shift_JIS");
    expect((caught as Error).message).toContain("Shift_JIS");
  });

  it("throws SvgUndecodableTextError, naming the declared encoding, when bytes contradict it", () => {
    // Declares UTF-16LE, then pads to an odd total byte length, whatever the declaration's own length happens to be, which cannot hold a whole number of 16-bit code units.
    const declarationBytes = latin1Bytes(
      '<?xml version="1.0" encoding="UTF-16LE"?>',
    );
    const padding = declarationBytes.length % 2 === 0 ? [0x00] : [0x00, 0x00];
    const bytes = Uint8Array.from([...declarationBytes, ...padding]);
    let caught: unknown;
    try {
      decodeSvgText(bytes);
    } catch (error) {
      caught = error;
    }
    expect((caught as SvgUndecodableTextError).name).toBe(
      "SvgUndecodableTextError",
    );
    expect((caught as SvgUndecodableTextError).encoding).toBe("utf-16le");
  });
});
