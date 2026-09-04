import { describe, expect, it } from "vitest";
import type {
  ContentDocument,
  ContentDrawPage,
  ContentShape,
  ContentVector,
} from "document-schema.js";
import { PAGE_SIZE_A4, rgbHexToColor } from "document-schema.js";
import type { XmlElement } from "../../model/node";
import type { Package } from "../../model/package";
import { encodePackage } from "../../codec";
import { readManifest } from "../../manifest";
import { readMimetype } from "../../mimetype";
import {
  attrValue,
  childrenWithTag,
  findChildElement,
  rootElement,
} from "../../xml/query";
import { assertMimetypeEntryLayout } from "../../test-support/zip";
import { writeOdgContent } from "./write";

// The write side's XML-shape suite: what writeOdgContent actually emits, construct by construct -- the drawing mirror of typed/odp/write.test.ts (and, through it, of typed/odt/write.test.ts, whose own top-of-file note states why this suite exists alongside the round-trip one: a writer and reader that agree with each other and with nobody else would round-trip perfectly and open nowhere). Every attribute asserted below is one typed/draw/shapes.ts genuinely reads, and the package README's own LibreOffice-verification section records what a real, independent ODF implementation made of the same output.

const RED = rgbHexToColor("#cc0000");
const BLUE = rgbHexToColor("#0033ff");

const PAGE_SIZE_LANDSCAPE = { widthPt: 720, heightPt: 540 };

function page(
  vectors: ContentVector[],
  shapes: ContentShape[] = [],
  size = PAGE_SIZE_LANDSCAPE,
): ContentDrawPage {
  return { size, shapes, vectors };
}

function documentOf(pages: ContentDrawPage[]): ContentDocument {
  return { kind: "drawing", metadata: {}, pages };
}

function shape(
  overrides: Partial<ContentShape> = {},
  blocks: ContentShape["blocks"] = [
    { kind: "paragraph", runs: [{ text: "Label" }] },
  ],
): ContentShape {
  return {
    frame: { xPt: 10, yPt: 20, widthPt: 200, heightPt: 60 },
    insetLeftPt: 0,
    insetTopPt: 0,
    insetRightPt: 0,
    insetBottomPt: 0,
    blocks,
    ...overrides,
  };
}

function rect(
  overrides: Partial<Extract<ContentVector, { kind: "rect" }>> = {},
) {
  return {
    kind: "rect",
    frame: { xPt: 36, yPt: 48, widthPt: 120, heightPt: 90 },
    ...overrides,
  } satisfies ContentVector;
}

function partRoot(pkg: Package, path: string): XmlElement {
  const part = pkg.parts[path];
  if (part?.kind !== "xml") {
    throw new Error(`expected an XML part at ${path}`);
  }
  const root = rootElement(part.nodes);
  if (root === undefined) {
    throw new Error(`expected a root element in ${path}`);
  }
  return root;
}

function drawingBody(pkg: Package): XmlElement {
  const body = findChildElement(
    partRoot(pkg, "content.xml").children,
    "office:body",
  );
  const drawing =
    body === undefined
      ? undefined
      : findChildElement(body.children, "office:drawing");
  if (drawing === undefined) {
    throw new Error("expected office:body/office:drawing");
  }
  return drawing;
}

function pagesOf(pkg: Package): XmlElement[] {
  return childrenWithTag(drawingBody(pkg), "draw:page");
}

function firstPageChildren(pkg: Package): XmlElement[] {
  return pagesOf(pkg)[0]!.children.filter(
    (node): node is XmlElement => node.type === "element",
  );
}

// The style:graphic-properties of the graphic-family automatic style an element's own draw:style-name names -- the one place a vector's fill and stroke actually live, since ODF has no direct formatting.
function graphicPropertiesOf(pkg: Package, element: XmlElement): XmlElement {
  const styleName = attrValue(element, "draw:style-name");
  if (styleName === undefined) {
    throw new Error(`expected ${element.tag} to carry a draw:style-name`);
  }
  const automaticStyles = findChildElement(
    partRoot(pkg, "content.xml").children,
    "office:automatic-styles",
  );
  if (automaticStyles === undefined) {
    throw new Error("expected content.xml office:automatic-styles");
  }
  const style = childrenWithTag(automaticStyles, "style:style").find(
    (candidate) =>
      attrValue(candidate, "style:name") === styleName &&
      attrValue(candidate, "style:family") === "graphic",
  );
  if (style === undefined) {
    throw new Error(`expected a graphic style named ${styleName}`);
  }
  const properties = childrenWithTag(style, "style:graphic-properties")[0];
  if (properties === undefined) {
    throw new Error(`expected style ${styleName} to carry graphic properties`);
  }
  return properties;
}

