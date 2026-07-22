import { describe, expect, it } from 'vitest';
import { decodePackage, zipPackage } from '../index';
import { readPptx } from './pptx';

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

// One `a:t` run on slide 1; two `a:t` runs on slide 2 to exercise per-slide concatenation.
const SLIDE_1 = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>First slide</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>',
);
const SLIDE_2 = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Second </a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:txBody><a:p><a:r><a:t>slide</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>',
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

// A second package exercising shapes, tables, and notes: slide1 carries two shapes, one table (one row, two cells), and a wired notesSlide; slide2 has a single shape and no notes.
const CONTENT_TYPES_WITH_NOTES = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/notesSlides/notesSlide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/></Types>',
);

const SLIDE_WITH_SHAPES_AND_TABLE = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Shape one</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:txBody><a:p><a:r><a:t>Shape two</a:t></a:r></a:p></p:txBody></p:sp><p:graphicFrame><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tr><a:tc><a:txBody><a:p><a:r><a:t>Cell A</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>Cell B</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:cSld></p:sld>',
);

const SLIDE_ONE_SHAPE = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Solo shape</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>',
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
    'ppt/slides/slide1.xml': SLIDE_WITH_SHAPES_AND_TABLE,
    'ppt/slides/slide2.xml': SLIDE_ONE_SHAPE,
    'ppt/slides/_rels/slide1.xml.rels': SLIDE_1_NOTES_RELS,
    'ppt/notesSlides/notesSlide1.xml': NOTES_SLIDE_1,
  };
}

describe('readPptx', () => {
  it('projects slides in numeric order with concatenated `a:t` text', () => {
    const result = readPptx(decodePackage(zipPackage(pptxParts())));
    expect(result.slides).toHaveLength(2);
    const first = result.slides[0];
    const second = result.slides[1];
    expect(first?.index).toBe(1);
    expect(first?.text).toBe('First slide');
    expect(second?.index).toBe(2);
    expect(second?.text).toBe('Second slide');
  });

  it('yields an empty slide list when no slide parts are present', () => {
    const result = readPptx(
      decodePackage(
        zipPackage({
          '[Content_Types].xml': CONTENT_TYPES_PPTX,
          '_rels/.rels': ROOT_RELS_PPTX,
          'ppt/presentation.xml': PRESENTATION,
          'ppt/_rels/presentation.xml.rels': PRESENTATION_RELS,
        }),
      ),
    );
    expect(result.slides).toEqual([]);
  });

  it('projects per-slide shapes, tables, and resolved notes', () => {
    const result = readPptx(decodePackage(zipPackage(pptxWithNotesParts())));
    expect(result.slides).toHaveLength(2);
    const first = result.slides[0];
    const second = result.slides[1];

    // slide1: two shapes, each carrying its own txBody text.
    expect(first?.shapes).toHaveLength(2);
    expect(first?.shapes[0]?.text).toBe('Shape one');
    expect(first?.shapes[1]?.text).toBe('Shape two');

    // slide1: one table, one row, two cells.
    expect(first?.tables).toHaveLength(1);
    expect(first?.tables[0]?.rows).toHaveLength(1);
    expect(first?.tables[0]?.rows[0]?.cells).toHaveLength(2);
    expect(first?.tables[0]?.rows[0]?.cells[0]?.text).toBe('Cell A');
    expect(first?.tables[0]?.rows[0]?.cells[1]?.text).toBe('Cell B');

    // slide1: notes resolved through the slide's /notesSlide relationship.
    expect(first?.notes).toBe('Speaker notes');

    // slide2: a single shape and no notes.
    expect(second?.shapes).toHaveLength(1);
    expect(second?.shapes[0]?.text).toBe('Solo shape');
    expect(second?.tables).toEqual([]);
    expect(second?.notes).toBe('');
  });
});
