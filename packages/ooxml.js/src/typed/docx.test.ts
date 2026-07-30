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

// A representative package exercising the expanded constructs: a 2x2 table, a hyperlink resolved through the document rels, a header, a footer, a comment, a real footnote plus a separator footnote, and a numbered list paragraph.
const RICH_CONTENT_TYPES = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/><Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>',
);

const RICH_ROOT_RELS = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
);

const RICH_DOCUMENT_RELS = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com" TargetMode="External"/></Relationships>',
);

const RICH_DOCUMENT_XML = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:tbl><w:tr><w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B1</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>A2</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B2</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:hyperlink r:id="rId9"><w:r><w:t>link text</w:t></w:r></w:hyperlink></w:p><w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>list item</w:t></w:r></w:p></w:body></w:document>',
);

const RICH_HEADER_XML = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Header text</w:t></w:r></w:p></w:hdr>',
);

const RICH_FOOTER_XML = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Footer text</w:t></w:r></w:p></w:ftr>',
);

const RICH_COMMENTS_XML = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:comment w:id="0" w:author="Ann"><w:p><w:r><w:t>comment text</w:t></w:r></w:p></w:comment></w:comments>',
);

const RICH_FOOTNOTES_XML = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:footnote w:id="-1" w:type="separator"><w:p><w:r><w:t></w:t></w:r></w:p></w:footnote><w:footnote w:id="1"><w:p><w:r><w:t>real footnote</w:t></w:r></w:p></w:footnote></w:footnotes>',
);

function richDocxParts(): Record<string, Uint8Array<ArrayBuffer>> {
  return {
    '[Content_Types].xml': RICH_CONTENT_TYPES,
    '_rels/.rels': RICH_ROOT_RELS,
    'word/_rels/document.xml.rels': RICH_DOCUMENT_RELS,
    'word/document.xml': RICH_DOCUMENT_XML,
    'word/header1.xml': RICH_HEADER_XML,
    'word/footer1.xml': RICH_FOOTER_XML,
    'word/comments.xml': RICH_COMMENTS_XML,
    'word/footnotes.xml': RICH_FOOTNOTES_XML,
  };
}

