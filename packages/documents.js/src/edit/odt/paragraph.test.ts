import type { Package, XmlElement } from 'odf.js';
import { attrValue, bytesToBase64, childrenWithTag, decodeOdfText, elementsWithTag, readManifest, rootElement, validateManifest } from 'odf.js';
import { encodePng } from 'byte-codec';
import { describe, expect, it } from 'vitest';
import { createOdt } from './editor';
import { buildParagraph, OdtParagraph } from './paragraph';

// A genuine, decodable 2x2 PNG (not just a bare magic-number stub) -- mirrors src/test-support/odp.ts's own tinyPngBase64 reasoning: readOdtContent's own image detection (src/odf/image/detect.ts) calls odf.js's own readDrawImageBlock, which sniffs the actual bytes and returns undefined for anything it cannot recognise as a real image format.
function tinyPngBytes(): Uint8Array<ArrayBuffer> {
  return encodePng({ width: 2, height: 2, channels: 3, data: new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]) });
}

function contentRoot(pkg: Package): XmlElement {
  const part = pkg.parts['content.xml'];
  const root = part?.kind === 'xml' ? rootElement(part.nodes) : undefined;
  if (root === undefined) {
    throw new Error('expected the built odt to have a content.xml root element');
  }
  return root;
}

function findDrawFrame(pkg: Package): XmlElement {
  const [frame] = elementsWithTag([contentRoot(pkg)], 'draw:frame');
  if (frame === undefined) {
    throw new Error('expected a draw:frame element');
  }
  return frame;
}

describe('OdtParagraph text', () => {
  it('aggregates text across multiple runs, including a bare tab', () => {
    const editor = createOdt();
    const paragraph = editor.body.appendParagraph();
    paragraph.appendRun({ text: 'Left' });
    paragraph.appendTab();
    paragraph.appendRun({ text: 'Right' });
    expect(paragraph.text).toBe('Left\tRight');
  });
});

describe('OdtParagraph.runs / appendRun / insertRunAt', () => {
  it('appendRun appends in order, runs() reflects them', () => {
    const editor = createOdt();
    const paragraph = editor.body.appendParagraph();
    paragraph.appendRun({ text: 'A' });
    paragraph.appendRun({ text: 'B' });
    expect(paragraph.runs().map((r) => r.text)).toEqual(['A', 'B']);
  });

  it('insertRunAt inserts at the requested run position', () => {
    const editor = createOdt();
    const paragraph = editor.body.appendParagraph();
    paragraph.appendRun({ text: 'First' });
    paragraph.appendRun({ text: 'Third' });
    paragraph.insertRunAt(1, { text: 'Second' });
    expect(paragraph.runs().map((r) => r.text)).toEqual(['First', 'Second', 'Third']);
  });
});

describe('OdtParagraph.styleId', () => {
  it('reads and writes text:style-name directly, bypassing StyleRegistry', () => {
    const editor = createOdt();
    const paragraph = editor.body.appendParagraph();
    expect(paragraph.styleId).toBeUndefined();
    paragraph.styleId = 'Heading_20_1';
    expect(paragraph.styleId).toBe('Heading_20_1');
    paragraph.styleId = undefined;
    expect(paragraph.styleId).toBeUndefined();
  });
});

describe('OdtParagraph.alignment', () => {
  it('reads and writes alignment via a freshly-interned automatic style', () => {
    const editor = createOdt();
    const paragraph = editor.body.appendParagraph();
    expect(paragraph.alignment).toBeUndefined();
    paragraph.alignment = 'center';
    expect(paragraph.alignment).toBe('center');
    paragraph.alignment = 'right';
    expect(paragraph.alignment).toBe('right');
  });
});

describe('buildParagraph', () => {
  it('builds a paragraph with initial text and styleId applied', () => {
    const editor = createOdt();
    const paragraphElement = buildParagraph(editor.toPackage(), { text: 'Hi', styleId: 'Standard' });
    const paragraph = new OdtParagraph([paragraphElement], paragraphElement, editor.toPackage());
    expect(paragraph.text).toBe('Hi');
    expect(paragraph.styleId).toBe('Standard');
  });

  // styleId and alignment both ultimately target the same text:style-name attribute (ODF has no separate inline alignment attribute the way WordprocessingML's w:jc is independent of w:pStyle) -- applying alignment always resolve-merges-interns a fresh automatic style and repoints text:style-name at it, so a styleId set earlier in the same buildParagraph call is superseded, not layered underneath. This is the same direct-formatting-flattens-the-cascade trade-off applyStyleChange's own comment (props.ts) documents for any two sequential setter calls, styleId included.
  it('alignment applied after styleId supersedes styleId, rather than layering under it', () => {
    const editor = createOdt();
    const paragraphElement = buildParagraph(editor.toPackage(), { text: 'Hi', styleId: 'Standard', alignment: 'center' });
    const paragraph = new OdtParagraph([paragraphElement], paragraphElement, editor.toPackage());
    expect(paragraph.alignment).toBe('center');
    expect(paragraph.styleId).not.toBe('Standard');
  });

  // A heading is a distinct ODF ELEMENT (text:h + text:outline-level), not a text:p with a heading-ish style name -- and the style spelling ODF resolves is Heading_20_2 (ODF's _20_ escape for the space in "Heading 2"), never the synthetic cross-format "Heading2" shape the flat ContentDocument carries in styleId. The paragraph's own init carries both spellings of the same depth for exactly the reason odf.js's own reader derives both from the one text:h element (typed/odt/read.ts's readParagraphOrHeading): one element state, two consumers (styleId-keyed and numeric), no way for them to disagree.
  it('builds a real text:h with text:outline-level and the Heading_20_N style spelling for a headingLevel init', () => {
    const editor = createOdt();
    const paragraphElement = buildParagraph(editor.toPackage(), { text: 'Chapter', headingLevel: 2 });
    expect(paragraphElement.tag).toBe('text:h');
    expect(attrValue(paragraphElement, 'text:outline-level')).toBe('2');
    expect(attrValue(paragraphElement, 'text:style-name')).toBe('Heading_20_2');
    const paragraph = new OdtParagraph([paragraphElement], paragraphElement, editor.toPackage());
    expect(paragraph.text).toBe('Chapter');
    expect(paragraph.headingLevel).toBe(2);
  });

  it('builds a plain text:p with no outline level when headingLevel is absent', () => {
    const editor = createOdt();
    const paragraphElement = buildParagraph(editor.toPackage(), { text: 'Body' });
    expect(paragraphElement.tag).toBe('text:p');
    expect(attrValue(paragraphElement, 'text:outline-level')).toBeUndefined();
  });
});

