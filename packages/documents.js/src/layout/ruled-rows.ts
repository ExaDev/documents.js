// A table ruled between its rows and set apart by whitespace between its columns: a rule drawn across the table under each row, and no vertical rule at all. Many typeset tables are built this way, and their cells wrap freely over several lines. Read line by line, such a table interleaves its columns: a first column's second line ("commercial", under "Shop and") is read beside the third column's second line rather than with the rest of its own cell, and a producer that draws the table one column at a time leaves nothing in content order to say otherwise. The rules are the drawn half of the structure: they say exactly where each row begins and ends. The columns are the other half, and the geometry states them just as plainly: a vertical strip that no text touches in any row holding text in more than one place is a gutter, the same kind of strip reading-order.ts finds between columns of prose. Together they make the grid a fully ruled table's lattice states, so the table is recovered through the same path and every cell's lines are read together.
//
// Three shapes such tables commonly take are part of the structure, not exceptions to it. A heading row often sits above the first rule with no rule of its own over it, so the lines directly above the first rule that keep to the columns and follow at the table's own line spacing are read as a first row. A row can run across the columns (a group heading such as "Part 2 items"); a row whose text sits in one place states nothing about the gutters, and where it crosses one it is read as a cell spanning the columns it covers. And the rule closing the table is often drawn wider than the rules between its rows, so rules belong to one table when their spans overlap almost entirely, not only when their ends coincide.
//
// Drawn rules alone do not make a table. Two columns of running prose between a rule above and a rule below leave a gutter too, so a grid whose every column reads as running prose (reading-order.ts's isRunningProse) is text set in columns, not a table, and is left to the reading order to split. Nor do gutters that the rows disagree about: when one row leaves a gap between two places and another row's text runs across it, the columns would read both places as one cell, so no grid is read.
import type { LayoutItem, LayoutText } from "pdf-codec";
import type { GridLattice, HorizontalRule, TableRegion } from "./lattice";
import {
  EDGE_COVERAGE_RATIO,
  horizontalRules,
  MIN_GRIDLINE_COUNT_PER_AXIS,
  RECT_LINE_THICKNESS_TOLERANCE_PT,
} from "./lattice";
import { isRunningProse, spaceAdvancePt } from "./reading-order";
import type { TextLine } from "./reconstruct-lines";
import {
  clusterIntoLines,
  estimateModalLineSpacing,
  PARAGRAPH_GAP_MULTIPLIER,
} from "./reconstruct-lines";

/**
 * The grid of a table ruled between its rows and set apart by gutters between its columns, when the page holds one.
 * @param items - the page's items; rules are read from its lines, paths and thin rectangles, and text from its text items
 * @returns a lattice whose row boundaries are the rules (and the top of an unruled heading row above them) and whose column boundaries are the table's two ends and the middle of each gutter, a row that crosses a gutter spanning the columns it covers; undefined when no set of rules of one span holds two rows of text, fewer than two rows hold text in more than one place, the rows leave no gutter they all share, a row leaves a gap between two places that another row's text runs across, or every column reads as running prose
 */
