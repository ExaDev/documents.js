import { describe, expect, it } from 'vitest';
import { PAGE_SIZE_A4 } from 'document-schema.js';
import type { Package } from '../../model/package';
import { el, txt } from '../../xml/fragment';
import { assertPackageRoundTrip, drawingPackage } from '../../test-support/document-package';
import { readOdg, readOdgContent } from './read';

// A full, real-shape .odg fixture assembled from XML shapes verified against genuine LibreOffice 26.2 output (a StarBasic macro run headlessly against the LibreOffice UNO API to construct actual draw:rect/ellipse/line/path/custom-shape geometry, then the resulting content.xml inspected directly -- NOT hand-authored guesses; see typed/shared/path.ts's own top-of-file note for the full verification method), matching this package's other typed-reader tests' established convention of building packages programmatically from ground-truth-verified shapes rather than loading a committed binary fixture (mirroring readOdpContent's own read.test.ts).

function stylesXml(): Package['parts'][string] {
  return {
    kind: 'xml',
    nodes: [
      el('office:document-styles', {}, [
        el('office:automatic-styles', {}, [el('style:page-layout', { 'style:name': 'PM0' }, [el('style:page-layout-properties', { 'fo:page-width': '21cm', 'fo:page-height': '29.7cm' })])]),
        el('office:master-styles', {}, [el('style:master-page', { 'style:name': 'Default', 'style:page-layout-name': 'PM0' })]),
      ]),
    ],
  };
}

function graphicStyle(name: string, attrs: Record<string, string>): ReturnType<typeof el> {
  return el('style:style', { 'style:name': name, 'style:family': 'graphic' }, [el('style:graphic-properties', attrs)]);
}

