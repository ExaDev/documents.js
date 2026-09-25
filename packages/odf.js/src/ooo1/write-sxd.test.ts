import { describe, expect, it } from "vitest";
import type {
  ContentDocument,
  ContentDrawPage,
  ContentShape,
  ContentVector,
} from "document-schema.js";
import {
  PAGE_SIZE_A4,
  assembleTree,
  flattenTree,
  rgbHexToColor,
} from "document-schema.js";
import type { Package } from "../model/package";
import { decodePackage, encodePackage } from "../codec";
import {
  rootElement,
  attrValue,
  childrenWithTag,
  findChildElement,
} from "../xml/query";
import { readMimetype } from "../mimetype";
import { readManifest } from "../manifest";
import { normaliseOdgContent } from "../typed/odg/write";
import { readSxd, readSxdContent } from "./read";
import { isOoo1Package } from "./ns";
import { writeSxd, writeSxdContent } from "./write";

// The write side's correctness suite for .sxw, mirroring typed/odt/write-round-trip.test.ts's own law: a document written by writeSxwContent and read back through the EXISTING readSxwContent reader (readOdtContent run over transformOoo1Package's own forward transform — unmodified by anything in this PR) reproduces the document it was given, up to the exact same canonical form normaliseOdtContent already states for the plain .odt writer. That reuse is deliberate, not a shortcut: writeSxwContent is writeOdtContent's own output run through transformToOoo1Package and back through transformOoo1Package on the way in, so the two writers share one correctness law by construction, and a normalisation gap in one is a normalisation gap in both.
//
// A second, independent kind of assertion sits alongside the round trip: that the PACKAGE writeSxwContent produces actually LOOKS like OpenOffice.org 1.x XML — declares its own namespace URIs, carries no "mimetype" part, splits nothing into ODF's typed style:*-properties family, wraps nothing in a draw:frame — rather than happening to round-trip only because transformOoo1Package's own catch-all passthrough tolerates whatever shape it was handed. A writer that merely round-trips without genuinely changing shape would pass the round-trip law by accident (see this module's own top-of-file note on why transformToOoo1Package must produce authentically OpenOffice.org 1.x-shaped output, not just something transformOoo1Package happens not to choke on).

// --- .sxd: the OpenOffice.org 1.x Draw writer --------------------------------------------------------------------------
//
// The same two-part discipline as the .sxw/.sxc/.sxi suites above: THE LAW below is the round-trip correctness proof (normaliseOdgContent(readSxdContent(writeSxdContent(document))) equals normaliseOdgContent(document), mirroring typed/odg/write-round-trip.test.ts's own law exactly, run through one more transform each way, including that suite's own rotated-geometry tolerance exception), and the "genuine OpenOffice.org 1.x XML" describe block that follows makes the same second, independent assertion the other three suites make: that writeSxdContent's own output actually LOOKS like OpenOffice.org 1.x XML — declares its own namespace URIs, carries no "mimetype" part, puts office:body's content directly inside it with no office:drawing genre wrapper, writes a text-in-a-frame shape as a bare draw:text-box rather than ODF's draw:frame-wrapped one, and keeps a vector's fill and stroke in one bare style:properties rather than ODF's typed style:graphic-properties — rather than happening to round-trip only because transformOoo1Package's own catch-all passthrough tolerates whatever shape it was handed.
//
// What this suite covers that the .sxi one structurally cannot is a drawing page's own second array: the VECTOR PRIMITIVES (rect/ellipse/line/path with fill and stroke) a ContentShape has no vocabulary for at all, and the paint order that has to hold BETWEEN the two arrays rather than within one of them.

type DrawingDocument = Extract<ContentDocument, { kind: "drawing" }>;

const SXD_RED = rgbHexToColor("#cc0000");
const SXD_GREEN = rgbHexToColor("#00aa44");
const SXD_BLUE = rgbHexToColor("#0033ff");

const SXD_PAGE_SIZE_LANDSCAPE = { widthPt: 720, heightPt: 540 };