export function detectRuledRowLattice(
  items: readonly LayoutItem[],
): GridLattice | undefined {
  const rules = rulesOfOneTable(items);
  if (rules === undefined) {
    return undefined;
  }
  const text = items.filter(
    (item): item is LayoutText =>
      item.kind === "text" &&
      item.text.trim().length > 0 &&
      item.xPt >= rules.leftPt &&
      item.xPt < rules.rightPt,
  );
  // A gutter is drawn from text extents, so every item needs a horizontal advance; a vertically set or rotated item has none to test, and rather than guess one the page keeps the reading it always had.
  if (
    text.some(
      (item) =>
        item.widthPt === undefined ||
        item.writingMode !== undefined ||
        (item.rotationDeg ?? 0) !== 0,
    )
  ) {
    return undefined;
  }
  const ruledRows = rules.positionsDescPt
    .slice(1)
    .map((lowerPt, row) =>
      text.filter(
        (item) => item.yPt > lowerPt && item.yPt < rules.positionsDescPt[row]!,
      ),
    );
  // The word space that separates two places in a row is measured on the rows' own text, never the page's: a large heading elsewhere on the page has a word space wide enough to swallow a table's gutters.
  const widestSpacePt = Math.max(...ruledRows.flat().map(spaceAdvancePt));
  const shared = sharedGutters(ruledRows, widestSpacePt);
  if (shared === undefined) {
    return undefined;
  }
  const { gutters } = shared;
  const dividersPt = gutters.map((gutter) => (gutter.loPt + gutter.hiPt) / 2);
  const topRulePt = rules.positionsDescPt[0]!;
  const heading = headingRow(
    text.filter((item) => item.yPt > topRulePt),
    topRulePt,
    dividersPt,
    clusterIntoLines(ruledRows.flat()),
    widestSpacePt,
  );
  const rows =
    heading === undefined ? ruledRows : [heading.items, ...ruledRows];
  // At least two rows must hold text in more than one place for the gutters to be the table's columns rather than one row's spacing; a heading row whose words keep to the columns is one of them.
  const evidence =
    shared.rowsWithColumns +
    (heading !== undefined && textRuns(heading.items, widestSpacePt).length > 1
      ? 1
      : 0);
  if (evidence < MIN_GRIDLINE_COUNT_PER_AXIS - 1) {
    return undefined;
  }
  const columnBoundariesAscPt = [rules.leftPt, ...dividersPt, rules.rightPt];
  if (holdsDrawing(items, rules, heading?.topPt ?? rules.positionsDescPt[0]!)) {
    return undefined;
  }
  const narrowestGutterPt = Math.min(
    ...gutters.map((gutter) => gutter.hiPt - gutter.loPt),
  );
  const columns = columnBoundariesAscPt
    .slice(1)
    .map((rightPt, column) =>
      rows
        .flat()
        .filter(
          (item) =>
            item.xPt >= columnBoundariesAscPt[column]! && item.xPt < rightPt,
        ),
    );
  if (columns.every((column) => isRunningProse(column, narrowestGutterPt))) {
    return undefined;
  }
  // Each ruled band, the heading's included, split into the rows its lines state, every row with the boundary over it.
  const bands = [
    ...(heading === undefined ? [] : [heading]),
    ...ruledRows.map((rowItems, row) => ({
      items: rowItems,
      topPt: rules.positionsDescPt[row]!,
    })),
  ].flatMap((band) =>
    rowsOfBand(band.items, band.topPt, dividersPt, widestSpacePt),
  );
  return {
    rowBoundariesDescPt: [
      ...bands.map((band) => band.topPt),
      rules.positionsDescPt.at(-1)!,
    ],
    columnBoundariesAscPt,
    regions: bands.flatMap((band, rowIndex) =>
      rowRegions(band.items, rowIndex, dividersPt, widestSpacePt),
    ),
    sourceItems: rules.sourceItems,
  };
}

interface TableRules {
  readonly positionsDescPt: readonly number[];
  readonly leftPt: number;
  readonly rightPt: number;
  readonly sourceItems: ReadonlySet<LayoutItem>;
}

// The largest set of horizontal rules spanning one table, top to bottom, a tie going to the wider span. Two rules span one table when their spans overlap by at least EDGE_COVERAGE_RATIO of the two together: a closing rule drawn a little wider than the rules between the rows still belongs, while a rule across half the page does not. A page's own furniture (a rule under the running head, another over the footer) can share a span too, but holds only one band between its two rules, so it never reaches the two rows a table needs; the text tests in detectRuledRowLattice reject the rest. The table's span is the widest its rules reach, so text set flush with the narrower rules (or a hair outside them, as a producer's rounding leaves it) is inside it.
function rulesOfOneTable(items: readonly LayoutItem[]): TableRules | undefined {
  const groups: HorizontalRule[][] = [];
  for (const rule of horizontalRules(items)) {
    const group = groups.find((members) =>
      members.every((member) => spansOverlap(member, rule)),
    );
    if (group === undefined) {
      groups.push([rule]);
    } else {
      group.push(rule);
    }
  }
  const best = groups
    .filter((members) => members.length >= MIN_GRIDLINE_COUNT_PER_AXIS)
    .map((members) => ({
      members,
      leftPt: Math.min(...members.map((rule) => rule.leftPt)),
      rightPt: Math.max(...members.map((rule) => rule.rightPt)),
    }))
    .sort(
      (a, b) =>
        b.members.length - a.members.length ||
        b.rightPt - b.leftPt - (a.rightPt - a.leftPt),
    )[0];
  if (best === undefined) {
    return undefined;
  }
  return {
    positionsDescPt: best.members
      .map((rule) => rule.position)
      .sort((a, b) => b - a),
    leftPt: best.leftPt,
    rightPt: best.rightPt,
    sourceItems: new Set(best.members.flatMap((rule) => rule.items)),
  };
}