describe("writeOdgContent: package structure", () => {
  const pkg = writeOdgContent(documentOf([page([rect()])]));

  it("declares the drawing media type", () => {
    expect(readMimetype(pkg)).toBe(
      "application/vnd.oasis.opendocument.graphics",
    );
  });

  it("hoists mimetype first, stored, uncompressed", () => {
    assertMimetypeEntryLayout(
      encodePackage(pkg),
      "application/vnd.oasis.opendocument.graphics",
    );
  });

  it("registers content.xml, styles.xml, and meta.xml in the manifest", () => {
    const paths = readManifest(pkg).entries.map((entry) => entry.fullPath);
    expect(paths).toContain("content.xml");
    expect(paths).toContain("styles.xml");
    expect(paths).toContain("meta.xml");
  });

  it("writes the body as office:drawing, one draw:page per page", () => {
    expect(pagesOf(pkg)).toHaveLength(1);
  });

  it("refuses a document that is not a drawing, by kind", () => {
    expect(() =>
      writeOdgContent({ kind: "presentation", metadata: {}, slides: [] }),
    ).toThrow(/expected a 'drawing' document, got 'presentation'/);
  });
});

describe("writeOdgContent: page geometry", () => {
  it("writes a style:master-page + style:page-layout per page, referenced by draw:master-page-name", () => {
    const pkg = writeOdgContent(
      documentOf([page([rect()]), page([rect()], [], PAGE_SIZE_A4)]),
    );
    const pages = pagesOf(pkg);
    expect(pages).toHaveLength(2);
    const firstName = attrValue(pages[0]!, "draw:master-page-name");
    const secondName = attrValue(pages[1]!, "draw:master-page-name");
    expect(firstName).toBeDefined();
    expect(secondName).toBeDefined();
    expect(firstName).not.toBe(secondName);

    const stylesRoot = partRoot(pkg, "styles.xml");
    const masterStyles = findChildElement(
      stylesRoot.children,
      "office:master-styles",
    );
    if (masterStyles === undefined) {
      throw new Error("expected office:master-styles");
    }
    const masterPage = childrenWithTag(masterStyles, "style:master-page").find(
      (element) => attrValue(element, "style:name") === secondName,
    );
    if (masterPage === undefined) {
      throw new Error("expected the referenced master page to exist");
    }
    const pageLayoutName = attrValue(masterPage, "style:page-layout-name");

    const automaticStyles = findChildElement(
      stylesRoot.children,
      "office:automatic-styles",
    );
    if (automaticStyles === undefined) {
      throw new Error("expected styles.xml office:automatic-styles");
    }
    const pageLayout = childrenWithTag(
      automaticStyles,
      "style:page-layout",
    ).find((element) => attrValue(element, "style:name") === pageLayoutName);
    if (pageLayout === undefined) {
      throw new Error("expected the referenced page layout to exist");
    }
    const properties = childrenWithTag(
      pageLayout,
      "style:page-layout-properties",
    )[0]!;
    expect(attrValue(properties, "fo:page-width")).toBe(
      `${PAGE_SIZE_A4.widthPt}pt`,
    );
    expect(attrValue(properties, "fo:page-height")).toBe(
      `${PAGE_SIZE_A4.heightPt}pt`,
    );
    expect(attrValue(properties, "style:print-orientation")).toBe("portrait");
  });
});

