import { readOdgContent, type Box, type ContentStroke, type ContentSubpath, type ContentVector, type LayoutColor, type OdpShape } from 'documents.js';
import { currentScreen, type AppState, type OdgOpenDocument, type Screen } from '../../../state/types.js';

// Shared between page-list.tsx, page-detail.tsx and shape-or-vector-detail.tsx: the odg-document/screen narrowing every one of them needs, the vector/shape enumeration workaround documents.js's own API leaves no other route to, and the small formatting/parsing helpers all three build their rows and forms from.

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
}

export interface PageShapeItem {
  readonly kind: 'shape';
  readonly shape: OdpShape;
  readonly shapeKind: 'text' | 'image';
}

export type PageItem = PageVectorItem | PageShapeItem;

// documents.js's `OdgPage` exposes `shapes()` for text/image frames but no accessor at all for an existing rect/ellipse/line/path vector -- not even for one this same process just created via `addRect`/`addEllipse`/`addLine`/`addPath`, since the reducer's dispatch-based mutation flow (needed for undo/hasUnsavedChanges bookkeeping) discards each call's return value, and `OdgBoxVector`/`OdgLineVector`/`OdgPathVector` construct only from internal XmlElement/container references no caller outside `OdgPage` itself can legitimately obtain. `readOdgContent` reads the live package fresh and DOES surface every vector, but only as a plain `ContentVector` data value, never as the live handle `SET_VECTOR_FILL`/`SET_VECTOR_STROKE` require -- so a vector item built here is genuinely, permanently view-only in this TUI (see shape-or-vector-detail.tsx's `VectorDetail`). Vectors are listed before shapes, matching this package's own documented drawing paint-order convention (`convertDrawingToLayout`'s own comment: "every vector paints before every shape").
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
  const vectorItems: readonly PageItem[] = contentPage.vectors.map((vector): PageItem => ({ kind: 'vector', vector }));
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

export function parseNumberField(raw: string, fallback: number): number {
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function parseColorField(raw: string): LayoutColor | undefined {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  const [r, g, b] = trimmed.split(/\s+/).map((part) => Number.parseFloat(part));
  if (r === undefined || g === undefined || b === undefined || ![r, g, b].every((value) => Number.isFinite(value))) {
    return undefined;
  }
  return { r, g, b };
}

export function parseStrokeField(raw: string): ContentStroke | undefined {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  const [r, g, b, widthPt] = trimmed.split(/\s+/).map((part) => Number.parseFloat(part));
  if (r === undefined || g === undefined || b === undefined || widthPt === undefined || ![r, g, b, widthPt].every((value) => Number.isFinite(value))) {
    return undefined;
  }
  return { color: { r, g, b }, widthPt };
}

// A hand-rolled path shape rather than something the user types point-by-point into a terminal text field: a triangle spanning the given frame, local (viewBox-relative) coordinates matching `PathVectorInit.subpaths`' own convention.
export function defaultTriangleSubpaths(widthPt: number, heightPt: number): readonly ContentSubpath[] {
  return [
    {
      start: { xPt: 0, yPt: heightPt },
      segments: [
        { kind: 'line', to: { xPt: widthPt / 2, yPt: 0 } },
        { kind: 'line', to: { xPt: widthPt, yPt: heightPt } },
      ],
      closed: true,
    },
  ];
}

// The add-item wizard walks every field of `fieldsForAddKind(kind)` in order and always records a value (its own default at minimum) before advancing, so a missing key at build time indicates a bug in that walk, not a legitimate empty state -- throwing here, rather than substituting a silent default, surfaces that bug instead of building a wrong action from it.
export function requireFieldValue(values: Readonly<Record<string, string>>, key: string): string {
  const value = values[key];
  if (value === undefined) {
    throw new Error(`Add-item field '${key}' was never recorded before building the action.`);
  }
  return value;
}