// Whether anything is drawn inside the table's area besides its rules: a stroke that is not horizontal, a box narrower than the table, an ellipse or an image. A table ruled only between its rows draws nothing across its columns, and a band shaded across the whole row (a heading's fill) is all the colour it carries; a diagram whose labels sit between horizontal strokes draws its other lines and shapes among them, and its labels are no table. A stroke or box running along the table's own edge is outside its area, so a frame drawn round the table does not count.
function holdsDrawing(
  items: readonly LayoutItem[],
  rules: TableRules,
  topPt: number,
): boolean {
  const bottomPt = rules.positionsDescPt.at(-1)!;
  const widthPt = rules.rightPt - rules.leftPt;
  const inside = (box: Box): boolean =>
    box.loXPt < rules.rightPt - RECT_LINE_THICKNESS_TOLERANCE_PT &&
    box.hiXPt > rules.leftPt + RECT_LINE_THICKNESS_TOLERANCE_PT &&
    box.loYPt < topPt &&
    box.hiYPt > bottomPt;
  const spansRow = (box: Box): boolean =>
    box.hiXPt - box.loXPt >= EDGE_COVERAGE_RATIO * widthPt;
  const horizontal = (box: Box): boolean =>
    box.hiYPt - box.loYPt <= RECT_LINE_THICKNESS_TOLERANCE_PT &&
    box.hiXPt - box.loXPt > box.hiYPt - box.loYPt;
  return items.some((item) => {
    if (rules.sourceItems.has(item)) {
      return false;
    }
    const box = boxOf(item);
    return (
      box !== undefined &&
      inside(box) &&
      !horizontal(box) &&
      !(item.kind !== "image" && item.kind !== "ellipse" && spansRow(box))
    );
  });
}

interface Box {
  readonly loXPt: number;
  readonly hiXPt: number;
  readonly loYPt: number;
  readonly hiYPt: number;
}

// The page-space extent of a drawn item; undefined for text and for the link annotations, which draw nothing.
function boxOf(item: LayoutItem): Box | undefined {
  switch (item.kind) {
    case "image":
    case "rect":
    case "ellipse":
      return {
        loXPt: item.xPt,
        hiXPt: item.xPt + item.widthPt,
        loYPt: item.yPt,
        hiYPt: item.yPt + item.heightPt,
      };
    case "line":
      return {
        loXPt: Math.min(item.x1Pt, item.x2Pt),
        hiXPt: Math.max(item.x1Pt, item.x2Pt),
        loYPt: Math.min(item.y1Pt, item.y2Pt),
        hiYPt: Math.max(item.y1Pt, item.y2Pt),
      };
    case "path": {
      const xs = item.subpaths.flatMap((subpath) => [
        subpath.startXPt,
        ...subpath.segments.flatMap((segment) =>
          segment.kind === "cubic"
            ? [segment.c1xPt, segment.c2xPt, segment.xPt]
            : [segment.xPt],
        ),
      ]);
      const ys = item.subpaths.flatMap((subpath) => [
        subpath.startYPt,
        ...subpath.segments.flatMap((segment) =>
          segment.kind === "cubic"
            ? [segment.c1yPt, segment.c2yPt, segment.yPt]
            : [segment.yPt],
        ),
      ]);
      return {
        loXPt: Math.min(...xs),
        hiXPt: Math.max(...xs),
        loYPt: Math.min(...ys),
        hiYPt: Math.max(...ys),
      };
    }
    case "text":
    case "link":
    case "internalLink":
      return undefined;
  }
  return undefined;
}

