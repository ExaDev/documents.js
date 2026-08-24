import { describe, expect, it } from "vitest";
import {
  decodeCompactPackage,
  decodePackage,
  encodeCompactPackage,
  encodePackage,
  fromCompact,
  toCompact,
  zipPackage,
} from "./index";
import type { Package, XmlElement } from "./index";

function enc(s: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(s);
}

const CONTENT_TYPES = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/media/image1.png" ContentType="image/png"/></Types>',
);

const ROOT_RELS = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
);

const PNG_BYTES: Uint8Array<ArrayBuffer> = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5,
]);

function docxParts(): Record<string, Uint8Array<ArrayBuffer>> {
  return {
    "[Content_Types].xml": CONTENT_TYPES,
    "_rels/.rels": ROOT_RELS,
    "word/document.xml": enc(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t xml:space="preserve">Hello &amp; world</w:t></w:r></w:p><w:p><w:r><w:t>Second paragraph</w:t></w:r></w:p></w:body></w:document>',
    ),
    "word/media/image1.png": PNG_BYTES,
  };
}

function docxPackage(): Package {
  return decodePackage(zipPackage(docxParts()));
}

// A nested element chain 16 levels deep, terminating in a leaf with a zero-attribute element and a text child.
function nestedElement(depth: number): XmlElement {
  if (depth === 0) {
    return {
      type: "element",
      tag: "leaf",
      attributes: [],
      children: [{ type: "text", value: "deep" }],
    };
  }
  return {
    type: "element",
    tag: `level${depth}`,
    attributes: [],
    children: [nestedElement(depth - 1)],
  };
}

describe("compact codec round-trip", () => {
  for (const [format, parts] of [
    ["docx", docxParts()],
    [
      "pptx",
      {
        "[Content_Types].xml": enc(
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>',
        ),
        "_rels/.rels": enc(
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>',
        ),
        "ppt/presentation.xml": enc(
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldIdLst/></p:presentation>',
        ),
      },
    ],
  ] as const) {
    it(`${format}: fromCompact(toCompact(pkg)) deep-equals pkg`, () => {
      const pkg = decodePackage(zipPackage(parts));
      expect(fromCompact(toCompact(pkg))).toEqual(pkg);
    });
  }

  it("preserves a binary part byte-for-byte through the compact round-trip", () => {
    const pkg = docxPackage();
    const roundTripped = fromCompact(toCompact(pkg));
    expect(roundTripped.parts["word/media/image1.png"]).toEqual(
      pkg.parts["word/media/image1.png"],
    );
    expect(
      decodePackage(encodePackage(roundTripped)).parts["word/media/image1.png"],
    ).toEqual(
      decodePackage(zipPackage(docxParts())).parts["word/media/image1.png"],
    );
  });
});

describe("bytes <-> CompactPackage codec (compactPackageCodec)", () => {
  it("decodeCompactPackage(bytes) equals toCompact(decodePackage(bytes))", () => {
    const bytes = zipPackage(docxParts());
    expect(decodeCompactPackage(bytes)).toEqual(
      toCompact(decodePackage(bytes)),
    );
  });

  it("round-trips bytes -> CompactPackage -> bytes -> Package back to the original Package", () => {
    const bytes = zipPackage(docxParts());
    const original = decodePackage(bytes);
    const compact = decodeCompactPackage(bytes);
    const roundTrippedBytes = encodeCompactPackage(compact);
    expect(decodePackage(roundTrippedBytes)).toEqual(original);
  });

  it("encodeCompactPackage(compact) equals encodePackage(fromCompact(compact))", () => {
    const pkg = docxPackage();
    const compact = toCompact(pkg);
    expect(decodePackage(encodeCompactPackage(compact))).toEqual(
      decodePackage(encodePackage(fromCompact(compact))),
    );
  });

  it("is deterministic across repeated calls", () => {
    const bytes = zipPackage(docxParts());
    expect(decodeCompactPackage(bytes)).toEqual(decodeCompactPackage(bytes));
  });
});

describe("compact shape", () => {
  it("interns a repeated tag once and references it by index", () => {
    const pkg: Package = {
      parts: {
        "word/document.xml": {
          kind: "xml",
          nodes: [
            {
              type: "element",
              tag: "w:body",
              attributes: [],
              children: [
                { type: "element", tag: "w:r", attributes: [], children: [] },
                { type: "element", tag: "w:r", attributes: [], children: [] },
                { type: "element", tag: "w:r", attributes: [], children: [] },
              ],
            },
          ],
        },
      },
    };
    const compact = toCompact(pkg);
    expect(compact.s.filter((value) => value === "w:r")).toHaveLength(1);
  });

  it("encodes a binary part as a bare string-table index", () => {
    const pkg: Package = {
      parts: {
        "word/media/image1.png": { kind: "binary", base64: "AQIDBA==" },
      },
    };
    const compact = toCompact(pkg);
    expect(typeof compact.p["word/media/image1.png"]).toBe("number");
  });
});

describe("compact determinism", () => {
  it("produces the same string table and parts across repeated calls", () => {
    const pkg = docxPackage();
    expect(toCompact(pkg)).toEqual(toCompact(pkg));
  });
});

describe("compact size", () => {
  it("is smaller than the verbose Package JSON for a non-trivial fixture", () => {
    const pkg = docxPackage();
    const compactSize = JSON.stringify(toCompact(pkg)).length;
    const verboseSize = JSON.stringify(pkg).length;
    expect(compactSize).toBeLessThan(verboseSize);
  });
});

describe("compact adversarial cases", () => {
  it("round-trips an empty Package", () => {
    const pkg: Package = { parts: {} };
    expect(fromCompact(toCompact(pkg))).toEqual(pkg);
  });

  it("round-trips an empty XML part", () => {
    const pkg: Package = {
      parts: { "word/document.xml": { kind: "xml", nodes: [] } },
    };
    const compact = toCompact(pkg);
    expect(compact.p["word/document.xml"]).toEqual([]);
    expect(fromCompact(compact)).toEqual(pkg);
  });

  it("round-trips a zero-attribute element", () => {
    const pkg: Package = {
      parts: {
        "word/document.xml": {
          kind: "xml",
          nodes: [
            { type: "element", tag: "w:body", attributes: [], children: [] },
          ],
        },
      },
    };
    expect(fromCompact(toCompact(pkg))).toEqual(pkg);
  });

  it("round-trips 16 levels of nested elements", () => {
    const pkg: Package = {
      parts: {
        "word/document.xml": { kind: "xml", nodes: [nestedElement(16)] },
      },
    };
    expect(fromCompact(toCompact(pkg))).toEqual(pkg);
  });

  it("round-trips a large base64 binary part as a single interned string", () => {
    const largeBase64 = Buffer.from(new Uint8Array(64 * 1024).fill(7)).toString(
      "base64",
    );
    const pkg: Package = {
      parts: {
        "word/media/large.bin": { kind: "binary", base64: largeBase64 },
      },
    };
    const compact = toCompact(pkg);
    expect(compact.s).toHaveLength(1);
    expect(compact.s[0]).toBe(largeBase64);
    expect(fromCompact(compact)).toEqual(pkg);
  });
});