function drawShapeOf(
  overrides: Partial<ContentShape> = {},
  blocks: ContentShape["blocks"] = [
    { kind: "paragraph", runs: [{ text: "Label" }] },
  ],
): ContentShape {
  return {
    frame: { xPt: 36, yPt: 48, widthPt: 240, heightPt: 80 },
    insetLeftPt: 0,
    insetTopPt: 0,
    insetRightPt: 0,
    insetBottomPt: 0,
    blocks,
    ...overrides,
  };
}

function drawPageOf(
  vectors: readonly ContentVector[],
  shapes: readonly ContentShape[] = [],
  size = SXD_PAGE_SIZE_LANDSCAPE,
): ContentDrawPage {
  return { size, shapes: [...shapes], vectors: [...vectors] };
}

function drawingDocumentOf(pages: readonly ContentDrawPage[]): DrawingDocument {
  return { kind: "drawing", metadata: {}, pages: [...pages] };
}

function drawingRoundTrip(document: ContentDocument): DrawingDocument {
  const pkg = decodePackage(encodePackage(writeSxdContent(document)));
  const { metadata, pages } = readSxdContent(pkg);
  return { kind: "drawing", metadata, pages };
}

function expectDrawingRoundTrip(document: ContentDocument): void {
  expect(normaliseOdgContent(drawingRoundTrip(document))).toEqual(
    normaliseOdgContent(document),
  );
}

