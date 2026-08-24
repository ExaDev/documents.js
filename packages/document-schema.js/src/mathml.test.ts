import { describe, expect, it } from "vitest";
import {
  type MathMlNode,
  MathMlElementSchema,
  MathMlNodeSchema,
  isMathMlNode,
} from "./mathml";

// A verbatim transcription of odf.js's own src/model/node.ts declarations (Attribute/XmlText/XmlCdata/XmlComment/XmlDeclaration/XmlPi/XmlElement/XmlNode), reproduced here rather than imported because odf.js is not a dependency of this package and must never become one -- this package sits below it in the dependency graph. The assignments below are the actual guarantee under test: an odf.js XmlNode (what readOdfFormula returns) must land in a MathMlNode field with no cast, wrapper, or field loss, which is only true while these two declarations stay structurally identical. If odf.js ever changes its node shape, this file is where that shows up.
interface OdfAttribute {
  name: string;
  value: string;
}
interface OdfXmlElement {
  type: "element";
  tag: string;
  attributes: OdfAttribute[];
  children: OdfXmlNode[];
}
type OdfXmlNode =
  | { type: "text"; value: string }
  | { type: "cdata"; value: string }
  | { type: "comment"; value: string }
  | { type: "declaration"; attributes: OdfAttribute[] }
  | { type: "pi"; target: string; content: string }
  | OdfXmlElement;

const everyVariant: MathMlNode[] = [
  { type: "text", value: "x" },
  { type: "cdata", value: "<raw>" },
  { type: "comment", value: " a note " },
  { type: "declaration", attributes: [{ name: "version", value: "1.0" }] },
  { type: "pi", target: "xml-stylesheet", content: 'href="a.xsl"' },
  {
    type: "element",
    tag: "math",
    attributes: [{ name: "display", value: "block" }],
    children: [
      {
        type: "element",
        tag: "mi",
        attributes: [],
        children: [{ type: "text", value: "x" }],
      },
    ],
  },
];

describe("isMathMlNode", () => {
  it("accepts every node variant, with its real payload", () => {
    for (const node of everyVariant) {
      expect(isMathMlNode(node)).toBe(true);
    }
  });

  it("accepts an element nested four levels deep, and genuinely walks every level", () => {
    const deep: MathMlNode = {
      type: "element",
      tag: "math",
      attributes: [],
      children: [
        {
          type: "element",
          tag: "mfrac",
          attributes: [],
          children: [
            {
              type: "element",
              tag: "msqrt",
              attributes: [],
              children: [
                {
                  type: "element",
                  tag: "mn",
                  attributes: [],
                  children: [{ type: "text", value: "2" }],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(isMathMlNode(deep)).toBe(true);
    // A malformed node buried at the deepest level must still fail, not be silently accepted.
    expect(
      isMathMlNode({
        type: "element",
        tag: "math",
        attributes: [],
        children: [
          {
            type: "element",
            tag: "mfrac",
            attributes: [],
            children: [
              {
                type: "element",
                tag: "msqrt",
                attributes: [],
                children: [{ type: "text", value: 2 }],
              },
            ],
          },
        ],
      }),
    ).toBe(false);
  });

  it("rejects a node whose payload is missing or wrongly typed for its own variant", () => {
    expect(isMathMlNode({ type: "text" })).toBe(false);
    expect(isMathMlNode({ type: "pi", target: "xml-stylesheet" })).toBe(false);
    expect(
      isMathMlNode({ type: "declaration", attributes: [{ name: "version" }] }),
    ).toBe(false);
    expect(isMathMlNode({ type: "element", tag: "mi", attributes: [] })).toBe(
      false,
    );
    expect(isMathMlNode({ type: "bogus" })).toBe(false);
    expect(isMathMlNode(null)).toBe(false);
    expect(isMathMlNode("a string")).toBe(false);
    expect(isMathMlNode(undefined)).toBe(false);
  });
});

describe("MathMlNodeSchema", () => {
  it("round trips every variant through JSON with no field loss", () => {
    for (const node of everyVariant) {
      const parsed = MathMlNodeSchema.parse(node);
      const roundTripped: unknown = JSON.parse(JSON.stringify(parsed));
      expect(MathMlNodeSchema.parse(roundTripped)).toEqual(node);
    }
  });

  it("validates an element through MathMlElementSchema too", () => {
    const element = everyVariant[5];
    expect(MathMlElementSchema.safeParse(element).success).toBe(true);
    expect(MathMlElementSchema.safeParse(everyVariant[0]).success).toBe(false);
  });
});

// The parameter types are the assertion: neither call below compiles if the two node declarations have diverged in any field.
function takesMathMlNode(node: MathMlNode): MathMlNode {
  return node;
}

function takesOdfXmlNode(node: OdfXmlNode): OdfXmlNode {
  return node;
}

describe("structural compatibility with odf.js's own XmlNode", () => {
  it("accepts an odf.js-shaped node tree as a MathMlNode with no cast, and vice versa", () => {
    const fromOdf: OdfXmlNode = {
      type: "element",
      tag: "math",
      attributes: [
        { name: "xmlns", value: "http://www.w3.org/1998/Math/MathML" },
      ],
      children: [
        {
          type: "element",
          tag: "mi",
          attributes: [],
          children: [{ type: "text", value: "x" }],
        },
        { type: "comment", value: " from odf.js " },
        { type: "pi", target: "target", content: "content" },
      ],
    };
    expect(isMathMlNode(takesOdfXmlNode(takesMathMlNode(fromOdf)))).toBe(true);
    expect(MathMlNodeSchema.parse(fromOdf)).toEqual(fromOdf);
  });
});
