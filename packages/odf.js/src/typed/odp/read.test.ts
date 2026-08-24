import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ContentListMembership, ContentParagraph, ContentSlide } from 'document-schema.js';
import type { Package } from '../../model/package';
import { el, txt } from '../../xml/fragment';
import { bytesToBase64 } from '../../util/base64';
import { parsePackage } from '../../package-io/read';
import { assertPackageRoundTrip, presentationPackage } from '../../test-support/document-tree';
import { readOdp, readOdpContent } from './read';

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function loadFixture(name: string): Package {
  const bytes = new Uint8Array(readFileSync(join(FIXTURES_DIR, name)));
  return parsePackage(bytes);
}

// A full, real-shape .odp fixture assembled from XML shapes verified against genuine LibreOffice 26.2 output (soffice --headless --convert-to odp on hand-built .fodp source, and an odp -> odp round trip to confirm LibreOffice's OWN writer's exact serialization -- see this repository's own commit history for the verification method): multiple draw:page elements in native document order, a rotated text frame, a grouped pair of shapes, an image, a table, and speaker notes, matching this package's other typed-reader tests' established convention of building packages programmatically from ground-truth-verified shapes rather than loading a committed binary fixture (mirroring ooxml.js's own src/typed/pptx/read.test.ts). The residue-row suite below additionally loads one genuine committed Impress fixture (fixtures/transitions.odp, built through the same UNO properties the Impress slide-transition sidebar writes) -- the placement facts it pins (transitions on the slide's own drawing-page style) are exactly the kind a programmatic fixture got wrong before it, so real producer output holds them.

function tinyPngBase64(): string {
  return bytesToBase64(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]));
}

function stylesXml(): Package['parts'][string] {
  return {
    kind: 'xml',
    nodes: [
      el('office:document-styles', {}, [
        el('office:automatic-styles', {}, [el('style:page-layout', { 'style:name': 'PM1' }, [el('style:page-layout-properties', { 'fo:page-width': '720pt', 'fo:page-height': '540pt' })])]),
        el('office:master-styles', {}, [el('style:master-page', { 'style:name': 'Default', 'style:page-layout-name': 'PM1' })]),
      ]),
    ],
  };
}

function buildFixturePackage(): Package {
  // Slide 1: a rotated title frame with real text, a grouped pair of shapes, and speaker notes.
  const titleFrame = el('draw:frame', { 'draw:name': 'Title', 'svg:width': '200pt', 'svg:height': '60pt', 'draw:transform': 'rotate(0.5235987755982988) translate(50pt 50pt)' }, [
    el('draw:text-box', {}, [el('text:p', {}, [txt('Slide One Title')])]),
  ]);
  const groupShapeA = el('draw:frame', { 'draw:name': 'A', 'svg:x': '50pt', 'svg:y': '150pt', 'svg:width': '80pt', 'svg:height': '40pt' }, [el('draw:text-box', {}, [el('text:p', {}, [txt('A')])])]);
  const groupShapeB = el('draw:frame', { 'draw:name': 'B', 'svg:x': '150pt', 'svg:y': '150pt', 'svg:width': '80pt', 'svg:height': '40pt' }, [el('draw:text-box', {}, [el('text:p', {}, [txt('B')])])]);
  const group = el('draw:g', {}, [groupShapeA, groupShapeB]);
  const notes = el('presentation:notes', {}, [el('draw:frame', { 'svg:x': '20pt', 'svg:y': '400pt', 'svg:width': '300pt', 'svg:height': '100pt' }, [el('draw:text-box', {}, [el('text:p', {}, [txt('First line of notes.')]), el('text:p', {}, [txt('Second line.')])])])]);
  const slide1 = el('draw:page', { 'draw:name': 'Slide1', 'draw:master-page-name': 'Default' }, [titleFrame, group, notes]);

  // Slide 2: an image and a table, no notes.
  const imageFrame = el('draw:frame', { 'svg:x': '400pt', 'svg:y': '50pt', 'svg:width': '60pt', 'svg:height': '60pt' }, [el('draw:image', { 'xlink:href': 'Pictures/img1.png' })]);
  const table = el('table:table', {}, [
    el('table:table-column'),
    el('table:table-column'),
    el('table:table-row', {}, [
      el('table:table-cell', { 'table:number-columns-spanned': '2' }, [el('text:p', {}, [txt('Spanned Header')])]),
      el('table:covered-table-cell'),
    ]),
    el('table:table-row', {}, [el('table:table-cell', {}, [el('text:p', {}, [txt('R2C1')])]), el('table:table-cell', {}, [el('text:p', {}, [txt('R2C2')])])]),
  ]);
  const tableFrame = el('draw:frame', { 'svg:x': '50pt', 'svg:y': '200pt', 'svg:width': '300pt', 'svg:height': '100pt' }, [table]);
  const slide2 = el('draw:page', { 'draw:name': 'Slide2', 'draw:master-page-name': 'Default' }, [imageFrame, tableFrame]);

  const contentXml: Package['parts'][string] = {
    kind: 'xml',
    nodes: [el('office:document-content', {}, [el('office:body', {}, [el('office:presentation', {}, [slide1, slide2])])])],
  };

  const metaXml: Package['parts'][string] = {
    kind: 'xml',
    nodes: [el('office:document-meta', {}, [el('office:meta', {}, [el('dc:title', {}, [txt('My Presentation')])])])],
  };

  return {
    parts: {
      'content.xml': contentXml,
      'styles.xml': stylesXml(),
      'meta.xml': metaXml,
      'Pictures/img1.png': { kind: 'binary', base64: tinyPngBase64() },
    },
  };
}