describe('readDocx expanded constructs', () => {
  it('projects a 2x2 table into rows of cells, each carrying its paragraph text', () => {
    const result = readDocx(decodePackage(zipPackage(richDocxParts())));
    expect(result.tables).toHaveLength(1);

    const table = result.tables[0];
    expect(table?.rows).toHaveLength(2);

    expect(table?.rows[0]?.cells).toHaveLength(2);
    expect(table?.rows[0]?.cells[0]?.paragraphs[0]?.runs[0]?.text).toBe('A1');
    expect(table?.rows[0]?.cells[1]?.paragraphs[0]?.runs[0]?.text).toBe('B1');

    expect(table?.rows[1]?.cells).toHaveLength(2);
    expect(table?.rows[1]?.cells[0]?.paragraphs[0]?.runs[0]?.text).toBe('A2');
    expect(table?.rows[1]?.cells[1]?.paragraphs[0]?.runs[0]?.text).toBe('B2');
  });

  it('resolves a hyperlink target through the document rels part', () => {
    const result = readDocx(decodePackage(zipPackage(richDocxParts())));
    expect(result.hyperlinks).toHaveLength(1);
    expect(result.hyperlinks[0]?.text).toBe('link text');
    expect(result.hyperlinks[0]?.target).toBe('https://example.com');
  });

  it('reads header and footer text from their parts', () => {
    const result = readDocx(decodePackage(zipPackage(richDocxParts())));
    expect(result.headers).toEqual(['Header text']);
    expect(result.footers).toEqual(['Footer text']);
  });

  it('reads comment author and text from word/comments.xml', () => {
    const result = readDocx(decodePackage(zipPackage(richDocxParts())));
    expect(result.comments).toHaveLength(1);
    expect(result.comments[0]?.author).toBe('Ann');
    expect(result.comments[0]?.text).toBe('comment text');
  });

  it('reads footnotes and skips separator and continuation marks', () => {
    const result = readDocx(decodePackage(zipPackage(richDocxParts())));
    expect(result.footnotes).toHaveLength(1);
    expect(result.footnotes[0]?.text).toBe('real footnote');
    expect(result.footnotes[0]?.type).toBeUndefined();
  });

  it('reads list membership from a paragraph w:numPr', () => {
    const result = readDocx(decodePackage(zipPackage(richDocxParts())));
    const listParagraph = result.paragraphs.find((p) => p.list !== undefined);
    expect(listParagraph?.list).toEqual({ numId: '1', level: 0 });
  });

  // w:ilvl's w:val is a raw XML attribute string; readListMembership must coerce it with Number() rather than passing it through, or ListMembership.level (typed as z.number()) silently holds a string at runtime.
  it('coerces w:ilvl to a number, not the raw XML attribute string', () => {
    const documentXml = enc(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:numPr><w:ilvl w:val="2"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>nested item</w:t></w:r></w:p></w:body></w:document>',
    );
    const result = readDocx(
      decodePackage(
        zipPackage({
          '[Content_Types].xml': CONTENT_TYPES_DOCX,
          '_rels/.rels': ROOT_RELS_DOCX,
          'word/document.xml': documentXml,
        }),
      ),
    );
    const list = result.paragraphs[0]?.list;
    expect(typeof list?.level).toBe('number');
    expect(list?.level).toBe(2);
  });

  it('leaves list undefined on a plain paragraph', () => {
    const result = readDocx(decodePackage(zipPackage(docxParts())));
    expect(result.tables).toEqual([]);
    expect(result.hyperlinks).toEqual([]);
    expect(result.comments).toEqual([]);
    expect(result.footnotes).toEqual([]);
    expect(result.headers).toEqual([]);
    expect(result.footers).toEqual([]);
    for (const paragraph of result.paragraphs) {
      expect(paragraph.list).toBeUndefined();
    }
  });

  // Regression: a table cell's paragraph must not also surface in the flat `paragraphs` field. Before the fix, `paragraphs` was built with an unrestricted recursive descendant search that found every w:p including ones nested inside w:tbl/w:tr/w:tc, duplicating each cell paragraph alongside its already-correct representation under `tables`.
  it('excludes table-cell paragraphs from the flat paragraphs list', () => {
    const documentXml = enc(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Body paragraph</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cell paragraph</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>',
    );
    const result = readDocx(
      decodePackage(
        zipPackage({
          '[Content_Types].xml': CONTENT_TYPES_DOCX,
          '_rels/.rels': ROOT_RELS_DOCX,
          'word/document.xml': documentXml,
        }),
      ),
    );

    expect(result.paragraphs).toHaveLength(1);
    expect(result.paragraphs[0]?.runs[0]?.text).toBe('Body paragraph');

    expect(result.tables).toHaveLength(1);
    expect(result.tables[0]?.rows[0]?.cells[0]?.paragraphs).toHaveLength(1);
    expect(result.tables[0]?.rows[0]?.cells[0]?.paragraphs[0]?.runs[0]?.text).toBe('Cell paragraph');
  });

  // Regression guard against overcorrection: a paragraph wrapped in a w:sdt content control (not inside a table) is genuine body-level reading-order content and must still appear in the flat paragraphs list.
  it('still includes a paragraph nested inside a w:sdt content control', () => {
    const documentXml = enc(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:sdt><w:sdtContent><w:p><w:r><w:t>SDT paragraph</w:t></w:r></w:p></w:sdtContent></w:sdt></w:body></w:document>',
    );
    const result = readDocx(
      decodePackage(
        zipPackage({
          '[Content_Types].xml': CONTENT_TYPES_DOCX,
          '_rels/.rels': ROOT_RELS_DOCX,
          'word/document.xml': documentXml,
        }),
      ),
    );

    expect(result.paragraphs).toHaveLength(1);
    expect(result.paragraphs[0]?.runs[0]?.text).toBe('SDT paragraph');
  });
});
