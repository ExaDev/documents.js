// A drawing page keeps its content in TWO independently-ordered arrays -- ContentDrawPage.vectors (rect/ellipse/line/path) and ContentDrawPage.shapes (draw:frame text/image/table content) -- with no structural nesting between them. Their true relative paint order lives in the `paintOrder` field document-schema.js models on both `ContentVector` and `ContentShape`: odf.js's own reader (typed/draw/shapes.ts's walkDrawPageContent/paintOrderKey) stamps every element it walks with one shared, monotonically increasing document index per page, honouring an explicit draw:z-index where a producer wrote one and falling back to document position otherwise. Merging the two arrays back by that field is what lets a genuinely interleaved page -- a label between two rectangles, a rectangle over a picture -- paint in the order its author actually built it.
//
// This module exists in src/model/ rather than beside either caller because BOTH layers need the identical merge and neither may import the other: src/layout/drawing.ts (ContentDrawPage -> LayoutDocument) and src/edit/odg/content.ts (ContentDrawPage -> a fresh odg Package) each walk one page's shapes and vectors in true paint order, and src/layout/* deliberately imports no odf.js/edit code at all.

export interface PaintOrdered {
  readonly paintOrder?: number;
}

export type PaintOrderEntry<V, S> =
  | { readonly kind: "vector"; readonly value: V }
  | { readonly kind: "shape"; readonly value: S };

// Vectors and shapes as ONE list in true paint order, back to front.
//
// The merge only runs when EVERY item on the page carries a paintOrder. A page missing it anywhere -- a ContentDocument built by hand, or one produced before document-schema.js modelled the field -- falls back wholesale to the historical vectors-then-shapes order rather than sorting a partially-stamped page, where an item with no paintOrder has no defensible position to be sorted into and any choice of one would silently reorder content. That legacy order is also exactly what the merge degenerates to on a page whose items were stamped in that order to begin with, and equal paintOrder values keep their relative position either way, since the input is built vectors-first and Array.prototype.sort is stable.
export function mergeByPaintOrder<
  V extends PaintOrdered,
  S extends PaintOrdered,
>(vectors: readonly V[], shapes: readonly S[]): PaintOrderEntry<V, S>[] {
  const entries: PaintOrderEntry<V, S>[] = [
    ...vectors.map((value) => ({ kind: "vector" as const, value })),
    ...shapes.map((value) => ({ kind: "shape" as const, value })),
  ];
  if (entries.some((entry) => entry.value.paintOrder === undefined)) {
    return entries;
  }
  return entries.sort(
    (a, b) => (a.value.paintOrder ?? 0) - (b.value.paintOrder ?? 0),
  );
}
