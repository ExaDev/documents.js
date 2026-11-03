// A page's reading frame (ExaDev/documents.js#1715): the quarter turn a reader gives a page before reading it. A landscape table in a portrait document is often typeset on a portrait page with every run turned a quarter turn, rather than on a page carrying a /Rotate entry, and pdf-codec reports each run where it sits in the page's own space with its rotationDeg, which is right. Every reader of a page's geometry here (line and paragraph clustering, the column split, ruled-row and lattice table recovery, vector recovery) reads x as across and y as down the page, so on such a page a printed row of figures is a vertical stack of runs sharing one x and a printed column shares one y: the table comes out transposed, and its rows as lines read in the wrong direction. Turning the page into the frame most of its text is upright in, before any of them reads it, gives every one of them the page a reader sees.
//
// The turn changes how the page's content is grouped and nothing the result states about the page itself: every frame a reconstruction stamps while reading the turned page is mapped back into the page's own space (restoreSourceFrames), so a frame still names the region of the source page its content came from, and a page's size is still the source page's.
import { type Box, LayoutFrameSchema } from "document-schema.js";
import type { LayoutItem, LayoutPage, LayoutPathSegment } from "pdf-codec";
import { normalisedRotationDeg } from "pdf-codec/text-group";

const DEGREES_PER_TURN = 360;
const QUARTER_TURN_DEG = 90;
const HALF_TURN_DEG = 180;
const THREE_QUARTER_TURN_DEG = 270;

/** A turn of one, two or three quarters, in degrees anticlockwise. */
export type QuarterTurn =
  | typeof QUARTER_TURN_DEG
  | typeof HALF_TURN_DEG
  | typeof THREE_QUARTER_TURN_DEG;

const QUARTER_TURNS: readonly QuarterTurn[] = [
  QUARTER_TURN_DEG,
  HALF_TURN_DEG,
  THREE_QUARTER_TURN_DEG,
];

// The turn that undoes each quarter turn: the rest of a whole turn.
const REVERSE_TURN: Readonly<Record<QuarterTurn, QuarterTurn>> = {
  [QUARTER_TURN_DEG]: THREE_QUARTER_TURN_DEG,
  [HALF_TURN_DEG]: HALF_TURN_DEG,
  [THREE_QUARTER_TURN_DEG]: QUARTER_TURN_DEG,
};

/**
 * A page as it reads once turned a quarter turn, and the way back to the page's own space.
 */
export interface PageReadingFrame {
  /** The quarter turn, anticlockwise, most of the page's text is set at; the page is turned the same amount clockwise to read it. */
  readonly turnDeg: QuarterTurn;
  /** The page in its reading frame: every item mapped through the turn, each run's and image's own rotation reduced by it, and the page's width and height swapped for a turn of 90 or 270. Coordinates keep pdf-codec's convention (the visible region's lower-left corner, y increasing upward) in the turned frame. Annotations are carried as they are: no reader of the reading frame uses their geometry. */
  readonly page: LayoutPage;
  /** Maps a box in the reading frame back to the region of the source page it covers. */
  readonly toSource: (box: Box) => Box;
}

interface Point {
  readonly xPt: number;
  readonly yPt: number;
}

// The share of a page's text, in characters, that must be set at one quarter turn before the page is read in that turn's frame: more than half, so the frame is the one most of the page reads in, and a page with no majority keeps its own.
const MIN_TURNED_TEXT_SHARE = 0.5;

// The quarter turn `rotationDeg` is set at, compared exactly once atan2's last-bit noise is removed (normalisedRotationDeg), which is the same comparison line clustering makes when it decides whether two runs share a baseline: a run set at any other angle never joins the turned page's lines, so it is no evidence of their frame.
function quarterTurnOf(
  rotationDeg: number | undefined,
): QuarterTurn | undefined {
  const normalised = normalisedRotationDeg(rotationDeg);
  return QUARTER_TURNS.find((turn) => turn === normalised);
}

