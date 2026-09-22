import type { Box, ContentShape } from "document-schema.js";

// Records where each shape falls in the order a person reading the slide would take them, as a
// `readingOrder` rank ON each shape — the shapes array itself is returned untouched, in document order.
//
// p:spTree order is z-order — roughly creation order — and bears no relation to layout: a title box
// drawn last sits last in the file, and a two-column slide interleaves its columns arbitrarily. That is
// fine for a consumer rendering the shapes, since each carries its own frame. It stops being fine for one
// reading a slide as prose, which in spTree order puts a column of bullets ahead of the heading that owns
// them — something the same deck exported to PDF does not do, because a PDF renderer has already
// resolved layout to reading order.
//
// A rank rather than a reordered array, and that is the whole design: `sourcePath` is assigned as
// slides[N].shapes[N] and has to keep naming the position it names, so sorting the array in place would
// either desynchronise every path or redefine sourcePath away from the document order its own comment
// promises. Expressed exactly as `paintOrder` already is — a plain number on the shape, non-integer by
// choice so a value can be inserted between two existing ones later — so a consumer that wants reading
// order sorts by it, and one that does not is unaffected.
//
// Every shape reaching here has a real frame: resolveShapeFrame resolves a placeholder's inherited
// a:xfrm through the layout/master cascade, and a shape whose geometry cannot be resolved at all is
// dropped rather than emitted at a default position. So there is no "geometry missing" case to guard.
export function assignReadingOrder(
  shapes: readonly ContentShape[],
): ContentShape[] {
  const ranked = new Map<ContentShape, number>();
  cut([...shapes]).forEach((shape, rank) => ranked.set(shape, rank));
  return shapes.map((shape) => ({
    ...shape,
    readingOrder: ranked.get(shape) ?? 0,
  }));
}

type Axis = "vertical" | "horizontal";

const start = (frame: Box, axis: Axis): number =>
  axis === "vertical" ? frame.yPt : frame.xPt;

const end = (frame: Box, axis: Axis): number =>
  axis === "vertical" ? frame.yPt + frame.heightPt : frame.xPt + frame.widthPt;

// One step of the cut: take whichever axis offers the widest band of empty space *relative to how far
// the shapes reach along that axis*, split on it, and recurse into each group.
//
// Choosing an axis at all, rather than always cutting rows first, is what keeps a two-column slide
// readable. Where each column is a heading above its own bullet list, the band between the columns is
// the wider one, so cutting columns yields heading-then-its-list twice; cutting rows would yield both
// headings and then both lists, separating every heading from the list it introduces. On a
// title-above-body slide the same comparison comes out the other way round.
//
// Relative rather than absolute, because the two gaps are measured along different axes and a raw
// comparison silently favours the wider one. A 16:9 slide is roughly twice as wide as it is tall, so
// horizontal gaps start out nearly twice as large for the same visual separation, and a four-box grid --
// which a reader takes row by row — cuts into columns instead. Dividing each gap by the extent the
// shapes actually occupy on its own axis removes that bias and settles both layouts correctly.
//
// Ties, including the degenerate case where a set has no extent on an axis, go to rows: the ordinary
// top-to-bottom reading of a slide with no column structure.
// No separate "0 or 1 shapes" early return is needed: with at most one shape, splitOnGap on either axis produces a single group and a zero widestGap, so both ratios below are 0, neither `> 1` group-count check can pass, and the function falls through to the final sort — a no-op on an array that short — returning the input untouched, exactly what an early return would have done.
// No separate "columns.groups.length > 1" guard is needed alongside the ratio comparison below: splitOnGap only ever raises widestGap above 0 by actually pushing a second group (a split happens exactly when a positive gap is found), so a widestGap of 0 always pairs with exactly one group and a ratio of 0 — meaning the ratio comparison can only come out true when columns.groups.length is already at least 2.
function cut(shapes: ContentShape[]): ContentShape[] {
  const rows = splitOnGap(shapes, "vertical");
  const columns = splitOnGap(shapes, "horizontal");
  if (
    ratio(columns.widestGap, extentAlong(shapes, "horizontal")) >
    ratio(rows.widestGap, extentAlong(shapes, "vertical"))
  ) {
    return columns.groups.flatMap(cut);
  }
  if (rows.groups.length > 1) {
    return rows.groups.flatMap(cut);
  }
  // Neither axis can be cut, so the shapes overlap: topmost, then leftmost. Deliberately a total order
  // (the x tiebreak), so a slide of overlapping shapes is at least ordered deterministically rather than
  // left in whatever order the sort happened to leave equal keys in.
  return [...shapes].sort(
    (a, b) => a.frame.yPt - b.frame.yPt || a.frame.xPt - b.frame.xPt,
  );
}

// How far a set of shapes reaches along one axis, from the earliest start to the latest end.
function extentAlong(shapes: readonly ContentShape[], axis: Axis): number {
  const starts = shapes.map((shape) => start(shape.frame, axis));
  const ends = shapes.map((shape) => end(shape.frame, axis));
  return Math.max(...ends) - Math.min(...starts);
}

// A gap as a fraction of the extent it sits in. No "extent === 0" guard is needed: extentAlong being exactly 0 forces every shape passed to it to share the same single point on this axis (see its own derivation above), which in turn forces every gap splitOnGap can find on that axis to be exactly 0 too — so the only way this divides 0 by 0 is a case where the un-guarded result (NaN) and the guarded one (0) are equally unable to win the `>` comparison in cut() that is this function's only caller, since neither a NaN nor a 0 is ever greater than the genuinely positive ratio the opposing axis produces whenever a real cut is actually possible.
function ratio(gap: number, extent: number): number {
  return gap / extent;
}

// Splits shapes wherever a band of space crosses the whole set with nothing in it: "vertical" sweeps down
// the y axis (producing rows, top first), "horizontal" across the x axis (producing columns, left first).
// Reports the widest such band alongside the groups, which is what lets cut choose between the two axes;
// a single group means no band exists and the widest gap is zero.
function splitOnGap(
  shapes: readonly ContentShape[],
  axis: Axis,
): { groups: ContentShape[][]; widestGap: number } {
  const sorted = [...shapes].sort(
    (a, b) => start(a.frame, axis) - start(b.frame, axis),
  );
  const groups: ContentShape[][] = [];
  let current: ContentShape[] = [];
  let reach = Number.NEGATIVE_INFINITY;
  let widestGap = 0;

  for (const shape of sorted) {
    if (current.length > 0 && start(shape.frame, axis) > reach) {
      widestGap = Math.max(widestGap, start(shape.frame, axis) - reach);
      groups.push(current);
      current = [];
    }
    current.push(shape);
    reach = Math.max(reach, end(shape.frame, axis));
  }
  // No "current.length > 0" guard is needed: for any non-empty `shapes`, the loop above always leaves at least the last-processed shape in `current` (it is only ever cleared and immediately refilled with the shape at hand), so the guard is always true there regardless. For an empty `shapes`, the loop never runs and this pushes an empty array as a phantom group instead of leaving `groups` empty — but cut(), this function's only caller, never inspects that phantom group's contents: its ratio comparison and group-count check both come out exactly the same as the empty-groups case (both see a widestGap of 0 and a groups length that is not greater than 1), and its own fallback path re-sorts cut()'s own `shapes` argument, not this function's `groups`, so the empty array vanishes there too.
  groups.push(current);
  return { groups, widestGap };
}
