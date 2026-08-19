import type { ContentStroke, ContentSubpath, LayoutColor } from 'documents.js';

// Vector-primitive field parsing shared across every screen that lets a caller type a fill/stroke/path into a plain TextField -- originally local to odg/shared.ts (odg's own add-item wizard, page-detail.tsx), extracted here once slide-detail.tsx's own odp vector-creation flow needed the identical parse. odg/shared.ts re-exports these three unchanged so every existing import from './shared.js' keeps working, matching field-wizard.tsx's own extraction precedent.

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
