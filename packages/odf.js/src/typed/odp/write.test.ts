import { describe, expect, it } from "vitest";
import type {
  ContentDocument,
  ContentShape,
  ContentSlide,
} from "document-schema.js";
import { SLIDE_SIZE_WIDESCREEN } from "document-schema.js";
import type { XmlElement } from "../../model/node";
import type { Package } from "../../model/package";
import { encodePackage } from "../../codec";
import { readManifest } from "../../manifest";
import { readMimetype } from "../../mimetype";
import {
  attrValue,
  childrenWithTag,
  elementsWithTag,
  findChildElement,
  rootElement,
} from "../../xml/query";
import { assertMimetypeEntryLayout } from "../../test-support/zip";
import { writeOdpContent } from "./write";

// The write side's XML-shape suite: what writeOdpContent actually emits, construct by construct -- the presentation mirror of typed/odt/write.test.ts (that file's own top-of-file note states why this suite exists alongside the round-trip one: a writer and reader that agree with each other and with nobody else would round-trip perfectly and open nowhere).

// A 1x1 PNG, genuinely decodable (sniffImageFormat reads real magic bytes, not a name), matching typed/odt/write-round-trip.test.ts's own fixture.
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function shape(
  overrides: Partial<ContentShape> = {},
  blocks: ContentShape["blocks"] = [
    { kind: "paragraph", runs: [{ text: "Body" }] },
  ],
): ContentShape {
  return {
    frame: { xPt: 10, yPt: 20, widthPt: 300, heightPt: 100 },
    insetLeftPt: 0,
    insetTopPt: 0,
    insetRightPt: 0,
    insetBottomPt: 0,
    blocks,
    ...overrides,
  };
}

function slide(shapes: ContentShape[], notes = ""): ContentSlide {
  return { size: SLIDE_SIZE_WIDESCREEN, shapes, notes };
}

function documentOf(slides: ContentSlide[]): ContentDocument {
  return { kind: "presentation", metadata: {}, slides };
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

function presentationBody(pkg: Package): XmlElement {
  const body = findChildElement(
    partRoot(pkg, "content.xml").children,
    "office:body",
  );
  const presentation =
    body === undefined
      ? undefined
      : findChildElement(body.children, "office:presentation");
  if (presentation === undefined) {
    throw new Error("expected office:body/office:presentation");
  }
  return presentation;
}

function pagesOf(pkg: Package): XmlElement[] {
  return childrenWithTag(presentationBody(pkg), "draw:page");
}

function styleNamed(
  container: XmlElement,
  name: string,
  family: string,
): XmlElement {
  const found = childrenWithTag(container, "style:style").find(
    (style) =>
      attrValue(style, "style:name") === name &&
      attrValue(style, "style:family") === family,
  );
  if (found === undefined) {
    throw new Error(`expected a ${family} style named ${name}`);
  }
  return found;
}

describe("writeOdpContent: package structure", () => {
  const pkg = writeOdpContent(documentOf([slide([shape()])]));

  it("declares the presentation media type", () => {
    expect(readMimetype(pkg)).toBe(
      "application/vnd.oasis.opendocument.presentation",
    );
  });

  it("hoists mimetype first, stored, uncompressed", () => {
    assertMimetypeEntryLayout(
      encodePackage(pkg),
      "application/vnd.oasis.opendocument.presentation",
    );
  });

  it("registers content.xml, styles.xml, and meta.xml in the manifest", () => {
    const manifest = readManifest(pkg);
    const paths = manifest.entries.map((entry) => entry.fullPath);
    expect(paths).toContain("content.xml");
    expect(paths).toContain("styles.xml");
    expect(paths).toContain("meta.xml");
  });

  it("writes one draw:page for one slide", () => {
    expect(pagesOf(pkg)).toHaveLength(1);
  });
});

describe("writeOdpContent: slide page geometry", () => {
  it("writes a style:master-page + style:page-layout per slide, referenced by draw:master-page-name", () => {
    const pkg = writeOdpContent(
      documentOf([slide([shape()]), slide([shape()])]),
    );
    const pages = pagesOf(pkg);
    expect(pages).toHaveLength(2);
    const masterPageName1 = attrValue(pages[0]!, "draw:master-page-name");
    const masterPageName2 = attrValue(pages[1]!, "draw:master-page-name");
    expect(masterPageName1).toBeDefined();
    expect(masterPageName2).toBeDefined();
    expect(masterPageName1).not.toBe(masterPageName2);

    const stylesRoot = partRoot(pkg, "styles.xml");
    const masterStyles = findChildElement(
      stylesRoot.children,
      "office:master-styles",
    );
    if (masterStyles === undefined) {
      throw new Error("expected office:master-styles");
    }
    const masterPage = childrenWithTag(masterStyles, "style:master-page").find(
      (element) => attrValue(element, "style:name") === masterPageName1,
    );
    if (masterPage === undefined) {
      throw new Error("expected the referenced master page to exist");
    }
    const pageLayoutName = attrValue(masterPage, "style:page-layout-name");
    expect(pageLayoutName).toBeDefined();

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
    )[0];
    expect(properties && attrValue(properties, "fo:page-width")).toBe("960pt");
    expect(properties && attrValue(properties, "fo:page-height")).toBe("540pt");
  });
});

