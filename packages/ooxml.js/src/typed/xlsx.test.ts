import { describe, expect, it } from 'vitest';
import { decodePackage, zipPackage } from '../index';
import { readXlsxWorkbook } from './xlsx';

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

describe('readXlsxWorkbook', () => {
  it('projects cell values, resolving shared strings and the sheet name via the workbook rels', () => {
    const pkg = decodePackage(zipPackage(xlsxParts()));
    const workbook = readXlsxWorkbook(pkg);
    expect(workbook.sheets).toHaveLength(1);
    expect(workbook.sheets[0]?.name).toBe('Sheet1');
    expect(workbook.sheets[0]?.cells).toEqual([
      { reference: 'A1', value: 'Hello' },
      { reference: 'B1', value: '42' },
    ]);
  });

  it('returns an empty workbook when there are no worksheet parts', () => {
    const pkg = decodePackage(zipPackage({ '[Content_Types].xml': CONTENT_TYPES, '_rels/.rels': ROOT_RELS }));
    expect(readXlsxWorkbook(pkg)).toEqual({ sheets: [], definedNames: [] });
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
    const sheet = readXlsxWorkbook(pkg).sheets[0];
    expect(sheet?.name).toBe('Sheet1');
    expect(sheet?.cells).toEqual([
      { reference: 'A1', value: 'Hello' },
      { reference: 'B1', value: '42' },
    ]);
  });

  it('projects cell formulas, merged-cell ranges, and defined names', () => {
    // sheet1 carries a formula cell (both <f> and <v>) and a <mergeCells> block; workbook carries a single defined name.
    const workbookXml = enc(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="Total">Sheet1!$A$1</definedName></definedNames></workbook>',
    );
    const sheet1Xml = enc(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1"><f>SUM(B1:B2)</f><v>3</v></c></row></sheetData><mergeCells count="1"><mergeCell ref="A1:B2"/></mergeCells></worksheet>',
    );
    const pkg = decodePackage(
      zipPackage({
        '[Content_Types].xml': CONTENT_TYPES,
        '_rels/.rels': ROOT_RELS,
        'xl/workbook.xml': workbookXml,
        'xl/_rels/workbook.xml.rels': WORKBOOK_RELS,
        'xl/worksheets/sheet1.xml': sheet1Xml,
      }),
    );
    const workbook = readXlsxWorkbook(pkg);
    expect(workbook.sheets).toHaveLength(1);
    expect(workbook.sheets[0]?.name).toBe('Sheet1');
    expect(workbook.sheets[0]?.cells).toEqual([
      { reference: 'A1', value: '3', formula: 'SUM(B1:B2)' },
    ]);
    expect(workbook.sheets[0]?.mergedRanges).toEqual(['A1:B2']);
    expect(workbook.definedNames).toEqual([{ name: 'Total', refersTo: 'Sheet1!$A$1' }]);
  });

  it('omits the formula field on cells without an <f> child and reports empty merged ranges / defined names when absent', () => {
    const pkg = decodePackage(zipPackage(xlsxParts()));
    const sheet = readXlsxWorkbook(pkg).sheets[0];
    // Cells in SHEET1 have no <f> children, so none carry a formula field.
    expect(sheet?.cells.every((cell) => !('formula' in cell))).toBe(true);
    expect(sheet?.mergedRanges).toEqual([]);
    expect(readXlsxWorkbook(pkg).definedNames).toEqual([]);
  });
});