describe("writeOdgContent: vector elements", () => {
  it("writes a rect as draw:rect with a plain svg:x/y/width/height box", () => {
    const pkg = writeOdgContent(documentOf([page([rect()])]));
    const element = firstPageChildren(pkg)[0]!;
    expect(element.tag).toBe("draw:rect");
    expect(attrValue(element, "svg:x")).toBe("36pt");
    expect(attrValue(element, "svg:y")).toBe("48pt");
    expect(attrValue(element, "svg:width")).toBe("120pt");
    expect(attrValue(element, "svg:height")).toBe("90pt");
    expect(attrValue(element, "draw:transform")).toBeUndefined();
  });

  // draw:circle is what real LibreOffice writes for the equal-width-and-height case, but the reader maps both spellings onto the one 'ellipse' variant, so writing the general one loses nothing.
  it("writes an ellipse as draw:ellipse, including a circular one", () => {
    const pkg = writeOdgContent(
      documentOf([
        page([
          {
            kind: "ellipse",
            frame: { xPt: 0, yPt: 0, widthPt: 80, heightPt: 80 },
          },
        ]),
      ]),
    );
    expect(firstPageChildren(pkg)[0]!.tag).toBe("draw:ellipse");
  });

  it("writes a line as draw:line with its two endpoints, and no box at all", () => {
    const pkg = writeOdgContent(
      documentOf([
        page([
          {
            kind: "line",
            from: { xPt: 10, yPt: 20 },
            to: { xPt: 130, yPt: 95 },
            stroke: { color: RED, widthPt: 2 },
          },
        ]),
      ]),
    );
    const element = firstPageChildren(pkg)[0]!;
    expect(element.tag).toBe("draw:line");
    expect(attrValue(element, "svg:x1")).toBe("10pt");
    expect(attrValue(element, "svg:y1")).toBe("20pt");
    expect(attrValue(element, "svg:x2")).toBe("130pt");
    expect(attrValue(element, "svg:y2")).toBe("95pt");
    expect(attrValue(element, "svg:width")).toBeUndefined();
  });

  it("writes a path as draw:path with an svg:viewBox sized to its own frame and an absolute svg:d", () => {
    const pkg = writeOdgContent(
      documentOf([
        page([
          {
            kind: "path",
            frame: { xPt: 200, yPt: 100, widthPt: 100, heightPt: 50 },
            subpaths: [
              {
                start: { xPt: 0, yPt: 0 },
                segments: [
                  { kind: "line", to: { xPt: 100, yPt: 0 } },
                  {
                    kind: "cubic",
                    control1: { xPt: 100, yPt: 25 },
                    control2: { xPt: 50, yPt: 50 },
                    to: { xPt: 0, yPt: 50 },
                  },
                ],
                closed: true,
              },
            ],
          },
        ]),
      ]),
    );
    const element = firstPageChildren(pkg)[0]!;
    expect(element.tag).toBe("draw:path");
    expect(attrValue(element, "svg:viewBox")).toBe("0 0 100 50");
    expect(attrValue(element, "svg:d")).toBe(
      "M 0,0 L 100,0 C 100,25 50,50 0,50 Z",
    );
    expect(attrValue(element, "svg:x")).toBe("200pt");
    expect(attrValue(element, "svg:width")).toBe("100pt");
  });

  it("writes a rotated vector as svg:width/height plus draw:transform, never svg:x/y", () => {
    const pkg = writeOdgContent(
      documentOf([page([rect({ rotationDeg: 30 })])]),
    );
    const element = firstPageChildren(pkg)[0]!;
    expect(attrValue(element, "svg:x")).toBeUndefined();
    expect(attrValue(element, "svg:y")).toBeUndefined();
    expect(attrValue(element, "draw:transform")).toMatch(
      /^rotate\(-?[\d.]+\) translate\(-?[\d.]+pt -?[\d.]+pt\)$/,
    );
  });

  // The ODF `length` datatype has no exponent form (typed/shared/units.ts's LENGTH_PATTERN), and a rotation about a pivot near the page origin is the ordinary way to reach that magnitude -- the terms cancel to trig rounding dust rather than a clean zero. The same defect the odp writer's own suite pins, reached here through a vector rather than a frame.
  it("writes no exponent-notation length for a vector rotated at the page origin", () => {
    const pkg = writeOdgContent(
      documentOf([
        page([
          rect({
            rotationDeg: 270,
            frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 },
          }),
        ]),
      ]),
    );
    const transform = attrValue(firstPageChildren(pkg)[0]!, "draw:transform");
    expect(transform).toBeDefined();
    expect(transform).not.toMatch(/[\d.]e[+-]?\d/i);
  });
});

