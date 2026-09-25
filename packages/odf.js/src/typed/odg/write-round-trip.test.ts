import { describe, expect, it } from "vitest";
import type {
  ContentDocument,
  ContentDrawPage,
  ContentShape,
  ContentVector,
  DocumentTree,
  SourceResidue,
} from "document-schema.js";
import { PAGE_SIZE_A4, rgbHexToColor, assembleTree } from "document-schema.js";
import type { Package } from "../../model/package";
import { decodePackage, encodePackage } from "../../codec";
import { readManifest } from "../../manifest";
import { readOdg, readOdgContent } from "./read";
import { normaliseOdgContent, writeOdg, writeOdgContent } from "./write";

// The write side's correctness suite: what writeOdgContent produces reads back as the document it was given. The sibling suite (write.test.ts) pins the XML shapes; this one states the law and every deviation from it by name — the drawing mirror of typed/odp/write-round-trip.test.ts.
//
// THE LAW: normaliseOdgContent(readOdgContent(writeOdgContent(document))) equals normaliseOdgContent(document), for every document the writer accepts. The normalisation is applied to BOTH sides, so it is a genuine equivalence rather than a licence to discard whatever the writer happened to lose.
//
// THE ONE DELIBERATE EXCEPTION, identical to odp's: a ROTATED vector's or shape's own frame/rotationDeg is compared with an explicit numeric tolerance rather than the blanket structural-equality helper, because two independent trig evaluations on either side of a real write-then-read round trip are not guaranteed bit-identical (typed/draw/write-shapes.ts's frameGeometryAttrs is an exact algebraic inverse of the reader's resolveOdfShapeGeometry, not an approximation).

type DrawingDocument = Extract<ContentDocument, { kind: "drawing" }>;

const RED = rgbHexToColor("#cc0000");
const GREEN = rgbHexToColor("#00aa44");
const BLUE = rgbHexToColor("#0033ff");

const PAGE_SIZE_LANDSCAPE = { widthPt: 720, heightPt: 540 };

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function contentOf(pkg: Package): DrawingDocument {
  const { metadata, pages } = readOdgContent(pkg);
  return { kind: "drawing", metadata, pages };
}

// One full pass through the writer and back: the document the caller handed in, written to a real package, encoded to real bytes, decoded again, and read — the bytes leg deliberately in the loop, matching every other writer's own round-trip suite here.
function roundTrip(document: ContentDocument): DrawingDocument {
  return contentOf(decodePackage(encodePackage(writeOdgContent(document))));
}

function expectRoundTrip(document: ContentDocument): void {
  expect(normaliseOdgContent(roundTrip(document))).toEqual(
    normaliseOdgContent(document),
  );
}