// The quarter turn more than MIN_TURNED_TEXT_SHARE of the page's text, counted in non-blank characters, is set at. A vertically set run (writingMode "vertical") counts by the way its glyphs face, since that is the frame its reader holds the page in.
function dominantQuarterTurn(page: LayoutPage): QuarterTurn | undefined {
  const characters = new Map<QuarterTurn, number>();
  let total = 0;
  for (const item of page.items) {
    if (item.kind !== "text") {
      continue;
    }
    const length = item.text.trim().length;
    total += length;
    const turn = quarterTurnOf(item.rotationDeg);
    if (turn !== undefined) {
      characters.set(turn, (characters.get(turn) ?? 0) + length);
    }
  }
  return QUARTER_TURNS.find(
    (turn) => (characters.get(turn) ?? 0) > total * MIN_TURNED_TEXT_SHARE,
  );
}

// Where a point of a `widthPt` by `heightPt` page lands once the page is turned `turn` degrees clockwise, which brings text set `turn` degrees anticlockwise upright.
function turnPoint(
  turn: QuarterTurn,
  widthPt: number,
  heightPt: number,
): (point: Point) => Point {
  if (turn === QUARTER_TURN_DEG) {
    return ({ xPt, yPt }) => ({ xPt: yPt, yPt: widthPt - xPt });
  }
  if (turn === HALF_TURN_DEG) {
    return ({ xPt, yPt }) => ({ xPt: widthPt - xPt, yPt: heightPt - yPt });
  }
  return ({ xPt, yPt }) => ({ xPt: heightPt - yPt, yPt: xPt });
}

// The axis-aligned box `box` becomes once turned: a quarter turn maps an axis-aligned box to another, so its two opposite corners are enough.
function turnBox(box: Box, turn: (point: Point) => Point): Box {
  const a = turn({ xPt: box.xPt, yPt: box.yPt });
  const b = turn({ xPt: box.xPt + box.widthPt, yPt: box.yPt + box.heightPt });
  return {
    xPt: Math.min(a.xPt, b.xPt),
    yPt: Math.min(a.yPt, b.yPt),
    widthPt: Math.abs(b.xPt - a.xPt),
    heightPt: Math.abs(b.yPt - a.yPt),
  };
}

// A rotation of `rotationDeg` as it reads in a frame turned `turn` clockwise, in (-180, 180]; undefined once upright, which is how pdf-codec reports an upright item.
function reducedRotation(
  rotationDeg: number | undefined,
  turn: QuarterTurn,
): number | undefined {
  const reduced = normalisedRotationDeg((rotationDeg ?? 0) - turn);
  if (reduced === 0) {
    return undefined;
  }
  return reduced > HALF_TURN_DEG ? reduced - DEGREES_PER_TURN : reduced;
}

function turnSegment(
  segment: LayoutPathSegment,
  turn: (point: Point) => Point,
): LayoutPathSegment {
  if (segment.kind === "line") {
    return { ...segment, ...turn(segment) };
  }
  const control1 = turn({ xPt: segment.c1xPt, yPt: segment.c1yPt });
  const control2 = turn({ xPt: segment.c2xPt, yPt: segment.c2yPt });
  return {
    ...segment,
    ...turn(segment),
    c1xPt: control1.xPt,
    c1yPt: control1.yPt,
    c2xPt: control2.xPt,
    c2yPt: control2.yPt,
  };
}

