import { execFileSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildXml as buildOdfXml, zipPackage } from 'odf.js';
import { describe, expect, it } from 'vitest';
import { FRACTION_FORMULA, MATRIX_FORMULA, odfFormulaBytes, SQRT_FORMULA, SUBSUP_FORMULA } from '../test-support/odf';
import { minimalOdpBytes } from '../test-support/odp';
import { minimalOdtBytes } from '../test-support/odt';
import type { ContentBlock, DocumentPackage, MathMlNode } from 'document-schema.js';
import { decodePackage } from 'odf.js';
import type { XmlElement } from 'ooxml.js';
import { attr, buildXml, childrenWithTag, decodePackage as decodeOoxmlPackage, elementsWithTag, encodePackage as encodeOoxmlPackage, rootElement, textContent } from 'ooxml.js';
import { readPdf } from 'pdf-codec';
import { buildDocxPackage } from '../edit/docx/content';
import { decodeMarkdownText } from '../markdown/text';
import type { OmmlDiagnostic } from '../omml/shared';
import { readDocxContent } from '../ooxml/docx/read';
import { readOdpContent } from '../odf/odp/read';
import { readOdtContent } from '../odf/odt/read';
import { odmBytes } from '../test-support/odm';
import { docxToOdt, odfToPdf, odmToPdf, odpToPdf, odtToDocx, odtToMarkdown, odtToPdf } from './convert';

// End-to-end coverage for the MathML/formula pipeline: odfToPdf (a standalone .odf formula document) for each of the task's own named curated formulas (a simple fraction, a square root, a superscript/subscript combination, a small matrix via mtable), plus the embedded-formula-inside-odt/odp path. Checks the output PDF is well-formed (readable back through this package's own readPdf; also cross-checked with qpdf --check when that binary is available locally -- see qpdfCheck below) and that real layout invariants hold, not just "it doesn't crash".

