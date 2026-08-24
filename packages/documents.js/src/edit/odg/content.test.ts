import { describe, expect, it } from "vitest";

import type { ContentDocument } from "document-schema.js";
import type { Package, XmlElement } from "odf.js";
import {
  bytesToBase64,
  childrenWithTag,
  decodePackage,
  elementsWithTag,
  encodePackage,
  findChildElement,
  rootElement,
} from "odf.js";
import { readOdgContent } from "../../odf/odg/read";
import { buildOdgPackage } from "./content";
import { OdgEditor } from "./editor";

// The first draw:page element of a built package's own content.xml, so a test can assert on RAW child document order -- the only thing that expresses paint order in a written .odg, since this writer never emits a draw:z-index (see OdgPage's own note).
function rootDrawPage(pkg: Package): XmlElement {
  const part = pkg.parts["content.xml"];
  if (part?.kind !== "xml") {
    throw new Error("expected an xml content.xml part");
  }
  const root = rootElement(part.nodes);
  const body =
    root === undefined
      ? undefined
      : findChildElement(root.children, "office:body");
  const drawing =
    body === undefined
      ? undefined
      : findChildElement(body.children, "office:drawing");
  const [page] =
    drawing === undefined ? [] : childrenWithTag(drawing, "draw:page");
  if (page === undefined) {
    throw new Error("expected a draw:page element");
  }
  return page;
}

function drawingDoc(
  pages: Extract<ContentDocument, { kind: "drawing" }>["pages"],
): ContentDocument {
  return { kind: "drawing", metadata: {}, pages };
}

const ZERO_INSETS = {
  insetLeftPt: 0,
  insetTopPt: 0,
  insetRightPt: 0,
  insetBottomPt: 0,
};
const RED = { r: 1, g: 0, b: 0 };
const BLACK = { r: 0, g: 0, b: 0 };

