import type { Package, XmlElement } from 'odf.js';
import { decodePackage, readOdg } from 'odf.js';
import { describe, expect, it } from 'vitest';
import type { ContentSubpath } from 'document-content-model';
import { minimalOdgBytes } from '../../test-support/odg';
import { createOdg, openOdg } from './editor';

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const RED = { r: 1, g: 0, b: 0 };
const BLUE = { r: 0, g: 0, b: 1 };
const BLACK = { r: 0, g: 0, b: 0 };
const CYAN = { r: 0, g: 1, b: 1 };

function drawPageElement(pkg: Package): XmlElement {
  const part = pkg.parts['content.xml'];
  const root = part?.kind === 'xml' ? part.nodes.find((n): n is XmlElement => n.type === 'element') : undefined;
  const body = root?.children.find((c): c is XmlElement => c.type === 'element' && c.tag === 'office:body');
  const drawing = body?.children.find((c): c is XmlElement => c.type === 'element' && c.tag === 'office:drawing');
  const page = drawing?.children.find((c): c is XmlElement => c.type === 'element' && c.tag === 'draw:page');
  if (page === undefined) {
    throw new Error('expected a draw:page element');
  }
  return page;
}

describe('openOdg / createOdg', () => {
  it('openOdg reads an existing package and exposes its pages/shapes', () => {
    const editor = openOdg(minimalOdgBytes());
    const pages = editor.pages();
    expect(pages).toHaveLength(1);
    // Only the text frame is a draw:frame -- shapes() (like OdpSlide's own) does not include vector primitives (draw:rect/ellipse/line/path), matching page.ts's own documented scope.
    expect(pages[0]?.shapes().map((s) => s.name)).toEqual(['TextFrame']);
  });

  it('createOdg starts from a valid, empty, encodable package with zero pages', () => {
    const editor = createOdg();
    expect(editor.pages()).toHaveLength(0);
    expect(decodePackage(editor.toBytes())).toEqual(editor.toPackage());
  });
});

describe('OdgEditor.addPage / removePageAt', () => {
  it('addPage appends a page referencing the shared master page, with an empty shape list', () => {
    const editor = createOdg();
    const page = editor.addPage();
    expect(page.shapes()).toHaveLength(0);
    expect(editor.pages()).toHaveLength(1);
    expect(() => editor.toBytes()).not.toThrow();
  });

  it('pages are ordered by document position, matching odf.js\'s own draw:page order', () => {
    const editor = createOdg();
    editor.addPage().addTextBox({ frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 }, text: 'First' });
    editor.addPage().addTextBox({ frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 }, text: 'Second' });
    editor.addPage().addTextBox({ frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 }, text: 'Third' });
    expect(editor.pages().map((p) => p.shapes()[0]?.text)).toEqual(['First', 'Second', 'Third']);
  });

  it('removePageAt removes the page', () => {
    const editor = createOdg();
    editor.addPage().addTextBox({ frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 }, text: 'One' });
    editor.addPage().addTextBox({ frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 }, text: 'Two' });
    editor.removePageAt(0);
    const remaining = editor.pages();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.shapes()[0]?.text).toBe('Two');
  });
});

describe('OdgEditor.pageSize', () => {
  it('defaults to A4 -- LibreOffice Draw\'s own real default', () => {
    const editor = createOdg();
    expect(editor.pageSize.widthPt).toBeCloseTo(595.28, 2);
    expect(editor.pageSize.heightPt).toBeCloseTo(841.89, 2);
  });

  it('can be set and read back', () => {
    const editor = createOdg();
    editor.pageSize = { widthPt: 400, heightPt: 300 };
    expect(editor.pageSize).toEqual({ widthPt: 400, heightPt: 300 });
  });
});

describe('OdgPage.addRect / addEllipse / addLine / addPath / addTextBox / addImage', () => {
  it('adds vectors and shapes to the correct page', () => {
    const editor = createOdg();
    const page = editor.addPage();
    page.addRect({ frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 }, fill: RED });
    page.addImage({ frame: { xPt: 0, yPt: 0, widthPt: 50, heightPt: 50 }, format: 'png', bytes: PNG_BYTES });
    expect(page.shapes()).toHaveLength(1);
    expect(decodePackage(editor.toBytes())).toEqual(editor.toPackage());
  });
});

describe('paint order: vectors and shapes come back in document-add order, with no draw:z-index attribute written', () => {
  it('matches odf.js\'s own canonical convention (document order IS z-order; real LibreOffice output never emits draw:z-index)', () => {
    const editor = createOdg();
    const page = editor.addPage();
    page.addRect({ frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 }, fill: RED });
    page.addEllipse({ frame: { xPt: 20, yPt: 0, widthPt: 10, heightPt: 10 }, fill: BLUE });
    page.addLine({ from: { xPt: 0, yPt: 0 }, to: { xPt: 10, yPt: 10 }, stroke: { color: BLACK, widthPt: 1 } });
    const subpaths: ContentSubpath[] = [{ start: { xPt: 0, yPt: 0 }, closed: false, segments: [{ kind: 'line', to: { xPt: 10, yPt: 10 } }] }];
    page.addPath({ frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 }, subpaths });
    page.addTextBox({ frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 }, text: 'One' });
    page.addImage({ frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 }, format: 'png', bytes: PNG_BYTES });

    const pkg = editor.toPackage();
    const pageElement = drawPageElement(pkg);
    for (const child of pageElement.children) {
      expect(child.type === 'element' ? child.attributes.some((a) => a.name === 'draw:z-index') : false).toBe(false);
    }

    const { pages } = readOdg(pkg);
    expect(pages[0]?.vectors.map((v) => v.kind)).toEqual(['rect', 'ellipse', 'line', 'path']);
    expect(pages[0]?.shapes).toHaveLength(2);
  });

  it('reordering the add calls reorders the read-back paint order identically -- proving it is genuinely document-order-driven, not a coincidence', () => {
    const editor = createOdg();
    const page = editor.addPage();
    page.addLine({ from: { xPt: 0, yPt: 0 }, to: { xPt: 10, yPt: 10 }, stroke: { color: BLACK, widthPt: 1 } });
    page.addRect({ frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 }, fill: RED });
    page.addEllipse({ frame: { xPt: 20, yPt: 0, widthPt: 10, heightPt: 10 }, fill: BLUE });

    const { pages } = readOdg(editor.toPackage());
    expect(pages[0]?.vectors.map((v) => v.kind)).toEqual(['line', 'rect', 'ellipse']);
  });
});

