import { describe, expect, it } from 'vitest';
import { decodePackage, zipPackage } from '../index';
import { readDocx } from './docx';

function enc(s: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(s);
}

const CONTENT_TYPES_DOCX = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
);

const ROOT_RELS_DOCX = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
);

// Paragraph 1: one bold run. Paragraph 2: one run whose text holds an ampersand entity, exercising entity decoding.
const DOCUMENT_XML = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Bold run</w:t></w:r></w:p><w:p><w:r><w:t>Tom &amp; Jerry</w:t></w:r></w:p></w:body></w:document>',
);

function docxParts(): Record<string, Uint8Array<ArrayBuffer>> {
  return {
    '[Content_Types].xml': CONTENT_TYPES_DOCX,
    '_rels/.rels': ROOT_RELS_DOCX,
    'word/document.xml': DOCUMENT_XML,
  };
}

describe('readDocx', () => {
  it('projects paragraphs, runs, and text with the bold toggle', () => {
    const result = readDocx(decodePackage(zipPackage(docxParts())));
    expect(result.paragraphs).toHaveLength(2);

    const firstRun = result.paragraphs[0]?.runs[0];
    const secondRun = result.paragraphs[1]?.runs[0];

    expect(firstRun?.text).toBe('Bold run');
    expect(firstRun?.bold).toBe(true);
    expect(firstRun?.italic).toBeUndefined();

    expect(secondRun?.text).toBe('Tom & Jerry');
    expect(secondRun?.bold).toBeUndefined();
  });

  it('throws when word/document.xml is missing', () => {
    const pkg = decodePackage(
      zipPackage({
        '[Content_Types].xml': CONTENT_TYPES_DOCX,
        '_rels/.rels': ROOT_RELS_DOCX,
      }),
    );
    expect(() => readDocx(pkg)).toThrow(/word\/document\.xml/);
  });
});
