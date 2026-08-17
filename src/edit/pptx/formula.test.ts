import type { ContentDocument, ContentFormula, MathMlElement, MathMlNode } from 'document-schema.js';
import { CONTENT_FORMAT_VERSION } from 'document-schema.js';
import type { Package, XmlElement } from 'ooxml.js';
import { childrenWithTag, rootElement } from 'ooxml.js';
import { describe, expect, it } from 'vitest';
import { formulaDocument } from '../../model/formula';
import { readPptxContent } from '../../ooxml/pptx/read';
import { findDescendantElement } from '../../xml/query';
import { buildPptxPackage } from './content';
import { PptxEditor } from './editor';

// pptx's own embedded-formula read/write path (ExaDev/documents.js#563's "pptx has zero formula support" gap): PptxShape.appendOfficeMath (shape.ts) writes a real m:oMathPara/m:oMath OOXML equation -- the identical src/omml/write.ts translator buildDocxPackage already uses -- and src/ooxml/pptx/formula.ts's spliceSlideFormulas reads it straight back, mirroring odp's own "one shape, one formula" granularity (src/edit/odp/formula.test.ts).

function mel(tag: string, children: MathMlNode[] = []): MathMlElement {
  return { type: 'element', tag, attributes: [], children };
}

function mtoken(tag: string, text: string): MathMlElement {
  return { type: 'element', tag, attributes: [], children: [{ type: 'text', value: text }] };
}

const FRACTION: ContentFormula = { mathml: [mel('mfrac', [mtoken('mi', 'a'), mtoken('mi', 'b')])] };
const FRAME = { xPt: 40, yPt: 30, widthPt: 100, heightPt: 50 };
const ZERO_INSETS = { insetLeftPt: 0, insetTopPt: 0, insetRightPt: 0, insetBottomPt: 0 };

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

function firstSlideRoot(pkg: Package): XmlElement {
  const root = rootElement(pkg.parts['ppt/slides/slide1.xml']);
  if (root === undefined) {
    throw new Error('expected a ppt/slides/slide1.xml root element');
  }
  return root;
}

function presentationDoc(shapes: Extract<ContentDocument, { kind: 'presentation' }>['slides'][number]['shapes']): ContentDocument {
  return { kind: 'presentation', formatVersion: CONTENT_FORMAT_VERSION, metadata: {}, slides: [{ size: { widthPt: 960, heightPt: 540 }, notes: '', shapes }] };
}

const FORMULA_SHAPES = [{ frame: FRAME, ...ZERO_INSETS, blocks: [{ kind: 'embeddedObject' as const, objectKind: 'formula' as const, document: formulaDocument(FRACTION), frame: FRAME }] }];

describe('PptxShape.appendOfficeMath', () => {
  it('writes a real m:oMathPara/m:oMath equation into the shape\'s own text body', () => {
    const editor = new PptxEditor(buildPptxPackage(presentationDoc([])));
    const slide = editor.slides()[0]!;
    const shape = slide.addTextBox({ frame: FRAME, text: '' });
    const { written } = shape.appendOfficeMath(FRACTION.mathml);
    expect(written).toBe(true);

    const slideRoot = firstSlideRoot(editor.toPackage());
    const oMathPara = findDescendantElement(slideRoot.children, 'm:oMathPara');
    expect(oMathPara).toBeDefined();
    expect(findDescendantElement(oMathPara!.node.children, 'm:oMath')).toBeDefined();
    expect(findDescendantElement(oMathPara!.node.children, 'm:f')).toBeDefined();
  });

  it('reports written: false and touches nothing for a formula whose MathML produces no OMML at all', () => {
    const editor = new PptxEditor(buildPptxPackage(presentationDoc([])));
    const slide = editor.slides()[0]!;
    const shape = slide.addTextBox({ frame: FRAME, text: 'placeholder' });
    const { written } = shape.appendOfficeMath([]);
    expect(written).toBe(false);
    expect(shape.text).toBe('placeholder');
  });
});

describe('buildPptxPackage: an embedded formula block', () => {
  it('writes the block as a real m:oMathPara equation, not the plain-text stand-in', () => {
    const pkg = buildPptxPackage(presentationDoc(FORMULA_SHAPES));
    const slideRoot = firstSlideRoot(pkg);
    expect(findDescendantElement(slideRoot.children, 'm:oMathPara')).toBeDefined();
    expect(childrenWithTag(slideRoot, 'p:cSld').length).toBeGreaterThan(0);
  });

  it('reads straight back through readPptxContent as one formula-kind embedded object, on its own shape', () => {
    const recovered = readPptxContent(buildPptxPackage(presentationDoc(FORMULA_SHAPES)));
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

  it('keeps a formula through repeated write/read cycles without accumulating spurious shapes', () => {
    let content = presentationDoc(FORMULA_SHAPES);
    for (let cycle = 0; cycle < 3; cycle++) {
      const next = readPptxContent(buildPptxPackage(content));
      if (next.kind !== 'presentation') {
        throw new Error('expected a presentation ContentDocument');
      }
      content = next;
      expect(next.slides[0]!.shapes).toHaveLength(1);
      expect(next.slides[0]!.shapes[0]!.blocks.map((block) => block.kind)).toEqual(['embeddedObject']);
    }
  });

  it('still writes the plain-text stand-in for a formula carrying no MathML at all', () => {
    const shapes = [{ frame: FRAME, ...ZERO_INSETS, blocks: [{ kind: 'embeddedObject' as const, objectKind: 'formula' as const, document: formulaDocument({ mathml: [], starMath: '{a} over {b}' }), frame: FRAME }] }];
    const pkg = buildPptxPackage(presentationDoc(shapes));
    const slideRoot = firstSlideRoot(pkg);
    expect(findDescendantElement(slideRoot.children, 'm:oMathPara')).toBeUndefined();
    expect(findDescendantElement(slideRoot.children, 'a:t')).toBeDefined();
  });

  it('reports an onMathDiagnostic for a construct src/omml/write.ts cannot translate', () => {
    // A positive-width mspace has no OMML counterpart that preserves its width -- src/omml/write.ts approximates it as a literal space and reports an 'approximated-element' diagnostic, exactly as it does for buildDocxPackage.
    const mspace: MathMlElement = { type: 'element', tag: 'mspace', attributes: [{ name: 'width', value: '5pt' }], children: [] };
    const spaced: ContentFormula = { mathml: [mel('mrow', [mtoken('mi', 'x'), mspace])] };
    const diagnostics: unknown[] = [];
    buildPptxPackage(
      presentationDoc([{ frame: FRAME, ...ZERO_INSETS, blocks: [{ kind: 'embeddedObject', objectKind: 'formula', document: formulaDocument(spaced), frame: FRAME }] }]),
      { onMathDiagnostic: (diagnostic) => diagnostics.push(diagnostic) },
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });
});