describe("writeOdpContent: shape geometry", () => {
  it("writes an unrotated shape's frame as plain svg:x/y/width/height", () => {
    const pkg = writeOdpContent(documentOf([slide([shape()])]));
    const frame = childrenWithTag(pagesOf(pkg)[0]!, "draw:frame")[0]!;
    expect(attrValue(frame, "svg:x")).toBe("10pt");
    expect(attrValue(frame, "svg:y")).toBe("20pt");
    expect(attrValue(frame, "svg:width")).toBe("300pt");
    expect(attrValue(frame, "svg:height")).toBe("100pt");
    expect(attrValue(frame, "draw:transform")).toBeUndefined();
  });

  it("writes a rotated shape's frame as svg:width/height plus draw:transform, never svg:x/y", () => {
    const pkg = writeOdpContent(
      documentOf([slide([shape({ rotationDeg: 30 })])]),
    );
    const frame = childrenWithTag(pagesOf(pkg)[0]!, "draw:frame")[0]!;
    expect(attrValue(frame, "svg:x")).toBeUndefined();
    expect(attrValue(frame, "svg:y")).toBeUndefined();
    expect(attrValue(frame, "svg:width")).toBe("300pt");
    expect(attrValue(frame, "svg:height")).toBe("100pt");
    const transform = attrValue(frame, "draw:transform");
    expect(transform).toMatch(
      /^rotate\(-?[\d.]+\) translate\(-?[\d.]+pt -?[\d.]+pt\)$/,
    );
  });

  it("writes a literal rotationDeg of 0 the same as no rotation at all", () => {
    const pkg = writeOdpContent(
      documentOf([slide([shape({ rotationDeg: 0 })])]),
    );
    const frame = childrenWithTag(pagesOf(pkg)[0]!, "draw:frame")[0]!;
    expect(attrValue(frame, "svg:x")).toBe("10pt");
    expect(attrValue(frame, "draw:transform")).toBeUndefined();
  });

  it("names a shape via draw:name when given one", () => {
    const pkg = writeOdpContent(
      documentOf([slide([shape({ name: "Title Placeholder" })])]),
    );
    const frame = childrenWithTag(pagesOf(pkg)[0]!, "draw:frame")[0]!;
    expect(attrValue(frame, "draw:name")).toBe("Title Placeholder");
  });

  it("escapes an XML special character in draw:name, storing the entity form in the attribute", () => {
    const pkg = writeOdpContent(
      documentOf([slide([shape({ name: "Q&A <draft>" })])]),
    );
    const frame = childrenWithTag(pagesOf(pkg)[0]!, "draw:frame")[0]!;
    expect(attrValue(frame, "draw:name")).toBe("Q&amp;A &lt;draft&gt;");
  });

  // The ODF `length` datatype has no exponent form at all (typed/shared/units.ts's own LENGTH_PATTERN), so an svg:*/translate() component in JavaScript's own exponent spelling is invalid ODF that this package's reader silently discards -- taking the translate(), or the whole shape, with it. A frame sitting at the page origin is the ordinary way to reach that magnitude: the rotation inverse's own terms cancel to trig rounding dust rather than to a clean zero. This exact case (a 100x100 frame at the origin, rotated 270 degrees) writes translate(7.105427357601002e-15pt ...) without the fix.
  it("writes no exponent-notation length for a rotated frame at the page origin, where the translate() components cancel to rounding dust", () => {
    const pkg = writeOdpContent(
      documentOf([
        slide([
          shape({
            rotationDeg: 270,
            frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 },
          }),
        ]),
      ]),
    );
    const frame = childrenWithTag(pagesOf(pkg)[0]!, "draw:frame")[0]!;
    const transform = attrValue(frame, "draw:transform");
    expect(transform).toBeDefined();
    expect(transform).not.toMatch(/[\d.]e[+-]?\d/i);
    expect(transform).toMatch(
      /^rotate\(-?[\d.]+\) translate\(-?[\d.]+pt -?[\d.]+pt\)$/,
    );
  });

  // The rotate() ANGLE is a bare radians value with no unit suffix, distinct from the translate() lengths the test above covers -- a tiny non-zero rotationDeg (never zero, which collapses to no transform at all) drives angleRad itself into JavaScript's own exponent spelling (rotationDeg: 1e-9 emits rotate(-1.7453292519943295e-11) without the fix), which is exactly as invalid to the ODF `length`/number grammar as an exponent-form translate() component.
  it("writes no exponent-notation angle in draw:transform's rotate() for a very small non-zero rotationDeg", () => {
    const pkg = writeOdpContent(
      documentOf([slide([shape({ rotationDeg: 1e-9 })])]),
    );
    const frame = childrenWithTag(pagesOf(pkg)[0]!, "draw:frame")[0]!;
    const transform = attrValue(frame, "draw:transform");
    expect(transform).toBeDefined();
    expect(transform).not.toMatch(/[\d.]e[+-]?\d/i);
  });
});