describe("buildOdgPackage", () => {
  it("throws for a presentation ContentDocument", () => {
    expect(() =>
      buildOdgPackage({ kind: "presentation", metadata: {}, slides: [] }),
    ).toThrow(/drawing/);
  });

  it("sets the deck-wide page size from the first page", () => {
    const content = drawingDoc([
      { size: { widthPt: 400, heightPt: 300 }, shapes: [], vectors: [] },
    ]);
    const editor = new OdgEditor(buildOdgPackage(content));
    expect(editor.pageSize).toEqual({ widthPt: 400, heightPt: 300 });
  });

  it("builds one page per ContentDrawPage", () => {
    const content = drawingDoc([
      { size: { widthPt: 400, heightPt: 300 }, shapes: [], vectors: [] },
      { size: { widthPt: 400, heightPt: 300 }, shapes: [], vectors: [] },
    ]);
    const editor = new OdgEditor(buildOdgPackage(content));
    expect(editor.pages()).toHaveLength(2);
  });

  // The odp text-box contract, one variant over: draw:text-box's content model is (text:p | text:list)* with no text:h anywhere in it, so a heading's depth can never cross into a drawing as markup -- its text:p instead points text:style-name at the scaffold's own Heading_20_N definition (asserted present in styles.xml here, since odg has no scaffold suite of its own), keeping the heading's visual weight through a reference that resolves, as the round-tripped run properties prove.
  it("points a heading paragraph in a text box at the scaffold's Heading_20_N style, keeping its visual weight without text:h", () => {
    const content = drawingDoc([
      {
        size: { widthPt: 400, heightPt: 300 },
        vectors: [],
        shapes: [
          {
            frame: { xPt: 10, yPt: 10, widthPt: 300, heightPt: 40 },
            ...ZERO_INSETS,
            blocks: [
              {
                kind: "paragraph",
                styleId: "Heading1",
                headingLevel: 1,
                runs: [{ text: "Page heading" }],
              },
            ],
          },
        ],
      },
    ]);
    const pkg = buildOdgPackage(content);
    const contentPart = pkg.parts["content.xml"];
    expect(
      elementsWithTag(
        contentPart?.kind === "xml" ? contentPart.nodes : [],
        "text:h",
      ),
    ).toHaveLength(0);
    const paragraph = elementsWithTag(
      contentPart?.kind === "xml" ? contentPart.nodes : [],
      "text:p",
    )[0];
    expect(paragraph?.attributes).toContainEqual({
      name: "text:style-name",
      value: "Heading_20_1",
    });
    const stylesRoot = rootElement(
      pkg.parts["styles.xml"]?.kind === "xml"
        ? pkg.parts["styles.xml"].nodes
        : [],
    );
    const officeStyles = stylesRoot?.children.find(
      (c) => c.type === "element" && c.tag === "office:styles",
    );
    const heading1 =
      officeStyles?.type === "element"
        ? officeStyles.children.find(
            (c) =>
              c.type === "element" &&
              c.tag === "style:style" &&
              c.attributes.some(
                (a) => a.name === "style:name" && a.value === "Heading_20_1",
              ),
          )
        : undefined;
    expect(heading1).toBeDefined();
    const roundTripped = readOdgContent(pkg);
    if (roundTripped.kind !== "drawing") {
      throw new Error("expected a drawing ContentDocument");
    }
    const block = roundTripped.pages[0]!.shapes[0]!.blocks[0];
    if (block?.kind !== "paragraph") {
      throw new Error("expected a paragraph block");
    }
    // styleId carries the verbatim reference; the resolved run properties are the proof the reference actually resolves to the scaffold's definition (HEADING_STYLES[1]: bold, 28pt) rather than naming a style nothing defines.
    expect(block.styleId).toBe("Heading_20_1");
    expect(block.runs[0]).toMatchObject({
      text: "Page heading",
      bold: true,
      sizePt: 28,
    });
  });

  it("writes rect/ellipse/line/path vectors alongside a shape", () => {
    const content = drawingDoc([
      {
        size: { widthPt: 400, heightPt: 300 },
        vectors: [
          {
            kind: "rect",
            frame: { xPt: 0, yPt: 0, widthPt: 40, heightPt: 30 },
            fill: RED,
          },
          {
            kind: "ellipse",
            frame: { xPt: 50, yPt: 0, widthPt: 40, heightPt: 30 },
            stroke: { color: BLACK, widthPt: 1 },
          },
          {
            kind: "line",
            from: { xPt: 0, yPt: 0 },
            to: { xPt: 10, yPt: 10 },
            stroke: { color: BLACK, widthPt: 2 },
          },
          {
            kind: "path",
            frame: { xPt: 100, yPt: 100, widthPt: 60, heightPt: 60 },
            subpaths: [
              {
                start: { xPt: 0, yPt: 0 },
                closed: true,
                segments: [
                  {
                    kind: "cubic",
                    control1: { xPt: 20, yPt: 0 },
                    control2: { xPt: 40, yPt: 60 },
                    to: { xPt: 60, yPt: 60 },
                  },
                ],
              },
            ],
            fill: RED,
          },
        ],
        shapes: [
          {
            frame: { xPt: 0, yPt: 200, widthPt: 100, heightPt: 30 },
            ...ZERO_INSETS,
            blocks: [{ kind: "paragraph", runs: [{ text: "Label" }] }],
          },
        ],
      },
    ]);
    const pkg = buildOdgPackage(content);
    const editor = new OdgEditor(pkg);
    const [page] = editor.pages();
    expect(page?.shapes().map((s) => s.text)).toEqual(["Label"]);
  });

  it("builds an image-only shape as a picture, not a text box", () => {
    const content = drawingDoc([
      {
        size: { widthPt: 400, heightPt: 300 },
        vectors: [],
        shapes: [
          {
            frame: { xPt: 0, yPt: 0, widthPt: 50, heightPt: 50 },
            ...ZERO_INSETS,
            blocks: [
              {
                kind: "image",
                format: "png",
                base64: bytesToBase64(new Uint8Array([1, 2, 3])),
                widthPt: 50,
                heightPt: 50,
              },
            ],
          },
        ],
      },
    ]);
    const pkg = buildOdgPackage(content);
    const mediaParts = Object.keys(pkg.parts).filter((p) =>
      p.startsWith("Pictures/"),
    );
    expect(mediaParts).toHaveLength(1);
  });

  it("carries a shape rotation through, reusing OdpShape's draw:transform machinery", () => {
    const content = drawingDoc([
      {
        size: { widthPt: 400, heightPt: 300 },
        vectors: [],
        shapes: [
          {
            frame: { xPt: 10, yPt: 10, widthPt: 100, heightPt: 50 },
            rotationDeg: 20,
            ...ZERO_INSETS,
            blocks: [{ kind: "paragraph", runs: [{ text: "Rotated" }] }],
          },
        ],
      },
    ]);
    const editor = new OdgEditor(buildOdgPackage(content));
    const [shape] = editor.pages()[0]!.shapes();
    expect(shape?.rotationDeg).toBeCloseTo(20, 6);
  });

  it("carries a vector rotation through for every variant that models one", () => {
    const content = drawingDoc([
      {
        size: { widthPt: 400, heightPt: 300 },
        shapes: [],
        vectors: [
          {
            kind: "rect",
            frame: { xPt: 10, yPt: 10, widthPt: 100, heightPt: 50 },
            rotationDeg: 20,
            fill: RED,
          },
          {
            kind: "ellipse",
            frame: { xPt: 150, yPt: 10, widthPt: 100, heightPt: 50 },
            rotationDeg: -35,
            fill: RED,
          },
          {
            kind: "path",
            frame: { xPt: 10, yPt: 100, widthPt: 60, heightPt: 60 },
            rotationDeg: 15,
            subpaths: [
              {
                start: { xPt: 0, yPt: 0 },
                closed: true,
                segments: [{ kind: "line", to: { xPt: 60, yPt: 60 } }],
              },
            ],
            fill: RED,
          },
        ],
      },
    ]);
    const built = readOdgContent(
      decodePackage(encodePackage(buildOdgPackage(content))),
    );
    if (built.kind !== "drawing") {
      throw new Error("expected a drawing ContentDocument");
    }
    // Reread through odf.js's own real readOdgContent, not this package's writer echoing its input back.
    const rotations = built.pages[0]!.vectors.map((v) =>
      v.kind === "line" ? undefined : v.rotationDeg,
    );
    expect(rotations[0]).toBeCloseTo(20, 4);
    expect(rotations[1]).toBeCloseTo(-35, 4);
    expect(rotations[2]).toBeCloseTo(15, 4);
  });

  // Appending in merged paintOrder order is the only thing that can preserve an interleaved page: a written .odg carries paint order purely as document order (no draw:z-index is ever emitted), so a shape appended after every vector paints in front of all of them regardless of what its own paintOrder said.
  it("appends shapes and vectors in merged paintOrder order, so an interleaved page keeps its interleaving", () => {
    const content = drawingDoc([
      {
        size: { widthPt: 400, heightPt: 300 },
        vectors: [
          {
            kind: "rect",
            frame: { xPt: 0, yPt: 0, widthPt: 40, heightPt: 30 },
            fill: RED,
            paintOrder: 0,
          },
          {
            kind: "rect",
            frame: { xPt: 50, yPt: 0, widthPt: 40, heightPt: 30 },
            fill: RED,
            paintOrder: 2,
          },
        ],
        shapes: [
          {
            frame: { xPt: 0, yPt: 200, widthPt: 100, heightPt: 30 },
            ...ZERO_INSETS,
            paintOrder: 1,
            blocks: [{ kind: "paragraph", runs: [{ text: "Between" }] }],
          },
        ],
      },
    ]);
    const page = rootDrawPage(buildOdgPackage(content));
    expect(
      page.children.filter((c) => c.type === "element").map((c) => c.tag),
    ).toEqual(["draw:rect", "draw:frame", "draw:rect"]);
  });

  it("falls back to vectors-then-shapes when any item on the page carries no paintOrder", () => {
    const content = drawingDoc([
      {
        size: { widthPt: 400, heightPt: 300 },
        vectors: [
          {
            kind: "rect",
            frame: { xPt: 0, yPt: 0, widthPt: 40, heightPt: 30 },
            fill: RED,
            paintOrder: 5,
          },
        ],
        shapes: [
          {
            frame: { xPt: 0, yPt: 200, widthPt: 100, heightPt: 30 },
            ...ZERO_INSETS,
            blocks: [{ kind: "paragraph", runs: [{ text: "Unstamped" }] }],
          },
        ],
      },
    ]);
    const page = rootDrawPage(buildOdgPackage(content));
    expect(
      page.children.filter((c) => c.type === "element").map((c) => c.tag),
    ).toEqual(["draw:rect", "draw:frame"]);
  });
});