describe("the sxd round-trip law", () => {
  it("round-trips a page carrying every vector kind writeOdgContent writes, alongside a text shape", () => {
    expectDrawingRoundTrip(
      drawingDocumentOf([
        drawPageOf(
          [
            {
              kind: "rect",
              frame: { xPt: 36, yPt: 48, widthPt: 120, heightPt: 90 },
              fill: SXD_BLUE,
              stroke: { color: SXD_RED, widthPt: 1.5 },
            },
            {
              kind: "ellipse",
              frame: { xPt: 200, yPt: 48, widthPt: 140, heightPt: 90 },
              fill: SXD_GREEN,
              stroke: { color: SXD_RED, widthPt: 3, style: "dashed" },
            },
            {
              kind: "line",
              from: { xPt: 12, yPt: 24 },
              to: { xPt: 300, yPt: 180 },
              stroke: { color: SXD_RED, widthPt: 2.25 },
            },
            {
              kind: "path",
              frame: { xPt: 40, yPt: 240, widthPt: 200, heightPt: 120 },
              subpaths: [
                {
                  start: { xPt: 0, yPt: 0 },
                  segments: [
                    { kind: "line", to: { xPt: 80, yPt: 0 } },
                    {
                      kind: "cubic",
                      control1: { xPt: 120, yPt: 0 },
                      control2: { xPt: 120, yPt: 60 },
                      to: { xPt: 80, yPt: 60 },
                    },
                    { kind: "line", to: { xPt: 0, yPt: 60 } },
                  ],
                  closed: true,
                },
                {
                  start: { xPt: 140, yPt: 10 },
                  segments: [
                    {
                      kind: "cubic",
                      control1: { xPt: 160, yPt: 110 },
                      control2: { xPt: 190, yPt: -10 },
                      to: { xPt: 200, yPt: 100 },
                    },
                  ],
                  closed: false,
                },
              ],
              fill: SXD_GREEN,
              fillRule: "evenodd",
              stroke: { color: SXD_RED, widthPt: 1 },
            },
          ],
          [
            drawShapeOf({}, [
              {
                kind: "paragraph",
                alignment: "center",
                runs: [{ text: "Caption", bold: true }],
              },
            ]),
          ],
        ),
      ]),
    );
  });

  it("round-trips multiple pages, each with its own page size", () => {
    expectDrawingRoundTrip({
      kind: "drawing",
      metadata: { title: "Sxd doc", keywords: ["openoffice", "draw"] },
      pages: [
        drawPageOf([
          {
            kind: "rect",
            frame: { xPt: 0, yPt: 0, widthPt: 60, heightPt: 40 },
            fill: SXD_BLUE,
          },
        ]),
        drawPageOf(
          [
            {
              kind: "ellipse",
              frame: { xPt: 20, yPt: 20, widthPt: 80, heightPt: 80 },
              fill: SXD_GREEN,
            },
          ],
          [drawShapeOf()],
          PAGE_SIZE_A4,
        ),
      ],
    });
  });

  it("round-trips a paint order that disagrees with document order across both of a page's arrays", () => {
    expectDrawingRoundTrip(
      drawingDocumentOf([
        drawPageOf(
          [
            {
              kind: "rect",
              frame: { xPt: 0, yPt: 0, widthPt: 50, heightPt: 50 },
              fill: SXD_BLUE,
              paintOrder: 0,
            },
            {
              kind: "ellipse",
              frame: { xPt: 60, yPt: 0, widthPt: 50, heightPt: 50 },
              fill: SXD_GREEN,
              paintOrder: 2,
            },
          ],
          [drawShapeOf({ paintOrder: 1 })],
        ),
      ]),
    );
  });

  // A rotated shape's and a rotated vector's own frame/rotationDeg is an exact algebraic inverse (typed/draw/write-shapes.ts's own frameGeometryAttrs) verified with a numeric tolerance rather than the blanket expectDrawingRoundTrip helper above, exactly mirroring typed/odg/write-round-trip.test.ts's own identical exception (two independent trig evaluations on either side of a real round trip — here run through transformToOoo1Package/transformOoo1Package on top of writeOdg/readOdg — are not guaranteed bit-identical).
  it("round-trips a rotated vector's geometry within floating-point tolerance", () => {
    const frame = { xPt: 60, yPt: 200, widthPt: 200, heightPt: 80 };
    const rotationDeg = 30;
    const rotationPrecisionDigits = 9;
    const framePrecisionDigits = 6;
    const written = drawingRoundTrip(
      drawingDocumentOf([
        drawPageOf([{ kind: "rect", frame, rotationDeg, fill: SXD_BLUE }]),
      ]),
    );
    const vector = written.pages[0]!.vectors[0]!;
    if (vector.kind !== "rect") {
      throw new Error(`expected a rect back, got '${vector.kind}'`);
    }
    expect(vector.rotationDeg).toBeCloseTo(
      rotationDeg,
      rotationPrecisionDigits,
    );
    expect(vector.frame.xPt).toBeCloseTo(frame.xPt, framePrecisionDigits);
    expect(vector.frame.yPt).toBeCloseTo(frame.yPt, framePrecisionDigits);
    expect(vector.frame.widthPt).toBeCloseTo(
      frame.widthPt,
      framePrecisionDigits,
    );
    expect(vector.frame.heightPt).toBeCloseTo(
      frame.heightPt,
      framePrecisionDigits,
    );
  });

  it("round-trips a rotated shape's geometry within floating-point tolerance", () => {
    const frame = { xPt: 36, yPt: 48, widthPt: 240, heightPt: 80 };
    const rotationDeg = 30;
    const rotationPrecisionDigits = 9;
    const framePrecisionDigits = 6;
    const written = drawingRoundTrip(
      drawingDocumentOf([
        drawPageOf([], [drawShapeOf({ frame, rotationDeg })]),
      ]),
    );
    const writtenShape = written.pages[0]!.shapes[0]!;
    expect(writtenShape.rotationDeg).toBeCloseTo(
      rotationDeg,
      rotationPrecisionDigits,
    );
    expect(writtenShape.frame.xPt).toBeCloseTo(frame.xPt, framePrecisionDigits);
    expect(writtenShape.frame.yPt).toBeCloseTo(frame.yPt, framePrecisionDigits);
    expect(writtenShape.frame.widthPt).toBeCloseTo(
      frame.widthPt,
      framePrecisionDigits,
    );
    expect(writtenShape.frame.heightPt).toBeCloseTo(
      frame.heightPt,
      framePrecisionDigits,
    );
  });

  it("holds through the tree form as well as the flat one", () => {
    const document = drawingDocumentOf([
      drawPageOf(
        [
          {
            kind: "rect",
            frame: { xPt: 12, yPt: 12, widthPt: 100, heightPt: 60 },
            fill: SXD_BLUE,
            stroke: { color: SXD_RED, widthPt: 2 },
          },
        ],
        [drawShapeOf()],
      ),
    ]);
    const tree = assembleTree(document);
    const pkg = decodePackage(encodePackage(writeSxd(tree)));
    // See the sxw suite's own identical note above: the round trip alone cannot distinguish genuine OpenOffice.org 1.x output from writeOdg's own plain ODF passed straight through.
    expect(isOoo1Package(pkg)).toBe(true);
    expect(normaliseOdgContent(flattenTree(readSxd(pkg)))).toEqual(
      normaliseOdgContent(document),
    );
    expect(readSxd(pkg).kind).toBe("drawing");
  });
});

