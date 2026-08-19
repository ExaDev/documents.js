import type { ContentDocument, ContentVector } from 'document-schema.js';

import type { Package as OdfPackage, XmlElement as OdfXmlElement } from 'odf.js';
import { childrenWithTag, decodePackage as decodeOdfPackage, encodePackage as encodeOdfPackage, findChildElement, readDrawPageContent, rootElement as odfRootElement, zipPackage as zipOdfPackage } from 'odf.js';
import type { XmlElement } from 'ooxml.js';
import { decodePackage as decodeOoxmlPackage, rootElement, zipPackage as zipOoxmlPackage } from 'ooxml.js';
import { describe, expect, it } from 'vitest';
import { buildOdpPackage } from '../edit/odp/content';
import { buildOdtPackage } from '../edit/odt/content';
import { readOdpContent } from '../odf/odp/read';
import { readOdtContent } from '../odf/odt/read';
import { readDocxContent } from '../ooxml/docx/read';
import { readPptxContent } from '../ooxml/pptx/read';
import { collectDrawingMlVectors } from '../test-support/drawingml-vector';
import { minimalOdgBytes } from '../test-support/odg';
import { VECTOR_FIXTURE, vectorDrawingBlock } from '../test-support/vectors';
import { docxToOdt, odgToPdf, odpToPptx, odtToDocx, pdfToDocx, pdfToOdp, pdfToOdt, pdfToPptx, pptxToOdp } from './convert';

// End-to-end proof that a page's painted geometry survives all the way from a real file, through PDF, into each of the four wordprocessing/presentation targets as real vector shapes -- not just that each builder writes markup when handed a drawing block (src/edit/{docx,pptx,odt,odp}/content.test.ts prove that in isolation) but that the recovery and the writing actually meet.
//
// The source is this package's own ground-truth .odg fixture (src/test-support/odg.ts: hand-authored XML, never built through this package's own editor), whose page carries three rects, an ellipse, a line, a genuinely curved path taken verbatim from real LibreOffice output, and a text frame. odgToPdf paints all of it; readPdf's own shape-pattern detection classifies it back; reconstructWordprocessing/reconstructPresentation package it as an embedded drawing block; and each builder writes it out.

const SOURCE_PDF = odgToPdf(minimalOdgBytes());

// Every vector kind the fixture's own page paints, in paint order -- the rects first (two overlapping, then a third), then the ellipse, the line, and the curve. The text frame is not a vector and is recovered as ordinary text content instead.
const EXPECTED_KINDS: readonly ContentVector['kind'][] = ['rect', 'rect', 'rect', 'ellipse', 'line', 'path'];

function ooxmlPart(bytes: Uint8Array<ArrayBuffer>, path: string): XmlElement {
  const root = rootElement(decodeOoxmlPackage(bytes).parts[path]);
  if (root === undefined) {
    throw new Error(`expected a root element at ${path}`);
  }
  return root;
}

function odfContentRoot(pkg: OdfPackage): OdfXmlElement {
  const part = pkg.parts['content.xml'];
  const root = part?.kind === 'xml' ? odfRootElement(part.nodes) : undefined;
  if (root === undefined) {
    throw new Error('expected an xml content.xml part with a root element');
  }
  return root;
}

function odfBodyChild(pkg: OdfPackage, tag: string): OdfXmlElement {
  const body = findChildElement(odfContentRoot(pkg).children, 'office:body');
  const child = body === undefined ? undefined : findChildElement(body.children, tag);
  if (child === undefined) {
    throw new Error(`expected an office:body/${tag} element`);
  }
  return child;
}