function spansOverlap(a: HorizontalRule, b: HorizontalRule): boolean {
  const overlapPt =
    Math.min(a.rightPt, b.rightPt) - Math.max(a.leftPt, b.leftPt);
  const unionPt = Math.max(a.rightPt, b.rightPt) - Math.min(a.leftPt, b.leftPt);
  return overlapPt >= EDGE_COVERAGE_RATIO * unionPt;
}

interface Strip {
  readonly loPt: number;
  readonly hiPt: number;
}

// The runs of a row's text along the page: its items' extents merged wherever they are no more than the widest word space apart, so a run is one place the row holds text, a cell's words and wrapped lines together.
function textRuns(row: readonly LayoutText[], widestSpacePt: number): Strip[] {
  const runs: { loPt: number; hiPt: number }[] = [];
  for (const item of [...row].sort((a, b) => a.xPt - b.xPt)) {
    const last = runs.at(-1);
    if (last !== undefined && item.xPt - last.hiPt <= widestSpacePt) {
      last.hiPt = Math.max(last.hiPt, rightEdge(item));
    } else {
      runs.push({ loPt: item.xPt, hiPt: rightEdge(item) });
    }
  }
  return runs;
}

// The gutters every row holding text in more than one place leaves between its runs, left to right, found by intersecting each such row's gaps; a strip survives only while it stays wider than the widest word space. A row with its text in one place says nothing about where the columns are, so it does not narrow the gutters. Reports how many rows did, for the caller to weigh as evidence. There are no gutters when a gap one such row leaves holds none of them: another such row runs across that strip, so the columns would read the text either side of the gap as one cell, and geometry cannot say whether the row running across it is a heading over two columns (a group heading over its sub-columns, set in the band holding the sub-headings) or the row leaving it splits one cell.
function sharedGutters(
  rows: readonly (readonly LayoutText[])[],
  widestSpacePt: number,
): { readonly gutters: Strip[]; readonly rowsWithColumns: number } | undefined {
  const gapsByRow = rows
    .map((row) => textRuns(row, widestSpacePt))
    .filter((runs) => runs.length > 1)
    .map((runs) =>
      runs.slice(1).map((run, index) => ({
        loPt: runs[index]!.hiPt,
        hiPt: run.loPt,
      })),
    );
  const [first, ...rest] = gapsByRow;
  if (first === undefined) {
    return undefined;
  }
  const gutters = rest.reduce(
    (shared, gaps) =>
      shared.flatMap((gutter) =>
        gaps.flatMap((gap) => {
          const loPt = Math.max(gutter.loPt, gap.loPt);
          const hiPt = Math.min(gutter.hiPt, gap.hiPt);
          return hiPt - loPt > widestSpacePt ? [{ loPt, hiPt }] : [];
        }),
      ),
    first,
  );
  // Every surviving gutter lies inside one gap of every row, so a gap holding none is one the other rows closed.
  const everyGapHoldsAGutter = gapsByRow.every((gaps) =>
    gaps.every((gap) =>
      gutters.some(
        (gutter) => gutter.loPt >= gap.loPt && gutter.hiPt <= gap.hiPt,
      ),
    ),
  );
  return gutters.length > 0 && everyGapHoldsAGutter
    ? { gutters, rowsWithColumns: gapsByRow.length }
    : undefined;
}

