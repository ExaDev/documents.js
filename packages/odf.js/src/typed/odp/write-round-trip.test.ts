import { describe, expect, it } from "vitest";
import type {
  ContentDocument,
  ContentShape,
  ContentSlide,
} from "document-schema.js";
import { PAGE_SIZE_A4, SLIDE_SIZE_WIDESCREEN } from "document-schema.js";
import type { Package } from "../../model/package";
import { decodePackage, encodePackage } from "../../codec";
import { readOdpContent } from "./read";
import { normaliseOdpContent, writeOdpContent } from "./write";

// The write side's correctness suite: what writeOdpContent produces reads back as the document it was given. The sibling suite (write.test.ts) pins the XML shapes; this one states the law and every deviation from it by name -- the presentation mirror of typed/odt/write-round-trip.test.ts (that file's own top-of-file note states the law in full).
//
// THE LAW: normaliseOdpContent(readOdpContent(writeOdpContent(document))) equals normaliseOdpContent(document), for every document the writer accepts. The normalisation is applied to BOTH sides, so it is a genuine equivalence rather than a licence to discard whatever the writer happened to lose.
//
// THE ONE DELIBERATE EXCEPTION: a ROTATED shape's own frame/rotationDeg is compared with an explicit numeric tolerance, not the blanket structural-equality helper every other case uses -- typed/draw/write-shapes.ts's own frameGeometryAttrs is an exact algebraic inverse of the reader's resolveOdfShapeGeometry, but two independent trig evaluations on either side of a real write-then-read round trip are not guaranteed bit-identical (see that module's own top-of-file note and typed/odp/write.ts's own canonicalShape note).

type PresentationDocument = Extract<ContentDocument, { kind: "presentation" }>;

// A 1x1 PNG, genuinely decodable (sniffImageFormat reads real magic bytes).
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function contentOf(pkg: Package): PresentationDocument {
  const { metadata, slides } = readOdpContent(pkg);
  return { kind: "presentation", metadata, slides };
}

// One full pass through the writer and back: the document the caller handed in, written to a real package, encoded to real bytes, decoded again, and read -- the bytes leg deliberately in the loop, matching typed/odt/write-round-trip.test.ts's own roundTrip.
function roundTrip(document: ContentDocument): PresentationDocument {
  return contentOf(decodePackage(encodePackage(writeOdpContent(document))));
}

function expectRoundTrip(document: ContentDocument): void {
  expect(normaliseOdpContent(roundTrip(document))).toEqual(
    normaliseOdpContent(document),
  );
}

