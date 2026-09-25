import { describe, expect, it } from "vitest";
import type {
  ContentDocument,
  ContentShape,
  ContentSlide,
} from "document-schema.js";
import {
  PAGE_SIZE_A4,
  SLIDE_SIZE_WIDESCREEN,
  assembleTree,
  flattenTree,
} from "document-schema.js";
import type { Package } from "../model/package";
import { decodePackage, encodePackage } from "../codec";
import { rootElement, attrValue, findChildElement } from "../xml/query";
import { readMimetype } from "../mimetype";
import { readManifest } from "../manifest";
import { normaliseOdpContent } from "../typed/odp/write";
import { readSxi, readSxiContent } from "./read";
import { isOoo1Package } from "./ns";
import { writeSxi, writeSxiContent } from "./write";

// The write side's correctness suite for .sxw, mirroring typed/odt/write-round-trip.test.ts's own law: a document written by writeSxwContent and read back through the EXISTING readSxwContent reader (readOdtContent run over transformOoo1Package's own forward transform — unmodified by anything in this PR) reproduces the document it was given, up to the exact same canonical form normaliseOdtContent already states for the plain .odt writer. That reuse is deliberate, not a shortcut: writeSxwContent is writeOdtContent's own output run through transformToOoo1Package and back through transformOoo1Package on the way in, so the two writers share one correctness law by construction, and a normalisation gap in one is a normalisation gap in both.
//
// A second, independent kind of assertion sits alongside the round trip: that the PACKAGE writeSxwContent produces actually LOOKS like OpenOffice.org 1.x XML — declares its own namespace URIs, carries no "mimetype" part, splits nothing into ODF's typed style:*-properties family, wraps nothing in a draw:frame — rather than happening to round-trip only because transformOoo1Package's own catch-all passthrough tolerates whatever shape it was handed. A writer that merely round-trips without genuinely changing shape would pass the round-trip law by accident (see this module's own top-of-file note on why transformToOoo1Package must produce authentically OpenOffice.org 1.x-shaped output, not just something transformOoo1Package happens not to choke on).

// The same two-part discipline as the .sxw/.sxc suites above: THE LAW below is the round-trip correctness proof (normaliseOdpContent(readSxiContent(writeSxiContent(document))) equals normaliseOdpContent(document), mirroring typed/odp/write-round-trip.test.ts's own law exactly, run through one more transform each way, including that suite's own rotated-shape tolerance exception), and the "genuine OpenOffice.org 1.x XML" describe block that follows makes the same second, independent assertion the .sxw/.sxc suites make: that writeSxiContent's own output actually LOOKS like OpenOffice.org 1.x XML — declares its own namespace URIs, carries no "mimetype" part, puts office:body's content directly inside it with no office:presentation genre wrapper, and writes a shape as a bare draw:text-box rather than ODF's draw:frame-wrapped one — rather than happening to round-trip only because transformOoo1Package's own catch-all passthrough tolerates whatever shape it was handed.

// A 1x1 PNG, genuinely decodable (sniffImageFormat reads real magic bytes) — the same fixture typed/odp/write-round-trip.test.ts's own suite uses.
const SXI_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

type PresentationDocument = Extract<ContentDocument, { kind: "presentation" }>;

function shapeOf(
  overrides: Partial<ContentShape> = {},
  blocks: ContentShape["blocks"] = [
    { kind: "paragraph", runs: [{ text: "Body" }] },
  ],
): ContentShape {
  return {
    frame: { xPt: 36, yPt: 48, widthPt: 400, heightPt: 120 },
    insetLeftPt: 0,
    insetTopPt: 0,
    insetRightPt: 0,
    insetBottomPt: 0,
    blocks,
    ...overrides,
  };
}

function slideOf(shapes: readonly ContentShape[], notes = ""): ContentSlide {
  return { size: SLIDE_SIZE_WIDESCREEN, shapes: [...shapes], notes };
}