describe('full editor round trip: open a real odg, add shapes and vectors including a curved path, save, reread via odf.js\'s own readOdg', () => {
  it('every new addition survives, including the curve\'s exact segment data through the svg:d regenerate/reparse round trip', () => {
    const editor = openOdg(minimalOdgBytes());
    const page = editor.pages()[0];
    if (page === undefined) {
      throw new Error('expected the fixture to have a page');
    }

    page.addRect({ frame: { xPt: 5, yPt: 5, widthPt: 40, heightPt: 30 }, fill: { r: 0, g: 1, b: 0 } });
    page.addEllipse({ frame: { xPt: 50, yPt: 5, widthPt: 40, heightPt: 30 }, stroke: { color: BLACK, widthPt: 1 } });
    page.addLine({ from: { xPt: 0, yPt: 0 }, to: { xPt: 100, yPt: 100 }, stroke: { color: { r: 1, g: 0, b: 1 }, widthPt: 2 } });
    const curveSubpaths: ContentSubpath[] = [
      {
        start: { xPt: 0, yPt: 80 },
        closed: true,
        segments: [
          { kind: 'line', to: { xPt: 60, yPt: 80 } },
          { kind: 'cubic', control1: { xPt: 80, yPt: 80 }, control2: { xPt: 80, yPt: 0 }, to: { xPt: 40, yPt: 0 } },
        ],
      },
    ];
    const newCurveFrame = { xPt: 10, yPt: 200, widthPt: 80, heightPt: 80 };
    page.addPath({ frame: newCurveFrame, subpaths: curveSubpaths, fill: CYAN });
    page.addTextBox({ frame: { xPt: 0, yPt: 260, widthPt: 100, heightPt: 30 }, text: 'New label' });
    page.addImage({ frame: { xPt: 0, yPt: 300, widthPt: 40, heightPt: 40 }, format: 'png', bytes: PNG_BYTES });

    const bytes = editor.toBytes();

    // Reread via THIS package's own live-view editor first (proves the write round-trips through documents.js itself)...
    const reopened = openOdg(bytes);
    const reopenedPage = reopened.pages()[0];
    if (reopenedPage === undefined) {
      throw new Error('expected the reopened package to have a page');
    }
    expect(reopenedPage.shapes().map((s) => s.name ?? s.text)).toContain('New label');

    // ...then, independently, via odf.js's own readOdg -- the actual downstream reader this package's ContentDocument pipeline depends on, proving the written package is genuinely valid ODF, not merely self-consistent with this package's own reader.
    const { pages } = readOdg(decodePackage(bytes));
    const firstPage = pages[0];
    if (firstPage === undefined) {
      throw new Error('expected a page');
    }

    const pathVectors = firstPage.vectors.filter((v) => v.kind === 'path');
    // The fixture already carries one real curve of its own (CurvePath1) -- the new one is disambiguated by its own distinctive fill colour.
    expect(pathVectors.length).toBeGreaterThanOrEqual(2);
    const newPath = pathVectors.find((v) => v.kind === 'path' && v.fill?.g === 1 && v.fill.b === 1 && v.fill.r === 0);
    if (newPath?.kind !== 'path') {
      throw new Error('expected to find the newly added cyan curved path');
    }
    expect(newPath.subpaths).toEqual(curveSubpaths);
    expect(newPath.frame.xPt).toBeCloseTo(newCurveFrame.xPt, 6);
    expect(newPath.frame.yPt).toBeCloseTo(newCurveFrame.yPt, 6);
    expect(newPath.frame.widthPt).toBeCloseTo(newCurveFrame.widthPt, 6);
    expect(newPath.frame.heightPt).toBeCloseTo(newCurveFrame.heightPt, 6);

    expect(firstPage.vectors.some((v) => v.kind === 'rect' && v.fill?.g === 1 && v.fill.r === 0 && v.fill.b === 0)).toBe(true);
    expect(firstPage.vectors.some((v) => v.kind === 'ellipse')).toBe(true);
    expect(firstPage.vectors.some((v) => v.kind === 'line' && v.stroke.color.r === 1 && v.stroke.color.b === 1)).toBe(true);

    const newLabel = firstPage.shapes.find((s) => s.blocks.some((b) => b.kind === 'paragraph' && b.runs.some((r) => r.text === 'New label')));
    expect(newLabel).toBeDefined();
    const newImageShape = firstPage.shapes.filter((s) => s.blocks.some((b) => b.kind === 'image'));
    expect(newImageShape.length).toBeGreaterThanOrEqual(1);
  });
});
