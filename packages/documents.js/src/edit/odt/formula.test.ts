import type { ContentDocument, ContentFormula, MathMlElement, MathMlNode } from 'document-schema.js';

import { attrValue, buildXml, childrenWithTag, decodePackage, elementsWithTag, encodePackage, readManifest, readOdfFormula, rootElement, validateManifest } from 'odf.js';
import type { Package, XmlElement } from 'odf.js';
import { describe, expect, it } from 'vitest';
import { readOdtContent } from '../../odf/odt/read';
import { readOdfEmbeddedFormula } from '../../odf/formula/read';
import { formulaDocument } from '../../model/formula';
import { buildOdtPackage } from './content';
import { createOdt } from './editor';

// The ODF embedded-formula WRITE path: a real formula sub-document ("Object N/content.xml") inside the odt package, referenced from a draw:frame/draw:object and listed in the manifest -- the structural inverse of odf.js's own readOdfFormula, and the ODF-side symmetry of buildDocxPackage's OMML writing. Every assertion below is about the real package that came out, read back through odf.js's own reader rather than through a hand-written expectation of the XML.

function mel(tag: string, children: MathMlNode[] = []): MathMlElement {
  return { type: 'element', tag, attributes: [], children };
}

function mtoken(tag: string, text: string): MathMlElement {
  return { type: 'element', tag, attributes: [], children: [{ type: 'text', value: text }] };
}

const FRACTION: ContentFormula = { mathml: [mel('mfrac', [mtoken('mi', 'a'), mtoken('mi', 'b')])] };
const FRAME = { xPt: 0, yPt: 0, widthPt: 28.35, heightPt: 14.17 };

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

function contentRoot(pkg: Package): XmlElement {
  const part = pkg.parts['content.xml'];
  const root = part?.kind === 'xml' ? rootElement(part.nodes) : undefined;
  if (root === undefined) {
    throw new Error('expected the built odt to have a content.xml root element');
  }
  return root;
}

type WordprocessingBlocks = Extract<ContentDocument, { kind: 'wordprocessing' }>['sections'][number]['blocks'];

function wordDoc(blocks: WordprocessingBlocks): ContentDocument {
  return {
    kind: 'wordprocessing',
    metadata: {},
    sections: [{ pageSize: { widthPt: 612, heightPt: 792 }, margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 }, blocks }],
  };
}

describe('OdtBody.appendFormula', () => {
  it('writes a real formula sub-document odf.js\'s own readOdfFormula reads straight back', () => {
    const editor = createOdt();
    editor.body.appendFormula(FRACTION, FRAME);
    const pkg = editor.toPackage();

    const subPart = pkg.parts['Object 1/content.xml'];
    expect(subPart?.kind).toBe('xml');
    // Read through odf.js's own formula reader over a synthetic sub-package, exactly as readOdfEmbeddedFormula does for a real one.
    const recovered = readOdfFormula({ parts: { 'content.xml': subPart! } });
    expect(signature(recovered.mathml)).toBe('mfrac(mi(a),mi(b))');
  });

  it('references the sub-document from a draw:object inside an as-char anchored draw:frame, carrying the declared size', () => {
    const editor = createOdt();
    editor.body.appendFormula(FRACTION, FRAME);
    const frame = elementsWithTag([contentRoot(editor.toPackage())], 'draw:frame')[0];
    expect(frame).toBeDefined();
    expect(attrValue(frame!, 'text:anchor-type')).toBe('as-char');
    expect(attrValue(frame!, 'svg:width')).toBe('28.35pt');
    expect(attrValue(frame!, 'svg:height')).toBe('14.17pt');
    expect(attrValue(frame!, 'svg:x')).toBeUndefined();
    expect(attrValue(childrenWithTag(frame!, 'draw:object')[0]!, 'xlink:href')).toBe('./Object 1');
  });

  it('lists the sub-document in the manifest with the genuine ODF formula media type, leaving the manifest valid', () => {
    const editor = createOdt();
    editor.body.appendFormula(FRACTION, FRAME);
    const pkg = editor.toPackage();
    const entries = readManifest(pkg).entries;
    expect(entries.find((entry) => entry.fullPath === 'Object 1/')?.mediaType).toBe('application/vnd.oasis.opendocument.formula');
    expect(entries.find((entry) => entry.fullPath === 'Object 1/content.xml')?.mediaType).toBe('text/xml');
    expect(validateManifest(pkg).filter((problem) => problem.severity === 'error')).toEqual([]);
  });

  it('numbers a second formula into its own object directory rather than overwriting the first', () => {
    const editor = createOdt();
    editor.body.appendFormula(FRACTION, FRAME);
    editor.body.appendFormula({ mathml: [mel('msqrt', [mtoken('mi', 'x')])] }, FRAME);
    const pkg = editor.toPackage();
    expect(Object.keys(pkg.parts)).toEqual(expect.arrayContaining(['Object 1/content.xml', 'Object 2/content.xml']));
    const hrefs = elementsWithTag([contentRoot(pkg)], 'draw:object').map((object) => attrValue(object, 'xlink:href'));
    expect(hrefs).toEqual(['./Object 1', './Object 2']);
    // Both directories keep their real media type -- the second sync re-derives every sub-document's own type rather than blanking the first.
    const entries = readManifest(pkg).entries;
    expect(entries.filter((entry) => entry.mediaType === 'application/vnd.oasis.opendocument.formula').map((entry) => entry.fullPath)).toEqual(['Object 1/', 'Object 2/']);
  });

  it('writes a StarMath annotation odf.js reads back as ContentFormula.starMath', () => {
    const editor = createOdt();
    editor.body.appendFormula({ ...FRACTION, starMath: '{a} over {b}' }, FRAME);
    const pkg = editor.toPackage();
    expect(readOdfEmbeddedFormula(pkg, 'Object 1')?.starMath).toBe('{a} over {b}');
  });

  it('survives a real zip encode/decode round trip, not just the in-memory package', () => {
    const editor = createOdt();
    editor.body.appendFormula(FRACTION, FRAME);
    const reopened = decodePackage(encodePackage(editor.toPackage()));
    expect(signature(readOdfEmbeddedFormula(reopened, 'Object 1')?.mathml ?? [])).toBe('mfrac(mi(a),mi(b))');
  });
});

