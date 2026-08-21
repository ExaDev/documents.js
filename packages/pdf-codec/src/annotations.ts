import type { PdfDiagnosticSink } from './diagnostics';
import type { PdfObjectResolver } from './interpret';
import type { LayoutAnnotation, LayoutAnnotationQuad } from './layout';
import { NOTES_ANNOTATION_AUTHOR } from './notes-annotation-author';
import type { PdfDict } from './objects';
import { asArray, asName, asNumber, dictGet } from './objects';
import { decodePdfString, parsePdfDate } from './pdf-text';
import { serializeObjectToText } from './serialize';
import { applyMatrix } from './matrix';
import type { Matrix } from './matrix';

// Annotation reading (#721 phase 4): the /Annots walk for everything that is neither a link item (read.ts's own walk), a /FileAttachment (the attachments table owns its filespec), nor a /Widget (the AcroForm field tree owns it). The semantic set is the sticky note, FreeText, and the /QuadPoints markup family; every other kind degrades to its rect plus the raw annotation dictionary in the quarantined residue channel -- the verdict row's own split. Popup annotations are dropped outright as derivable (a popup's rect is the parent plus a fixed offset, and its contents ARE the parent's).

const SEMANTIC_SUBTYPES = new Set(['Text', 'FreeText', 'Highlight', 'Underline', 'StrikeOut', 'Squiggly']);
// Annotations another reader here already owns; listing them keeps this walk's skip set explicit rather than an else-shaped accident.
const OWNED_ELSEWHERE_SUBTYPES = new Set(['Link', 'FileAttachment', 'Widget', 'Popup']);

export function readPageAnnotations(page: PdfDict, pageMatrix: Matrix, resolver: PdfObjectResolver, sink: PdfDiagnosticSink): LayoutAnnotation[] {
  const annotsArr = asArray(dictGet(page, 'Annots'));
  if (annotsArr === undefined) {
    return [];
  }
  const annotations: LayoutAnnotation[] = [];
  for (const annotRef of annotsArr) {
    const annot = resolver.resolveDict(annotRef);
    if (annot === undefined) {
      continue;
    }
    const subtype = asName(dictGet(annot, 'Subtype'));
    if (subtype === undefined || OWNED_ELSEWHERE_SUBTYPES.has(subtype)) {
      continue;
    }
    // This package's own hidden presenter-notes annotation is a round-trip mechanism, not document content -- readPageNotes consumes it, and it must not also surface as a sticky note.
    if (subtype === 'Text' && annotString(annot, 'T') === NOTES_ANNOTATION_AUTHOR) {
      continue;
    }
    const rectArr = asArray(dictGet(annot, 'Rect'));
    if (rectArr === undefined) {
      sink({ code: 'pdf/annotation-missing-rect', severity: 'warning', message: `a /${subtype} annotation carries no /Rect; skipping it` });
      continue;
    }
    const x1 = asNumber(rectArr[0]) ?? 0;
    const y1 = asNumber(rectArr[1]) ?? 0;
    const x2 = asNumber(rectArr[2]) ?? 0;
    const y2 = asNumber(rectArr[3]) ?? 0;
    const p1 = applyMatrix(pageMatrix, { x: Math.min(x1, x2), y: Math.min(y1, y2) });
    const p2 = applyMatrix(pageMatrix, { x: Math.max(x1, x2), y: Math.max(y1, y2) });
    const contents = annotString(annot, 'Contents');
    const author = annotString(annot, 'T');
    const modifiedIso = parsePdfDate(annotString(annot, 'M'));
    annotations.push({
      subtype,
      xPt: Math.min(p1.x, p2.x),
      yPt: Math.min(p1.y, p2.y),
      widthPt: Math.abs(p2.x - p1.x),
      heightPt: Math.abs(p2.y - p1.y),
      ...(contents !== undefined ? { contents } : {}),
      ...(author !== undefined ? { author } : {}),
      ...(modifiedIso !== undefined ? { modifiedIso } : {}),
      ...(SEMANTIC_SUBTYPES.has(subtype) ? markupFields(annot, pageMatrix) : { source: { format: 'pdf' as const, xml: serializeObjectToText(annot) } }),
    });
  }
  return annotations;
}

function annotString(annot: PdfDict, key: string): string | undefined {
  const obj = dictGet(annot, key);
  return obj?.kind === 'string' ? decodePdfString(obj.bytes) : undefined;
}

// The markup family's /QuadPoints (ISO 32000-1 Table 174): a flat run of quadrilaterals, eight coordinates each, each quad's four corners transformed through the page matrix so a consumer matches them against recovered items in one space.
function markupFields(annot: PdfDict, pageMatrix: Matrix): { quads?: LayoutAnnotationQuad[] } {
  const quadPoints = asArray(dictGet(annot, 'QuadPoints'));
  if (quadPoints === undefined || quadPoints.length < 8 || quadPoints.length % 8 !== 0) {
    return {};
  }
  const quads: LayoutAnnotationQuad[] = [];
  for (let i = 0; i < quadPoints.length; i += 8) {
    const corner = (index: number): { xPt: number; yPt: number } => {
      const x = asNumber(quadPoints[i + index * 2]) ?? 0;
      const y = asNumber(quadPoints[i + index * 2 + 1]) ?? 0;
      const transformed = applyMatrix(pageMatrix, { x, y });
      return { xPt: transformed.x, yPt: transformed.y };
    };
    quads.push([corner(0), corner(1), corner(2), corner(3)]);
  }
  return { quads };
}