function buildFixturePackage(): Package {
  // Page 1: a real mix of vector primitives, in the exact document order a genuine LibreOffice .odg round trip produced (Ellipse1 was moved to the BACK and Rect1 to the FRONT via the UNO ZOrder property before saving -- LibreOffice's own writer represents that purely via THIS document order, with no draw:z-index attribute at all; see shapes.test.ts's own dedicated draw:z-index tests for the explicit-attribute-override case).
  const ellipse = el('draw:ellipse', { 'draw:name': 'Ellipse1', 'draw:style-name': 'grEllipse', 'svg:width': '5cm', 'svg:height': '3cm', 'svg:x': '3cm', 'svg:y': '2cm' }, [el('text:p')]);
  const line = el('draw:line', { 'draw:name': 'Line1', 'draw:style-name': 'grLine', 'svg:x1': '9cm', 'svg:y1': '1cm', 'svg:x2': '13cm', 'svg:y2': '4cm' }, [el('text:p')]);
  const curvePath = el('draw:path', {
    'draw:name': 'CurvePath1', 'draw:style-name': 'grCurve',
    'svg:width': '3.656cm', 'svg:height': '3.999cm', 'svg:x': '15cm', 'svg:y': '1cm',
    'svg:viewBox': '0 0 3657 4000', 'svg:d': 'M0 4000h3000c1000 0 1000-4000-1000-4000z',
  }, [el('text:p')]);
  const polygon = el('draw:polygon', {
    'draw:name': 'Polygon1', 'draw:style-name': 'grPolygon',
    'svg:width': '3.999cm', 'svg:height': '2.999cm', 'svg:x': '25cm', 'svg:y': '1cm',
    'svg:viewBox': '0 0 4000 3000', 'draw:points': '0,3000 2000,0 4000,3000 2000,1500',
  }, [el('text:p')]);
  const customRect = el('draw:custom-shape', { 'draw:name': 'CustomRect1', 'draw:style-name': 'grCustom', 'svg:width': '5cm', 'svg:height': '3cm', 'svg:x': '1cm', 'svg:y': '8cm' }, [
    el('text:p'),
    el('draw:enhanced-geometry', { 'svg:viewBox': '0 0 21600 21600', 'draw:type': 'rectangle', 'draw:enhanced-path': 'M 0 0 L 21600 0 21600 21600 0 21600 0 0 Z N' }),
  ]);
  const customEllipse = el('draw:custom-shape', { 'draw:name': 'CustomEllipse1', 'draw:style-name': 'grCustom', 'svg:width': '5cm', 'svg:height': '3cm', 'svg:x': '13cm', 'svg:y': '8cm' }, [
    el('text:p'),
    el('draw:enhanced-geometry', { 'svg:viewBox': '0 0 21600 21600', 'draw:type': 'ellipse' }),
  ]);
  const customSmiley = el('draw:custom-shape', { 'draw:name': 'CustomSmiley1', 'draw:style-name': 'grCustom', 'svg:width': '5cm', 'svg:height': '3cm', 'svg:x': '19cm', 'svg:y': '8cm' }, [
    el('text:p'),
    el('draw:enhanced-geometry', { 'svg:viewBox': '0 0 21600 21600', 'draw:type': 'smiley' }),
  ]);
  const rect = el('draw:rect', { 'draw:name': 'Rect1', 'draw:style-name': 'grRect', 'svg:width': '5cm', 'svg:height': '3cm', 'svg:x': '1cm', 'svg:y': '1cm' }, [el('text:p')]);
  const page1 = el('draw:page', { 'draw:name': 'page1', 'draw:master-page-name': 'Default' }, [ellipse, line, curvePath, polygon, customRect, customEllipse, customSmiley, rect]);

  // Page 2: a single frame with real text, to confirm draw:frame content still reads correctly through readDrawPageContent inside a drawing document, and that multiple draw:page elements read in document order.
  const frame = el('draw:frame', { 'draw:name': 'TextFrame', 'svg:x': '1cm', 'svg:y': '1cm', 'svg:width': '10cm', 'svg:height': '2cm' }, [el('draw:text-box', {}, [el('text:p', {}, [txt('Page two text')])])]);
  const page2 = el('draw:page', { 'draw:name': 'page2', 'draw:master-page-name': 'Default' }, [frame]);

  const contentXml: Package['parts'][string] = {
    kind: 'xml',
    nodes: [
      el('office:document-content', {}, [
        el('office:automatic-styles', {}, [
          graphicStyle('grEllipse', { 'draw:fill-color': '#00ff00' }),
          graphicStyle('grLine', { 'svg:stroke-color': '#0000ff', 'svg:stroke-width': '0.03cm' }),
          graphicStyle('grCurve', { 'draw:fill-color': '#ffff00', 'svg:stroke-color': '#000000', 'svg:stroke-width': '0.02cm' }),
          graphicStyle('grPolygon', { 'draw:fill-color': '#ff8000', 'svg:stroke-color': '#000000', 'svg:stroke-width': '0.02cm' }),
          graphicStyle('grCustom', { 'draw:fill-color': '#0080ff' }),
          graphicStyle('grRect', { 'draw:fill-color': '#ff0000', 'svg:stroke-color': '#000000', 'svg:stroke-width': '0.05cm' }),
        ]),
        el('office:body', {}, [el('office:drawing', {}, [page1, page2])]),
      ]),
    ],
  };

  const metaXml: Package['parts'][string] = {
    kind: 'xml',
    nodes: [el('office:document-meta', {}, [el('office:meta', {}, [el('dc:title', {}, [txt('My Drawing')])])])],
  };

  return { parts: { 'content.xml': contentXml, 'styles.xml': stylesXml(), 'meta.xml': metaXml } };
}