describe('buildOdtPackage: an embedded formula block', () => {
  const formulaBlocks = [
    { kind: 'paragraph' as const, runs: [{ text: 'Before the formula' }] },
    { kind: 'embeddedObject' as const, objectKind: 'formula' as const, document: formulaDocument(FRACTION), frame: FRAME },
  ];

  it('writes the block as a real formula sub-document, not the plain-text stand-in it used to', () => {
    const pkg = buildOdtPackage(wordDoc(formulaBlocks));
    expect(pkg.parts['Object 1/content.xml']?.kind).toBe('xml');
    expect(buildXml(contentRoot(pkg).children)).not.toContain('[formula]');
  });

  it('reads straight back through readOdtContent as one formula block, with no empty paragraph beside it', () => {
    const recovered = readOdtContent(buildOdtPackage(wordDoc(formulaBlocks)));
    if (recovered.kind !== 'wordprocessing') {
      throw new Error('expected a wordprocessing ContentDocument');
    }
    const blocks = recovered.sections[0]!.blocks;
    expect(blocks.map((block) => block.kind)).toEqual(['paragraph', 'embeddedObject']);
    const block = blocks[1];
    if (block?.kind !== 'embeddedObject' || block.document.kind !== 'formula') {
      throw new Error('expected a formula-kind embedded document');
    }
    expect(signature(block.document.formula.mathml)).toBe('mfrac(mi(a),mi(b))');
  });

  it('keeps a formula through repeated write/read cycles without accumulating blank paragraphs', () => {
    let content = wordDoc(formulaBlocks);
    for (let cycle = 0; cycle < 3; cycle++) {
      const next = readOdtContent(buildOdtPackage(content));
      if (next.kind !== 'wordprocessing') {
        throw new Error('expected a wordprocessing ContentDocument');
      }
      content = next;
      expect(next.sections[0]!.blocks.map((block) => block.kind)).toEqual(['paragraph', 'embeddedObject']);
    }
  });

  it('still writes the plain-text stand-in for a formula carrying no MathML at all', () => {
    const pkg = buildOdtPackage(
      wordDoc([{ kind: 'embeddedObject', objectKind: 'formula', document: formulaDocument({ mathml: [], starMath: '{a} over {b}' }), frame: FRAME }]),
    );
    expect(pkg.parts['Object 1/content.xml']).toBeUndefined();
    expect(buildXml(contentRoot(pkg).children)).toContain('{a} over {b}');
  });
});
