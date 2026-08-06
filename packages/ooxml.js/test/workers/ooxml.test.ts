import { describe, expect, it } from 'vitest';
import { decodePackage, readXlsxContent, zipPackage } from '../../src';

// Proves ooxml.js's xlsx decode path executes inside a Cloudflare Workers isolate (workerd, via @cloudflare/vitest-pool-workers) with no Node-only APIs. The path under test -- zipPackage (fflate, pure JS) -> decodePackage -> readXlsxContent (fast-xml-parser, pure JS) -- is deliberately Node-free; if any step touched node:fs/Buffer/process the workerd isolate would throw rather than these passing. The minimal xlsx parts are built inline as a Record<string, Uint8Array> (no node:fs/readFileSync -- workerd has no fs) and round-trip through the same zip/decode path src/typed/xlsx.test.ts already exercises under node. This is the runtime proof for ooxml.js issue #17.
describe('ooxml.js xlsx decode under the Cloudflare Workers runtime', () => {
  it('decodes a minimal xlsx built inline and reads it back as a spreadsheet content document', () => {
    const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

    // A complete minimal xlsx package: the five parts every spreadsheet reader needs (root content-types, root rels, workbook, workbook rels, one worksheet) plus a sixth optional one this package's readXlsxContent is designed to consume. The worksheet carries a single row with a single inline-string cell (t="inlineStr") so no shared-strings part is required -- the cell's own <is><t> holds its value directly.
    const parts: Record<string, Uint8Array> = {
      '[Content_Types].xml': enc(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
      ),
      '_rels/.rels': enc(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      ),
      'xl/workbook.xml': enc(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>',
      ),
      'xl/_rels/workbook.xml.rels': enc(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
      ),
      'xl/worksheets/sheet1.xml': enc(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Hello from workerd</t></is></c></row></sheetData></worksheet>',
      ),
    };

    // zipPackage (fflate) -> decodePackage -> readXlsxContent: the full decode path src/typed/xlsx.test.ts exercises under node, now running inside a workerd isolate. No Node Buffer, no fs, no process.
    const bytes = zipPackage(parts);
    const pkg = decodePackage(bytes);
    const document = readXlsxContent(pkg);

    expect(document.kind).toBe('spreadsheet');
    expect(document.sheets).toHaveLength(1);
    expect(document.sheets[0]?.name).toBe('Sheet1');
    // ContentSheet.cells is a flat array indexed by position, each carrying its own row/column indices -- the inline-string cell at A1 reads as a string ContentCellValue at row 0, column 0.
    const cell = document.sheets[0]?.cells[0];
    expect(cell?.row).toBe(0);
    expect(cell?.column).toBe(0);
    expect(cell?.value).toEqual({ kind: 'string', value: 'Hello from workerd' });
  });
});