// A run and an image are each placed by an anchor and a rotation about it (an image's unit square is scaled, rotated, then translated to its xPt/yPt), so turning one turns its anchor and reduces its rotation, its own width and height unchanged. Boxes and links are axis-aligned regions; lines and paths are points, a path being the one kind the earlier branches leave.
function turnItem(
  item: LayoutItem,
  turn: (point: Point) => Point,
  turnDeg: QuarterTurn,
): LayoutItem {
  if (item.kind === "text" || item.kind === "image") {
    return {
      ...item,
      ...turn(item),
      rotationDeg: reducedRotation(item.rotationDeg, turnDeg),
    };
  }
  if (
    item.kind === "rect" ||
    item.kind === "ellipse" ||
    item.kind === "link" ||
    item.kind === "internalLink"
  ) {
    return { ...item, ...turnBox(item, turn) };
  }
  if (item.kind === "line") {
    const start = turn({ xPt: item.x1Pt, yPt: item.y1Pt });
    const end = turn({ xPt: item.x2Pt, yPt: item.y2Pt });
    return {
      ...item,
      x1Pt: start.xPt,
      y1Pt: start.yPt,
      x2Pt: end.xPt,
      y2Pt: end.yPt,
    };
  }
  return {
    ...item,
    subpaths: item.subpaths.map((subpath) => {
      const start = turn({ xPt: subpath.startXPt, yPt: subpath.startYPt });
      return {
        ...subpath,
        startXPt: start.xPt,
        startYPt: start.yPt,
        segments: subpath.segments.map((segment) => turnSegment(segment, turn)),
      };
    }),
  };
}

/**
 * The frame a page reads in, when most of its text is set a quarter turn from upright.
 *
 * A page is turned when more than half of its text, counted in non-blank characters, is set at one quarter turn (90, 180 or 270 degrees anticlockwise, exactly once atan2's noise is removed). Its few runs at another angle (an upright folio on a sideways page) keep their angle relative to the turned frame, as they are once the page is turned.
 * @param page - a page as pdf-codec reports it
 * @returns the page in its reading frame and the way back, or undefined when the page reads as it stands
 */
export function pageReadingFrame(
  page: LayoutPage,
): PageReadingFrame | undefined {
  const turnDeg = dominantQuarterTurn(page);
  if (turnDeg === undefined) {
    return undefined;
  }
  const turn = turnPoint(turnDeg, page.widthPt, page.heightPt);
  const swapsSides = turnDeg !== HALF_TURN_DEG;
  const widthPt = swapsSides ? page.heightPt : page.widthPt;
  const heightPt = swapsSides ? page.widthPt : page.heightPt;
  const back = turnPoint(REVERSE_TURN[turnDeg], widthPt, heightPt);
  return {
    turnDeg,
    page: {
      ...page,
      widthPt,
      heightPt,
      items: page.items.map((item) => turnItem(item, turn, turnDeg)),
    },
    toSource: (box) => turnBox(box, back),
  };
}

/**
 * Maps, in place, every frame on `pageIndex` held anywhere in `content` through `toSource`: the step that returns what a reconstruction stamped while reading a page in its reading frame to the page's own space.
 *
 * The walk reaches every `frames` array in the content however deeply it is nested (a table's cells, a drawing's vectors), since stampFrame records a node's position on the node itself wherever it sits. Frames on other pages are left as they are.
 * @param content - the blocks, sheet or other content a reconstruction built from the page
 * @param pageIndex - the source index of the page that was read in its reading frame
 * @param toSource - the reading frame's way back to the page's own space
 */
export function restoreSourceFrames(
  content: object,
  pageIndex: number,
  toSource: (box: Box) => Box,
): void {
  const seen = new WeakSet<object>();
  const visit = (node: unknown): void => {
    if (typeof node !== "object" || node === null || seen.has(node)) {
      return;
    }
    seen.add(node);
    if ("frames" in node && Array.isArray(node.frames)) {
      const frames: unknown[] = node.frames;
      frames.forEach((entry, index) => {
        const frame = LayoutFrameSchema.safeParse(entry);
        if (frame.success && frame.data.pageIndex === pageIndex) {
          frames[index] = { pageIndex, ...toSource(frame.data) };
        }
      });
    }
    for (const child of Object.values(node)) {
      visit(child);
    }
  };
  visit(content);
}