// A dedicated fixture for text:list content inside slide text frames (draw:frame > draw:text-box): one slide carrying a "Body" frame whose text box holds a plain paragraph, a styled (bullet) 2-level text:list, and a second unstyled sibling text:list, plus an "Aside" frame with a third text:list of its own -- so nesting depth, per-encounter identity, cross-frame identity, the ordered:/bullet: kind prefix, and the no-membership case are all exercisable against one real-shape package. The text:list-style lives in content.xml's office:automatic-styles, the placement real LibreOffice output uses.
function buildListFixturePackage(): Package {
  const styledList = el('text:list', { 'text:style-name': 'L1' }, [
    el('text:list-item', {}, [el('text:p', {}, [txt('Alpha')])]),
    el('text:list-item', {}, [
      el('text:p', {}, [txt('Beta')]),
      el('text:list', {}, [el('text:list-item', {}, [el('text:p', {}, [txt('Beta.1')])]), el('text:list-item', {}, [el('text:p', {}, [txt('Beta.2')])])]),
    ]),
    el('text:list-item', {}, [el('text:p', {}, [txt('Gamma')])]),
  ]);
  const siblingList = el('text:list', {}, [el('text:list-item', {}, [el('text:p', {}, [txt('Delta')])])]);
  const bodyFrame = el('draw:frame', { 'draw:name': 'Body', 'svg:x': '40pt', 'svg:y': '80pt', 'svg:width': '400pt', 'svg:height': '300pt' }, [
    el('draw:text-box', {}, [el('text:p', {}, [txt('Intro')]), styledList, siblingList]),
  ]);
  const asideFrame = el('draw:frame', { 'draw:name': 'Aside', 'svg:x': '40pt', 'svg:y': '400pt', 'svg:width': '400pt', 'svg:height': '80pt' }, [
    el('draw:text-box', {}, [el('text:list', {}, [el('text:list-item', {}, [el('text:p', {}, [txt('Epsilon')])])])]),
  ]);
  const slide = el('draw:page', { 'draw:name': 'ListSlide', 'draw:master-page-name': 'Default' }, [bodyFrame, asideFrame]);

  return {
    parts: {
      'content.xml': {
        kind: 'xml',
        nodes: [
          el('office:document-content', {}, [
            el('office:automatic-styles', {}, [el('text:list-style', { 'style:name': 'L1' }, [el('text:list-level-style-bullet', { 'text:level': '1' })])]),
            el('office:body', {}, [el('office:presentation', {}, [slide])]),
          ]),
        ],
      },
      'styles.xml': stylesXml(),
    },
  };
}

function paragraphsWithText(slides: readonly ContentSlide[], shapeName: string, expected: readonly string[]): ContentParagraph[] {
  const shape = slides[0]?.shapes.find((s) => s.name === shapeName);
  if (shape === undefined) {
    throw new Error(`expected a "${shapeName}" shape on slide 1`);
  }
  const paragraphs = shape.blocks.filter((block): block is ContentParagraph => block.kind === 'paragraph');
  const texts = paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join(''));
  expect(texts).toEqual([...expected]);
  return paragraphs;
}