describe("writeOdpContent: shape insets", () => {
  it("writes no draw:style-name at all when every inset is zero", () => {
    const pkg = writeOdpContent(documentOf([slide([shape()])]));
    const frame = childrenWithTag(pagesOf(pkg)[0]!, "draw:frame")[0]!;
    expect(attrValue(frame, "draw:style-name")).toBeUndefined();
  });

  it("interns a graphic-family style carrying fo:padding-* when an inset is non-zero", () => {
    const pkg = writeOdpContent(
      documentOf([
        slide([
          shape({
            insetLeftPt: 5,
            insetTopPt: 6,
            insetRightPt: 7,
            insetBottomPt: 8,
          }),
        ]),
      ]),
    );
    const frame = childrenWithTag(pagesOf(pkg)[0]!, "draw:frame")[0]!;
    const styleName = attrValue(frame, "draw:style-name");
    expect(styleName).toBeDefined();
    const contentAutomaticStyles = findChildElement(
      partRoot(pkg, "content.xml").children,
      "office:automatic-styles",
    );
    if (contentAutomaticStyles === undefined) {
      throw new Error("expected content.xml office:automatic-styles");
    }
    const style = styleNamed(contentAutomaticStyles, styleName!, "graphic");
    const properties = childrenWithTag(style, "style:graphic-properties")[0]!;
    expect(attrValue(properties, "fo:padding-left")).toBe("5pt");
    expect(attrValue(properties, "fo:padding-top")).toBe("6pt");
    expect(attrValue(properties, "fo:padding-right")).toBe("7pt");
    expect(attrValue(properties, "fo:padding-bottom")).toBe("8pt");
  });
});