describe("writeOdgContent: fill and stroke", () => {
  it("writes a fill as draw:fill=solid plus draw:fill-color on a graphic-family style", () => {
    const pkg = writeOdgContent(documentOf([page([rect({ fill: BLUE })])]));
    const properties = graphicPropertiesOf(pkg, firstPageChildren(pkg)[0]!);
    expect(attrValue(properties, "draw:fill")).toBe("solid");
    expect(attrValue(properties, "draw:fill-color")).toBe("#0033ff");
  });

  it("writes a stroke as draw:stroke=solid plus svg:stroke-color and svg:stroke-width", () => {
    const pkg = writeOdgContent(
      documentOf([page([rect({ stroke: { color: RED, widthPt: 1.5 } })])]),
    );
    const properties = graphicPropertiesOf(pkg, firstPageChildren(pkg)[0]!);
    expect(attrValue(properties, "draw:stroke")).toBe("solid");
    expect(attrValue(properties, "svg:stroke-color")).toBe("#cc0000");
    expect(attrValue(properties, "svg:stroke-width")).toBe("1.5pt");
  });

  it("writes a dashed stroke as ODF's own draw:stroke=dash spelling", () => {
    const pkg = writeOdgContent(
      documentOf([
        page([rect({ stroke: { color: RED, widthPt: 1, style: "dashed" } })]),
      ]),
    );
    const properties = graphicPropertiesOf(pkg, firstPageChildren(pkg)[0]!);
    expect(attrValue(properties, "draw:stroke")).toBe("dash");
  });

  // An ABSENT declaration means "inherit" in ODF, not "none" -- a consumer's own default graphic style supplies a fill, so an unfilled rect has to say so explicitly or it renders filled.
  it("states draw:fill=none and draw:stroke=none explicitly for a vector with neither", () => {
    const pkg = writeOdgContent(documentOf([page([rect()])]));
    const properties = graphicPropertiesOf(pkg, firstPageChildren(pkg)[0]!);
    expect(attrValue(properties, "draw:fill")).toBe("none");
    expect(attrValue(properties, "draw:stroke")).toBe("none");
    expect(attrValue(properties, "draw:fill-color")).toBeUndefined();
  });

  it("writes svg:fill-rule for a path that states one, and none for a path that does not", () => {
    const subpaths = [
      {
        start: { xPt: 0, yPt: 0 },
        segments: [{ kind: "line" as const, to: { xPt: 10, yPt: 10 } }],
        closed: true,
      },
    ];
    const frame = { xPt: 0, yPt: 0, widthPt: 20, heightPt: 20 };
    const withRule = writeOdgContent(
      documentOf([
        page([{ kind: "path", frame, subpaths, fillRule: "evenodd" }]),
      ]),
    );
    expect(
      attrValue(
        graphicPropertiesOf(withRule, firstPageChildren(withRule)[0]!),
        "svg:fill-rule",
      ),
    ).toBe("evenodd");

    const withoutRule = writeOdgContent(
      documentOf([page([{ kind: "path", frame, subpaths }])]),
    );
    expect(
      attrValue(
        graphicPropertiesOf(withoutRule, firstPageChildren(withoutRule)[0]!),
        "svg:fill-rule",
      ),
    ).toBeUndefined();
  });

  it("interns one style for two identically painted vectors rather than minting a duplicate", () => {
    const pkg = writeOdgContent(
      documentOf([
        page([
          rect({ fill: BLUE, stroke: { color: RED, widthPt: 1 } }),
          rect({
            fill: BLUE,
            stroke: { color: RED, widthPt: 1 },
            frame: { xPt: 200, yPt: 0, widthPt: 50, heightPt: 50 },
          }),
        ]),
      ]),
    );
    const elements = firstPageChildren(pkg);
    expect(attrValue(elements[0]!, "draw:style-name")).toBe(
      attrValue(elements[1]!, "draw:style-name"),
    );
  });
});

describe("writeOdgContent: refusals", () => {
  it("refuses a dotted stroke, by name", () => {
    expect(() =>
      writeOdgContent(
        documentOf([
          page([rect({ stroke: { color: RED, widthPt: 1, style: "dotted" } })]),
        ]),
      ),
    ).toThrow(/'dotted' stroke style/);
  });

  it("refuses a double stroke, by name", () => {
    expect(() =>
      writeOdgContent(
        documentOf([
          page([rect({ stroke: { color: RED, widthPt: 1, style: "double" } })]),
        ]),
      ),
    ).toThrow(/'double' stroke style/);
  });

  it("refuses a stroke of non-positive width, by name", () => {
    expect(() =>
      writeOdgContent(
        documentOf([page([rect({ stroke: { color: RED, widthPt: 0 } })])]),
      ),
    ).toThrow(/stroke of width 0pt/);
  });

  it("refuses a path with no subpaths, by name", () => {
    expect(() =>
      writeOdgContent(
        documentOf([
          page([
            {
              kind: "path",
              frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
              subpaths: [],
            },
          ]),
        ]),
      ),
    ).toThrow(/no subpaths at all/);
  });

  it("refuses a path whose frame has a zero extent, by name", () => {
    expect(() =>
      writeOdgContent(
        documentOf([
          page([
            {
              kind: "path",
              frame: { xPt: 0, yPt: 0, widthPt: 0, heightPt: 10 },
              subpaths: [
                { start: { xPt: 0, yPt: 0 }, segments: [], closed: false },
              ],
            },
          ]),
        ]),
      ),
    ).toThrow(/frame of 0pt x 10pt/);
  });

  // The shape-level refusals are typed/draw/write-shapes.ts's own planShapeContent, reached unchanged from here -- a drawing adds none of its own and relaxes none.
  it("refuses a heading inside a shape's own text, the same way every writer here does", () => {
    expect(() =>
      writeOdgContent(
        documentOf([
          page(
            [],
            [
              shape({}, [
                { kind: "paragraph", headingLevel: 1, runs: [{ text: "x" }] },
              ]),
            ],
          ),
        ]),
      ),
    ).toThrow(/heading/);
  });
});