function shape(
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

function slide(shapes: ContentShape[], notes = ""): ContentSlide {
  return { size: SLIDE_SIZE_WIDESCREEN, shapes, notes };
}

function documentOf(slides: ContentSlide[]): PresentationDocument {
  return { kind: "presentation", metadata: {}, slides };
}

describe("writeOdpContent: the round-trip law", () => {
  it("round-trips metadata", () => {
    expectRoundTrip({
      kind: "presentation",
      metadata: {
        title: "Round trip",
        author: "odf.js",
        subject: "The odp write path",
        keywords: ["odf", "presentation"],
        creator: "odf.js test suite",
        createdIso: "2026-09-03T10:00:00Z",
        modifiedIso: "2026-09-03T11:00:00Z",
      },
      slides: [slide([shape()])],
    });
  });

  it("round-trips multiple slides, each with its own page size", () => {
    expectRoundTrip(
      documentOf([
        { size: SLIDE_SIZE_WIDESCREEN, shapes: [shape()], notes: "" },
        { size: PAGE_SIZE_A4, shapes: [shape()], notes: "" },
      ]),
    );
  });

  it("round-trips a shape with formatted runs, whitespace, and a hyperlink", () => {
    expectRoundTrip(
      documentOf([
        slide([
          shape({}, [
            {
              kind: "paragraph",
              alignment: "center",
              runs: [
                { text: "Plain, " },
                { text: "bold", bold: true },
                { text: ", " },
                {
                  text: "italic",
                  italic: true,
                  sizePt: 18,
                  fontFamily: "Liberation Sans",
                },
                { text: " and " },
                {
                  text: "a link",
                  underline: true,
                  hyperlink: "https://example.invalid/?a=1&b=2",
                },
                { text: "." },
              ],
            },
            {
              kind: "paragraph",
              runs: [
                { text: "  leading, three   inner, a\ttab and a\nbreak.  " },
              ],
            },
          ]),
        ]),
      ]),
    );
  });

  it("round-trips a bullet list and an ordered list in the same shape as two separate runs", () => {
    expectRoundTrip(
      documentOf([
        slide([
          shape({}, [
            {
              kind: "paragraph",
              runs: [{ text: "bullet one" }],
              list: { numId: "bullet:a", level: 0 },
            },
            {
              kind: "paragraph",
              runs: [{ text: "bullet two, nested" }],
              list: { numId: "bullet:a", level: 1 },
            },
            { kind: "paragraph", runs: [{ text: "not a list item" }] },
            {
              kind: "paragraph",
              runs: [{ text: "ordered one" }],
              list: { numId: "ordered:b", level: 0 },
            },
          ]),
        ]),
      ]),
    );
  });

  it("round-trips list membership across two different shapes without merging their runs, even with the same raw numId", () => {
    expectRoundTrip(
      documentOf([
        slide([
          shape({ frame: { xPt: 0, yPt: 0, widthPt: 200, heightPt: 100 } }, [
            {
              kind: "paragraph",
              runs: [{ text: "shape one" }],
              list: { numId: "bullet:shared", level: 0 },
            },
          ]),
          shape({ frame: { xPt: 220, yPt: 0, widthPt: 200, heightPt: 100 } }, [
            {
              kind: "paragraph",
              runs: [{ text: "shape two" }],
              list: { numId: "bullet:shared", level: 0 },
            },
          ]),
        ]),
      ]),
    );
  });

  it("round-trips a shape carrying a table as its sole content", () => {
    expectRoundTrip(
      documentOf([
        slide([
          shape({}, [
            {
              kind: "table",
              columnWidthsPt: [120, 120],
              rows: [
                {
                  cells: [
                    {
                      blocks: [{ kind: "paragraph", runs: [{ text: "A1" }] }],
                    },
                    {
                      blocks: [
                        {
                          kind: "paragraph",
                          runs: [{ text: "B1", bold: true }],
                        },
                      ],
                      background: { r: 0.9, g: 0.9, b: 0.9 },
                    },
                  ],
                },
                {
                  cells: [
                    {
                      blocks: [{ kind: "paragraph", runs: [{ text: "A2" }] }],
                      colSpan: 2,
                    },
                    { blocks: [] },
                  ],
                },
              ],
            },
          ]),
        ]),
      ]),
    );
  });

  it("round-trips a shape carrying an image as its sole content", () => {
    expectRoundTrip(
      documentOf([
        slide([
          shape({}, [
            {
              kind: "image",
              format: "png",
              base64: PNG_BASE64,
              widthPt: 200,
              heightPt: 100,
              altText: "A tiny picture",
            },
          ]),
        ]),
      ]),
    );
  });

  it("round-trips multiple shapes on one slide, insets included", () => {
    expectRoundTrip(
      documentOf([
        slide([
          shape({
            frame: { xPt: 0, yPt: 0, widthPt: 200, heightPt: 100 },
            insetLeftPt: 4,
            insetTopPt: 4,
            insetRightPt: 4,
            insetBottomPt: 4,
          }),
          shape({
            frame: { xPt: 220, yPt: 0, widthPt: 200, heightPt: 100 },
            name: "Second shape",
          }),
        ]),
      ]),
    );
  });

  it("round-trips speaker notes spanning multiple lines, including a blank line", () => {
    expectRoundTrip(
      documentOf([
        slide([shape()], "First line\n\nThird line, after a blank one"),
      ]),
    );
  });

  it("round-trips an empty shape (no blocks at all)", () => {
    expectRoundTrip(documentOf([slide([shape({}, [])])]));
  });

  it("drops the residue channel, the one loss this writer takes rather than refuses", () => {
    const document = documentOf([
      {
        size: SLIDE_SIZE_WIDESCREEN,
        shapes: [shape()],
        notes: "",
        source: { format: "odp", xml: "<presentation:sound/>" },
      },
    ]);
    const written = roundTrip(document);
    expect(written.slides[0]!.source).toBeUndefined();
    expectRoundTrip(document);
  });

  it("drops metadata fields ODF or this package's own reader cannot carry back", () => {
    const document: PresentationDocument = {
      kind: "presentation",
      metadata: { title: "T", producer: "a PDF writer", language: "en-GB" },
      slides: [slide([shape()])],
    };
    expect(normaliseOdpContent(document).metadata).toEqual({ title: "T" });
    expectRoundTrip(document);
  });
});

describe("writeOdpContent: refusals", () => {
  it("refuses a page break inside a shape's own text", () => {
    expect(() =>
      writeOdpContent(
        documentOf([slide([shape({}, [{ kind: "pageBreak" }])])]),
      ),
    ).toThrow(/page break/);
  });

  it("refuses a table mixed with paragraphs in one shape", () => {
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

  it("refuses a heading inside a shape's own text", () => {
    expect(() =>
      writeOdpContent(
        documentOf([
          slide([
            shape({}, [
              { kind: "paragraph", headingLevel: 2, runs: [{ text: "x" }] },
            ]),
          ]),
        ]),
      ),
    ).toThrow(/heading/);
  });
});

// A rotated shape's own frame/rotationDeg is an exact algebraic inverse (typed/draw/write-shapes.ts's own frameGeometryAttrs), verified with a numeric tolerance rather than the blanket expectRoundTrip helper above -- see this file's own top-of-file note.
describe("writeOdpContent: rotated shape geometry, within floating-point tolerance", () => {
  it.each([30, 90, 180, -45, 12.5])(
    "round-trips a %i-degree rotation",
    (rotationDeg) => {
      const document = documentOf([
        slide([
          shape({
            rotationDeg,
            frame: { xPt: 50, yPt: 60, widthPt: 200, heightPt: 80 },
          }),
        ]),
      ]);
      const written = roundTrip(document);
      const writtenShape = written.slides[0]!.shapes[0]!;
      expect(writtenShape.rotationDeg).toBeCloseTo(rotationDeg, 9);
      expect(writtenShape.frame.xPt).toBeCloseTo(50, 6);
      expect(writtenShape.frame.yPt).toBeCloseTo(60, 6);
      expect(writtenShape.frame.widthPt).toBeCloseTo(200, 6);
      expect(writtenShape.frame.heightPt).toBeCloseTo(80, 6);
    },
  );

  it("collapses a literal 0-degree rotation to no rotation at all on the way back", () => {
    const document = documentOf([slide([shape({ rotationDeg: 0 })])]);
    const written = roundTrip(document);
    expect(written.slides[0]!.shapes[0]!.rotationDeg).toBeUndefined();
  });
});

// The regression suite for the one class of length a plain number-to-string spells in EXPONENT notation, which the ODF `length` datatype has no form for (typed/shared/units.ts's own LENGTH_PATTERN and formatOdfLength note). The failure it pins is silent and total rather than approximate, which is why it needs a sweep rather than a single case: parseOdfTransform drops a translate() whose components don't parse, so a rotated shape lands at its own pivot instead of its frame; parseBox returns undefined for an unrotated frame whose svg:x/svg:y don't parse, so readDrawFrame returns undefined and the shape VANISHES from the slide entirely.
//
// The values that reach that magnitude are ordinary, not contrived: frameGeometryAttrs's translate() components are trig-derived, so a frame whose own centre sits at or near the page origin cancels to 1e-15-ish rounding dust rather than a clean zero at most angles. The sweep below crosses every quadrant boundary and both signs of each component, against frames at the origin, straddling it, and well away from it.
describe("writeOdpContent: rotated geometry near the page origin", () => {
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
    "keeps every frame's own shape and geometry through a real write-then-read at %p degrees",
    (rotationDeg) => {
      const document = documentOf([
        slide(FRAMES.map((frame) => shape({ frame, rotationDeg }))),
      ]);
      const written = roundTrip(document);
      const writtenShapes = written.slides[0]!.shapes;
      // The whole-shape loss first: an unparseable svg:x/svg:y or transform drops the frame from the read entirely, so a length count mismatch IS the bug, not a symptom of one.
      expect(writtenShapes).toHaveLength(FRAMES.length);
      FRAMES.forEach((frame, index) => {
        const writtenShape = writtenShapes[index]!;
        expect(writtenShape.frame.xPt).toBeCloseTo(frame.xPt, 6);
        expect(writtenShape.frame.yPt).toBeCloseTo(frame.yPt, 6);
        expect(writtenShape.frame.widthPt).toBeCloseTo(frame.widthPt, 6);
        expect(writtenShape.frame.heightPt).toBeCloseTo(frame.heightPt, 6);
        expect(writtenShape.rotationDeg ?? 0).toBeCloseTo(rotationDeg, 9);
      });
    },
  );

  it("keeps an UNROTATED frame whose own svg:x/svg:y are small enough to reach exponent notation", () => {
    const tiny = { xPt: 1e-9, yPt: -7.1e-15, widthPt: 200, heightPt: 80 };
    const written = roundTrip(documentOf([slide([shape({ frame: tiny })])]));
    const writtenShapes = written.slides[0]!.shapes;
    expect(writtenShapes).toHaveLength(1);
    expect(writtenShapes[0]!.frame).toEqual(tiny);
  });
});
