import type {
  ContentEmbeddedObjectBlock,
  ContentVector,
  PageSize,
} from "document-schema.js";
import { buildDrawingBlock } from "../model/embedded-drawing";

// The one vector fixture all four build-then-read round-trip tests share (src/edit/{docx,pptx,odt,odp}/content.test.ts), so "the vector content survives" means the same thing in every format rather than four subtly different things.
//
// It covers each ContentVector variant once and, between them, every field a variant can carry: a fill-only rect, a stroke-only ellipse, a rotated rect (the one attribute ODF and DrawingML express in genuinely different ways -- draw:transform against a:xfrm/@rot), a line running up and to the LEFT (so a writer that ignores direction produces visibly wrong endpoints rather than accidentally-right ones), and a path holding a real cubic Bezier plus a straight segment and an explicit close.
//
// Every coordinate is page-absolute, matching what src/layout/reconstruct.ts's own vector recovery produces -- these are the coordinates a recovered drawing block actually carries.

const RED = { r: 1, g: 0, b: 0 };
const BLUE = { r: 0, g: 0, b: 1 };
const BLACK = { r: 0, g: 0, b: 0 };

export const VECTOR_FIXTURE: readonly ContentVector[] = [
  {
    kind: "rect",
    frame: { xPt: 10, yPt: 20, widthPt: 40, heightPt: 30 },
    fill: RED,
    paintOrder: 0,
  },
  {
    kind: "ellipse",
    frame: { xPt: 60, yPt: 20, widthPt: 40, heightPt: 30 },
    stroke: { color: BLACK, widthPt: 1.5 },
    paintOrder: 1,
  },
  {
    kind: "line",
    from: { xPt: 200, yPt: 140 },
    to: { xPt: 10, yPt: 100 },
    stroke: { color: BLACK, widthPt: 2 },
    paintOrder: 2,
  },
  {
    kind: "path",
    frame: { xPt: 10, yPt: 160, widthPt: 60, heightPt: 60 },
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
          { kind: "line", to: { xPt: 0, yPt: 60 } },
        ],
      },
    ],
    fill: BLUE,
    stroke: { color: RED, widthPt: 0.75 },
    paintOrder: 3,
  },
  {
    kind: "rect",
    frame: { xPt: 300, yPt: 300, widthPt: 80, heightPt: 40 },
    rotationDeg: 30,
    fill: BLUE,
    paintOrder: 4,
  },
];

// VECTOR_FIXTURE packaged exactly as src/layout/reconstruct.ts's own recovery packages a page's vectors: one embedded-object block carrying a one-page drawing document sized to the source page.
export function vectorDrawingBlock(size: PageSize): ContentEmbeddedObjectBlock {
  return buildDrawingBlock(size, VECTOR_FIXTURE);
}

// Rotation is the one field a round trip cannot reproduce bit-exactly in EVERY format, so the two ODF tests compare geometry with it stripped and check the rotations themselves at a tolerance. ODF stores a rotation as a RADIAN angle inside draw:transform, so a whole number of degrees does not survive (30 comes back as 29.999999999999996); DrawingML's a:xfrm/@rot, an integer count of 60,000ths of a degree, does survive exactly, which is why the docx and pptx tests compare the whole fixture outright instead. Stating that once here beats each test discovering it separately.
export function withoutRotation(
  vectors: readonly ContentVector[],
): ContentVector[] {
  return vectors.map((vector) =>
    vector.kind === "line" ? vector : { ...vector, rotationDeg: undefined },
  );
}

// The rotations withoutRotation drops, positionally. 'line' has no rotationDeg on ContentVectorSchema at all, so it always reports undefined here.
export function rotationsOf(
  vectors: readonly ContentVector[],
): (number | undefined)[] {
  return vectors.map((vector) =>
    vector.kind === "line" ? undefined : vector.rotationDeg,
  );
}
