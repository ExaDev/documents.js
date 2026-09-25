import { describe, expect, it } from "vitest";
import {
  CompactXmlNodeSchema,
  decodeCompactPackage,
  decodePackage,
  encodeCompactPackage,
  encodePackage,
  fromCompact,
  toCompact,
  zipPackage,
} from "./index";
import type { CompactPackage, Package, XmlElement } from "./index";
import { assertNeverCompactXmlNodeCode } from "./compact";
import { PNG_SIGNATURE } from "./image/sniff";

function enc(s: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(s);
}

const CONTENT_TYPES = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/media/image1.png" ContentType="image/png"/></Types>',
);

const ROOT_RELS = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
);

// The genuine PNG signature followed by five arbitrary trailing bytes standing in for whatever real image data would normally follow it: their exact values carry no meaning, so they simply count upward.
const ARBITRARY_TRAILING_BYTE_COUNT = 5;
const PNG_BYTES: Uint8Array<ArrayBuffer> = new Uint8Array([
  ...PNG_SIGNATURE,
  ...Array.from(
    { length: ARBITRARY_TRAILING_BYTE_COUNT },
    (_unused, index) => index + 1,
  ),
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

describe("isCompactXmlNode (via CompactXmlNodeSchema)", () => {
  // The same tuple type-code discriminants compact.ts itself names (NODE_TAG_ELEMENT through NODE_TAG_PI); element (0), text (1), and cdata (2) stay bare literals below since the shared no-magic-numbers ignore list already exempts -1/0/1/2.
  const NODE_TAG_COMMENT = 3;
  const NODE_TAG_DECLARATION = 4;
  const NODE_TAG_PI = 5;

  it("rejects a non-array value", () => {
    expect(CompactXmlNodeSchema.safeParse("nope").success).toBe(false);
    expect(CompactXmlNodeSchema.safeParse({ 0: 1, 1: 0 }).success).toBe(false);
  });

  it("accepts a text/cdata/comment node ([1|2|3, number])", () => {
    expect(CompactXmlNodeSchema.safeParse([1, 0]).success).toBe(true);
    expect(CompactXmlNodeSchema.safeParse([2, 0]).success).toBe(true);
    expect(CompactXmlNodeSchema.safeParse([NODE_TAG_COMMENT, 0]).success).toBe(
      true,
    );
  });

  it("rejects a text/cdata/comment node with the wrong tuple length", () => {
    expect(CompactXmlNodeSchema.safeParse([1, 0, 0]).success).toBe(false);
    expect(CompactXmlNodeSchema.safeParse([2, 0, 0]).success).toBe(false);
    expect(
      CompactXmlNodeSchema.safeParse([NODE_TAG_COMMENT, 0, 0]).success,
    ).toBe(false);
    expect(CompactXmlNodeSchema.safeParse([1]).success).toBe(false);
  });

  it("rejects a text/cdata/comment node whose value slot is not a number", () => {
    expect(CompactXmlNodeSchema.safeParse([1, "x"]).success).toBe(false);
    expect(CompactXmlNodeSchema.safeParse([2, "x"]).success).toBe(false);
    expect(
      CompactXmlNodeSchema.safeParse([NODE_TAG_COMMENT, "x"]).success,
    ).toBe(false);
  });

  it("accepts a declaration node ([4, attrPairs])", () => {
    expect(
      CompactXmlNodeSchema.safeParse([NODE_TAG_DECLARATION, [0, 1]]).success,
    ).toBe(true);
    expect(
      CompactXmlNodeSchema.safeParse([NODE_TAG_DECLARATION, []]).success,
    ).toBe(true);
  });

  it("rejects a declaration node with the wrong tuple length", () => {
    // An arbitrary extra tuple element: only its presence matters, to push the tuple one slot past the declaration's own [tag, attrPairs] length.
    const ARBITRARY_EXTRA_TUPLE_ELEMENT = 9;
    expect(
      CompactXmlNodeSchema.safeParse([
        NODE_TAG_DECLARATION,
        [0, 1],
        ARBITRARY_EXTRA_TUPLE_ELEMENT,
      ]).success,
    ).toBe(false);
    expect(CompactXmlNodeSchema.safeParse([NODE_TAG_DECLARATION]).success).toBe(
      false,
    );
  });

  it("rejects a declaration node whose attr pairs are not a valid CompactAttrPairs", () => {
    expect(
      CompactXmlNodeSchema.safeParse([NODE_TAG_DECLARATION, "not-an-array"])
        .success,
    ).toBe(false);
    expect(
      CompactXmlNodeSchema.safeParse([NODE_TAG_DECLARATION, [0, "x"]]).success,
    ).toBe(false);
  });

  it("accepts a pi node ([5, number, number])", () => {
    expect(CompactXmlNodeSchema.safeParse([NODE_TAG_PI, 0, 1]).success).toBe(
      true,
    );
  });

  it("rejects a pi node with the wrong tuple length", () => {
    expect(CompactXmlNodeSchema.safeParse([NODE_TAG_PI, 0]).success).toBe(
      false,
    );
    expect(CompactXmlNodeSchema.safeParse([NODE_TAG_PI, 0, 1, 2]).success).toBe(
      false,
    );
  });

  it("rejects a pi node whose target or content slot is not a number", () => {
    expect(CompactXmlNodeSchema.safeParse([NODE_TAG_PI, "x", 1]).success).toBe(
      false,
    );
    expect(CompactXmlNodeSchema.safeParse([NODE_TAG_PI, 0, "x"]).success).toBe(
      false,
    );
  });

  it("accepts an element node ([0, tag, attrPairs, children])", () => {
    expect(CompactXmlNodeSchema.safeParse([0, 0, [], []]).success).toBe(true);
    expect(
      CompactXmlNodeSchema.safeParse([0, 0, [1, 2], [[1, 0]]]).success,
    ).toBe(true);
  });

  it("rejects an element node with the wrong tuple length", () => {
    // An arbitrary extra tuple element: only its presence matters, to push the tuple one slot past the element's own [tag, tagIdx, attrPairs, children] length.
    const ARBITRARY_EXTRA_TUPLE_ELEMENT = 9;
    expect(
      CompactXmlNodeSchema.safeParse([
        0,
        0,
        [],
        [],
        ARBITRARY_EXTRA_TUPLE_ELEMENT,
      ]).success,
    ).toBe(false);
    expect(CompactXmlNodeSchema.safeParse([0, 0, []]).success).toBe(false);
  });

  it("rejects an element node whose tag slot is not a number", () => {
    expect(CompactXmlNodeSchema.safeParse([0, "x", [], []]).success).toBe(
      false,
    );
  });

  it("rejects an element node whose attr pairs are not a valid CompactAttrPairs", () => {
    expect(
      CompactXmlNodeSchema.safeParse([0, 0, "not-an-array", []]).success,
    ).toBe(false);
    expect(CompactXmlNodeSchema.safeParse([0, 0, [0, "x"], []]).success).toBe(
      false,
    );
  });

  it("rejects an element node whose children slot is not an array", () => {
    expect(
      CompactXmlNodeSchema.safeParse([0, 0, [], "not-an-array"]).success,
    ).toBe(false);
  });

  it("rejects an element node whose children are not all valid compact nodes", () => {
    expect(
      CompactXmlNodeSchema.safeParse([0, 0, [], [["not-a-node"]]]).success,
    ).toBe(false);
  });

  it("rejects an unrecognised leading type code, even one that happens to satisfy the element-shape checks", () => {
    // A type-code value past NODE_TAG_PI (5), the highest one compact.ts defines: any code beyond it is unrecognised regardless of what shape follows.
    const UNRECOGNISED_NODE_TAG = 9;
    expect(
      CompactXmlNodeSchema.safeParse([UNRECOGNISED_NODE_TAG]).success,
    ).toBe(false);
    expect(
      CompactXmlNodeSchema.safeParse([UNRECOGNISED_NODE_TAG, 0, [], []])
        .success,
    ).toBe(false);
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
    // Arbitrary but deep enough to genuinely exercise the recursive encode/decode across several levels, without approaching a real call-stack limit.
    const NESTED_ELEMENT_TEST_DEPTH = 16;
    const pkg: Package = {
      parts: {
        "word/document.xml": {
          kind: "xml",
          nodes: [nestedElement(NESTED_ELEMENT_TEST_DEPTH)],
        },
      },
    };
    expect(fromCompact(toCompact(pkg))).toEqual(pkg);
  });

  it("round-trips a cdata node", () => {
    const pkg: Package = {
      parts: {
        "word/document.xml": {
          kind: "xml",
          nodes: [{ type: "cdata", value: "<raw> & unescaped" }],
        },
      },
    };
    expect(fromCompact(toCompact(pkg))).toEqual(pkg);
  });

  it("round-trips a processing-instruction node", () => {
    const pkg: Package = {
      parts: {
        "word/document.xml": {
          kind: "xml",
          nodes: [
            {
              type: "pi",
              target: "mso-application",
              content: 'progid="Word.Document"',
            },
          ],
        },
      },
    };
    expect(fromCompact(toCompact(pkg))).toEqual(pkg);
  });

  it("throws with the out-of-range string index when a string-table lookup fails", () => {
    // Any index is out of range against an empty string table; this one has no significance beyond that.
    const OUT_OF_RANGE_STRING_INDEX = 5;
    const cpkg: CompactPackage = {
      s: [],
      p: { "word/document.xml": [[1, OUT_OF_RANGE_STRING_INDEX]] },
    };
    expect(() => fromCompact(cpkg)).toThrow(
      `fromCompact: string table index ${OUT_OF_RANGE_STRING_INDEX} is out of range`,
    );
  });

  it("throws when an attribute index-pairs array has odd length", () => {
    // The declaration tuple's own type-code discriminant (compact.ts's NODE_TAG_DECLARATION).
    const NODE_TAG_DECLARATION = 4;
    const cpkg: CompactPackage = {
      s: ["name-only"],
      p: { "word/document.xml": [[NODE_TAG_DECLARATION, [0]]] },
    };
    expect(() => fromCompact(cpkg)).toThrow(
      "fromCompact: attribute index pairs array has odd length",
    );
  });

  it("round-trips a large base64 binary part as a single interned string", () => {
    // Large enough to genuinely exercise the "large binary" path rather than the size mattering in itself, filled with a single arbitrary repeated byte since the content itself is irrelevant to string-table interning.
    const LARGE_BINARY_SIZE_KIB = 64;
    const BYTES_PER_KIB = 1024;
    const ARBITRARY_FILL_BYTE = 7;
    const largeBase64 = Buffer.from(
      new Uint8Array(LARGE_BINARY_SIZE_KIB * BYTES_PER_KIB).fill(
        ARBITRARY_FILL_BYTE,
      ),
    ).toString("base64");
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

describe("assertNeverCompactXmlNodeCode", () => {
  it("throws naming the unhandled type code, proving decodeNode's own exhaustiveness guard actually fires at runtime", () => {
    // Any value past NODE_TAG_PI (5), the highest type code compact.ts defines, is unhandled by construction.
    const UNHANDLED_NODE_TAG = 99;
    let caught: unknown;
    try {
      assertNeverCompactXmlNodeCode([UNHANDLED_NODE_TAG] as never);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe(
      `decodeNode: unhandled CompactXmlNode type code [${UNHANDLED_NODE_TAG}]`,
    );
  });
});