describe('recovered vector geometry reaching real output bytes', () => {
  it('pdfToDocx writes every recovered vector as a real DrawingML shape', () => {
    expect(collectDrawingMlVectors(ooxmlPart(pdfToDocx(SOURCE_PDF), 'word/document.xml'), 'wps:spPr').map((vector) => vector.kind)).toEqual(EXPECTED_KINDS);
  });

  it('pdfToPptx writes every recovered vector as a real DrawingML shape', () => {
    expect(collectDrawingMlVectors(ooxmlPart(pdfToPptx(SOURCE_PDF), 'ppt/slides/slide1.xml'), 'p:spPr').map((vector) => vector.kind)).toEqual(EXPECTED_KINDS);
  });

  // Read back through odf.js's OWN readDrawPageContent, the same reader readOdgContent uses for a real drawing page -- a genuinely independent oracle, unlike the DrawingML side, whose reader is written alongside this package's writer.
  it('pdfToOdt writes every recovered vector as a real draw: primitive anchored in the text flow', () => {
    const pkg = decodeOdfPackage(pdfToOdt(SOURCE_PDF));
    const vectors = childrenWithTag(odfBodyChild(pkg, 'office:text'), 'text:p').flatMap((paragraph) => readDrawPageContent(paragraph.children, pkg).vectors);
    expect(vectors.map((vector) => vector.kind)).toEqual(EXPECTED_KINDS);
  });

  it('pdfToOdp writes every recovered vector as a real draw: primitive on the slide page', () => {
    const pkg = decodeOdfPackage(pdfToOdp(SOURCE_PDF));
    const [page] = childrenWithTag(odfBodyChild(pkg, 'office:presentation'), 'draw:page');
    if (page === undefined) {
      throw new Error('expected a draw:page element');
    }
    expect(readDrawPageContent(page.children, pkg).vectors.map((vector) => vector.kind)).toEqual(EXPECTED_KINDS);
  });

  // The curve is the one piece a naive writer would quietly flatten: it has to reach the output as a real cubic segment, in both vocabularies.
  it('keeps the curved path curved in both vocabularies, rather than approximating it with line segments', () => {
    const drawingMlPath = collectDrawingMlVectors(ooxmlPart(pdfToPptx(SOURCE_PDF), 'ppt/slides/slide1.xml'), 'p:spPr').find((vector) => vector.kind === 'path');
    expect(drawingMlPath?.kind === 'path' && drawingMlPath.subpaths.some((subpath) => subpath.segments.some((segment) => segment.kind === 'cubic'))).toBe(true);

    const pkg = decodeOdfPackage(pdfToOdp(SOURCE_PDF));
    const [page] = childrenWithTag(odfBodyChild(pkg, 'office:presentation'), 'draw:page');
    if (page === undefined) {
      throw new Error('expected a draw:page element');
    }
    const odfPath = readDrawPageContent(page.children, pkg).vectors.find((vector) => vector.kind === 'path');
    expect(odfPath?.kind === 'path' && odfPath.subpaths.some((subpath) => subpath.segments.some((segment) => segment.kind === 'cubic'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Reader-side vector/drawing round-trip: hand-authored fixtures, never built through this package's own writer, proving detection against independently-plausible raw markup rather than merely round-tripping this package's own output back through itself (which src/edit/{docx,pptx,odt,odp}/content.test.ts already do).
// ---------------------------------------------------------------------------

function enc(s: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(s);
}

describe('readDocxContent: a hand-authored vector-only w:drawing', () => {
  const CONTENT_TYPES_XML = enc(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
  );
  const ROOT_RELS_XML = enc(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  const DOCUMENT_RELS_XML = enc(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
  );
  const STYLES_XML = enc(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>',
  );

  // The wps:spPr's own a:xfrm deliberately DISAGREES with the wrapping wp:anchor's own wp:positionH/wp:positionV -- a real producer's wps:wsp always mirrors the anchor's position, but nothing in the schema requires it to, and the anchor is the one place a page-absolute recovered coordinate genuinely lives (see src/ooxml/docx/vector.ts's own readDrawingMlVector doc comment). The recovered vector's frame must come from the ANCHOR (100pt, 50pt, 40pt x 30pt), never from spPr's own wildly different xfrm (500pt, 500pt, 10pt x 10pt).
  function documentXml(): Uint8Array<ArrayBuffer> {
    return enc(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        '<w:body>' +
        '<w:p><w:r>' +
        '<w:drawing xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">' +
        '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="1" behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1">' +
        '<wp:simplePos x="0" y="0"/>' +
        '<wp:positionH relativeFrom="page"><wp:posOffset>1270000</wp:posOffset></wp:positionH>' +
        '<wp:positionV relativeFrom="page"><wp:posOffset>635000</wp:posOffset></wp:positionV>' +
        '<wp:extent cx="508000" cy="381000"/>' +
        '<wp:effectExtent l="0" t="0" r="0" b="0"/>' +
        '<wp:wrapNone/>' +
        '<wp:docPr id="1" name="Rect 1"/>' +
        '<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">' +
        '<wps:wsp><wps:cNvSpPr/><wps:spPr>' +
        '<a:xfrm><a:off x="6350000" y="6350000"/><a:ext cx="127000" cy="127000"/></a:xfrm>' +
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
        '<a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>' +
        '<a:ln><a:noFill/></a:ln>' +
        '</wps:spPr><wps:bodyPr/></wps:wsp>' +
        '</a:graphicData></a:graphic>' +
        '</wp:anchor></w:drawing>' +
        '</w:r></w:p>' +
        '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>' +
        '</w:body></w:document>',
    );
  }

  function docxBytes(): Uint8Array<ArrayBuffer> {
    return zipOoxmlPackage({
      '[Content_Types].xml': CONTENT_TYPES_XML,
      '_rels/.rels': ROOT_RELS_XML,
      'word/document.xml': documentXml(),
      'word/_rels/document.xml.rels': DOCUMENT_RELS_XML,
      'word/styles.xml': STYLES_XML,
    });
  }

  it('recovers the rect at the anchor\'s own position, not spPr\'s own disagreeing a:xfrm', () => {
    const content = readDocxContent(decodeOoxmlPackage(docxBytes()));
    if (content.kind !== 'wordprocessing') {
      throw new Error('expected a wordprocessing ContentDocument');
    }
    const [block] = content.sections[0]!.blocks;
    if (block?.kind !== 'embeddedObject' || block.document.kind !== 'drawing') {
      throw new Error('expected a drawing-kind embeddedObject block');
    }
    const [vector] = block.document.pages[0]!.vectors;
    expect(vector).toMatchObject({ kind: 'rect', frame: { xPt: 100, yPt: 50, widthPt: 40, heightPt: 30 }, fill: { r: 1, g: 0, b: 0 } });
  });
});

describe('readPptxContent: a hand-authored slide mixing a vector shape, a connector, and a group', () => {
  const CONTENT_TYPES_XML = enc(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>',
  );
  const ROOT_RELS_XML = enc(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>',
  );
  const PRESENTATION_XML = enc(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst><p:sldSz cx="9144000" cy="6858000"/></p:presentation>',
  );
  const PRESENTATION_RELS_XML = enc(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>',
  );
  // A real slide's own shape tree: an ordinary text shape (shapes[0]), a connector (p:cxnSp -- occupies no shape slot at all, so it must not shift shapes[1]'s own index), a bare vector p:sp (shapes[1]), a SECOND ordinary text shape (shapes[2] -- deliberately separating the two vectors, so they do NOT collapse into one maximal run), and a p:grpSp wrapping a third vector p:sp (shapes[3], flattened out of the group exactly as readPptxContent itself flattens it).
  const SLIDE1_XML = enc(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
      '<p:cSld><p:spTree>' +
      '<p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:t>Title</a:t></a:r></a:p></p:txBody></p:sp>' +
      '<p:cxnSp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm></p:spPr></p:cxnSp>' +
      '<p:sp><p:spPr><a:xfrm><a:off x="914400" y="914400"/><a:ext cx="457200" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="00FF00"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr></p:sp>' +
      '<p:sp><p:spPr><a:xfrm><a:off x="2743200" y="914400"/><a:ext cx="914400" cy="914400"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:t>Middle</a:t></a:r></a:p></p:txBody></p:sp>' +
      '<p:grpSp><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="9144000" cy="6858000"/><a:chOff x="0" y="0"/><a:chExt cx="9144000" cy="6858000"/></a:xfrm></p:grpSpPr>' +
      '<p:sp><p:spPr><a:xfrm><a:off x="1828800" y="1828800"/><a:ext cx="457200" cy="457200"/></a:xfrm><a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="0000FF"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr></p:sp>' +
      '</p:grpSp>' +
      '</p:spTree></p:cSld></p:sld>',
  );

  function pptxBytes(): Uint8Array<ArrayBuffer> {
    return zipOoxmlPackage({
      '[Content_Types].xml': CONTENT_TYPES_XML,
      '_rels/.rels': ROOT_RELS_XML,
      'ppt/presentation.xml': PRESENTATION_XML,
      'ppt/_rels/presentation.xml.rels': PRESENTATION_RELS_XML,
      'ppt/slides/slide1.xml': SLIDE1_XML,
    });
  }

  it('recovers the two vector shapes as their own drawing blocks, skipping the connector and flattening the group', () => {
    const content = readPptxContent(decodeOoxmlPackage(pptxBytes()));
    if (content.kind !== 'presentation') {
      throw new Error('expected a presentation ContentDocument');
    }
    const shapes = content.slides[0]!.shapes;
    expect(shapes).toHaveLength(4);
    expect(shapes[0]?.blocks[0]).toMatchObject({ kind: 'paragraph', runs: [{ text: 'Title' }] });
    const rectBlock = shapes[1]?.blocks[0];
    if (rectBlock?.kind !== 'embeddedObject' || rectBlock.document.kind !== 'drawing') {
      throw new Error('expected the second shape to be a drawing-kind embeddedObject block (the connector occupies no slot)');
    }
    expect(rectBlock.document.pages[0]!.vectors).toMatchObject([{ kind: 'rect', fill: { r: 0, g: 1, b: 0 } }]);
    expect(shapes[2]?.blocks[0]).toMatchObject({ kind: 'paragraph', runs: [{ text: 'Middle' }] });
    const ellipseBlock = shapes[3]?.blocks[0];
    if (ellipseBlock?.kind !== 'embeddedObject' || ellipseBlock.document.kind !== 'drawing') {
      throw new Error('expected the fourth shape (the group\'s own vector, flattened out) to be a drawing-kind embeddedObject block');
    }
    expect(ellipseBlock.document.pages[0]!.vectors).toMatchObject([{ kind: 'ellipse', fill: { r: 0, g: 0, b: 1 } }]);
  });
});

describe('readOdtContent: a hand-authored bare draw:rect sitting directly in office:text', () => {
  const OFFICE_NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"';
  const TEXT_NS = 'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"';
  const DRAW_NS = 'xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"';
  const SVG_NS = 'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"';
  const STYLE_NS = 'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"';

  // A draw:rect written directly as a sibling of text:p at office:text level -- not wrapped in any paragraph the way this package's own OdtBody.appendVectors writes one, proving detection reaches a vector that a THIRD-PARTY producer might place completely bare.
  function odtBytes(): Uint8Array<ArrayBuffer> {
    const contentXml = enc(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<office:document-content ${OFFICE_NS} ${TEXT_NS} ${DRAW_NS} ${SVG_NS} ${STYLE_NS}>` +
        '<office:automatic-styles><style:style style:name="gr1" style:family="graphic"><style:graphic-properties draw:fill="solid" draw:fill-color="#00FF00"/></style:style></office:automatic-styles>' +
        '<office:body><office:text>' +
        '<text:p>Before</text:p>' +
        '<draw:rect svg:x="1cm" svg:y="1cm" svg:width="2cm" svg:height="1cm" draw:style-name="gr1"/>' +
        '<text:p>After</text:p>' +
        '</office:text></office:body></office:document-content>',
    );
    return zipOdfPackage([
      ['mimetype', { bytes: enc('application/vnd.oasis.opendocument.text'), stored: true }],
      ['content.xml', { bytes: contentXml }],
    ]);
  }

  it('recovers the bare rect as a drawing block, between the two real paragraphs', () => {
    const content = readOdtContent(decodeOdfPackage(odtBytes()));
    if (content.kind !== 'wordprocessing') {
      throw new Error('expected a wordprocessing ContentDocument');
    }
    const blocks = content.sections[0]!.blocks;
    expect(blocks.map((block) => block.kind)).toEqual(['paragraph', 'embeddedObject', 'paragraph']);
    const drawingBlock = blocks[1];
    if (drawingBlock?.kind !== 'embeddedObject' || drawingBlock.document.kind !== 'drawing') {
      throw new Error('expected a drawing-kind embeddedObject block');
    }
    expect(drawingBlock.document.pages[0]!.vectors).toMatchObject([{ kind: 'rect', fill: { r: 0, g: 1, b: 0 } }]);
  });
});

describe('readOdpContent: a hand-authored slide interleaving a real shape and a bare vector', () => {
  const OFFICE_NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"';
  const TEXT_NS = 'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"';
  const DRAW_NS = 'xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"';
  const SVG_NS = 'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"';
  const STYLE_NS = 'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"';

  // A slide carrying a real draw:frame text box (occupying slide.shapes[0]) followed by a bare draw:rect (a genuine vector primitive, occupying no shape slot at all) -- proving the vector inserts AFTER the real shape rather than always at the end, and confirming (per this module's own dedicated correspondence test below) that odf.js's own readOdpContent and readDrawPageContent agree on where shapes[0] sits.
  function odpBytes(): Uint8Array<ArrayBuffer> {
    const contentXml = enc(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<office:document-content ${OFFICE_NS} ${TEXT_NS} ${DRAW_NS} ${SVG_NS} ${STYLE_NS}>` +
        '<office:automatic-styles>' +
        '<style:style style:name="PM1" style:family="drawing-page"/>' +
        '<style:style style:name="gr1" style:family="graphic"><style:graphic-properties draw:fill="solid" draw:fill-color="#0000FF"/></style:style>' +
        '</office:automatic-styles>' +
        '<office:body><office:presentation><draw:page draw:style-name="PM1">' +
        '<draw:frame svg:x="1cm" svg:y="1cm" svg:width="4cm" svg:height="2cm"><draw:text-box><text:p>A label</text:p></draw:text-box></draw:frame>' +
        '<draw:rect svg:x="6cm" svg:y="6cm" svg:width="3cm" svg:height="2cm" draw:style-name="gr1"/>' +
        '</draw:page></office:presentation></office:body></office:document-content>',
    );
    return zipOdfPackage([
      ['mimetype', { bytes: enc('application/vnd.oasis.opendocument.presentation'), stored: true }],
      ['content.xml', { bytes: contentXml }],
    ]);
  }

  it('recovers the bare rect as a second, synthetic shape after the real text-box shape', () => {
    const content = readOdpContent(decodeOdfPackage(odpBytes()));
    if (content.kind !== 'presentation') {
      throw new Error('expected a presentation ContentDocument');
    }
    const shapes = content.slides[0]!.shapes;
    expect(shapes).toHaveLength(2);
    expect(shapes[0]?.blocks[0]).toMatchObject({ kind: 'paragraph', runs: [{ text: 'A label' }] });
    const drawingBlock = shapes[1]?.blocks[0];
    if (drawingBlock?.kind !== 'embeddedObject' || drawingBlock.document.kind !== 'drawing') {
      throw new Error('expected a drawing-kind embeddedObject block');
    }
    expect(drawingBlock.document.pages[0]!.vectors).toMatchObject([{ kind: 'rect', fill: { r: 0, g: 0, b: 1 } }]);
  });

  // The dedicated correspondence check this module's own design assumes but did not, before this task, independently verify from source: odf.js's readOdpContent (which builds slide.shapes via its own walkDrawShapes) and readDrawPageContent (which this package's own collectSlideVectorGroups calls to get BOTH shapes and vectors from one shared paintOrder counter) must agree on the ARRAY POSITION they assign the same real shape, or insertBeforeShapeIndex would be meaningless. Verified directly here against the same hand-authored fixture, independently of collectSlideVectorGroups' own internal use of it.
  it('confirms readOdpContent\'s own shape array and readDrawPageContent\'s own shape array agree on position for the same fixture', () => {
    const pkg = decodeOdfPackage(odpBytes());
    const presentationContent = readOdpContent(pkg);
    if (presentationContent.kind !== 'presentation') {
      throw new Error('expected a presentation ContentDocument');
    }
    // readOdpContent already spliced a synthetic vector shape in, so re-derive readOdp's OWN pristine shape count from the untouched fixture bytes via a second, independent read.
    const body = findChildElement(odfContentRoot(pkg).children, 'office:body');
    const presentationElement = body === undefined ? undefined : findChildElement(body.children, 'office:presentation');
    const [page] = presentationElement === undefined ? [] : childrenWithTag(presentationElement, 'draw:page');
    if (page === undefined) {
      throw new Error('expected a draw:page element');
    }
    const { shapes: pageShapes } = readDrawPageContent(page.children, pkg);
    expect(pageShapes).toHaveLength(1);
    expect(pageShapes[0]?.blocks[0]).toMatchObject({ runs: [{ text: 'A label' }] });
  });
});

// ---------------------------------------------------------------------------
// Round-trip chain tests: recovered vector geometry crossing the odt<->docx and odp<->pptx bridges repeatedly, mirroring src/convert/formula.test.ts's own "survives repeated odt -> docx -> odt cycles" pattern -- proving the combined formula-and-vector splice (src/model/block-splice.ts) does not accumulate an extra empty paragraph/shape per hop the way running two independent, sequential splices against stale indices would.
// ---------------------------------------------------------------------------

describe('odt <-> docx: a recovered drawing survives repeated cycles without accumulating empty paragraphs', () => {
  it('keeps exactly one paragraph-drawing-paragraph block sequence across three docx -> odt cycles', () => {
    const size = { widthPt: 612, heightPt: 792 };
    const source: ContentDocument = {
      kind: 'wordprocessing',
      metadata: {},
      sections: [
        {
          pageSize: size,
          margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
          blocks: [{ kind: 'paragraph', runs: [{ text: 'Before' }] }, vectorDrawingBlock(size), { kind: 'paragraph', runs: [{ text: 'After' }] }],
        },
      ],
    };
    let bytes = encodeOdfPackage(buildOdtPackage(source));
    for (let cycle = 0; cycle < 3; cycle++) {
      bytes = docxToOdt(odtToDocx(bytes));
      const content = readOdtContent(decodeOdfPackage(bytes));
      if (content.kind !== 'wordprocessing') {
        throw new Error('expected a wordprocessing ContentDocument');
      }
      const blocks = content.sections[0]!.blocks;
      expect(blocks.map((block) => block.kind)).toEqual(['paragraph', 'embeddedObject', 'paragraph']);
      const drawingBlock = blocks[1];
      if (drawingBlock?.kind !== 'embeddedObject' || drawingBlock.document.kind !== 'drawing') {
        throw new Error('expected a drawing-kind embeddedObject block');
      }
      expect(drawingBlock.document.pages[0]!.vectors).toHaveLength(VECTOR_FIXTURE.length);
    }
  });
});

describe('odp <-> pptx: a recovered drawing survives repeated cycles without accumulating empty shapes', () => {
  it('keeps exactly one shape-drawing-shape sequence across three pptx -> odp cycles', () => {
    const size = { widthPt: 960, heightPt: 540 };
    const zeroInsets = { insetLeftPt: 0, insetTopPt: 0, insetRightPt: 0, insetBottomPt: 0 };
    const source: ContentDocument = {
      kind: 'presentation',
      metadata: {},
      slides: [
        {
          size,
          notes: '',
          shapes: [
            { frame: { xPt: 10, yPt: 10, widthPt: 200, heightPt: 50 }, ...zeroInsets, blocks: [{ kind: 'paragraph', runs: [{ text: 'Before' }] }] },
            { frame: { xPt: 0, yPt: 0, ...size }, ...zeroInsets, blocks: [vectorDrawingBlock(size)] },
            { frame: { xPt: 10, yPt: 480, widthPt: 200, heightPt: 50 }, ...zeroInsets, blocks: [{ kind: 'paragraph', runs: [{ text: 'After' }] }] },
          ],
        },
      ],
    };
    let bytes = encodeOdfPackage(buildOdpPackage(source));
    for (let cycle = 0; cycle < 3; cycle++) {
      bytes = pptxToOdp(odpToPptx(bytes));
      const content = readOdpContent(decodeOdfPackage(bytes));
      if (content.kind !== 'presentation') {
        throw new Error('expected a presentation ContentDocument');
      }
      const shapes = content.slides[0]!.shapes;
      expect(shapes.map((shape) => shape.blocks[0]?.kind)).toEqual(['paragraph', 'embeddedObject', 'paragraph']);
      const drawingBlock = shapes[1]?.blocks[0];
      if (drawingBlock?.kind !== 'embeddedObject' || drawingBlock.document.kind !== 'drawing') {
        throw new Error('expected a drawing-kind embeddedObject block');
      }
      expect(drawingBlock.document.pages[0]!.vectors).toHaveLength(VECTOR_FIXTURE.length);
    }
  });
});