describe('readOdgContent', () => {
  it('reads draw:page elements in native document order (no p:sldIdLst-style indirection, matching odp)', () => {
    const { pages } = readOdgContent(buildFixturePackage());
    expect(pages).toHaveLength(2);
  });

  it('resolves page size from the master-page -> page-layout chain, identically to readOdpContent', () => {
    const { pages } = readOdgContent(buildFixturePackage());
    expect(pages[0]?.size.widthPt).toBeCloseTo((21 * 72) / 2.54, 6);
    expect(pages[0]?.size.heightPt).toBeCloseTo((29.7 * 72) / 2.54, 6);
  });

  it('falls back to A4 (LibreOffice Draw\'s own real default page size) when the master-page/page-layout chain does not resolve', () => {
    const pkg = buildFixturePackage();
    delete pkg.parts['styles.xml'];
    const { pages } = readOdgContent(pkg);
    expect(pages[0]?.size).toEqual(PAGE_SIZE_A4);
  });

  it('reads every recognised vector primitive kind onto the first page\'s own vectors array', () => {
    const { pages } = readOdgContent(buildFixturePackage());
    const kinds = pages[0]?.vectors.map((v) => v.kind);
    expect(kinds).toEqual(['ellipse', 'line', 'path', 'path', 'rect', 'ellipse', 'rect']);
  });

  it('salvages the unrecognised custom-shape preset ("smiley") as nothing at all (no real text content in this fixture) rather than a vector', () => {
    const { pages } = readOdgContent(buildFixturePackage());
    expect(pages[0]?.shapes).toEqual([]);
  });

  it('reads the closed curve\'s real svg:d geometry correctly end to end (viewBox-scaled cubic segment)', () => {
    const { pages } = readOdgContent(buildFixturePackage());
    const path = pages[0]?.vectors.find((v) => v.kind === 'path' && v.subpaths[0]?.closed === true);
    if (path?.kind !== 'path') {
      throw new Error('expected the closed curve path vector');
    }
    expect(path.subpaths[0]?.segments[1]).toMatchObject({ kind: 'cubic' });
    expect(path.fill).toEqual({ r: 1, g: 1, b: 0 });
  });

  it('reads the polygon\'s draw:points geometry as a closed straight-line path', () => {
    const { pages } = readOdgContent(buildFixturePackage());
    const polygon = pages[0]?.vectors.find((v) => v.kind === 'path' && v.subpaths[0]?.closed === true && v.subpaths[0]?.segments.length === 3);
    if (polygon?.kind !== 'path') {
      throw new Error('expected the polygon path vector');
    }
    expect(polygon.subpaths[0]?.segments.every((s) => s.kind === 'line')).toBe(true);
  });

  it('reads a recognised custom-shape preset\'s fill from its own graphic-family style', () => {
    const { pages } = readOdgContent(buildFixturePackage());
    const rectPreset = pages[0]?.vectors.find((v) => v.kind === 'rect');
    expect(rectPreset?.fill).toEqual({ r: 0, g: 0.5019607843137255, b: 1 });
  });

  it('reads a second page\'s draw:frame text content via the SAME shared shape-walking logic odp uses', () => {
    const { pages } = readOdgContent(buildFixturePackage());
    expect(pages[1]?.shapes).toHaveLength(1);
    expect(pages[1]?.shapes[0]?.blocks[0]).toMatchObject({ kind: 'paragraph', runs: [{ text: 'Page two text' }] });
  });

  it('reads document metadata via meta.xml', () => {
    const { metadata } = readOdgContent(buildFixturePackage());
    expect(metadata.title).toBe('My Drawing');
  });

  it('reads an empty pages array for a package with no office:drawing at all', () => {
    const pkg: Package = { parts: { 'content.xml': { kind: 'xml', nodes: [el('office:document-content', {}, [el('office:body')])] } } };
    expect(readOdgContent(pkg).pages).toEqual([]);
  });

  it('reads an empty pages array and empty metadata for a package with no content.xml at all', () => {
    const result = readOdgContent({ parts: {} });
    expect(result.pages).toEqual([]);
    expect(result.metadata).toEqual({});
  });
});

describe('readOdg: the package-native reader over the same fixture', () => {
  it('assembles the fixture into a drawing package whose tree flattens back to readOdgContent output exactly', () => {
    const pkg = buildFixturePackage();
    const content = readOdgContent(pkg);
    const documentPackage = readOdg(pkg);

    expect(documentPackage.kind).toBe('drawing');
    expect(documentPackage.metadata).toEqual(content.metadata);
    // One draw-page group per authored ContentDrawPage. These are the document's OWN pages, not the package envelope's rendered `pages` array -- which stays absent, since no layout pass has run.
    expect(documentPackage.children).toHaveLength(content.pages.length);
    expect(documentPackage.pages).toBeUndefined();
    assertPackageRoundTrip(documentPackage, { kind: 'drawing', ...content });
  });

  it('carries each page\'s size on its group node, its shapes as groups, and its vector primitives as the leaves after them', () => {
    const pkg = buildFixturePackage();
    const content = readOdgContent(pkg);
    const documentPackage = drawingPackage(readOdg(pkg));
    const firstPage = documentPackage.children[0];
    const firstContentPage = content.pages[0];
    if (firstPage === undefined || firstContentPage === undefined) {
      throw new Error('expected at least one draw page');
    }
    expect(firstPage.node.kind).toBe('drawPage');
    expect(firstPage.node.size).toEqual(firstContentPage.size);
    // A shape is a container and becomes its own group; a vector is a textless primitive with no inner structure and stays a leaf, after every shape group -- so the page's children are the two arrays concatenated in that order.
    expect(firstPage.children).toHaveLength(firstContentPage.shapes.length + firstContentPage.vectors.length);
    expect(firstPage.children.slice(firstContentPage.shapes.length)).toEqual(firstContentPage.vectors);
    expect(firstContentPage.vectors.length).toBeGreaterThan(0);
  });
});