describe("writeSxdContent produces genuine OpenOffice.org 1.x XML, not merely something transformOoo1Package tolerates", () => {
  function drawingContentRootOf(pkg: Package): {
    readonly pkg: Package;
    readonly root: ReturnType<typeof rootElement>;
  } {
    const content = pkg.parts["content.xml"];
    if (content?.kind !== "xml") {
      throw new Error("content.xml did not survive as an XML part");
    }
    return { pkg, root: rootElement(content.nodes) };
  }

  function firstDrawPage(pkg: Package): ReturnType<typeof findChildElement> {
    const { root } = drawingContentRootOf(pkg);
    const body =
      root === undefined
        ? undefined
        : findChildElement(root.children, "office:body");
    return body === undefined
      ? undefined
      : findChildElement(body.children, "draw:page");
  }

  const RECT: ContentVector = {
    kind: "rect",
    frame: { xPt: 36, yPt: 48, widthPt: 120, heightPt: 90 },
    fill: SXD_BLUE,
    stroke: { color: SXD_RED, widthPt: 1.5 },
  };

  it("carries no mimetype part at all", () => {
    const pkg = writeSxdContent(drawingDocumentOf([drawPageOf([RECT])]));
    expect(pkg.parts.mimetype).toBeUndefined();
    expect(readMimetype(pkg)).toBeUndefined();
  });

  it("is itself detected as an OpenOffice.org 1.x package", () => {
    const pkg = writeSxdContent(drawingDocumentOf([drawPageOf([RECT])]));
    expect(isOoo1Package(pkg)).toBe(true);
  });

  it("declares the .std template media type in the manifest root entry when template is requested", () => {
    const pkg = writeSxdContent(drawingDocumentOf([drawPageOf([RECT])]), {
      template: true,
    });
    expect(
      readManifest(pkg).entries.find((entry) => entry.fullPath === "/")
        ?.mediaType,
    ).toBe("application/vnd.sun.xml.draw.template");
  });

  it("declares the OpenOffice.org 1.x namespace URIs and office:class='drawing'", () => {
    const { root } = drawingContentRootOf(
      writeSxdContent(drawingDocumentOf([drawPageOf([RECT])])),
    );
    if (root === undefined) {
      throw new Error("content.xml has no root element");
    }
    expect(attrValue(root, "xmlns:office")).toBe(
      "http://openoffice.org/2000/office",
    );
    // The trap this format shares with OASIS ODF: the drawing namespace is ".../drawing", never ".../draw" (see ./ns.ts).
    expect(attrValue(root, "xmlns:draw")).toBe(
      "http://openoffice.org/2000/drawing",
    );
    expect(attrValue(root, "xmlns:svg")).toBe("http://www.w3.org/2000/svg");
    expect(attrValue(root, "office:class")).toBe("drawing");
  });

  it("puts office:body's content directly inside it, with no office:drawing genre wrapper", () => {
    const { root } = drawingContentRootOf(
      writeSxdContent(drawingDocumentOf([drawPageOf([RECT])])),
    );
    const body =
      root === undefined
        ? undefined
        : findChildElement(root.children, "office:body");
    if (body === undefined) {
      throw new Error("content.xml has no office:body");
    }
    expect(findChildElement(body.children, "office:drawing")).toBeUndefined();
    expect(findChildElement(body.children, "draw:page")).toBeDefined();
  });

  it("writes a text-in-a-frame shape as a bare draw:text-box, not ODF's draw:frame-wrapped one", () => {
    const page = firstDrawPage(
      writeSxdContent(drawingDocumentOf([drawPageOf([], [drawShapeOf()])])),
    );
    if (page === undefined) {
      throw new Error("content.xml has no draw:page");
    }
    expect(findChildElement(page.children, "draw:frame")).toBeUndefined();
    expect(findChildElement(page.children, "draw:text-box")).toBeDefined();
  });

  it("writes a vector as a bare draw:rect, never wrapped in anything", () => {
    const page = firstDrawPage(
      writeSxdContent(drawingDocumentOf([drawPageOf([RECT])])),
    );
    if (page === undefined) {
      throw new Error("content.xml has no draw:page");
    }
    expect(findChildElement(page.children, "draw:frame")).toBeUndefined();
    const rectElement = findChildElement(page.children, "draw:rect");
    if (rectElement === undefined) {
      throw new Error("no draw:rect was written");
    }
    expect(attrValue(rectElement, "svg:x")).toBe("36pt");
    expect(attrValue(rectElement, "svg:width")).toBe("120pt");
  });

  // Two independent facts in one assertion, both of which a real consumer needs: the drawing family is spelled "graphics" (ODF's singular "graphic" leaves every fill and stroke silently unbound in LibreOffice), and its properties sit in one bare style:properties rather than ODF's typed style:graphic-properties.
  it("writes a vector's fill and stroke as one bare style:properties on a style:family='graphics' style", () => {
    const { root } = drawingContentRootOf(
      writeSxdContent(drawingDocumentOf([drawPageOf([RECT])])),
    );
    if (root === undefined) {
      throw new Error("content.xml has no root element");
    }
    const automaticStyles = findChildElement(
      root.children,
      "office:automatic-styles",
    );
    if (automaticStyles === undefined) {
      throw new Error("content.xml has no office:automatic-styles");
    }
    expect(
      childrenWithTag(automaticStyles, "style:style").some(
        (styleElement) => attrValue(styleElement, "style:family") === "graphic",
      ),
    ).toBe(false);
    const graphicStyle = childrenWithTag(automaticStyles, "style:style").find(
      (styleElement) => attrValue(styleElement, "style:family") === "graphics",
    );
    if (graphicStyle === undefined) {
      throw new Error("no graphics style:style was minted");
    }
    const properties = findChildElement(
      graphicStyle.children,
      "style:properties",
    );
    if (properties === undefined) {
      throw new Error("the graphic style carries no bare style:properties");
    }
    expect(
      findChildElement(graphicStyle.children, "style:graphic-properties"),
    ).toBeUndefined();
    expect(attrValue(properties, "draw:fill")).toBe("solid");
    expect(attrValue(properties, "draw:fill-color")).toBe("#0033ff");
  });

  it("writes a path's own subpaths as real svg:d path data against an svg:viewBox", () => {
    const page = firstDrawPage(
      writeSxdContent(
        drawingDocumentOf([
          drawPageOf([
            {
              kind: "path",
              frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 50 },
              subpaths: [
                {
                  start: { xPt: 0, yPt: 0 },
                  segments: [{ kind: "line", to: { xPt: 100, yPt: 50 } }],
                  closed: false,
                },
              ],
              stroke: { color: SXD_RED, widthPt: 1 },
            },
          ]),
        ]),
      ),
    );
    const pathElement =
      page === undefined
        ? undefined
        : findChildElement(page.children, "draw:path");
    if (pathElement === undefined) {
      throw new Error("no draw:path was written");
    }
    expect(attrValue(pathElement, "svg:viewBox")).toBe("0 0 100 50");
    expect(attrValue(pathElement, "svg:d")).toBe("M 0,0 L 100,50");
  });
});
