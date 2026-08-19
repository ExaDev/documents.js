import { readOdgContent, type Box, type ContentVector, type LayoutColor, type OdgVector, type OdpShape } from 'documents.js';
import { currentScreen, type AppState, type OdgOpenDocument, type Screen } from '../../../state/types.js';
import { parseNumberField } from '../../shared/text.js';
import { defaultTriangleSubpaths, parseColorField, parseStrokeField } from '../../shared/vector-fields.js';

// All re-exported here so every existing local import of `parseNumberField`/`requireFieldValue`/`parseColorField`/`parseStrokeField`/`defaultTriangleSubpaths` from './shared.js' keeps working unmodified -- the implementations themselves now live in screens/shared, since paragraph-detail.tsx/paragraph-family.tsx and (for the vector helpers) pptx/odp's own slide-detail.tsx need the identical parse/lookup and none of them is an odg-specific concept.
export { parseNumberField };
export { requireFieldValue } from '../../shared/field-wizard.js';
export { defaultTriangleSubpaths, parseColorField, parseStrokeField };

// Shared between page-list.tsx, page-detail.tsx and shape-or-vector-detail.tsx: the odg-document/screen narrowing every one of them needs, the vector/shape enumeration and live/read-only parity check every one of them relies on, and the small formatting/parsing helpers all three build their rows and forms from.

export function requireOdgDocument(state: AppState): OdgOpenDocument {
  const doc = state.openDocument;
  if (doc?.format !== 'odg') {
    throw new Error(`An odg screen rendered with the open document being ${doc === undefined ? 'no document' : `a '${doc.format}' document`} -- pageList/pageDetail/shapeOrVectorDetail only ever get pushed from odg-routed navigation (rootScreenForFormat maps 'odg' to 'pageList', and every deeper push originates from that screen or its own descendants), so this indicates a routing bug elsewhere, not a state this screen should render around.`);
  }
  return doc;
}

export function requirePageDetailScreen(state: AppState): Extract<Screen, { kind: 'pageDetail' }> {
  const screen = currentScreen(state);
  if (screen.kind !== 'pageDetail') {
    throw new Error(`OdgPageDetailScreen rendered while the top of the stack is '${screen.kind}', not 'pageDetail' -- app.tsx's ScreenBody switch only mounts this component for that screen kind, so this cannot happen without a routing bug.`);
  }
  return screen;
}

export function requireShapeOrVectorDetailScreen(state: AppState): Extract<Screen, { kind: 'shapeOrVectorDetail' }> {
  const screen = currentScreen(state);
  if (screen.kind !== 'shapeOrVectorDetail') {
    throw new Error(`OdgShapeOrVectorDetailScreen rendered while the top of the stack is '${screen.kind}', not 'shapeOrVectorDetail' -- app.tsx's ScreenBody switch only mounts this component for that screen kind, so this cannot happen without a routing bug.`);
  }
  return screen;
}

export interface PageVectorItem {
  readonly kind: 'vector';
  readonly vector: ContentVector;
  // Defined only when this page's live `OdgPage.vectors()` and the read-only `readOdgContent(...).vectors` agree exactly -- same length, same `kind` at every index (see `vectorsParityMatch` below). `undefined` means the parity check failed for this page, and every vector item on it (not just the mismatching one) is shown read-only, since there is no way to tell which live vector, if any, a given read-only row actually corresponds to once the two arrays have drifted apart.
  readonly liveVector: OdgVector | undefined;
}

export interface PageShapeItem {
  readonly kind: 'shape';
  readonly shape: OdpShape;
  readonly shapeKind: 'text' | 'image';
}

export type PageItem = PageVectorItem | PageShapeItem;

// documents.js's `OdgPage.vectors()` IS a real, live accessor onto every rect/ellipse/line/path vector on the page (added after this screen was first written, when the only handle on an existing vector was the reference `addRect`/`addEllipse`/`addLine`/`addPath` returned at creation time). What still makes a naive index-zip against it unsafe is that its own writer-side element recognition (`wrapVectorElement`, documents.js's `src/edit/odg/vector.ts`) is NARROWER than odf.js's own reader (`readOdgContent`, via `typed/draw/shapes.ts`): the reader additionally salvages `draw:circle`/`draw:polygon`/`draw:polyline`/a recognised `draw:custom-shape` preset into the same `ContentVector` 'ellipse'/'path' kinds, while `OdgPage.vectors()` silently skips those elements outright. A page containing one of those wider element kinds alongside an ordinary rect/ellipse/line/path therefore has `page.vectors()` return FEWER entries than `readOdgContent(...).vectors`, with everything after the skipped element shifted one position out of alignment -- pairing the wrong live handle to the wrong displayed row is a real, silent-corruption risk, not a theoretical one. `vectorsParityMatch` below guards against exactly that: `liveVector` is only ever populated when the two arrays agree in length AND kind at every index for the WHOLE page.
export function vectorsParityMatch(liveVectors: readonly { readonly kind: ContentVector['kind'] }[], contentVectors: readonly { readonly kind: ContentVector['kind'] }[]): boolean {
  if (liveVectors.length !== contentVectors.length) {
    return false;
  }
  return liveVectors.every((live, index) => live.kind === contentVectors[index]?.kind);
}

