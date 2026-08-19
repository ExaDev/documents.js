import { describe, expect, it } from 'vitest';
import { decodePackage, zipPackage } from '../index';
import { readPptxContent } from './pptx/read';

// Integration-level coverage for readPptxContent, exercised through a real zip round trip (decodePackage(zipPackage(...))) rather than raw Package/XmlElement fixtures -- the deep placeholder-inheritance, run-cascade, group-transform, and table coverage lives in ./pptx/read.test.ts and ./pptx/inherit.test.ts. This file replaces the pre-existing flat-shape (index/text/shapes/tables) test suite, which asserted a shape readPptxContent no longer has -- see the BREAKING CHANGE described in PptxDocument's own doc comment.

function enc(s: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(s);
}

const CONTENT_TYPES_PPTX = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>',
);

const ROOT_RELS_PPTX = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>',
);

const PRESENTATION = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId r:id="rId1"/><p:sldId r:id="rId2"/></p:sldIdLst></p:presentation>',
);

const PRESENTATION_RELS = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/></Relationships>',
);

// One shape on slide 1; two shapes on slide 2 to exercise per-slide shape ordering.
const SLIDE_1 = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:t>First slide</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>',
);
const SLIDE_2 = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:t>Second </a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:spPr><a:xfrm><a:off x="914400" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:t>slide</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>',
);

function pptxParts(): Record<string, Uint8Array<ArrayBuffer>> {
  return {
    '[Content_Types].xml': CONTENT_TYPES_PPTX,
    '_rels/.rels': ROOT_RELS_PPTX,
    'ppt/presentation.xml': PRESENTATION,
    'ppt/_rels/presentation.xml.rels': PRESENTATION_RELS,
    'ppt/slides/slide1.xml': SLIDE_1,
    'ppt/slides/slide2.xml': SLIDE_2,
  };
}

// A second package exercising a table and a wired notesSlide: slide1 carries one shape and one table (one row, two cells) and a notesSlide; slide2 has a single shape and no notes.
const CONTENT_TYPES_WITH_NOTES = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/notesSlides/notesSlide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/></Types>',
);

const SLIDE_WITH_SHAPE_AND_TABLE = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:t>Shape one</a:t></a:r></a:p></p:txBody></p:sp><p:graphicFrame><p:xfrm><a:off x="914400" y="914400"/><a:ext cx="914400" cy="914400"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tr><a:tc><a:txBody><a:p><a:r><a:t>Cell A</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>Cell B</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:cSld></p:sld>',
);

const SLIDE_ONE_SHAPE = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:t>Solo shape</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>',
);

const NOTES_SLIDE_1 = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Speaker notes</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>',
);

const SLIDE_1_NOTES_RELS = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/></Relationships>',
);

function pptxWithNotesParts(): Record<string, Uint8Array<ArrayBuffer>> {
  return {
    '[Content_Types].xml': CONTENT_TYPES_WITH_NOTES,
    '_rels/.rels': ROOT_RELS_PPTX,
    'ppt/presentation.xml': PRESENTATION,
    'ppt/_rels/presentation.xml.rels': PRESENTATION_RELS,
    'ppt/slides/slide1.xml': SLIDE_WITH_SHAPE_AND_TABLE,
    'ppt/slides/slide2.xml': SLIDE_ONE_SHAPE,
    'ppt/slides/_rels/slide1.xml.rels': SLIDE_1_NOTES_RELS,
    'ppt/notesSlides/notesSlide1.xml': NOTES_SLIDE_1,
  };
}

function shapeText(shape: { blocks: { kind: string; runs?: { text: string }[] }[] } | undefined): string | undefined {
  const block = shape?.blocks[0];
  return block?.kind === 'paragraph' ? block.runs?.[0]?.text : undefined;
}

describe('readPptxContent', () => {
  it('projects slides in numeric order (via p:sldIdLst) with each shape\'s own text', () => {
    const result = readPptxContent(decodePackage(zipPackage(pptxParts())));
    expect(result.slides).toHaveLength(2);
    expect(shapeText(result.slides[0]?.shapes[0])).toBe('First slide');
    expect(shapeText(result.slides[1]?.shapes[0])).toBe('Second ');
    expect(shapeText(result.slides[1]?.shapes[1])).toBe('slide');
  });

  it('yields an empty slide list when p:sldIdLst is empty -- slide order/presence comes from the presentation part, not from scanning slide files', () => {
    const emptyPresentation = enc(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst/></p:presentation>',
    );
    const result = readPptxContent(
      decodePackage(
        zipPackage({
          '[Content_Types].xml': CONTENT_TYPES_PPTX,
          '_rels/.rels': ROOT_RELS_PPTX,
          'ppt/presentation.xml': emptyPresentation,
        }),
      ),
    );
    expect(result.slides).toEqual([]);
  });

  it('projects per-slide shapes, a table, and resolved notes', () => {
    const result = readPptxContent(decodePackage(zipPackage(pptxWithNotesParts())));
    expect(result.slides).toHaveLength(2);
    const first = result.slides[0];
    const second = result.slides[1];

    // slide1: one text shape, one table graphic frame.
    expect(shapeText(first?.shapes[0])).toBe('Shape one');
    const tableBlock = first?.shapes[1]?.blocks[0];
    if (tableBlock?.kind !== 'table') {
      throw new Error('expected a table block');
    }
    expect(tableBlock.rows).toHaveLength(1);
    expect(tableBlock.rows[0]?.cells).toHaveLength(2);

    // slide1: notes resolved through the slide's /notesSlide relationship.
    expect(first?.notes).toBe('Speaker notes');

    // slide2: a single shape and no notes.
    expect(second?.shapes).toHaveLength(1);
    expect(shapeText(second?.shapes[0])).toBe('Solo shape');
    expect(second?.notes).toBe('');
  });

  it('reads document metadata via readCoreProperties', () => {
    const parts = pptxParts();
    parts['docProps/core.xml'] = enc('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Fixture Deck</dc:title></cp:coreProperties>');
    const result = readPptxContent(decodePackage(zipPackage(parts)));
    expect(result.metadata.title).toBe('Fixture Deck');
  });
});