// The heading row a table often carries above its first rule with no rule of its own over it: the lines directly above the first rule, nearest first, for as long as each keeps to the columns (no item reaching across the line dividing two of them, since a heading's words may be wider than the column's cells beneath them) and follows the one below it (or the rule) at no more than a paragraph gap of the table's own line spacing. The first line that crosses a gutter (a caption, a line of prose) or stands further off ends it, and lines holding text in only one column are no heading at all. Its top is the highest of its lines' em boxes, above every baseline it holds.
function headingRow(
  above: readonly LayoutText[],
  topRulePt: number,
  dividersPt: readonly number[],
  tableLines: readonly TextLine[],
  widestSpacePt: number,
): { readonly items: LayoutText[]; readonly topPt: number } | undefined {
  const reachPt =
    PARAGRAPH_GAP_MULTIPLIER * estimateModalLineSpacing(tableLines);
  const items: LayoutText[] = [];
  let lowerPt = topRulePt;
  for (const line of [...clusterIntoLines(above)].reverse()) {
    const crosses = line.items.some((item) =>
      dividersPt.some(
        (dividerPt) => item.xPt < dividerPt && rightEdge(item) > dividerPt,
      ),
    );
    if (crosses || line.baselineY - lowerPt > reachPt) {
      break;
    }
    items.push(...line.items);
    lowerPt = line.baselineY;
  }
  // A heading names the columns, so it has text in more than one of them; lines in one column alone directly above the first rule are the table's caption or a note, read before the table as they always were.
  if (columnsHolding(items, dividersPt, widestSpacePt).size < 2) {
    return undefined;
  }
  return {
    items,
    topPt: Math.max(...items.map((item) => item.yPt + item.sizePt)),
  };
}

// The columns some run of these items starts in.
function columnsHolding(
  items: readonly LayoutText[],
  dividersPt: readonly number[],
  widestSpacePt: number,
): ReadonlySet<number> {
  return new Set(
    textRuns(items, widestSpacePt).map(
      (run) => dividersPt.filter((dividerPt) => dividerPt <= run.loPt).length,
    ),
  );
}

// The rows one ruled band holds. A band whose cells wrap is one row: its later lines continue the cells its first line opened, and some of them leave one of those cells' columns empty. A band setting several rows between two rules (a table ruled only under its heading and at its foot) has every line hold text in every column its first line does, so each line is a row of its own. A band mixing the two is read as one row, since geometry cannot say which of its lines open rows.
function rowsOfBand(
  items: readonly LayoutText[],
  topPt: number,
  dividersPt: readonly number[],
  widestSpacePt: number,
): { readonly items: LayoutText[]; readonly topPt: number }[] {
  const lines = clusterIntoLines(items);
  const first = lines[0];
  const opening =
    first === undefined
      ? new Set<number>()
      : columnsHolding(first.items, dividersPt, widestSpacePt);
  const lineByLine =
    lines.length > 1 &&
    opening.size > 1 &&
    lines.every((line) => {
      const occupied = columnsHolding(line.items, dividersPt, widestSpacePt);
      return [...opening].every((column) => occupied.has(column));
    });
  if (!lineByLine) {
    return [{ items: [...items], topPt }];
  }
  // Each later row's boundary is halfway between its baseline and the one above: below anything the line above sets on or under its baseline, and above anything this line raises, a superscript included, since neither moves further than half an em.
  return lines.map((line, index) => ({
    items: [...line.items],
    topPt:
      index === 0 ? topPt : (lines[index - 1]!.baselineY + line.baselineY) / 2,
  }));
}

// One row's cells: every column its own cell, except that a run of the row's text reaching across the line dividing two columns makes one cell of every column it covers.
function rowRegions(
  row: readonly LayoutText[],
  rowIndex: number,
  dividersPt: readonly number[],
  widestSpacePt: number,
): TableRegion[] {
  const runs = textRuns(row, widestSpacePt);
  const regions: TableRegion[] = [];
  let colStart = 0;
  dividersPt.forEach((dividerPt, index) => {
    const joins = runs.some(
      (run) => run.loPt < dividerPt && run.hiPt > dividerPt,
    );
    if (!joins) {
      regions.push({
        rowStart: rowIndex,
        rowEnd: rowIndex + 1,
        colStart,
        colEnd: index + 1,
      });
      colStart = index + 1;
    }
  });
  regions.push({
    rowStart: rowIndex,
    rowEnd: rowIndex + 1,
    colStart,
    colEnd: dividersPt.length + 1,
  });
  return regions;
}

function rightEdge(item: LayoutText): number {
  return item.xPt + (item.widthPt ?? 0);
}