describe('readOdpContent: text:list content inside slide text frames', () => {
  it('reads a nested text:list as one numId across both depths, with level read off the actual text:list-in-text:list-item nesting and document order preserved across listed and unlisted paragraphs', () => {
    const paragraphs = paragraphsWithText(readOdpContent(buildListFixturePackage()).slides, 'Body', ['Intro', 'Alpha', 'Beta', 'Beta.1', 'Beta.2', 'Gamma', 'Delta']);
    const [, alpha, beta, beta1, beta2, gamma] = paragraphs;
    expect([alpha?.list?.level, beta?.list?.level, beta1?.list?.level, beta2?.list?.level, gamma?.list?.level]).toEqual([0, 0, 1, 1, 0]);
    const numId = alpha?.list?.numId;
    expect(numId).toBeDefined();
    expect([beta?.list?.numId, beta1?.list?.numId, beta2?.list?.numId, gamma?.list?.numId]).toEqual([numId, numId, numId, numId]);
  });

  it('mints a distinct numId per top-level text:list encounter -- a sibling list in the same text box and a list in a different frame never share an identity', () => {
    const { slides } = readOdpContent(buildListFixturePackage());
    const body = paragraphsWithText(slides, 'Body', ['Intro', 'Alpha', 'Beta', 'Beta.1', 'Beta.2', 'Gamma', 'Delta']);
    const aside = paragraphsWithText(slides, 'Aside', ['Epsilon']);
    const firstListId = body[1]?.list?.numId;
    const siblingListId = body[6]?.list?.numId;
    const asideListId = aside[0]?.list?.numId;
    expect(new Set([firstListId, siblingListId, asideListId]).size).toBe(3);
  });

  it('leaves list undefined on paragraphs outside any text:list, including one sharing a text box with a list', () => {
    const { slides } = readOdpContent(buildListFixturePackage());
    expect(paragraphsWithText(slides, 'Body', ['Intro', 'Alpha', 'Beta', 'Beta.1', 'Beta.2', 'Gamma', 'Delta'])[0]?.list).toBeUndefined();
    // The main fixture's title frame proves the same for a text box that never carried a list at all.
    expect(readOdpContent(buildFixturePackage()).slides[0]?.shapes.find((s) => s.name === 'Title')?.blocks[0]).not.toHaveProperty('list');
  });

  it('resolves the ordered-vs-bullet kind prefix from the referenced text:list-style, and leaves an unstyled list unprefixed -- the same shared numId convention the odt reader mints', () => {
    const paragraphs = paragraphsWithText(readOdpContent(buildListFixturePackage()).slides, 'Body', ['Intro', 'Alpha', 'Beta', 'Beta.1', 'Beta.2', 'Gamma', 'Delta']);
    expect(paragraphs[1]?.list).toEqual({ numId: 'bullet:list1', level: 0 } satisfies ContentListMembership);
    expect(paragraphs[6]?.list).toEqual({ numId: 'list2', level: 0 } satisfies ContentListMembership);
  });
});