describe("writeOdpContent: shape content", () => {
  it("writes plain paragraphs as a draw:text-box of text:p", () => {
    const pkg = writeOdpContent(
      documentOf([
        slide([
          shape({}, [
            { kind: "paragraph", runs: [{ text: "One" }] },
            { kind: "paragraph", runs: [{ text: "Two", bold: true }] },
          ]),
        ]),
      ]),
    );
    const frame = childrenWithTag(pagesOf(pkg)[0]!, "draw:frame")[0]!;
    const textBox = childrenWithTag(frame, "draw:text-box")[0];
    if (textBox === undefined) {
      throw new Error("expected a draw:text-box");
    }
    const paragraphs = childrenWithTag(textBox, "text:p");
    expect(paragraphs).toHaveLength(2);
  });

  it("groups consecutive list paragraphs into one text:list", () => {
    const pkg = writeOdpContent(
      documentOf([
        slide([
          shape({}, [
            {
              kind: "paragraph",
              runs: [{ text: "a" }],
              list: { numId: "bullet:x", level: 0 },
            },
            {
              kind: "paragraph",
              runs: [{ text: "b" }],
              list: { numId: "bullet:x", level: 0 },
            },
          ]),
        ]),
      ]),
    );
    const frame = childrenWithTag(pagesOf(pkg)[0]!, "draw:frame")[0]!;
    const textBox = childrenWithTag(frame, "draw:text-box")[0]!;
    const lists = childrenWithTag(textBox, "text:list");
    expect(lists).toHaveLength(1);
    expect(childrenWithTag(lists[0]!, "text:list-item")).toHaveLength(2);
  });

  it("writes a shape whose sole block is a table as a bare table:table, no draw:text-box wrapper", () => {
    const pkg = writeOdpContent(
      documentOf([
        slide([
          shape({}, [
            {
              kind: "table",
              columnWidthsPt: [100, 100],
              rows: [
                {
                  cells: [
                    { blocks: [{ kind: "paragraph", runs: [{ text: "A" }] }] },
                    { blocks: [{ kind: "paragraph", runs: [{ text: "B" }] }] },
                  ],
                },
              ],
            },
          ]),
        ]),
      ]),
    );
    const frame = childrenWithTag(pagesOf(pkg)[0]!, "draw:frame")[0]!;
    expect(childrenWithTag(frame, "table:table")).toHaveLength(1);
    expect(childrenWithTag(frame, "draw:text-box")).toHaveLength(0);
  });

  it("writes a shape whose sole block is an image as a bare draw:image, no draw:text-box wrapper", () => {
    const pkg = writeOdpContent(
      documentOf([
        slide([
          shape({}, [
            {
              kind: "image",
              format: "png",
              base64: PNG_BASE64,
              widthPt: 300,
              heightPt: 100,
              altText: "A picture",
            },
          ]),
        ]),
      ]),
    );
    const frame = childrenWithTag(pagesOf(pkg)[0]!, "draw:frame")[0]!;
    expect(childrenWithTag(frame, "draw:text-box")).toHaveLength(0);
    const image = childrenWithTag(frame, "draw:image")[0];
    if (image === undefined) {
      throw new Error("expected a draw:image");
    }
    expect(attrValue(image, "xlink:href")).toBe("Pictures/image1.png");
    expect(pkg.parts["Pictures/image1.png"]?.kind).toBe("binary");
    const title = childrenWithTag(frame, "svg:title")[0];
    expect(title).toBeDefined();
  });

  it("refuses a table mixed with other content, by name", () => {
    expect(() =>
      writeOdpContent(
        documentOf([
          slide([
            shape({}, [
              { kind: "paragraph", runs: [{ text: "x" }] },
              {
                kind: "table",
                columnWidthsPt: [10],
                rows: [{ cells: [{ blocks: [] }] }],
              },
            ]),
          ]),
        ]),
      ),
    ).toThrow(/table alongside other content/);
  });

  it("refuses a heading inside a shape's own text, by name", () => {
    expect(() =>
      writeOdpContent(
        documentOf([
          slide([
            shape({}, [
              { kind: "paragraph", headingLevel: 1, runs: [{ text: "x" }] },
            ]),
          ]),
        ]),
      ),
    ).toThrow(/heading/);
  });

  it("refuses a page break inside a shape's own text, by name", () => {
    expect(() =>
      writeOdpContent(
        documentOf([slide([shape({}, [{ kind: "pageBreak" }])])]),
      ),
    ).toThrow(/page break/);
  });
});

