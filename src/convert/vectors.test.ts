import type { ContentVector } from 'document-schema.js';
import type { Package as OdfPackage, XmlElement as OdfXmlElement } from 'odf.js';
import { childrenWithTag, decodePackage as decodeOdfPackage, findChildElement, readDrawPageContent, rootElement as odfRootElement } from 'odf.js';
import type { XmlElement } from 'ooxml.js';
import { decodePackage as decodeOoxmlPackage, rootElement } from 'ooxml.js';
import { describe, expect, it } from 'vitest';
import { collectDrawingMlVectors } from '../test-support/drawingml-vector';
import { minimalOdgBytes } from '../test-support/odg';
import { odgToPdf, pdfToDocx, pdfToOdp, pdfToOdt, pdfToPptx } from './convert';

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

  // Read back through odf.js's OWN readDrawPageContent, the same reader readOdg uses for a real drawing page -- a genuinely independent oracle, unlike the DrawingML side, whose reader is written alongside this package's writer.
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