describe('OdtParagraph.headingLevel', () => {
  it('promotes a live text:p to a text:h and demotes it back', () => {
    const editor = createOdt();
    const paragraph = editor.body.appendParagraph({ text: 'Chapter' });
    expect(paragraph.headingLevel).toBeUndefined();
    paragraph.headingLevel = 3;
    // The promote is a tag rename on the SAME element, not a remove-and-reinsert -- the live view keeps working, and editor.paragraphs() (which surfaces text:p and text:h both, see its own comment) still lists the paragraph as the heading it now is.
    expect(paragraph.headingLevel).toBe(3);
    expect(paragraph.text).toBe('Chapter');
    expect(editor.paragraphs()).toHaveLength(1);
    expect(editor.paragraphs()[0]?.headingLevel).toBe(3);
    paragraph.headingLevel = undefined;
    expect(paragraph.headingLevel).toBeUndefined();
    expect(editor.paragraphs()).toHaveLength(1);
    expect(editor.paragraphs()[0]?.text).toBe('Chapter');
  });
});

describe('OdtParagraph.insertImageAfter', () => {
  it('appends an as-char anchored draw:frame referencing the inserted media part, with no absolute position', () => {
    const editor = createOdt();
    const paragraph = editor.body.appendParagraph();
    paragraph.insertImageAfter({ format: 'png', bytes: tinyPngBytes(), widthPt: 100, heightPt: 50 });
    const pkg = editor.toPackage();
    const mediaParts = Object.keys(pkg.parts).filter((path) => path.startsWith('Pictures/'));
    expect(mediaParts).toHaveLength(1);
    const [partPath] = mediaParts;

    const frameElement = findDrawFrame(pkg);
    expect(attrValue(frameElement, 'text:anchor-type')).toBe('as-char');
    expect(attrValue(frameElement, 'svg:width')).toBe('100pt');
    expect(attrValue(frameElement, 'svg:height')).toBe('50pt');
    expect(attrValue(frameElement, 'svg:x')).toBeUndefined();
    expect(attrValue(frameElement, 'svg:y')).toBeUndefined();
    const [imageElement] = childrenWithTag(frameElement, 'draw:image');
    expect(attrValue(imageElement!, 'xlink:href')).toBe(partPath);
  });

  it('writes altText as a real svg:title child element, never an attribute', () => {
    const editor = createOdt();
    const paragraph = editor.body.appendParagraph();
    paragraph.insertImageAfter({ format: 'png', bytes: tinyPngBytes(), widthPt: 100, heightPt: 50, altText: 'A photo' });
    const frameElement = findDrawFrame(editor.toPackage());
    expect(attrValue(frameElement, 'svg:title')).toBeUndefined();
    const [titleElement] = childrenWithTag(frameElement, 'svg:title');
    expect(titleElement).toBeDefined();
    expect(decodeOdfText(titleElement!)).toBe('A photo');
  });

  it('registers the binary part under Pictures/ with a matching, valid manifest entry', () => {
    const editor = createOdt();
    const paragraph = editor.body.appendParagraph();
    const bytes = tinyPngBytes();
    paragraph.insertImageAfter({ format: 'png', bytes, widthPt: 100, heightPt: 50 });
    const pkg = editor.toPackage();
    const mediaParts = Object.keys(pkg.parts).filter((path) => path.startsWith('Pictures/'));
    expect(mediaParts).toHaveLength(1);
    const [partPath] = mediaParts;
    const entries = readManifest(pkg).entries;
    expect(entries.find((entry) => entry.fullPath === partPath)?.mediaType).toBe('image/png');
    expect(validateManifest(pkg).filter((problem) => problem.severity === 'error')).toEqual([]);
    const part = pkg.parts[partPath!];
    if (part?.kind !== 'binary') {
      throw new Error('expected a binary media part');
    }
    expect(part.base64).toBe(bytesToBase64(bytes));
  });
});

describe('OdtParagraph.remove', () => {
  it('removes the paragraph from its body and throws on any further use', () => {
    const editor = createOdt();
    const paragraph = editor.body.appendParagraph({ text: 'Bye' });
    expect(editor.paragraphs()).toHaveLength(1);
    paragraph.remove();
    expect(editor.paragraphs()).toHaveLength(0);
    expect(() => paragraph.text).toThrow(/removed/);
  });
});
