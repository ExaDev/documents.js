import { describe, expect, it } from "vitest";
import type {
  ContentDocument,
  ContentDrawPage,
  ContentShape,
  ContentVector,
} from "document-schema.js";
import { PAGE_SIZE_A4, rgbHexToColor } from "document-schema.js";
import type { Package } from "../../model/package";
import { decodePackage, encodePackage } from "../../codec";
import { readOdgContent } from "./read";
import { normaliseOdgContent, writeOdgContent } from "./write";

// The write side's correctness suite: what writeOdgContent produces reads back as the document it was given. The sibling suite (write.test.ts) pins the XML shapes; this one states the law and every deviation from it by name -- the drawing mirror of typed/odp/write-round-trip.test.ts.
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

// One full pass through the writer and back: the document the caller handed in, written to a real package, encoded to real bytes, decoded again, and read -- the bytes leg deliberately in the loop, matching every other writer's own round-trip suite here.
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
  vectors: ContentVector[],
  shapes: ContentShape[] = [],
  size = PAGE_SIZE_LANDSCAPE,
): ContentDrawPage {
  return { size, shapes, vectors };
}

function documentOf(pages: ContentDrawPage[]): DrawingDocument {
  return { kind: "drawing", metadata: {}, pages };
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
                  columnWidthsPt: [10],
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

// ContentDrawPage keeps shapes and vectors in two arrays with no field connecting them, but readDrawPageContent stamps both from ONE monotonic counter and sorts each array by the result -- so a page's true relative paint order is recoverable across the two, and this writer has to preserve it. See normaliseOdgContent's own note for the emit order this arithmetic is the counterpart of.
describe("writeOdgContent: paint order across both arrays", () => {
  it("round-trips explicit paint orders that interleave shapes and vectors", () => {
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
            paintOrder: 3,
          },
        ],
        [
          shape({ paintOrder: 0 }),
          shape({
            paintOrder: 2,
            frame: { xPt: 300, yPt: 0, widthPt: 100, heightPt: 40 },
          }),
        ],
      ),
    ]);
    const written = roundTrip(document);
    expect(written.pages[0]!.shapes.map((item) => item.paintOrder)).toEqual([
      0, 2,
    ]);
    expect(written.pages[0]!.vectors.map((item) => item.paintOrder)).toEqual([
      1, 3,
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
    expect(written.pages[0]!.shapes.map((item) => item.paintOrder)).toEqual([
      0, 1,
    ]);
    expect(written.pages[0]!.vectors.map((item) => item.paintOrder)).toEqual([
      2, 3,
    ]);
    expectRoundTrip(document);
  });

  it("sorts both arrays by paint order on the way back, even when the input arrays disagree with it", () => {
    const document = documentOf([
      page([
        {
          kind: "rect",
          frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
          paintOrder: 7,
        },
        {
          kind: "rect",
          frame: { xPt: 20, yPt: 0, widthPt: 10, heightPt: 10 },
          paintOrder: 2,
        },
      ]),
    ]);
    const written = roundTrip(document);
    expect(written.pages[0]!.vectors.map((item) => item.paintOrder)).toEqual([
      2, 7,
    ]);
    expect(
      written.pages[0]!.vectors.map((item) =>
        item.kind === "rect" ? item.frame.xPt : undefined,
      ),
    ).toEqual([20, 0]);
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

// A rotated vector's own frame/rotationDeg is an exact algebraic inverse, verified with a numeric tolerance rather than the blanket expectRoundTrip helper -- see this file's own top-of-file note.
describe("writeOdgContent: rotated vector geometry, within floating-point tolerance", () => {
  it.each([30, 90, 180, -45, 12.5])(
    "round-trips a %i-degree rotation on a rect",
    (rotationDeg) => {
      const frame = { xPt: 50, yPt: 60, widthPt: 200, heightPt: 80 };
      const written = roundTrip(
        documentOf([page([{ kind: "rect", frame, rotationDeg, fill: BLUE }])]),
      );
      const vector = written.pages[0]!.vectors[0]!;
      if (vector.kind !== "rect") {
        throw new Error("expected a rect back");
      }
      expect(vector.rotationDeg).toBeCloseTo(rotationDeg, 9);
      expect(vector.frame.xPt).toBeCloseTo(frame.xPt, 6);
      expect(vector.frame.yPt).toBeCloseTo(frame.yPt, 6);
      expect(vector.frame.widthPt).toBeCloseTo(frame.widthPt, 6);
      expect(vector.frame.heightPt).toBeCloseTo(frame.heightPt, 6);
    },
  );

  it("collapses a literal 0-degree rotation to no rotation at all on the way back", () => {
    const written = roundTrip(
      documentOf([
        page([
          {
            kind: "rect",
            frame: { xPt: 10, yPt: 10, widthPt: 40, heightPt: 20 },
            rotationDeg: 0,
          },
        ]),
      ]),
    );
    expect(
      written.pages[0]!.vectors[0]!.kind === "rect" &&
        written.pages[0]!.vectors[0]!.rotationDeg,
    ).toBeUndefined();
  });
});

// The regression sweep for the one class of length a plain number-to-string spells in EXPONENT notation, which the ODF `length` datatype has no form for (typed/shared/units.ts's LENGTH_PATTERN and formatOdfLength note). The failure it pins is silent and total rather than approximate: parseOdfTransform drops a translate() whose components don't parse, so a rotated vector lands at its own pivot; parseBox returns undefined for an unrotated one whose svg:x/svg:y don't parse, so readDrawRectVector returns undefined and the vector VANISHES from the page entirely. The same sweep the odp writer's own suite runs, over vectors rather than frames -- the values that reach that magnitude are ordinary, since frameGeometryAttrs's translate() components are trig-derived and a frame centred at or near the page origin cancels to 1e-15-ish rounding dust at most angles.
describe("writeOdgContent: rotated vector geometry near the page origin", () => {
  const ANGLES_DEG = [
    -270, -180, -135, -90, -45, -30, -1, 0.0001, 1, 30, 45, 90, 135, 180, 270,
  ];
  const FRAMES = [
    { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 }, // centre at (50,50) -- the classic cancelling case at 90/180/270.
    { xPt: 0, yPt: 0, widthPt: 1, heightPt: 1 },
    { xPt: -50, yPt: -50, widthPt: 100, heightPt: 100 }, // centre exactly ON the origin.
    { xPt: -0.5, yPt: -0.5, widthPt: 1, heightPt: 1 },
    { xPt: 0.0001, yPt: 0.0001, widthPt: 200, heightPt: 80 },
    { xPt: 36, yPt: 48, widthPt: 400, heightPt: 120 }, // an ordinary, far-from-origin frame, as the control.
    { xPt: 720.05, yPt: 405.05, widthPt: 0.1, heightPt: 0.1 },
  ];

  it.each(ANGLES_DEG)(
    "keeps every rect's own geometry through a real write-then-read at %p degrees",
    (rotationDeg) => {
      const written = roundTrip(
        documentOf([
          page(
            FRAMES.map((frame, index) => ({
              kind: "rect" as const,
              frame,
              rotationDeg,
              paintOrder: index,
            })),
          ),
        ]),
      );
      const vectors = written.pages[0]!.vectors;
      // The whole-vector loss first: an unparseable svg:x/svg:y or transform drops the element from the read entirely, so a length mismatch IS the bug, not a symptom of one.
      expect(vectors).toHaveLength(FRAMES.length);
      FRAMES.forEach((frame, index) => {
        const vector = vectors[index]!;
        if (vector.kind !== "rect") {
          throw new Error("expected a rect back");
        }
        expect(vector.frame.xPt).toBeCloseTo(frame.xPt, 6);
        expect(vector.frame.yPt).toBeCloseTo(frame.yPt, 6);
        expect(vector.frame.widthPt).toBeCloseTo(frame.widthPt, 6);
        expect(vector.frame.heightPt).toBeCloseTo(frame.heightPt, 6);
        expect(vector.rotationDeg ?? 0).toBeCloseTo(rotationDeg, 9);
      });
    },
  );

  it("keeps an UNROTATED vector whose own svg:x/svg:y are small enough to reach exponent notation", () => {
    const frame = { xPt: 1e-9, yPt: -7.1e-15, widthPt: 200, heightPt: 80 };
    const written = roundTrip(documentOf([page([{ kind: "rect", frame }])]));
    expect(written.pages[0]!.vectors).toHaveLength(1);
    expect(
      written.pages[0]!.vectors[0]!.kind === "rect" &&
        written.pages[0]!.vectors[0]!.frame,
    ).toEqual(frame);
  });

  // A path's own subpath coordinates go through the same formatOdfNumber spelling as its svg:viewBox, so a curve whose control points reach that magnitude survives too -- svg:viewBox has no exponent form at all, and an unparseable one drops the whole element.
  it("keeps a path whose own coordinates are small enough to reach exponent notation", () => {
    const document = documentOf([
      page([
        {
          kind: "path",
          frame: { xPt: 0, yPt: 0, widthPt: 1e-7, heightPt: 2 },
          subpaths: [
            {
              start: { xPt: 0, yPt: 0 },
              segments: [
                { kind: "line", to: { xPt: 7.105427357601002e-15, yPt: 1 } },
              ],
              closed: false,
            },
          ],
        },
      ]),
    ]);
    expect(roundTrip(document).pages[0]!.vectors).toHaveLength(1);
    expectRoundTrip(document);
  });
});
