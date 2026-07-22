import { describe, expect, it } from 'vitest';
import { decodePackage, zipPackage } from '../index';
import { readXlsx } from './xlsx';

function enc(s: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(s);
}

const CONTENT_TYPES = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>',
);

const ROOT_RELS = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
);

const WORKBOOK = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>',
);

const WORKBOOK_RELS = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
);

const SHARED_STRINGS = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="1" uniqueCount="1"><si><t>Hello</t></si></sst>',
);

const SHEET1 = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>42</v></c></row></sheetData></worksheet>',
);

function xlsxParts(): Record<string, Uint8Array<ArrayBuffer>> {
  return {
    '[Content_Types].xml': CONTENT_TYPES,
    '_rels/.rels': ROOT_RELS,
    'xl/workbook.xml': WORKBOOK,
    'xl/_rels/workbook.xml.rels': WORKBOOK_RELS,
    'xl/sharedStrings.xml': SHARED_STRINGS,
    'xl/worksheets/sheet1.xml': SHEET1,
  };
}

describe('readXlsx', () => {
  it('projects cell values, resolving shared strings and the sheet name via the workbook rels', () => {
    const pkg = decodePackage(zipPackage(xlsxParts()));
    const workbook = readXlsx(pkg);
    expect(workbook.sheets).toHaveLength(1);
    expect(workbook.sheets[0]?.name).toBe('Sheet1');
    expect(workbook.sheets[0]?.cells).toEqual([
      { reference: 'A1', value: 'Hello' },
      { reference: 'B1', value: '42' },
    ]);
  });

  it('returns an empty workbook when there are no worksheet parts', () => {
    const pkg = decodePackage(zipPackage({ '[Content_Types].xml': CONTENT_TYPES, '_rels/.rels': ROOT_RELS }));
    expect(readXlsx(pkg)).toEqual({ sheets: [] });
  });

  it('falls back to the filename-derived Sheet<number> name when the workbook correlation is absent', () => {
    // xl/workbook.xml and its rels are omitted, so the name cannot be correlated; sharedStrings is still present so both cells resolve.
    const pkg = decodePackage(
      zipPackage({
        '[Content_Types].xml': CONTENT_TYPES,
        '_rels/.rels': ROOT_RELS,
        'xl/sharedStrings.xml': SHARED_STRINGS,
        'xl/worksheets/sheet1.xml': SHEET1,
      }),
    );
    const sheet = readXlsx(pkg).sheets[0];
    expect(sheet?.name).toBe('Sheet1');
    expect(sheet?.cells).toEqual([
      { reference: 'A1', value: 'Hello' },
      { reference: 'B1', value: '42' },
    ]);
  });
});