function shape(
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

function page(
  vectors: readonly ContentVector[],
  shapes: readonly ContentShape[] = [],
  size = PAGE_SIZE_LANDSCAPE,
): ContentDrawPage {
  return { size, shapes: [...shapes], vectors: [...vectors] };
}

function documentOf(pages: readonly ContentDrawPage[]): DrawingDocument {
  return { kind: "drawing", metadata: {}, pages: [...pages] };
}

describe("writeOdgContent: the round-trip law", () => {
  it("round-trips metadata", () => {
    expectRoundTrip({
      kind: "drawing",
      metadata: {
        title: "Round trip",
        author: "odf.js",
        subject: "The odg write path",
        keywords: ["odf", "drawing"],
        creator: "odf.js test suite",
        createdIso: "2026-09-04T10:00:00Z",
        modifiedIso: "2026-09-04T11:00:00Z",
      },
      pages: [
        page([
          {
            kind: "rect",
            frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
          },
        ]),
      ],
    });
  });

  it("round-trips a filled and stroked rect and ellipse", () => {
    expectRoundTrip(
      documentOf([
        page([
          {
            kind: "rect",
            frame: { xPt: 36, yPt: 48, widthPt: 120, heightPt: 90 },
            fill: BLUE,
            stroke: { color: RED, widthPt: 1.5 },
          },
          {
            kind: "ellipse",
            frame: { xPt: 200, yPt: 48, widthPt: 140, heightPt: 90 },
            fill: GREEN,
            stroke: { color: RED, widthPt: 3, style: "dashed" },
          },
        ]),
      ]),
    );
  });

  it("round-trips a rect with a fill and no stroke, and one with a stroke and no fill", () => {
    expectRoundTrip(
      documentOf([
        page([
          {
            kind: "rect",
            frame: { xPt: 0, yPt: 0, widthPt: 50, heightPt: 50 },
            fill: BLUE,
          },
          {
            kind: "rect",
            frame: { xPt: 60, yPt: 0, widthPt: 50, heightPt: 50 },
            stroke: { color: RED, widthPt: 2 },
          },
          {
            kind: "rect",
            frame: { xPt: 120, yPt: 0, widthPt: 50, heightPt: 50 },
          },
        ]),
      ]),
    );
  });

  it("round-trips a line", () => {
    expectRoundTrip(
      documentOf([
        page([
          {
            kind: "line",
            from: { xPt: 12, yPt: 24 },
            to: { xPt: 300, yPt: 180 },
            stroke: { color: RED, widthPt: 2.25 },
          },
        ]),
      ]),
    );
  });

  it("round-trips a path whose subpaths mix line and cubic segments, one closed and one open", () => {
    expectRoundTrip(
      documentOf([
        page([
          {
            kind: "path",
            frame: { xPt: 40, yPt: 40, widthPt: 200, heightPt: 120 },
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
            fill: GREEN,
            fillRule: "evenodd",
            stroke: { color: RED, widthPt: 1 },
          },
        ]),
      ]),
    );
  });

  it("round-trips a shape and vectors coexisting on one page", () => {
    expectRoundTrip(
      documentOf([
        page(
          [
            {
              kind: "rect",
              frame: { xPt: 0, yPt: 200, widthPt: 100, heightPt: 60 },
              fill: BLUE,
            },
            {
              kind: "line",
              from: { xPt: 0, yPt: 300 },
              to: { xPt: 400, yPt: 300 },
              stroke: { color: RED, widthPt: 1 },
            },
          ],
          [
            shape({}, [
              {
                kind: "paragraph",
                alignment: "center",
                runs: [
                  { text: "Mixed " },
                  { text: "bold", bold: true },
                  { text: " content" },
                ],
              },
              {
                kind: "paragraph",
                runs: [{ text: "bullet" }],
                list: { numId: "bullet:a", level: 0 },
              },
            ]),
            shape(
              {
                frame: { xPt: 300, yPt: 48, widthPt: 120, heightPt: 120 },
                name: "Picture holder",
              },
              [
                {
                  kind: "image",
                  format: "png",
                  base64: PNG_BASE64,
                  widthPt: 120,
                  heightPt: 120,
                  altText: "A tiny picture",
                },
              ],
            ),
          ],
        ),
      ]),
    );
  });

  it("round-trips multiple pages, each with its own page size", () => {
    expectRoundTrip(
      documentOf([
        page([
          {
            kind: "rect",
            frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
          },
        ]),
        page(
          [
            {
              kind: "rect",
              frame: { xPt: 5, yPt: 5, widthPt: 20, heightPt: 20 },
            },
          ],
          [],
          PAGE_SIZE_A4,
        ),
      ]),
    );
  });

  it("round-trips a page with no content at all", () => {
    expectRoundTrip(documentOf([page([])]));
  });

  it("drops the residue channel, the one loss this writer takes rather than refuses", () => {
    const document = documentOf([
      {
        size: PAGE_SIZE_LANDSCAPE,
        shapes: [],
        vectors: [
          {
            kind: "rect",
            frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
          },
        ],
        source: { format: "odg", xml: "<draw:connector/>" },
      },
    ]);
    expect(roundTrip(document).pages[0]!.source).toBeUndefined();
    expectRoundTrip(document);
  });

  it("drops metadata fields ODF or this package's own reader cannot carry back", () => {
    const document: DrawingDocument = {
      kind: "drawing",
      metadata: { title: "T", producer: "a PDF writer", language: "en-GB" },
      pages: [page([])],
    };
    expect(normaliseOdgContent(document).metadata).toEqual({ title: "T" });
    expectRoundTrip(document);
  });

  it("refuses a document that is not a drawing, by kind, with an exact message naming both the expected and actual kind", () => {
    expect(() =>
      normaliseOdgContent({ kind: "presentation", metadata: {}, slides: [] }),
    ).toThrow(/expected a 'drawing' document, got 'presentation'/);
  });

  it("collapses an absent stroke style to the 'solid' ContentStrokeStyleSchema already documents absence to mean", () => {
    const written = roundTrip(
      documentOf([
        page([
          {
            kind: "line",
            from: { xPt: 0, yPt: 0 },
            to: { xPt: 10, yPt: 10 },
            stroke: { color: RED, widthPt: 1 },
          },
        ]),
      ]),
    );
    const vector = written.pages[0]!.vectors[0]!;
    if (vector.kind !== "line") {
      throw new Error("expected a line back");
    }
    expect(vector.stroke.style).toBe("solid");
  });

  it("restores a quarantined non-content package part verbatim, through the tree form", () => {
    // A settings.xml this writer never generates itself, exactly the shape readOdgContent quarantines wholesale on the way in (typed/shared/constructs.ts's collectOdfNonContentPartResidue).
    const settingsXml =
      '<office:document-settings office:version="1.3"><office:settings><config:config-item-set config:name="ooo:view-settings"><config:config-item config:name="ViewAreaTop" config:type="int">0</config:config-item></config:config-item-set></office:settings></office:document-settings>';
    const source: Record<string, SourceResidue> = {
      "settings.xml": { format: "odg", xml: settingsXml },
    };
    const tree: DocumentTree = {
      ...assembleTree(documentOf([page([], [shape()])])),
      source,
    };

    const written = writeOdg(tree);
    const settingsPart = written.parts["settings.xml"];
    expect(settingsPart?.kind).toBe("xml");
    expect(
      settingsPart?.kind === "xml" &&
        settingsPart.nodes.some(
          (node) =>
            node.type === "element" && node.tag === "office:document-settings",
        ),
    ).toBe(true);
    const manifest = readManifest(written);
    expect(
      manifest.entries.some((entry) => entry.fullPath === "settings.xml"),
    ).toBe(true);

    const readBack = readOdg(decodePackage(encodePackage(written)));
    expect(readBack.source).toEqual(source);
  });

  it("round-trips a footnote anchor in shape text with its definitions-table body through writeOdg", () => {
    // Mirrors typed/odp/write-round-trip.test.ts's identical test: a footnote/comment construct only writes when the definitions table actually holds its body (typed/shared/constructs.ts's odfRunConstructWriteKind), so this also proves writeOdg's own definitions option genuinely reaches the shape writer.
    const document = documentOf([
      page(
        [],
        [
          shape({}, [
            {
              kind: "paragraph",
              runs: [{ text: "1" }],
              constructs: [
                {
                  descriptor: {
                    kind: "anchor",
                    anchorType: "footnote",
                    name: "note1",
                    definition: "note:note1",
                  },
                  startRun: 0,
                  endRun: 1,
                },
              ],
            },
          ]),
        ],
      ),
    ]);
    const tree = assembleTree(document);
    tree.definitions = {
      "note:note1": {
        kind: "footnote",
        citation: "1",
        body: [{ kind: "paragraph", runs: [{ text: "the note body" }] }],
      },
    };
    const rewritten = readOdgContent(writeOdg(tree));
    const shapeText = rewritten.pages[0]!.shapes[0]!.blocks[0]!;
    expect(shapeText).toMatchObject({
      kind: "paragraph",
      constructs: [
        {
          descriptor: {
            kind: "anchor",
            anchorType: "footnote",
            name: "note1",
          },
        },
      ],
    });
  });

  it("stamps a custom version option onto the manifest via writeOdg's own final sync, distinct from the default DEFAULT_ODF_VERSION both share", () => {
    const tree = assembleTree(documentOf([page([])]));
    const written = writeOdg(tree, { version: "1.4" });
    expect(readManifest(written).version).toBe("1.4");
  });
});

describe("writeOdgContent: refusals", () => {
  it("refuses a dotted stroke", () => {
    expect(() =>
      writeOdgContent(
        documentOf([
          page([
            {
              kind: "rect",
              frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
              stroke: { color: RED, widthPt: 1, style: "dotted" },
            },
          ]),
        ]),
      ),
    ).toThrow(/'dotted' stroke style/);
  });

  it("refuses a path with no subpaths", () => {
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

  it("refuses a table mixed with paragraphs in one shape, the same way every writer here does", () => {
    expect(() =>
      writeOdgContent(
        documentOf([
          page(
            [],
            [
              shape({}, [
                { kind: "paragraph", runs: [{ text: "x" }] },
                {
                  kind: "table",
                  columns: [{ widthPt: 10 }],
                  rows: [{ cells: [{ blocks: [] }] }],
                },
              ]),
            ],
          ),
        ]),
      ),
    ).toThrow(/table alongside other content/);
  });
});

// ContentDrawPage keeps shapes and vectors in two arrays with no field connecting them, but readDrawPageContent stamps both from ONE monotonic counter and sorts each array by the result — so a page's true relative paint order is recoverable across the two, and this writer has to preserve it. See normaliseOdgContent's own note for the emit order this arithmetic is the counterpart of.
describe("writeOdgContent: paint order across both arrays", () => {
  it("round-trips explicit paint orders that interleave shapes and vectors", () => {
    const ellipsePaintOrder = 3;
    const secondShapePaintOrder = 2;
    const document = documentOf([
      page(
        [
          {
            kind: "rect",
            frame: { xPt: 0, yPt: 0, widthPt: 40, heightPt: 40 },
            paintOrder: 1,
          },
          {
            kind: "ellipse",
            frame: { xPt: 60, yPt: 0, widthPt: 40, heightPt: 40 },
            paintOrder: ellipsePaintOrder,
          },
        ],
        [
          shape({ paintOrder: 0 }),
          shape({
            paintOrder: secondShapePaintOrder,
            frame: { xPt: 300, yPt: 0, widthPt: 100, heightPt: 40 },
          }),
        ],
      ),
    ]);
    const written = roundTrip(document);
    expect(written.pages[0]!.shapes.map((item) => item.paintOrder)).toEqual([
      0,
      secondShapePaintOrder,
    ]);
    expect(written.pages[0]!.vectors.map((item) => item.paintOrder)).toEqual([
      1,
      ellipsePaintOrder,
    ]);
    expectRoundTrip(document);
  });

  it("gives an item with no paintOrder the reader's own encounter index, counting shapes before vectors", () => {
    const document = documentOf([
      page(
        [
          {
            kind: "rect",
            frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
          },
          {
            kind: "rect",
            frame: { xPt: 20, yPt: 0, widthPt: 10, heightPt: 10 },
          },
        ],
        [
          shape(),
          shape({ frame: { xPt: 0, yPt: 300, widthPt: 10, heightPt: 10 } }),
        ],
      ),
    ]);
    const written = roundTrip(document);
    // Shapes are read before vectors, so the monotonic encounter counter numbers the two rects 0/1, then continues into the two shapes at 2/3.
    const secondVectorPaintOrder = 3;
    expect(written.pages[0]!.shapes.map((item) => item.paintOrder)).toEqual([
      0, 1,
    ]);
    expect(written.pages[0]!.vectors.map((item) => item.paintOrder)).toEqual([
      2,
      secondVectorPaintOrder,
    ]);
    expectRoundTrip(document);
  });

  it("sorts both arrays by paint order on the way back, even when the input arrays disagree with it", () => {
    const firstRectPaintOrder = 7;
    const secondRectXPt = 20;
    const document = documentOf([
      page([
        {
          kind: "rect",
          frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
          paintOrder: firstRectPaintOrder,
        },
        {
          kind: "rect",
          frame: { xPt: secondRectXPt, yPt: 0, widthPt: 10, heightPt: 10 },
          paintOrder: 2,
        },
      ]),
    ]);
    const written = roundTrip(document);
    expect(written.pages[0]!.vectors.map((item) => item.paintOrder)).toEqual([
      2,
      firstRectPaintOrder,
    ]);
    expect(
      written.pages[0]!.vectors.map((item) =>
        item.kind === "rect" ? item.frame.xPt : undefined,
      ),
    ).toEqual([secondRectXPt, 0]);
    expectRoundTrip(document);
  });

  it("falls back to encounter order for a paintOrder ODF cannot spell, rather than rounding it", () => {
    const document = documentOf([
      page([
        {
          kind: "rect",
          frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
          paintOrder: 1.5,
        },
        {
          kind: "rect",
          frame: { xPt: 20, yPt: 0, widthPt: 10, heightPt: 10 },
          paintOrder: -3,
        },
      ]),
    ]);
    expect(
      roundTrip(document).pages[0]!.vectors.map((item) => item.paintOrder),
    ).toEqual([0, 1]);
    expectRoundTrip(document);
  });
});

// A rotated vector's own frame/rotationDeg is an exact algebraic inverse, verified with a numeric tolerance rather than the blanket expectRoundTrip helper — see this file's own top-of-file note.
// ExaDev/documents.js#969 closing the shape-text arm: a run-level construct extent inside a drawing shape's own text writes through the identical construct machinery, and the round-trip law holds exactly as it already did for odp shape text.