describe("writeOdpContent: speaker notes", () => {
  it("writes no presentation:notes at all for an empty notes string", () => {
    const pkg = writeOdpContent(documentOf([slide([shape()], "")]));
    const page = pagesOf(pkg)[0]!;
    expect(childrenWithTag(page, "presentation:notes")).toHaveLength(0);
  });

  it("writes one text:p per line of notes, inside a draw:frame > draw:text-box", () => {
    const pkg = writeOdpContent(
      documentOf([slide([shape()], "First line\nSecond line")]),
    );
    const page = pagesOf(pkg)[0]!;
    const notes = childrenWithTag(page, "presentation:notes")[0];
    if (notes === undefined) {
      throw new Error("expected presentation:notes");
    }
    const frame = childrenWithTag(notes, "draw:frame")[0];
    if (frame === undefined) {
      throw new Error("expected a draw:frame inside presentation:notes");
    }
    const textBox = childrenWithTag(frame, "draw:text-box")[0];
    if (textBox === undefined) {
      throw new Error("expected a draw:text-box inside the notes frame");
    }
    const paragraphs = elementsWithTag(textBox.children, "text:p");
    expect(paragraphs).toHaveLength(2);
  });
});

// ContentShape.paintOrder -> draw:z-index, the one spelling ODF has for a stacking order independent of document position, and the one typed/draw/shapes.ts's own paintOrderKey already reads back. See typed/draw/write-shapes.ts's odfZIndexOf for why a paintOrder ODF cannot spell writes no attribute at all rather than a rounded approximation.
describe("writeOdpContent: shape paint order", () => {
  it("writes a shape's paintOrder as draw:z-index", () => {
    const pkg = writeOdpContent(
      documentOf([slide([shape({ paintOrder: 7 }), shape({ paintOrder: 2 })])]),
    );
    const frames = childrenWithTag(pagesOf(pkg)[0]!, "draw:frame");
    expect(frames.map((frame) => attrValue(frame, "draw:z-index"))).toEqual([
      "7",
      "2",
    ]);
  });

  it("writes draw:z-index as the shape's own document-encounter index for a shape with no paintOrder, never omitting the attribute", () => {
    const pkg = writeOdpContent(documentOf([slide([shape()])]));
    const frame = childrenWithTag(pagesOf(pkg)[0]!, "draw:frame")[0]!;
    expect(attrValue(frame, "draw:z-index")).toBe("0");
  });

  it("writes draw:z-index as each shape's own document-encounter index for a paintOrder ODF's own xsd:nonNegativeInteger cannot spell, rather than rounding it onto a neighbouring shape's order", () => {
    const pkg = writeOdpContent(
      documentOf([
        slide([shape({ paintOrder: 1.5 }), shape({ paintOrder: -1 })]),
      ]),
    );
    const frames = childrenWithTag(pagesOf(pkg)[0]!, "draw:frame");
    expect(frames.map((frame) => attrValue(frame, "draw:z-index"))).toEqual([
      "0",
      "1",
    ]);
  });

  // Number.isInteger(1e21) is true, and String(1e21) is "1e+21" -- an integer beyond Number.isSafeInteger's 2^53 bound reaches JavaScript's own exponent-notation threshold before it reaches any bound xsd:nonNegativeInteger itself states, the exact failure class formatOdfLength's own expandExponential exists to close for lengths. odfZIndexOf must refuse one rather than writing a draw:z-index no XML integer datatype can spell.
  it("writes draw:z-index as the shape's own document-encounter index for a paintOrder beyond Number.isSafeInteger's own bound, rather than emitting exponent notation", () => {
    const pkg = writeOdpContent(
      documentOf([slide([shape({ paintOrder: 1e21 })])]),
    );
    const frame = childrenWithTag(pagesOf(pkg)[0]!, "draw:frame")[0]!;
    expect(attrValue(frame, "draw:z-index")).toBe("0");
  });
});
