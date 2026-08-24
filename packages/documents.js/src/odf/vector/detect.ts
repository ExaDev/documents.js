import type { ContentVector } from 'document-schema.js';
import type { Package, XmlNode } from 'odf.js';
import { readDrawPageContent } from 'odf.js';

// Vector detection for odt/odp -- the ODF-side counterpart to src/ooxml/docx/vector.ts and src/ooxml/pptx/vector.ts, kept in its own module (parallel to but separate from src/odf/formula/detect.ts) because the traversal shapes genuinely differ: a formula frame can sit anywhere at all (nested in a group, anchored inline in a run), so collectFormulaFrames runs its own deep, bespoke walk; a vector primitive's own detection is a thin call straight through to odf.js's own EXPORTED readDrawPageContent, which already does everything this module needs (including recursing into a draw:g group) -- there is no bespoke walk to write here at all.

// The direct-child ODF tag names a vector primitive can be written as -- odf.js's own readDrawPageContent recognises exactly this set (see that library's typed/draw/shapes.ts), and this package's own writer (src/edit/odg/vector.ts) only ever emits draw:rect/draw:ellipse/draw:line/draw:path -- draw:circle/draw:polygon/draw:polyline/draw:custom-shape are real ODF vector shapes a THIRD-PARTY producer (LibreOffice itself, notably) can write, which this reader recognises too since it is reading arbitrary real files, not only ones this package wrote.
const VECTOR_ELEMENT_TAGS: ReadonlySet<string> = new Set(['draw:rect', 'draw:ellipse', 'draw:circle', 'draw:line', 'draw:path', 'draw:polygon', 'draw:polyline', 'draw:custom-shape']);

export function isVectorElementTag(tag: string): boolean {
  return VECTOR_ELEMENT_TAGS.has(tag);
}

// Every vector primitive found directly among `children` (recursing into a nested draw:g exactly as odf.js's own readDrawPageContent already does), reused rather than reimplemented: a vector's own attribute vocabulary is identical wherever it sits -- a document's text flow, a slide's page, a drawing's page -- which is exactly the argument src/edit/odg/vector.ts's own writer already rests on for the write side.
export function collectContainerVectors(children: readonly XmlNode[], pkg: Package): readonly ContentVector[] {
  return readDrawPageContent(children, pkg).vectors;
}

export interface DetectedSlideVectorGroup {
  // The 0-based position, among the ContentShapes odf.js's own readOdpContent already produced for this slide, immediately before which this group's synthetic drawing shape is inserted.
  readonly insertBeforeShapeIndex: number;
  readonly vectors: readonly ContentVector[];
}

// odf.js's own readDrawPageContent stamps a real, monotonically increasing paintOrder on every shape and vector it finds on one page/container (see that library's own walkDrawPageContent), from ONE SHARED counter across both arrays -- so a vector's paintOrder can be compared directly against a shape's own to recover their true relative document position, even though readOdp's own walkDrawShapes (which builds slide.shapes) walks and counts shapes alone. The two walks visit draw:frame/draw:g in the identical order with the identical "push one shape per draw:frame whose geometry resolves, recurse into a group" rule, so the ARRAY POSITION each assigns a given shape is identical between them -- confirmed directly against both libraries' own source (see this package's own test suite's dedicated correspondence check) -- which is what makes `insertBeforeShapeIndex` meaningful against slide.shapes at all.
function paintOrderOf(item: { readonly paintOrder?: number }): number {
  if (item.paintOrder === undefined) {
    throw new Error("expected odf.js's own readDrawPageContent to stamp every shape/vector with a paintOrder");
  }
  return item.paintOrder;
}

// Every vector primitive on one draw:page, grouped by which of odf.js's own readOdpContent-produced ContentShapes each sits immediately before -- so a caller inserting synthetic shapes for them lands each group at its true position among the slide's real shapes, in ONE forward pass, rather than always at the end.
export function collectSlideVectorGroups(pageChildren: readonly XmlNode[], pkg: Package): readonly DetectedSlideVectorGroup[] {
  const { shapes, vectors } = readDrawPageContent(pageChildren, pkg);
  const shapePaintOrders = shapes.map(paintOrderOf);

  interface MutableGroup {
    insertBeforeShapeIndex: number;
    vectors: ContentVector[];
  }
  const groups: MutableGroup[] = [];
  for (const vector of vectors) {
    const vectorOrder = paintOrderOf(vector);
    const insertBeforeShapeIndex = shapePaintOrders.filter((order) => order < vectorOrder).length;
    const last = groups[groups.length - 1];
    const continuesLastGroup = last?.insertBeforeShapeIndex === insertBeforeShapeIndex;
    if (continuesLastGroup) {
      last.vectors.push(vector);
      continue;
    }
    groups.push({ insertBeforeShapeIndex, vectors: [vector] });
  }
  // paintOrder resets to each group's own 0-based position, matching buildDrawingBlock's own fixture-relative numbering.
  return groups.map((group) => ({
    insertBeforeShapeIndex: group.insertBeforeShapeIndex,
    vectors: group.vectors.map((vector, index) => ({ ...vector, paintOrder: index })),
  }));
}