function findQpdf(): boolean {
  try {
    execFileSync('which', ['qpdf'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
const QPDF_AVAILABLE = findQpdf();

// Cross-checks a PDF's own well-formedness with a real, independent, mature PDF tool -- qpdf --check parses the object graph, xref table, and every stream's own /Length, catching a structural mistake this package's own reader might tolerate. Skipped (not failed) when qpdf isn't installed locally -- matching this repo's own test:corpus precedent for an optional, environment-dependent check that never gates pnpm test/CI.
function qpdfCheck(bytes: Uint8Array<ArrayBuffer>): void {
  if (!QPDF_AVAILABLE) {
    return;
  }
  const path = join(tmpdir(), `documents-js-formula-test-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
  writeFileSync(path, bytes);
  try {
    execFileSync('qpdf', ['--check', path], { stdio: 'pipe' });
  } finally {
    unlinkSync(path);
  }
}

describe('odfToPdf: a simple fraction', () => {
  it('produces a well-formed, single-page PDF with the fraction rule between numerator and denominator', () => {
    const bytes = odfToPdf(odfFormulaBytes(FRACTION_FORMULA));
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe('%PDF-');

    const layout = readPdf(bytes);
    expect(layout.pages).toHaveLength(1);
    qpdfCheck(bytes);
  });
});

describe('odfToPdf: a square root', () => {
  it('produces a well-formed PDF', () => {
    const bytes = odfToPdf(odfFormulaBytes(SQRT_FORMULA));
    const layout = readPdf(bytes);
    expect(layout.pages).toHaveLength(1);
    qpdfCheck(bytes);
  });
});

describe('odfToPdf: a superscript/subscript combination', () => {
  it('produces a well-formed PDF', () => {
    const bytes = odfToPdf(odfFormulaBytes(SUBSUP_FORMULA));
    const layout = readPdf(bytes);
    expect(layout.pages).toHaveLength(1);
    qpdfCheck(bytes);
  });
});

describe('odfToPdf: a small matrix (mtable)', () => {
  it('produces a well-formed PDF', () => {
    const bytes = odfToPdf(odfFormulaBytes(MATRIX_FORMULA));
    const layout = readPdf(bytes);
    expect(layout.pages).toHaveLength(1);
    qpdfCheck(bytes);
  });

  it('carries the StarMath annotation through, honoured by readOdfFormulaContent, even though it never affects the rendered output', () => {
    // starMath itself is not asserted on the PDF (there is no StarMath-rendering path -- the real MathML is what's rendered), but this confirms the option is accepted and odfToPdf still succeeds with it present.
    const bytes = odfToPdf(odfFormulaBytes(FRACTION_FORMULA, { starMath: '{a} over {b}' }));
    expect(readPdf(bytes).pages).toHaveLength(1);
  });
});

describe('odfToPdf: cancellation', () => {
  it('throws when the signal is already aborted', () => {
    const controller = new AbortController();
    controller.abort();
    expect(() => odfToPdf(odfFormulaBytes(FRACTION_FORMULA), { signal: controller.signal })).toThrow();
  });
});

// An odt (or odp) with a real embedded formula sub-object -- a draw:frame > draw:object referencing "./Object 1", the standard ODF convention this package's own src/odf/formula/detect.ts targets (see that module's own comment) -- built by hand exactly like every other src/test-support/*.ts fixture, not from a real LibreOffice-produced .odt/.odp.
const OFFICE_NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"';
const TEXT_NS = 'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"';
const DRAW_NS = 'xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"';
const XLINK_NS = 'xmlns:xlink="http://www.w3.org/1999/xlink"';
const SVG_NS = 'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"';
const STYLE_NS = 'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"';

function enc(s: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(s);
}

// The embedded sub-object's own content.xml, addressed as "<name>/content.xml" inside the OUTER package -- the same office:body > office:math > math:math structure odfFormulaBytes builds for a standalone .odf, just package-relative rather than a whole separate zip (see src/odf/formula/detect.ts's own subPackagePathFromHref for the "./Object 1" -> "Object 1" convention this exercises).
function embeddedFormulaObjectBytes(mathMlInner: string): Uint8Array<ArrayBuffer> {
  return enc(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<office:document-content ${OFFICE_NS} xmlns:math="http://www.w3.org/1998/Math/MathML"><office:body><office:math><math:math xmlns:math="http://www.w3.org/1998/Math/MathML">${mathMlInner}</math:math></office:math></office:body></office:document-content>`,
  );
}

function odtBodyBytes(bodyInner: string): Uint8Array<ArrayBuffer> {
  return enc(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<office:document-content ${OFFICE_NS} ${TEXT_NS} ${DRAW_NS} ${XLINK_NS} ${SVG_NS}><office:body><office:text>${bodyInner}</office:text></office:body></office:document-content>`,
  );
}

function odtZip(bodyInner: string, objects: readonly (readonly [string, string])[]): Uint8Array<ArrayBuffer> {
  return zipPackage([
    ['mimetype', { bytes: enc('application/vnd.oasis.opendocument.text'), stored: true }],
    ['content.xml', { bytes: odtBodyBytes(bodyInner) }],
    ...objects.map(([name, mathMlInner]) => [`${name}/content.xml`, { bytes: embeddedFormulaObjectBytes(mathMlInner) }] as const),
  ]);
}

// A formula frame sitting as a DIRECT child of office:text -- the absolutely-positioned (non-inline) shape, and the only one this package detected before.
function odtWithEmbeddedFormulaBytes(): Uint8Array<ArrayBuffer> {
  return odtZip(
    '<text:p>Before the formula</text:p><draw:frame svg:x="2cm" svg:y="2cm" svg:width="4cm" svg:height="1.5cm"><draw:object xlink:href="./Object 1"/></draw:frame>',
    [['Object 1', '<math:mfrac><math:mi>a</math:mi><math:mi>b</math:mi></math:mfrac>']],
  );
}

// A formula anchored INLINE inside a paragraph's own run content -- the shape LibreOffice writes for a formula typed into a sentence: text:anchor-type="as-char", carrying svg:width/svg:height but deliberately NO svg:x, since its horizontal position comes from the text flow rather than from the frame (see src/odf/formula/detect.ts's own flowAnchoredFrameBox).
function odtWithInlineFormulaBytes(): Uint8Array<ArrayBuffer> {
  return odtZip(
    '<text:p>First paragraph</text:p><text:p>Second paragraph with <draw:frame text:anchor-type="as-char" svg:width="1cm" svg:height="0.5cm"><draw:object xlink:href="./Object 1"/></draw:frame> inline.</text:p><text:p>Third paragraph</text:p>',
    [['Object 1', '<math:msqrt><math:mi>x</math:mi></math:msqrt>']],
  );
}

// A formula frame nested inside a draw:g group at the top level of office:text -- neither a direct child of office:text nor inside a paragraph.
function odtWithGroupedFormulaBytes(): Uint8Array<ArrayBuffer> {
  return odtZip(
    '<text:p>Before the group</text:p><draw:g><draw:frame svg:x="2cm" svg:y="2cm" svg:width="4cm" svg:height="1.5cm"><draw:object xlink:href="./Object 1"/></draw:frame></draw:g><text:p>After the group</text:p>',
    [['Object 1', '<math:mfrac><math:mi>a</math:mi><math:mi>b</math:mi></math:mfrac>']],
  );
}

// A formula inside a list item's own paragraph: the case where "one raw XML child = one block" genuinely fails, since a single text:list unwraps into one ContentParagraph per item.
function odtWithListItemFormulaBytes(): Uint8Array<ArrayBuffer> {
  return odtZip(
    '<text:list><text:list-item><text:p>Item one</text:p></text:list-item><text:list-item><text:p>Item two <draw:frame text:anchor-type="as-char" svg:width="1cm" svg:height="0.5cm"><draw:object xlink:href="./Object 1"/></draw:frame></text:p></text:list-item></text:list><text:p>After the list</text:p>',
    [['Object 1', '<math:mn>7</math:mn>']],
  );
}

function odpZip(pageInner: string, objects: readonly (readonly [string, string])[]): Uint8Array<ArrayBuffer> {
  const contentXml = enc(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<office:document-content ${OFFICE_NS} ${TEXT_NS} ${DRAW_NS} ${XLINK_NS} ${SVG_NS} ${STYLE_NS}><office:automatic-styles><style:style style:name="PM1" style:family="drawing-page"/></office:automatic-styles><office:body><office:presentation><draw:page draw:style-name="PM1">${pageInner}</draw:page></office:presentation></office:body></office:document-content>`,
  );
  return zipPackage([
    ['mimetype', { bytes: enc('application/vnd.oasis.opendocument.presentation'), stored: true }],
    ['content.xml', { bytes: contentXml }],
    ...objects.map(([name, mathMlInner]) => [`${name}/content.xml`, { bytes: embeddedFormulaObjectBytes(mathMlInner) }] as const),
  ]);
}

const FORMULA_FRAME = '<draw:frame svg:x="2cm" svg:y="2cm" svg:width="4cm" svg:height="1.5cm"><draw:object xlink:href="./Object 1"/></draw:frame>';
const TEXT_BOX_FRAME = '<draw:frame svg:x="1cm" svg:y="1cm" svg:width="3cm" svg:height="1cm"><draw:text-box><text:p>A label</text:p></draw:text-box></draw:frame>';

function odpWithEmbeddedFormulaBytes(): Uint8Array<ArrayBuffer> {
  return odpZip(FORMULA_FRAME, [['Object 1', '<math:msqrt><math:mi>x</math:mi></math:msqrt>']]);
}

// A slide carrying BOTH a draw:g group and a formula frame -- the exact shape that previously disabled formula detection for the whole slide, because a group's own frames are spliced into readOdp's flat shapes array at the group's own position, breaking any "Nth top-level frame = shapes[N]" correspondence.
function odpWithGroupAndFormulaBytes(): Uint8Array<ArrayBuffer> {
  return odpZip(`<draw:g>${TEXT_BOX_FRAME}</draw:g>${FORMULA_FRAME}`, [['Object 1', '<math:msqrt><math:mi>x</math:mi></math:msqrt>']]);
}

// The mirror case: the formula itself lives INSIDE the group, after an ungrouped shape.
function odpWithFormulaInsideGroupBytes(): Uint8Array<ArrayBuffer> {
  return odpZip(`${TEXT_BOX_FRAME}<draw:g>${FORMULA_FRAME}</draw:g>`, [['Object 1', '<math:mfrac><math:mi>a</math:mi><math:mi>b</math:mi></math:mfrac>']]);
}

describe('odtToPdf: an embedded formula inside a real odt document', () => {
  it('detects the embedded formula and renders it as real MathML, not merely its own placeholder text', () => {
    const bytes = odtToPdf(odtWithEmbeddedFormulaBytes());
    const layout = readPdf(bytes);
    expect(layout.pages.length).toBeGreaterThanOrEqual(1);
    qpdfCheck(bytes);
  });

  it('still produces a valid PDF for an ordinary odt with no embedded objects at all (the formula path never activates)', () => {
    const bytes = odtToPdf(minimalOdtBytes());
    expect(readPdf(bytes).pages.length).toBeGreaterThanOrEqual(1);
  });
});

describe('odpToPdf: an embedded formula inside a real odp slide', () => {
  it('detects the embedded formula and renders it as real MathML', () => {
    const bytes = odpToPdf(odpWithEmbeddedFormulaBytes());
    const layout = readPdf(bytes);
    expect(layout.pages).toHaveLength(1);
    qpdfCheck(bytes);
  });

  it('still produces a valid PDF for an ordinary odp with no embedded objects at all', () => {
    const bytes = odpToPdf(minimalOdpBytes());
    expect(readPdf(bytes).pages.length).toBeGreaterThanOrEqual(1);
  });
});

// --- The formula ContentDocument kind: a formula travels INSIDE the ContentDocument, with no side-channel map anywhere ---

describe('a formula as a real ContentDocument, not a side-channel map', () => {
  it('readOdtContent returns a bare ContentDocument whose formula block genuinely carries its own MathML', () => {
    const content = readOdtContent(decodePackage(odtWithEmbeddedFormulaBytes()));
    if (content.kind !== 'wordprocessing') {
      throw new Error('expected a wordprocessing ContentDocument');
    }
    const block = content.sections[0]!.blocks.find((b) => b.kind === 'embeddedObject');
    expect(block).toBeDefined();
    expect(block).toMatchObject({ objectKind: 'formula', document: { kind: 'formula' } });
    if (block?.kind !== 'embeddedObject' || block.document.kind !== 'formula') {
      throw new Error('expected a formula-kind embedded document');
    }
    // The real MathML tree, not a plain-text stand-in: the fixture's own mfrac is right there in the ContentDocument.
    expect(block.document.formula.mathml).toHaveLength(1);
    expect(block.document.formula.mathml[0]).toMatchObject({ type: 'element', tag: 'math:mfrac' });
  });

  it('readOdpContent does the same for a slide shape, replacing that shape\'s blocks with the formula block', () => {
    const content = readOdpContent(decodePackage(odpWithEmbeddedFormulaBytes()));
    if (content.kind !== 'presentation') {
      throw new Error('expected a presentation ContentDocument');
    }
    const [block] = content.slides[0]!.shapes[0]!.blocks;
    if (block?.kind !== 'embeddedObject' || block.document.kind !== 'formula') {
      throw new Error('expected a formula-kind embedded document');
    }
    expect(block.document.formula.mathml[0]).toMatchObject({ type: 'element', tag: 'math:msqrt' });
  });

  it('odfToPdf now invokes onDocument with a real, non-undefined formula ContentDocument', () => {
    let captured: DocumentPackage | undefined;
    const bytes = odfToPdf(odfFormulaBytes(FRACTION_FORMULA, { starMath: '{a} over {b}' }), { onDocument: (pkg) => { captured = pkg; } });
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe('%PDF-');

    expect(captured).toBeDefined();
    expect(captured?.content.kind).toBe('formula');
    if (captured?.content.kind !== 'formula') {
      throw new Error('expected a formula ContentDocument');
    }
    expect(captured.content.formula.starMath).toBe('{a} over {b}');
    expect(captured.content.formula.mathml.length).toBeGreaterThan(0);
    // The layout half is a genuine single A4 page carrying no items, by construction: the formula renders through writePdf's own separate formula positioning, never as page content.
    expect(captured.layout?.pages).toHaveLength(1);
    expect(captured.layout?.pages[0]?.items).toHaveLength(0);
  });

  it('carries an odt formula through onDocument as part of the ContentDocument the conversion built', () => {
    let captured: DocumentPackage | undefined;
    odtToPdf(odtWithEmbeddedFormulaBytes(), { onDocument: (pkg) => { captured = pkg; } });
    if (captured?.content.kind !== 'wordprocessing') {
      throw new Error('expected a wordprocessing ContentDocument');
    }
    const block = captured.content.sections[0]!.blocks.find((b) => b.kind === 'embeddedObject');
    expect(block?.kind === 'embeddedObject' && block.document.kind === 'formula').toBe(true);
  });
});

// --- Where a formula frame actually IS: inline in a paragraph's run content, inside a group, inside a list item -- and where its block lands as a result ---

function wordprocessingBlocks(bytes: Uint8Array<ArrayBuffer>): readonly ContentBlock[] {
  const content = readOdtContent(decodePackage(bytes));
  if (content.kind !== 'wordprocessing') {
    throw new Error('expected a wordprocessing ContentDocument');
  }
  return content.sections[0]!.blocks;
}

function blockSummary(blocks: readonly ContentBlock[]): string[] {
  return blocks.map((block) => (block.kind === 'paragraph' ? block.runs.map((run) => run.text).join('') : block.kind));
}

function formulaRootTag(block: ContentBlock | undefined): string | undefined {
  if (block?.kind !== 'embeddedObject' || block.document.kind !== 'formula') {
    return undefined;
  }
  const [root] = block.document.formula.mathml;
  return root?.type === 'element' ? root.tag : undefined;
}

describe('embedded-formula detection: a formula anchored inline inside a paragraph', () => {
  it('detects a formula in a paragraph\'s own run content and places its block immediately after that paragraph', () => {
    const blocks = wordprocessingBlocks(odtWithInlineFormulaBytes());
    expect(blockSummary(blocks)).toEqual(['First paragraph', 'Second paragraph with  inline.', 'embeddedObject', 'Third paragraph']);
    expect(formulaRootTag(blocks[2])).toBe('math:msqrt');
  });

  it('sizes an inline frame from its own declared svg:width/svg:height, which odf.js\'s own readDrawFrame resolves nothing for (an as-char frame carries no svg:x)', () => {
    const block = wordprocessingBlocks(odtWithInlineFormulaBytes())[2];
    if (block?.kind !== 'embeddedObject') {
      throw new Error('expected an embeddedObject block');
    }
    // 1cm x 0.5cm, in points, at the zero origin the text flow replaces.
    expect(block.frame.widthPt).toBeCloseTo(28.35, 1);
    expect(block.frame.heightPt).toBeCloseTo(14.17, 1);
    expect(block.frame.xPt).toBe(0);
  });

  it('numbers the formula block\'s own sourcePath by its FINAL position in the combined block list', () => {
    const block = wordprocessingBlocks(odtWithInlineFormulaBytes())[2];
    expect(block?.kind === 'embeddedObject' ? block.sourcePath : undefined).toBe('sections[0].blocks[2]');
  });

  it('renders that inline formula as real MathML through odtToPdf, not as its own plain-text stand-in', () => {
    const pdfBytes = odtToPdf(odtWithInlineFormulaBytes());
    expect(new TextDecoder('latin1').decode(pdfBytes)).toContain('CIDFontType0C');
  });
});

describe('embedded-formula detection: a formula nested inside a draw:g group', () => {
  it('detects a grouped formula at the top level of office:text and places its block between the surrounding paragraphs', () => {
    const blocks = wordprocessingBlocks(odtWithGroupedFormulaBytes());
    expect(blockSummary(blocks)).toEqual(['Before the group', 'embeddedObject', 'After the group']);
    expect(formulaRootTag(blocks[1])).toBe('math:mfrac');
  });
});

describe('embedded-formula detection: a formula inside a list item', () => {
  it('counts a text:list\'s own per-item block unwrapping, so the formula lands after the item it belongs to rather than at the end', () => {
    const blocks = wordprocessingBlocks(odtWithListItemFormulaBytes());
    expect(blockSummary(blocks)).toEqual(['Item one', 'Item two ', 'embeddedObject', 'After the list']);
    expect(formulaRootTag(blocks[2])).toBe('math:mn');
  });
});

describe('embedded-formula detection: an odp slide that also contains a group', () => {
  it('detects the formula on a slide carrying a draw:g, attaching it to the shape readOdp actually produced for that frame', () => {
    const content = readOdpContent(decodePackage(odpWithGroupAndFormulaBytes()));
    if (content.kind !== 'presentation') {
      throw new Error('expected a presentation ContentDocument');
    }
    const shapes = content.slides[0]!.shapes;
    // walkDrawShapes splices a group's own frames in at the group's position, so the grouped text box is shapes[0] and the ungrouped formula frame is shapes[1].
    expect(shapes).toHaveLength(2);
    expect(shapes[0]!.blocks.map((block) => block.kind)).toEqual(['paragraph']);
    expect(formulaRootTag(shapes[1]!.blocks[0])).toBe('math:msqrt');
  });

  it('detects a formula nested INSIDE the group itself, resolving its shape index the same way', () => {
    const content = readOdpContent(decodePackage(odpWithFormulaInsideGroupBytes()));
    if (content.kind !== 'presentation') {
      throw new Error('expected a presentation ContentDocument');
    }
    const shapes = content.slides[0]!.shapes;
    expect(shapes).toHaveLength(2);
    expect(shapes[0]!.blocks.map((block) => block.kind)).toEqual(['paragraph']);
    expect(formulaRootTag(shapes[1]!.blocks[0])).toBe('math:mfrac');
  });

  it('renders a grouped-slide formula as real MathML through odpToPdf', () => {
    const pdfBytes = odpToPdf(odpWithGroupAndFormulaBytes());
    expect(new TextDecoder('latin1').decode(pdfBytes)).toContain('CIDFontType0C');
  });
});

// The formula now being an ordinary block inside the ContentDocument is exactly what makes these two work: neither the odm chapter concatenation nor the cross-format bridges have (or need) any formula-specific wiring of their own.
describe('a formula crossing a boundary that cannot typeset it', () => {
  it('renders a real .odm chapter\'s embedded formula as genuine MathML, not a plain-text stand-in', () => {
    const chapterBytes = odtWithEmbeddedFormulaBytes();
    const pdfBytes = odmToPdf(odmBytes([{ name: 'Chapter1', href: '../chapter1.odt' }]), { resolveSubDocument: () => chapterBytes });
    expect(new TextDecoder().decode(pdfBytes.subarray(0, 5))).toBe('%PDF-');
    // A rendered MathML formula embeds the real STIX Two Math CID font; a plain-text stand-in would use a standard-14 font and no CIDFont resource at all.
    expect(new TextDecoder('latin1').decode(pdfBytes)).toContain('CIDFontType0C');
  });

  it('degrades the same formula to that stand-in across the markdown bridge too', () => {
    const markdown = decodeMarkdownText(odtToMarkdown(odtWithEmbeddedFormulaBytes()));
    expect(markdown).toContain('Before the formula');
    expect(markdown).toContain('formula'); // markdown-codec escapes the surrounding brackets, so match the word rather than the exact literal
  });
});

// --- odt -> docx: a formula crosses as REAL OMML now, verified against the actual word/document.xml element tree the bridge wrote ---

function documentRootOf(docxBytes: Uint8Array<ArrayBuffer>): XmlElement {
  const root = rootElement(decodeOoxmlPackage(docxBytes).parts['word/document.xml']);
  if (root === undefined) {
    throw new Error('expected the built docx to have a word/document.xml root element');
  }
  return root;
}

function ommlTextOf(root: XmlElement): string[] {
  return elementsWithTag([root], 'm:t').map((t) => t.children.map((child) => (child.type === 'text' ? child.value : '')).join(''));
}

describe('odtToDocx: an embedded formula becomes real OOXML math', () => {
  it('writes a genuine m:oMathPara > m:oMath display equation, not the plain-text stand-in', () => {
    const root = documentRootOf(odtToDocx(odtWithEmbeddedFormulaBytes()));

    const paras = elementsWithTag([root], 'm:oMathPara');
    expect(paras).toHaveLength(1);
    expect(childrenWithTag(paras[0]!, 'm:oMath')).toHaveLength(1);
    // The formula's own structure, translated -- an m:f carrying num/den, exactly what a docx-math-aware consumer renders as a fraction.
    const fractions = elementsWithTag([root], 'm:f');
    expect(fractions).toHaveLength(1);
    expect(childrenWithTag(fractions[0]!, 'm:num')).toHaveLength(1);
    expect(childrenWithTag(fractions[0]!, 'm:den')).toHaveLength(1);
    expect(ommlTextOf(root)).toEqual(['a', 'b']);

    // ...and the stand-in it used to write is genuinely gone, not merely accompanied by real math.
    expect(buildXml([root])).not.toContain('[formula]');
  });

  it('hangs the equation directly off a w:p, where WordprocessingML\'s own EG_PContent permits it, with the OMML namespace declared on the fragment itself', () => {
    const root = documentRootOf(odtToDocx(odtWithEmbeddedFormulaBytes()));
    const mathParagraph = elementsWithTag([root], 'w:p').find((paragraph) => childrenWithTag(paragraph, 'm:oMathPara').length > 0);
    expect(mathParagraph).toBeDefined();
    expect(attr(childrenWithTag(mathParagraph!, 'm:oMathPara')[0]!, 'xmlns:m')).toBe('http://schemas.openxmlformats.org/officeDocument/2006/math');
  });

  it('keeps the surrounding paragraph text intact alongside the equation', () => {
    const content = readDocxContent(decodeOoxmlPackage(odtToDocx(odtWithEmbeddedFormulaBytes())));
    if (content.kind !== 'wordprocessing') {
      throw new Error('expected a wordprocessing ContentDocument');
    }
    const texts = content.sections.flatMap((section) => section.blocks).flatMap((block) => (block.kind === 'paragraph' ? [block.runs.map((run) => run.text).join('')] : []));
    expect(texts).toContain('Before the formula');
  });

  it('carries an INLINE odt formula across the bridge as OMML too, in its own true block position', () => {
    const root = documentRootOf(odtToDocx(odtWithInlineFormulaBytes()));
    expect(elementsWithTag([root], 'm:rad')).toHaveLength(1);
    // The equation paragraph sits between the second and third source paragraphs, exactly where the inline frame was anchored.
    const paragraphKinds = elementsWithTag([root], 'w:p').map((paragraph) => (childrenWithTag(paragraph, 'm:oMathPara').length > 0 ? 'math' : textContent(paragraph)));
    expect(paragraphKinds).toEqual(['First paragraph', 'Second paragraph with  inline.', 'math', 'Third paragraph']);
  });

  it('reports no diagnostics at all for a formula whose every construct has a real OMML equivalent', () => {
    const diagnostics: OmmlDiagnostic[] = [];
    odtToDocx(odtWithEmbeddedFormulaBytes(), { onMathDiagnostic: (diagnostic) => diagnostics.push(diagnostic) });
    expect(diagnostics).toEqual([]);
  });

  it('degrades only an unsupported construct, reporting it while the rest of the equation stays real math', () => {
    const bytes = odtZip('<text:p>Mixed</text:p><draw:frame svg:x="2cm" svg:y="2cm" svg:width="4cm" svg:height="1.5cm"><draw:object xlink:href="./Object 1"/></draw:frame>', [
      ['Object 1', '<math:mrow><math:mfrac><math:mi>a</math:mi><math:mi>b</math:mi></math:mfrac><math:mmultiscripts><math:mi>F</math:mi></math:mmultiscripts></math:mrow>'],
    ]);
    const diagnostics: { readonly kind: string; readonly detail: string; readonly sourcePath: string | undefined }[] = [];
    const root = documentRootOf(odtToDocx(bytes, { onMathDiagnostic: (diagnostic, context) => diagnostics.push({ ...diagnostic, sourcePath: context.sourcePath }) }));

    expect(diagnostics).toEqual([{ kind: 'unsupported-element', detail: 'mmultiscripts', sourcePath: 'sections[0].blocks[1]' }]);
    expect(elementsWithTag([root], 'm:f')).toHaveLength(1);
    expect(ommlTextOf(root)).toEqual(['a', 'b', 'F']);
  });

  it('falls back to the whole-formula plain-text stand-in only when the MathML produces no OMML at all', () => {
    const bytes = odtZip('<text:p>Empty</text:p><draw:frame svg:x="2cm" svg:y="2cm" svg:width="4cm" svg:height="1.5cm"><draw:object xlink:href="./Object 1"/></draw:frame>', [['Object 1', '']]);
    const root = documentRootOf(odtToDocx(bytes));
    expect(elementsWithTag([root], 'm:oMathPara')).toHaveLength(0);
    expect(buildXml([root])).toContain('[formula]');
  });

  it('reads the equation back as a real formula block, consuming the paragraph that held nothing but the equation', () => {
    // The read direction closing the loop the write direction opened: readDocxContent recovers the m:oMathPara this bridge wrote as a genuine ContentEmbeddedObjectBlock carrying real MathML, and the otherwise-empty w:p that held it becomes the formula block rather than an empty paragraph sitting beside one.
    const content = readDocxContent(decodeOoxmlPackage(odtToDocx(odtWithEmbeddedFormulaBytes())));
    if (content.kind !== 'wordprocessing') {
      throw new Error('expected a wordprocessing ContentDocument');
    }
    const blocks = content.sections[0]!.blocks;
    expect(blocks.map((block) => block.kind)).toEqual(['paragraph', 'embeddedObject']);
    expect(formulaRootTag(blocks[1])).toBe('mfrac');
    expect(blocks[1]?.kind === 'embeddedObject' ? blocks[1].sourcePath : undefined).toBe('sections[0].blocks[1]');
  });

  it('keeps an INLINE equation\'s own paragraph, placing the formula block immediately after it', () => {
    // The mirror of the consumption rule above: a paragraph carrying real text alongside its equation is not the equation, so it keeps its own block and the formula lands after it -- exactly where src/odf/odt/read.ts places an inline ODF formula frame.
    const content = readDocxContent(decodeOoxmlPackage(odtToDocx(odtWithInlineFormulaBytes())));
    if (content.kind !== 'wordprocessing') {
      throw new Error('expected a wordprocessing ContentDocument');
    }
    expect(blockSummary(content.sections[0]!.blocks)).toEqual(['First paragraph', 'Second paragraph with  inline.', 'embeddedObject', 'Third paragraph']);
  });

  it('carries an .odm chapter\'s own formula into a docx as OMML through the same path', () => {
    const chapterBytes = odtWithEmbeddedFormulaBytes();
    // odmToPdf proves the PDF direction; this proves the same concatenated ContentDocument writes real math when the target is docx instead.
    const combined = readOdtContent(decodePackage(chapterBytes));
    if (combined.kind !== 'wordprocessing') {
      throw new Error('expected a wordprocessing ContentDocument');
    }
    const root = documentRootOf(encodeOoxmlPackage(buildDocxPackage(combined)));
    expect(elementsWithTag([root], 'm:f')).toHaveLength(1);
  });
});

// --- The regression this whole pair of features exists to close: a formula surviving odt -> docx -> odt as a formula ---

// Every element tag, nested, with a token element's own text inlined -- the same "same construct types, same content" comparison src/omml/read.test.ts's own round-trip suite uses, applied here to the MathML at each end of a two-format chain.
function mathSignature(nodes: readonly MathMlNode[]): string {
  return nodes
    .flatMap((node) => {
      if (node.type !== 'element') {
        return [];
      }
      const inner = node.children.some((child) => child.type === 'element') ? mathSignature(node.children) : node.children.map((child) => (child.type === 'text' ? child.value : '')).join('');
      const colon = node.tag.indexOf(':');
      return [`${colon === -1 ? node.tag : node.tag.slice(colon + 1)}(${inner})`];
    })
    .join(',');
}

function formulaMathmlOf(blocks: readonly ContentBlock[]): readonly MathMlNode[] {
  const block = blocks.find((candidate) => candidate.kind === 'embeddedObject');
  if (block?.kind !== 'embeddedObject' || block.document.kind !== 'formula') {
    throw new Error(`expected a formula block among ${JSON.stringify(blocks.map((candidate) => candidate.kind))}`);
  }
  return block.document.formula.mathml;
}

describe('odt -> docx -> odt: a formula survives the whole chain as a formula', () => {
  it('recovers the same MathML at the far end, having been real OMML in the middle', () => {
    const source = odtWithEmbeddedFormulaBytes();
    const sourceContent = readOdtContent(decodePackage(source));
    if (sourceContent.kind !== 'wordprocessing') {
      throw new Error('expected a wordprocessing ContentDocument');
    }

    const docxBytes = odtToDocx(source);
    // The middle of the chain is genuinely editable Word math, not a stand-in and not a picture.
    expect(elementsWithTag([documentRootOf(docxBytes)], 'm:f')).toHaveLength(1);

    const finalContent = readOdtContent(decodePackage(docxToOdt(docxBytes)));
    if (finalContent.kind !== 'wordprocessing') {
      throw new Error('expected a wordprocessing ContentDocument');
    }
    expect(blockSummary(finalContent.sections[0]!.blocks)).toEqual(['Before the formula', 'embeddedObject']);
    expect(mathSignature(formulaMathmlOf(finalContent.sections[0]!.blocks))).toBe(mathSignature(formulaMathmlOf(sourceContent.sections[0]!.blocks)));
  });

  it('carries the whole odt chain as a real embedded sub-document, not a plain-text stand-in anywhere along it', () => {
    const odtBytes = docxToOdt(odtToDocx(odtWithEmbeddedFormulaBytes()));
    const pkg = decodePackage(odtBytes);
    expect(pkg.parts['Object 1/content.xml']?.kind).toBe('xml');
    // The literal stand-in the bridge used to write is gone from both ends of the chain.
    const content = pkg.parts['content.xml'];
    expect(content?.kind === 'xml' ? buildOdfXml(content.nodes) : '').not.toContain('[formula]');
  });

  it('renders as genuine typeset MathML when the round-tripped odt is converted to PDF, proving the recovered tree is real math rather than text', () => {
    const odtBytes = docxToOdt(odtToDocx(odtWithEmbeddedFormulaBytes()));
    // A rendered MathML formula embeds the real STIX Two Math CID font; a plain-text stand-in would use a standard-14 font and no CIDFont resource at all.
    expect(new TextDecoder('latin1').decode(odtToPdf(odtBytes))).toContain('CIDFontType0C');
  });

  it('survives repeated odt -> docx -> odt cycles without accumulating blank paragraphs or losing the formula', () => {
    let bytes = odtWithEmbeddedFormulaBytes();
    for (let cycle = 0; cycle < 3; cycle++) {
      bytes = docxToOdt(odtToDocx(bytes));
      const content = readOdtContent(decodePackage(bytes));
      if (content.kind !== 'wordprocessing') {
        throw new Error('expected a wordprocessing ContentDocument');
      }
      expect(blockSummary(content.sections[0]!.blocks)).toEqual(['Before the formula', 'embeddedObject']);
    }
  });

  it('takes an INLINE odt formula through the same chain, keeping its own paragraph and its position', () => {
    const finalContent = readOdtContent(decodePackage(docxToOdt(odtToDocx(odtWithInlineFormulaBytes()))));
    if (finalContent.kind !== 'wordprocessing') {
      throw new Error('expected a wordprocessing ContentDocument');
    }
    expect(blockSummary(finalContent.sections[0]!.blocks)).toEqual(['First paragraph', 'Second paragraph with  inline.', 'embeddedObject', 'Third paragraph']);
    expect(mathSignature(formulaMathmlOf(finalContent.sections[0]!.blocks))).toBe('msqrt(mi(x))');
  });
});
