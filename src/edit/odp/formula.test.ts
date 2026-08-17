import type { ContentDocument, ContentFormula, MathMlElement, MathMlNode } from 'document-schema.js';
import { CONTENT_FORMAT_VERSION } from 'document-schema.js';
import { attrValue, childrenWithTag, decodePackage, elementsWithTag, encodePackage, findChildElement, readManifest, readOdfFormula, rootElement, validateManifest } from 'odf.js';
import type { Package, XmlElement } from 'odf.js';
import { describe, expect, it } from 'vitest';
import { readOdfEmbeddedFormula } from '../../odf/formula/read';
import { readOdpContent } from '../../odf/odp/read';
import { formulaDocument } from '../../model/formula';
import { buildOdpPackage } from './content';
import { OdpEditor } from './editor';

// The odp counterpart to src/edit/odt/formula.test.ts -- ExaDev/documents.js#563's "odp can read an embedded formula but its writer drops it" gap. OdpSlide.addFormula (slide.ts) and buildOdpPackage's own appendShape (content.ts) reuse the identical src/odf-package/formula.ts machinery odt/ods already write through; only the referencing draw:frame's own positioning differs (real svg:x/svg:y, like every other odp shape, not odt's text-flow "as-char" anchoring).

function mel(tag: string, children: MathMlNode[] = []): MathMlElement {
  return { type: 'element', tag, attributes: [], children };
}

function mtoken(tag: string, text: string): MathMlElement {
  return { type: 'element', tag, attributes: [], children: [{ type: 'text', value: text }] };
}

const FRACTION: ContentFormula = { mathml: [mel('mfrac', [mtoken('mi', 'a'), mtoken('mi', 'b')])] };
const FRAME = { xPt: 40, yPt: 30, widthPt: 100, heightPt: 50 };

function signature(nodes: readonly MathMlNode[]): string {
  return nodes
    .flatMap((node) => {
      if (node.type !== 'element') {
        return [];
      }
      const inner = node.children.some((child) => child.type === 'element') ? signature(node.children) : node.children.map((child) => (child.type === 'text' ? child.value : '')).join('');
      return [`${localTag(node.tag)}(${inner})`];
    })
    .join(',');
}

function localTag(tag: string): string {
  const colon = tag.indexOf(':');
  return colon === -1 ? tag : tag.slice(colon + 1);
}

function firstDrawPage(pkg: Package): XmlElement {
  const part = pkg.parts['content.xml'];
  const root = part?.kind === 'xml' ? rootElement(part.nodes) : undefined;
  const body = root === undefined ? undefined : findChildElement(root.children, 'office:body');
  const presentation = body === undefined ? undefined : findChildElement(body.children, 'office:presentation');
  const [page] = presentation === undefined ? [] : childrenWithTag(presentation, 'draw:page');
  if (page === undefined) {
    throw new Error('expected an office:presentation/draw:page element');
  }
  return page;
}

function presentationDoc(shapes: Extract<ContentDocument, { kind: 'presentation' }>['slides'][number]['shapes']): ContentDocument {
  return { kind: 'presentation', formatVersion: CONTENT_FORMAT_VERSION, metadata: {}, slides: [{ size: { widthPt: 960, heightPt: 540 }, notes: '', shapes }] };
}

const ZERO_INSETS = { insetLeftPt: 0, insetTopPt: 0, insetRightPt: 0, insetBottomPt: 0 };

const FORMULA_SHAPES = [{ frame: FRAME, ...ZERO_INSETS, blocks: [{ kind: 'embeddedObject' as const, objectKind: 'formula' as const, document: formulaDocument(FRACTION), frame: FRAME }] }];