describe('readOdpContent', () => {
  it('reads slides in native document order (draw:page order, no p:sldIdLst-style indirection to resolve)', () => {
    const { slides } = readOdpContent(buildFixturePackage());
    expect(slides).toHaveLength(2);
  });

  it('resolves slide size from the master-page -> page-layout chain (draw:master-page-name -> style:master-page -> style:page-layout-name -> style:page-layout-properties)', () => {
    const { slides } = readOdpContent(buildFixturePackage());
    expect(slides[0]?.size).toEqual({ widthPt: 720, heightPt: 540 });
    expect(slides[1]?.size).toEqual({ widthPt: 720, heightPt: 540 });
  });

  it('falls back to document-schema.js\'s own SLIDE_SIZE_WIDESCREEN when the master-page/page-layout chain does not resolve', () => {
    const pkg = buildFixturePackage();
    delete pkg.parts['styles.xml'];
    const { slides } = readOdpContent(pkg);
    expect(slides[0]?.size.widthPt).toBeGreaterThan(0);
  });

  it('reads a rotated shape\'s real text content and its pixel-verified geometry (see transform.test.ts for the render-based derivation)', () => {
    const { slides } = readOdpContent(buildFixturePackage());
    const title = slides[0]?.shapes.find((s) => s.name === 'Title');
    expect(title).toBeDefined();
    expect(title?.blocks[0]).toMatchObject({ kind: 'paragraph', runs: [{ text: 'Slide One Title' }] });
    expect(title?.rotationDeg).toBeCloseTo(-30, 6);
  });

  it('flattens a grouped pair of shapes into the slide\'s own flat shape list, in document order', () => {
    const { slides } = readOdpContent(buildFixturePackage());
    const names = slides[0]?.shapes.map((s) => s.name);
    expect(names).toEqual(['Title', 'A', 'B']);
  });

  it('extracts speaker notes text, joining multiple text:p lines with a newline', () => {
    const { slides } = readOdpContent(buildFixturePackage());
    expect(slides[0]?.notes).toBe('First line of notes.\nSecond line.');
  });

  it('reads an empty string for notes when a slide carries no presentation:notes at all', () => {
    const { slides } = readOdpContent(buildFixturePackage());
    expect(slides[1]?.notes).toBe('');
  });

  it('reads an image shape\'s referenced media part on the slide with no notes', () => {
    const { slides } = readOdpContent(buildFixturePackage());
    const imageShape = slides[1]?.shapes.find((s) => s.blocks[0]?.kind === 'image');
    expect(imageShape?.blocks[0]).toMatchObject({ kind: 'image', format: 'png', widthPt: 60, heightPt: 60 });
  });

  it('reads a table shape with a spanned header row and a covered cell', () => {
    const { slides } = readOdpContent(buildFixturePackage());
    const tableShape = slides[1]?.shapes.find((s) => s.blocks[0]?.kind === 'table');
    const table = tableShape?.blocks[0];
    if (table?.kind !== 'table') {
      throw new Error('expected a table block');
    }
    expect(table.rows[0]?.cells[0]).toMatchObject({ colSpan: 2 });
    expect(table.rows[0]?.cells[1]).toEqual({ blocks: [] });
    expect(table.rows[1]?.cells.map((c) => (c.blocks[0]?.kind === 'paragraph' ? c.blocks[0].runs[0]?.text : undefined))).toEqual(['R2C1', 'R2C2']);
  });

  it('reads document metadata via meta.xml', () => {
    const { metadata } = readOdpContent(buildFixturePackage());
    expect(metadata.title).toBe('My Presentation');
  });

  it('reads an empty slides array for a package with no office:presentation at all', () => {
    const pkg: Package = { parts: { 'content.xml': { kind: 'xml', nodes: [el('office:document-content', {}, [el('office:body')])] } } };
    expect(readOdpContent(pkg).slides).toEqual([]);
  });

  it('reads an empty slides array and empty metadata for a package with no content.xml at all', () => {
    const result = readOdpContent({ parts: {} });
    expect(result.slides).toEqual([]);
    expect(result.metadata).toEqual({});
  });
});

describe('readOdp: the package-native reader over the same fixture', () => {
  it('assembles the fixture into a presentation package whose tree flattens back to readOdpContent output exactly', () => {
    const pkg = buildFixturePackage();
    const content = readOdpContent(pkg);
    const documentPackage = readOdp(pkg);

    expect(documentPackage.kind).toBe('presentation');
    expect(documentPackage.metadata).toEqual(content.metadata);
    // One slide group per ContentSlide, each holding its own shapes as groups -- never one slide's paragraphs flattened across its shapes.
    expect(documentPackage.children).toHaveLength(content.slides.length);
    assertPackageRoundTrip(documentPackage, { kind: 'presentation', ...content });
  });

  it('keeps each slide\'s shapes as their own groups, with the slide descriptor carrying size and notes', () => {
    const documentPackage = presentationPackage(readOdp(buildFixturePackage()));
    const content = readOdpContent(buildFixturePackage());
    const firstSlide = documentPackage.children[0];
    const firstContentSlide = content.slides[0];
    if (firstSlide === undefined || firstContentSlide === undefined) {
      throw new Error('expected at least one slide');
    }
    expect(firstSlide.node.kind).toBe('slide');
    expect(firstSlide.node.size).toEqual(firstContentSlide.size);
    expect(firstSlide.node.notes).toBe(firstContentSlide.notes);
    expect(firstSlide.children).toHaveLength(firstContentSlide.shapes.length);
  });

  it('round-trips the list fixture, whose slide text frames carry real text:list nesting', () => {
    const pkg = buildListFixturePackage();
    const content = readOdpContent(pkg);
    assertPackageRoundTrip(readOdp(pkg), { kind: 'presentation', ...content });
  });
});

