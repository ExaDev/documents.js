// Line numbers a page sets down its margin in white: a column of numbers painted in the page's own colour beside each line, which a reader of the printed or rendered page never sees and a reader of the file's text reads as digits among the words (ENA's engineering recommendations set one down the left margin, and the text read `to  180  10`). They are not the document's content, so reconstruction drops them as it drops content in a layer the default view hides.
//
// A column is recognised by what no other white text of a page has. It is at least MIN_LINE_NUMBERS_IN_A_COLUMN whole numbers in white, none over a coloured shape or an image (white on a coloured side tab is visible, and a catalogue's section numbers are set that way), each on a line of the page's upright text and wholly left of it, and rising down the page. Text set turned (a licence stamp up the margin) is not a line of the page and is not its left edge. Only the white numbers of such a column go: a white word anywhere else stays.
import { normalisedRotationDeg, runsShareBaseline } from "pdf-codec/text-group";
import type {
  LayoutDocument,
  LayoutItem,
  LayoutPage,
  LayoutText,
} from "pdf-codec";

// The fewest whole numbers a column of line numbers has: two rising numbers beside two lines are as likely a pair of unrelated figures, three rising down a margin are a column.
const MIN_LINE_NUMBERS_IN_A_COLUMN = 3;

// A whole number as a line number is set: digits and nothing else.
const WHOLE_NUMBER = /^\d+$/u;

// The extent of a shape or an image a white text could be seen against.
interface Box {
  readonly fromXPt: number;
  readonly toXPt: number;
  readonly fromYPt: number;
  readonly toYPt: number;
}

function isWhite(color: { r: number; g: number; b: number }): boolean {
  return color.r === 1 && color.g === 1 && color.b === 1;
}

function isUpright(item: LayoutText): boolean {
  return normalisedRotationDeg(item.rotationDeg) === 0;
}

function endOf(item: LayoutText): number {
  return item.xPt + (item.widthPt ?? 0);
}

// The box of `item` when a white text is visible against it: an image, or a rect, ellipse or path filled with a colour other than white. A shape with no fill or a white one shows the white page through it. A path is taken by the box that holds its points, no smaller than the path, and `yPt` may be either edge of a rect, ellipse or image, so its height is taken both ways: a box that is too large keeps text, the error this rule prefers.
function backdropBox(item: LayoutItem): Box | undefined {
  switch (item.kind) {
    case "image":
    case "rect":
    case "ellipse": {
      if (
        item.kind !== "image" &&
        (item.fill === undefined || isWhite(item.fill))
      ) {
        return undefined;
      }
      return {
        fromXPt: item.xPt,
        toXPt: item.xPt + item.widthPt,
        fromYPt: item.yPt - item.heightPt,
        toYPt: item.yPt + item.heightPt,
      };
    }
    case "path": {
      if (item.fill === undefined || isWhite(item.fill)) {
        return undefined;
      }
      const points = item.subpaths.flatMap((subpath) => [
        [subpath.startXPt, subpath.startYPt] as const,
        ...subpath.segments.flatMap((segment) =>
          segment.kind === "line"
            ? [[segment.xPt, segment.yPt] as const]
            : [
                [segment.c1xPt, segment.c1yPt] as const,
                [segment.c2xPt, segment.c2yPt] as const,
                [segment.xPt, segment.yPt] as const,
              ],
        ),
      ]);
      if (points.length === 0) {
        return undefined;
      }
      const xs = points.map(([xPt]) => xPt);
      const ys = points.map(([, yPt]) => yPt);
      return {
        fromXPt: Math.min(...xs),
        toXPt: Math.max(...xs),
        fromYPt: Math.min(...ys),
        toYPt: Math.max(...ys),
      };
    }
    default:
      return undefined;
  }
}

function lies(item: LayoutText, box: Box): boolean {
  return (
    item.xPt <= box.toXPt &&
    endOf(item) >= box.fromXPt &&
    item.yPt <= box.toYPt &&
    item.yPt + item.sizePt >= box.fromYPt
  );
}

// The white whole numbers of `page` that are its hidden line numbers, or none when they are not a column of at least MIN_LINE_NUMBERS_IN_A_COLUMN.
function hiddenLineNumbersOf(page: LayoutPage): LayoutText[] {
  const texts = page.items.filter(
    (item): item is LayoutText => item.kind === "text",
  );
  const backdrops = page.items.flatMap((item) => {
    const box = backdropBox(item);
    return box === undefined ? [] : [box];
  });
  const numbers = texts.filter(
    (item) =>
      isWhite(item.color) &&
      isUpright(item) &&
      WHOLE_NUMBER.test(item.text.trim()) &&
      !backdrops.some((box) => lies(item, box)),
  );
  const others = texts.filter(
    (item) =>
      !numbers.includes(item) && isUpright(item) && item.text.trim() !== "",
  );
  const leftEdge = Math.min(...others.map((item) => item.xPt));
  const column = numbers
    .filter(
      (item) =>
        endOf(item) <= leftEdge &&
        others.some((other) => runsShareBaseline(other, item)),
    )
    .toSorted((a, b) => b.yPt - a.yPt);
  const rising = column.every(
    (item, index) =>
      index === 0 ||
      Number(item.text.trim()) > Number(column[index - 1]?.text.trim()),
  );
  return rising && column.length >= MIN_LINE_NUMBERS_IN_A_COLUMN ? column : [];
}

// A page without its hidden line numbers; the same page object when it has none.
function dropFromPage(page: LayoutPage): LayoutPage {
  const hidden = new Set<LayoutItem>(hiddenLineNumbersOf(page));
  return hidden.size === 0
    ? page
    : { ...page, items: page.items.filter((item) => !hidden.has(item)) };
}

/**
 * `doc` without the line numbers a page sets down its margin in white, which the rendered page does not show.
 *
 * A column of at least three whole numbers rising down the page, painted white, none over a coloured shape or an image, each on a line of the page's upright text and wholly left of that text, is removed from its page; text set turned is not the page's left edge. A white word or number anywhere else stays. A page without such a column is returned as the same object, and so is a document without one.
 * @param doc - a parsed PDF layout
 * @returns the layout without those numbers
 */
export function dropHiddenLineNumbers(doc: LayoutDocument): LayoutDocument {
  const pages = doc.pages.map(dropFromPage);
  return pages.every((page, index) => page === doc.pages[index])
    ? doc
    : { ...doc, pages };
}