describe('OdpSlide.addFormula', () => {
  it('writes a real formula sub-document odf.js\'s own readOdfFormula reads straight back', () => {
    const editor = new OdpEditor(buildOdpPackage(presentationDoc([])));
    const slide = editor.slides()[0]!;
    slide.addFormula(FRAME, FRACTION);
    const pkg = editor.toPackage();

    const subPart = pkg.parts['Object 1/content.xml'];
    expect(subPart?.kind).toBe('xml');
    const recovered = readOdfFormula({ parts: { 'content.xml': subPart! } });
    expect(signature(recovered.mathml)).toBe('mfrac(mi(a),mi(b))');
  });

  it('references the sub-document from a draw:object inside a positioned frame -- real svg:x/svg:y, unlike odt\'s as-char anchoring', () => {
    const editor = new OdpEditor(buildOdpPackage(presentationDoc([])));
    const slide = editor.slides()[0]!;
    slide.addFormula(FRAME, FRACTION);
    const frame = elementsWithTag([firstDrawPage(editor.toPackage())], 'draw:frame')[0];
    expect(frame).toBeDefined();
    expect(attrValue(frame!, 'text:anchor-type')).toBeUndefined();
    expect(attrValue(frame!, 'svg:x')).toBe('40pt');
    expect(attrValue(frame!, 'svg:y')).toBe('30pt');
    expect(attrValue(frame!, 'svg:width')).toBe('100pt');
    expect(attrValue(frame!, 'svg:height')).toBe('50pt');
    expect(attrValue(childrenWithTag(frame!, 'draw:object')[0]!, 'xlink:href')).toBe('./Object 1');
  });

  it('lists the sub-document in the manifest with the genuine ODF formula media type, leaving the manifest valid', () => {
    const editor = new OdpEditor(buildOdpPackage(presentationDoc([])));
    editor.slides()[0]!.addFormula(FRAME, FRACTION);
    const pkg = editor.toPackage();
    const entries = readManifest(pkg).entries;
    expect(entries.find((entry) => entry.fullPath === 'Object 1/')?.mediaType).toBe('application/vnd.oasis.opendocument.formula');
    expect(validateManifest(pkg).filter((problem) => problem.severity === 'error')).toEqual([]);
  });

  it('survives a real zip encode/decode round trip, not just the in-memory package', () => {
    const editor = new OdpEditor(buildOdpPackage(presentationDoc([])));
    editor.slides()[0]!.addFormula(FRAME, FRACTION);
    const reopened = decodePackage(encodePackage(editor.toPackage()));
    expect(signature(readOdfEmbeddedFormula(reopened, 'Object 1')?.mathml ?? [])).toBe('mfrac(mi(a),mi(b))');
  });
});

describe('buildOdpPackage: an embedded formula block', () => {
  it('writes the block as a real formula sub-document', () => {
    const pkg = buildOdpPackage(presentationDoc(FORMULA_SHAPES));
    expect(pkg.parts['Object 1/content.xml']?.kind).toBe('xml');
  });

  it('reads straight back through readOdpContent as one formula-kind embedded object, on its own shape', () => {
    const recovered = readOdpContent(buildOdpPackage(presentationDoc(FORMULA_SHAPES)));
    if (recovered.kind !== 'presentation') {
      throw new Error('expected a presentation ContentDocument');
    }
    const shapes = recovered.slides[0]!.shapes;
    expect(shapes).toHaveLength(1);
    const [block] = shapes[0]!.blocks;
    if (block?.kind !== 'embeddedObject' || block.document.kind !== 'formula') {
      throw new Error('expected a formula-kind embedded document');
    }
    expect(signature(block.document.formula.mathml)).toBe('mfrac(mi(a),mi(b))');
  });

  it('still writes the plain-text stand-in for a formula carrying no MathML at all', () => {
    const shapes = [{ frame: FRAME, ...ZERO_INSETS, blocks: [{ kind: 'embeddedObject' as const, objectKind: 'formula' as const, document: formulaDocument({ mathml: [], starMath: '{a} over {b}' }), frame: FRAME }] }];
    const pkg = buildOdpPackage(presentationDoc(shapes));
    expect(pkg.parts['Object 1/content.xml']).toBeUndefined();
    const textBox = elementsWithTag([firstDrawPage(pkg)], 'draw:text-box')[0];
    expect(textBox).toBeDefined();
  });
});