// The odp residue rows (ExaDev/documents.js#769): presentation transitions/sound/animations and the unmapped shape kinds quarantine on their own slide's residue, and non-content parts quarantine at the package tier. Slide transitions sit on the page's OWN drawing-page style (style:drawing-page-properties, referenced by draw:style-name), never as attributes of draw:page itself -- no ODF schema version (1.1, 1.2) puts them there, and real LibreOffice output writes them in the style (the transitions.odp fixture below is genuine Impress output).
describe('readOdpContent: residue rows', () => {
  function slidePackage(page: ReturnType<typeof el>, extraParts: Record<string, Package['parts'][string]> = {}, automaticStyles?: ReturnType<typeof el>  ): Package {
    const contentChildren = automaticStyles === undefined ? [] : [automaticStyles];
    return {
      parts: {
        'content.xml': { kind: 'xml', nodes: [el('office:document-content', {}, [...contentChildren, el('office:body', {}, [el('office:presentation', {}, [page])])])] },
        'styles.xml': stylesXml(),
        ...extraParts,
      },
    };
  }

  it('quarantines a slide\'s transition attributes from its drawing-page style (both the legacy presentation: and the ODF 1.2 smil: spellings), its sound, and its animation trees in the slide\'s own residue', () => {
    const automaticStyles = el('office:automatic-styles', {}, [
      el('style:style', { 'style:name': 'dp1', 'style:family': 'drawing-page' }, [
        el('style:drawing-page-properties', {
          'presentation:transition-type': 'automatic',
          'presentation:transition-style': 'fade',
          'presentation:transition-speed': 'slow',
          'presentation:duration': 'PT2S',
          'smil:type': 'fade',
          'smil:subtype': 'fadesmoothly',
          'smil:direction': 'reverse',
          'smil:fadeColor': '#00cc00',
          'presentation:background-visible': 'true',
        }),
      ]),
    ]);
    const page = el('draw:page', { 'draw:master-page-name': 'Default', 'draw:style-name': 'dp1' }, [
      el('presentation:sound', { 'xlink:href': '../media/sound.wav' }),
      el('anim:par', { 'pres:node-type': 'timing-root' }, [el('anim:animate', { 'smil:attributeName': 'x' })]),
      el('draw:frame', { 'svg:x': '20pt', 'svg:y': '20pt', 'svg:width': '100pt', 'svg:height': '40pt' }, [el('draw:text-box', {}, [el('text:p', {}, [txt('Real content')])])]),
    ]);
    const { slides } = readOdpContent(slidePackage(page, {}, automaticStyles));
    const slide = slides[0];
    if (slide === undefined) {
      throw new Error('expected a slide');
    }
    expect(slide.source?.format).toBe('odp');
    // The transition attributes ride a children-stripped style:drawing-page-properties carrying ONLY the transition attributes, from both spellings -- the style's non-transition decoration facts (background visibility) stay out.
    expect(slide.source?.xml).toContain('<style:drawing-page-properties ');
    expect(slide.source?.xml).toContain('presentation:transition-type="automatic"');
    expect(slide.source?.xml).toContain('presentation:transition-style="fade"');
    expect(slide.source?.xml).toContain('smil:type="fade"');
    expect(slide.source?.xml).toContain('smil:subtype="fadesmoothly"');
    expect(slide.source?.xml).toContain('smil:direction="reverse"');
    expect(slide.source?.xml).toContain('smil:fadeColor="#00cc00"');
    expect(slide.source?.xml).not.toContain('presentation:background-visible');
    expect(slide.source?.xml).toContain('<presentation:sound');
    expect(slide.source?.xml).toContain('<anim:par');
    expect(slide.shapes).toHaveLength(1);
  });

  it('leaves a slide with a transition-free drawing-page style field-free, not an empty residue entry', () => {
    const automaticStyles = el('office:automatic-styles', {}, [
      el('style:style', { 'style:name': 'dp1', 'style:family': 'drawing-page' }, [
        el('style:drawing-page-properties', { 'presentation:background-visible': 'true' }),
      ]),
    ]);
    const page = el('draw:page', { 'draw:master-page-name': 'Default', 'draw:style-name': 'dp1' });
    const { slides } = readOdpContent(slidePackage(page, {}, automaticStyles));
    expect(slides[0]?.source).toBeUndefined();
  });

  it('quarantines the REAL transitions.odp fixture\'s Impress-written smil transitions on their own slides', () => {
    const { slides } = readOdpContent(loadFixture('transitions.odp'));
    expect(slides).toHaveLength(8);
    // Genuine Impress output: the transition rides the slide's own drawing-page style as smil:type (with smil:direction where the transition has one, and the legacy presentation:transition-speed alongside), while the style's page-decoration attributes stay out of the residue.
    expect(slides[0]?.source?.format).toBe('odp');
    expect(slides[0]?.source?.xml).toContain('<style:drawing-page-properties smil:type="barWipe"');
    expect(slides[1]?.source?.xml).toContain('smil:type="boxWipe"');
    expect(slides[2]?.source?.xml).toContain('smil:type="fourBoxWipe"');
    expect(slides[2]?.source?.xml).toContain('presentation:transition-speed="fast"');
    expect(slides[3]?.source?.xml).toContain('smil:type="barnDoorWipe"');
    expect(slides[3]?.source?.xml).toContain('smil:direction="reverse"');
    expect(slides[4]?.source?.xml).toContain('smil:type="diagonalWipe"');
    expect(slides[5]?.source?.xml).toContain('smil:type="bowTieWipe"');
    expect(slides[6]?.source?.xml).toContain('smil:type="miscDiagonalWipe"');
    expect(slides[7]?.source?.xml).toContain('smil:type="veeWipe"');
    for (const slide of slides) {
      expect(slide.source?.xml).not.toContain('presentation:background-visible');
    }
  });

  it('quarantines the unmapped shape kinds (draw:connector, draw:measure, dr3d:scene, applet/plugin/floating-frame) on the slide they sit in, including inside a draw:g', () => {
    const page = el('draw:page', { 'draw:master-page-name': 'Default' }, [
      el('draw:connector', { 'svg:x1': '1cm', 'svg:y1': '1cm', 'svg:x2': '4cm', 'svg:y2': '4cm' }),
      el('draw:g', {}, [el('dr3d:scene', {}, [el('dr3d:cube')])]),
      el('draw:applet', { 'xlink:href': './Applet' }),
      el('draw:plugin', { 'xlink:href': './Plugin' }),
      el('draw:floating-frame', { 'xlink:href': './Frame' }),
    ]);
    const { slides } = readOdpContent(slidePackage(page));
    const slide = slides[0];
    if (slide === undefined) {
      throw new Error('expected a slide');
    }
    expect(slide.shapes).toEqual([]);
    expect(slide.source?.format).toBe('odp');
    expect(slide.source?.xml).toContain('<draw:connector');
    expect(slide.source?.xml).toContain('<dr3d:scene');
    expect(slide.source?.xml).toContain('<draw:applet');
    expect(slide.source?.xml).toContain('<draw:plugin');
    expect(slide.source?.xml).toContain('<draw:floating-frame');
  });

  it('quarantines a vendor-extension element on the slide alongside the unmapped kinds', () => {
    const page = el('draw:page', { 'draw:master-page-name': 'Default' }, [el('drawooo:enhanced-path', {}, [txt('')])]);
    const { slides } = readOdpContent(slidePackage(page));
    expect(slides[0]?.source?.xml).toContain('<drawooo:enhanced-path');
  });

  it('quarantines a non-content XML part at the package tier keyed by its part path, spliced onto readOdp\'s root', () => {
    const page = el('draw:page', { 'draw:master-page-name': 'Default' });
    const pkg = slidePackage(page, { 'settings.xml': { kind: 'xml', nodes: [el('office:document-settings')] } });
    const { source } = readOdpContent(pkg);
    expect(source?.['settings.xml']?.format).toBe('odp');
    expect(readOdp(pkg).source?.['settings.xml']?.xml).toContain('<office:document-settings');
  });
});