describe("writeOdgContent: shapes and vectors on one page", () => {
  it("emits every draw:frame before every vector element, in each array's own order", () => {
    const pkg = writeOdgContent(
      documentOf([
        page(
          [
            rect(),
            {
              kind: "line",
              from: { xPt: 0, yPt: 0 },
              to: { xPt: 10, yPt: 10 },
              stroke: { color: RED, widthPt: 1 },
            },
          ],
          [
            shape(),
            shape({ frame: { xPt: 0, yPt: 0, widthPt: 5, heightPt: 5 } }),
          ],
        ),
      ]),
    );
    expect(firstPageChildren(pkg).map((element) => element.tag)).toEqual([
      "draw:frame",
      "draw:frame",
      "draw:rect",
      "draw:line",
    ]);
  });
});

// ContentVector.paintOrder -> draw:z-index, exactly as ContentShape.paintOrder already does through typed/draw/write-shapes.ts's odfZIndexOf -- the one spelling ODF has for a stacking order independent of document position, and the one typed/draw/shapes.ts's paintOrderKey reads back.
describe("writeOdgContent: paint order", () => {
  it("writes a vector's paintOrder as draw:z-index", () => {
    const pkg = writeOdgContent(
      documentOf([page([rect({ paintOrder: 5 }), rect({ paintOrder: 1 })])]),
    );
    expect(
      firstPageChildren(pkg).map((element) =>
        attrValue(element, "draw:z-index"),
      ),
    ).toEqual(["5", "1"]);
  });

  it("writes draw:z-index as the vector's own document-encounter index for a vector with no paintOrder, never omitting the attribute", () => {
    const pkg = writeOdgContent(documentOf([page([rect()])]));
    expect(attrValue(firstPageChildren(pkg)[0]!, "draw:z-index")).toBe("0");
  });

  it("writes draw:z-index as each vector's own document-encounter index for a paintOrder ODF's own xsd:nonNegativeInteger cannot spell", () => {
    const pkg = writeOdgContent(
      documentOf([
        page([
          rect({ paintOrder: 1.5 }),
          rect({ paintOrder: -2 }),
          rect({ paintOrder: 1e21 }),
        ]),
      ]),
    );
    expect(
      firstPageChildren(pkg).map((element) =>
        attrValue(element, "draw:z-index"),
      ),
    ).toEqual(["0", "1", "2"]);
  });

  // The bug this pins: an item with no attribute at all reads back on a real consumer as APPENDED AFTER every item that does carry one, regardless of its own resolved paint order relative to them (confirmed against real LibreOffice output -- see the review that found this). A page mixing an explicit paintOrder shape with an unspelled-paintOrder vector must therefore never omit draw:z-index on either: both resolve through the identical odfZIndexOf(paintOrder) ?? documentIndex this page's own canonicalDrawShape/canonicalDrawVector already use, and BOTH are written -- one shape (index 0), one vector whose own document-encounter index is shapes.length (1) plus its position (0), so 1.
  it("writes an explicit draw:z-index for every item on a page mixing an explicit paintOrder shape with an unspelled-paintOrder vector, spanning both arrays", () => {
    const pkg = writeOdgContent(
      documentOf([page([rect()], [shape({ paintOrder: 3 })])]),
    );
    const children = firstPageChildren(pkg);
    expect(children.map((element) => element.tag)).toEqual([
      "draw:frame",
      "draw:rect",
    ]);
    expect(
      children.map((element) => attrValue(element, "draw:z-index")),
    ).toEqual(["3", "1"]);
  });
});