function presentationDocumentOf(
  slides: readonly ContentSlide[],
): PresentationDocument {
  return { kind: "presentation", metadata: {}, slides: [...slides] };
}

function presentationRoundTrip(
  document: ContentDocument,
): PresentationDocument {
  const pkg = decodePackage(encodePackage(writeSxiContent(document)));
  const { metadata, slides } = readSxiContent(pkg);
  return { kind: "presentation", metadata, slides };
}

function expectPresentationRoundTrip(document: ContentDocument): void {
  expect(normaliseOdpContent(presentationRoundTrip(document))).toEqual(
    normaliseOdpContent(document),
  );
}

describe("the sxi round-trip law", () => {
  it("round-trips a slide with formatted text, a table, an image, and speaker notes", () => {
    expectPresentationRoundTrip(
      presentationDocumentOf([
        slideOf(
          [
            shapeOf({}, [
              {
                kind: "paragraph",
                alignment: "center",
                runs: [{ text: "Title", bold: true }],
              },
            ]),
            shapeOf(
              { frame: { xPt: 300, yPt: 300, widthPt: 200, heightPt: 100 } },
              [
                {
                  kind: "table",
                  columns: [{ widthPt: 80 }, { widthPt: 80 }],
                  rows: [
                    {
                      cells: [
                        {
                          blocks: [
                            { kind: "paragraph", runs: [{ text: "A" }] },
                          ],
                        },
                        {
                          blocks: [
                            { kind: "paragraph", runs: [{ text: "B" }] },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            ),
            shapeOf(
              { frame: { xPt: 100, yPt: 400, widthPt: 96, heightPt: 96 } },
              [
                {
                  kind: "image",
                  format: "png",
                  base64: SXI_PNG_BASE64,
                  widthPt: 96,
                  heightPt: 96,
                },
              ],
            ),
          ],
          "Speaker notes line one\nline two",
        ),
      ]),
    );
  });

  it("round-trips multiple slides, each with its own page size", () => {
    expectPresentationRoundTrip({
      kind: "presentation",
      metadata: { title: "Sxi doc" },
      slides: [
        { size: SLIDE_SIZE_WIDESCREEN, shapes: [shapeOf()], notes: "" },
        { size: PAGE_SIZE_A4, shapes: [shapeOf()], notes: "" },
      ],
    });
  });

  // A rotated shape's own frame/rotationDeg is an exact algebraic inverse (typed/draw/write-shapes.ts's own frameGeometryAttrs) verified with a numeric tolerance rather than the blanket expectPresentationRoundTrip helper above, exactly mirroring typed/odp/write-round-trip.test.ts's own identical exception (two independent trig evaluations on either side of a real round trip — here run through transformToOoo1Package/transformOoo1Package on top of writeOdp/readOdp — are not guaranteed bit-identical).
  it("round-trips a rotated shape's geometry within floating-point tolerance", () => {
    const frame = { xPt: 60, yPt: 200, widthPt: 200, heightPt: 80 };
    const rotationDeg = 30;
    const rotationPrecisionDigits = 9;
    const framePrecisionDigits = 6;
    const written = presentationRoundTrip(
      presentationDocumentOf([slideOf([shapeOf({ frame, rotationDeg })])]),
    );
    const writtenShape = written.slides[0]!.shapes[0]!;
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
    const document = presentationDocumentOf([slideOf([shapeOf()])]);
    const tree = assembleTree(document);
    const pkg = decodePackage(encodePackage(writeSxi(tree)));
    // See the sxw suite's own identical note above: the round trip alone cannot distinguish genuine OpenOffice.org 1.x output from writeOdp's own plain ODF passed straight through.
    expect(isOoo1Package(pkg)).toBe(true);
    expect(normaliseOdpContent(flattenTree(readSxi(pkg)))).toEqual(
      normaliseOdpContent(document),
    );
  });
});

describe("writeSxiContent produces genuine OpenOffice.org 1.x XML, not merely something transformOoo1Package tolerates", () => {
  function presentationContentRootOf(pkg: Package): {
    readonly pkg: Package;
    readonly root: ReturnType<typeof rootElement>;
  } {
    const content = pkg.parts["content.xml"];
    if (content?.kind !== "xml") {
      throw new Error("content.xml did not survive as an XML part");
    }
    return { pkg, root: rootElement(content.nodes) };
  }

  it("carries no mimetype part at all", () => {
    const pkg = writeSxiContent(presentationDocumentOf([slideOf([shapeOf()])]));
    expect(pkg.parts.mimetype).toBeUndefined();
    expect(readMimetype(pkg)).toBeUndefined();
  });

  it("is itself detected as an OpenOffice.org 1.x package", () => {
    const pkg = writeSxiContent(presentationDocumentOf([slideOf([shapeOf()])]));
    expect(isOoo1Package(pkg)).toBe(true);
  });

  it("declares the .sti template media type in the manifest root entry when template is requested", () => {
    const pkg = writeSxiContent(
      presentationDocumentOf([slideOf([shapeOf()])]),
      { template: true },
    );
    expect(
      readManifest(pkg).entries.find((entry) => entry.fullPath === "/")
        ?.mediaType,
    ).toBe("application/vnd.sun.xml.impress.template");
  });

  it("declares the OpenOffice.org 1.x namespace URIs and office:class='presentation'", () => {
    const { root } = presentationContentRootOf(
      writeSxiContent(presentationDocumentOf([slideOf([shapeOf()])])),
    );
    if (root === undefined) {
      throw new Error("content.xml has no root element");
    }
    expect(attrValue(root, "xmlns:office")).toBe(
      "http://openoffice.org/2000/office",
    );
    expect(attrValue(root, "xmlns:presentation")).toBe(
      "http://openoffice.org/2000/presentation",
    );
    expect(attrValue(root, "office:class")).toBe("presentation");
  });

  it("puts office:body's content directly inside it, with no office:presentation genre wrapper", () => {
    const { root } = presentationContentRootOf(
      writeSxiContent(presentationDocumentOf([slideOf([shapeOf()])])),
    );
    const body =
      root === undefined
        ? undefined
        : findChildElement(root.children, "office:body");
    if (body === undefined) {
      throw new Error("content.xml has no office:body");
    }
    expect(
      findChildElement(body.children, "office:presentation"),
    ).toBeUndefined();
    expect(findChildElement(body.children, "draw:page")).toBeDefined();
  });

  it("writes a shape as a bare draw:text-box, not ODF's draw:frame-wrapped one", () => {
    const pkg = writeSxiContent(presentationDocumentOf([slideOf([shapeOf()])]));
    const { root } = presentationContentRootOf(pkg);
    const body =
      root === undefined
        ? undefined
        : findChildElement(root.children, "office:body");
    const page =
      body === undefined
        ? undefined
        : findChildElement(body.children, "draw:page");
    if (page === undefined) {
      throw new Error("content.xml has no draw:page");
    }
    expect(findChildElement(page.children, "draw:frame")).toBeUndefined();
    expect(findChildElement(page.children, "draw:text-box")).toBeDefined();
  });

  it("gives each slide's speaker notes as presentation:notes with no xmlns undeclared-prefix defect", () => {
    const pkg = writeSxiContent(
      presentationDocumentOf([slideOf([shapeOf()], "Notes text")]),
    );
    const { root } = presentationContentRootOf(pkg);
    const body =
      root === undefined
        ? undefined
        : findChildElement(root.children, "office:body");
    const page =
      body === undefined
        ? undefined
        : findChildElement(body.children, "draw:page");
    const notes =
      page === undefined
        ? undefined
        : findChildElement(page.children, "presentation:notes");
    expect(notes).toBeDefined();
  });
});
