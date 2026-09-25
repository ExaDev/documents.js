import { describe, expect, it } from "vitest";
import type {
  ContentDocument,
  ContentDrawPage,
  ContentShape,
  ContentVector,
} from "document-schema.js";
import { rgbHexToColor } from "document-schema.js";
import type { Package } from "../../model/package";
import { decodePackage, encodePackage } from "../../codec";
import { readOdgContent } from "./read";
import { normaliseOdgContent, writeOdgContent } from "./write";

// The write side's correctness suite: what writeOdgContent produces reads back as the document it was given. The sibling suite (write.test.ts) pins the XML shapes; this one states the law and every deviation from it by name — the drawing mirror of typed/odp/write-round-trip.test.ts.
//
// THE LAW: normaliseOdgContent(readOdgContent(writeOdgContent(document))) equals normaliseOdgContent(document), for every document the writer accepts. The normalisation is applied to BOTH sides, so it is a genuine equivalence rather than a licence to discard whatever the writer happened to lose.
//
// THE ONE DELIBERATE EXCEPTION, identical to odp's: a ROTATED vector's or shape's own frame/rotationDeg is compared with an explicit numeric tolerance rather than the blanket structural-equality helper, because two independent trig evaluations on either side of a real write-then-read round trip are not guaranteed bit-identical (typed/draw/write-shapes.ts's frameGeometryAttrs is an exact algebraic inverse of the reader's resolveOdfShapeGeometry, not an approximation).

type DrawingDocument = Extract<ContentDocument, { kind: "drawing" }>;

const BLUE = rgbHexToColor("#0033ff");

const PAGE_SIZE_LANDSCAPE = { widthPt: 720, heightPt: 540 };

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

describe("writeOdg: fidelity constructs in shape text (#969)", () => {
  it("round-trips a field extent inside a shape's own text", () => {
    const document = documentOf([
      page(
        [],
        [
          shape({}, [
            {
              kind: "paragraph",
              runs: [{ text: "Author: " }, { text: "Joe" }, { text: "." }],
              constructs: [
                {
                  descriptor: {
                    kind: "field",
                    instruction: '<text:author-name text:fixed="false"/>',
                    cachedResult: "Joe",
                  },
                  startRun: 1,
                  endRun: 2,
                },
              ],
            },
          ]),
        ],
      ),
    ]);
    expectRoundTrip(document);
  });
});

describe("writeOdgContent: rotated vector geometry, within floating-point tolerance", () => {
  const rotationPrecisionDigits = 9;
  const framePrecisionDigits = 6;
  const acuteRotationDeg = 30;
  const rightAngleRotationDeg = 90;
  const halfTurnRotationDeg = 180;
  const negativeRotationDeg = -45;
  const fractionalRotationDeg = 12.5;

  it.each([
    acuteRotationDeg,
    rightAngleRotationDeg,
    halfTurnRotationDeg,
    negativeRotationDeg,
    fractionalRotationDeg,
  ])("round-trips a %i-degree rotation on a rect", (rotationDeg) => {
    const frame = { xPt: 50, yPt: 60, widthPt: 200, heightPt: 80 };
    const written = roundTrip(
      documentOf([page([{ kind: "rect", frame, rotationDeg, fill: BLUE }])]),
    );
    const vector = written.pages[0]!.vectors[0]!;
    if (vector.kind !== "rect") {
      throw new Error("expected a rect back");
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

// The regression sweep for the one class of length a plain number-to-string spells in EXPONENT notation, which the ODF `length` datatype has no form for (typed/shared/units.ts's LENGTH_PATTERN and formatOdfLength note). The failure it pins is silent and total rather than approximate: parseOdfTransform drops a translate() whose components don't parse, so a rotated vector lands at its own pivot; parseBox returns undefined for an unrotated one whose svg:x/svg:y don't parse, so readDrawRectVector returns undefined and the vector VANISHES from the page entirely. The same sweep the odp writer's own suite runs, over vectors rather than frames — the values that reach that magnitude are ordinary, since frameGeometryAttrs's translate() components are trig-derived and a frame centred at or near the page origin cancels to 1e-15-ish rounding dust at most angles.
describe("writeOdgContent: rotated vector geometry near the page origin", () => {
  // Each value is a fraction of a full turn (or its negative), except EXPONENT_NOTATION_EPSILON_DEG: the one value small enough that JS's own number-to-string spells it in exponent notation, which is the specific case the file-level comment above explains this sweep exists to pin.
  const NEGATIVE_THREE_QUARTER_TURN_DEG = -270;
  const NEGATIVE_HALF_TURN_DEG = -180;
  const NEGATIVE_THREE_EIGHTHS_TURN_DEG = -135;
  const NEGATIVE_QUARTER_TURN_DEG = -90;
  const NEGATIVE_EIGHTH_TURN_DEG = -45;
  const NEGATIVE_TWELFTH_TURN_DEG = -30;
  const TINY_NEGATIVE_DEG = -1;
  const EXPONENT_NOTATION_EPSILON_DEG = 0.0001;
  const TINY_POSITIVE_DEG = 1;
  const TWELFTH_TURN_DEG = 30;
  const EIGHTH_TURN_DEG = 45;
  const QUARTER_TURN_DEG = 90;
  const THREE_EIGHTHS_TURN_DEG = 135;
  const HALF_TURN_DEG = 180;
  const THREE_QUARTER_TURN_DEG = 270;
  const ANGLES_DEG = [
    NEGATIVE_THREE_QUARTER_TURN_DEG,
    NEGATIVE_HALF_TURN_DEG,
    NEGATIVE_THREE_EIGHTHS_TURN_DEG,
    NEGATIVE_QUARTER_TURN_DEG,
    NEGATIVE_EIGHTH_TURN_DEG,
    NEGATIVE_TWELFTH_TURN_DEG,
    TINY_NEGATIVE_DEG,
    EXPONENT_NOTATION_EPSILON_DEG,
    TINY_POSITIVE_DEG,
    TWELFTH_TURN_DEG,
    EIGHTH_TURN_DEG,
    QUARTER_TURN_DEG,
    THREE_EIGHTHS_TURN_DEG,
    HALF_TURN_DEG,
    THREE_QUARTER_TURN_DEG,
  ];
  const FRAMES = [
    { xPt: 0, yPt: 0, widthPt: 100, heightPt: 100 }, // centre at (50,50) — the classic cancelling case at 90/180/270.
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
      const framePrecisionDigits = 6;
      const rotationPrecisionDigits = 9;
      // The whole-vector loss first: an unparseable svg:x/svg:y or transform drops the element from the read entirely, so a length mismatch IS the bug, not a symptom of one.
      expect(vectors).toHaveLength(FRAMES.length);
      FRAMES.forEach((frame, index) => {
        const vector = vectors[index]!;
        if (vector.kind !== "rect") {
          throw new Error("expected a rect back");
        }
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
        expect(vector.rotationDeg ?? 0).toBeCloseTo(
          rotationDeg,
          rotationPrecisionDigits,
        );
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

  // A path's own subpath coordinates go through the same formatOdfNumber spelling as its svg:viewBox, so a curve whose control points reach that magnitude survives too — svg:viewBox has no exponent form at all, and an unparseable one drops the whole element.
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