// Vectors are listed before shapes, matching this package's own documented drawing paint-order convention (`convertDrawingToLayout`'s own comment: "every vector paints before every shape").
export function buildPageItems(doc: OdgOpenDocument, pageIndex: number): readonly PageItem[] {
  const page = doc.editor.pages()[pageIndex];
  if (page === undefined) {
    return [];
  }
  const content = readOdgContent(doc.editor.toPackage());
  if (content.kind !== 'drawing') {
    throw new Error(`readOdgContent(doc.editor.toPackage()) returned a '${content.kind}' ContentDocument for an odg-format open document -- an odg package should always read back as the 'drawing' variant, so this indicates a real inconsistency in documents.js's own reader, not a state this screen should paper over.`);
  }
  const contentPage = content.pages[pageIndex];
  if (contentPage === undefined) {
    throw new Error(`readOdgContent found no page at index ${pageIndex}, but doc.editor.pages() has a page there -- the two read the same live package, so they should always agree on page count.`);
  }
  const liveVectors = page.vectors();
  const parityOk = vectorsParityMatch(liveVectors, contentPage.vectors);
  const vectorItems: readonly PageItem[] = contentPage.vectors.map((vector, index): PageItem => ({ kind: 'vector', vector, liveVector: parityOk ? liveVectors[index] : undefined }));
  const shapeItems: readonly PageItem[] = page.shapes().map((shape, index): PageItem => {
    // `contentPage.shapes` and `page.shapes()` both walk the same `draw:page`'s `draw:frame` children in document order, so index-aligning them is a reasonable, bounded assumption for this display-only classification -- a mismatch would only mislabel a row's Text/Image badge, never break navigation or editing (both of which address by the live `shape` reference or `containerIndex`/`shapeIndex`, not this index).
    const contentShape = contentPage.shapes[index];
    const shapeKind: 'text' | 'image' = contentShape?.blocks.some((block) => block.kind === 'image') === true ? 'image' : 'text';
    return { kind: 'shape', shape, shapeKind };
  });
  return [...vectorItems, ...shapeItems];
}

export function vectorKindLabel(kind: ContentVector['kind']): string {
  switch (kind) {
    case 'rect':
      return 'Rect';
    case 'ellipse':
      return 'Ellipse';
    case 'line':
      return 'Line';
    case 'path':
      return 'Path';
  }
}

export function formatPt(value: number): string {
  return value.toFixed(1);
}

export function formatFrame(box: Box): string {
  return `${formatPt(box.xPt)},${formatPt(box.yPt)} ${formatPt(box.widthPt)}x${formatPt(box.heightPt)}pt`;
}

function formatPoint(point: { readonly xPt: number; readonly yPt: number }): string {
  return `${formatPt(point.xPt)},${formatPt(point.yPt)}`;
}

export function formatColor(color: LayoutColor): string {
  return `rgb(${color.r.toFixed(2)}, ${color.g.toFixed(2)}, ${color.b.toFixed(2)})`;
}

export function describeVectorGeometry(vector: ContentVector): string {
  if (vector.kind === 'line') {
    return `${formatPoint(vector.from)} -> ${formatPoint(vector.to)}`;
  }
  return formatFrame(vector.frame);
}

export function describeFillStroke(vector: ContentVector): string {
  const parts: string[] = [];
  if (vector.kind !== 'line' && vector.fill !== undefined) {
    parts.push(`fill ${formatColor(vector.fill)}`);
  }
  if (vector.stroke !== undefined) {
    parts.push(`stroke ${formatColor(vector.stroke.color)} ${formatPt(vector.stroke.widthPt)}pt`);
  }
  return parts.length === 0 ? 'no fill or stroke' : parts.join(', ');
}

