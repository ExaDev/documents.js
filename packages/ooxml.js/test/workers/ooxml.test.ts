import { describe, expect, it } from 'vitest';
import { buildXlsxPackage, decodePackage, encodePackage, flattenPackage, readXlsx, readXlsxContent, zipPackage } from '../../src';

// Proves ooxml.js's xlsx decode path executes inside a Cloudflare Workers isolate (workerd, via @cloudflare/vitest-pool-workers) with no Node-only APIs. The path under test -- zipPackage (fflate, pure JS) -> decodePackage -> readXlsxContent (fast-xml-parser, pure JS) -- is deliberately Node-free; if any step touched node:fs/Buffer/process the workerd isolate would throw rather than these passing. The minimal xlsx parts are built inline as a Record<string, Uint8Array> (no node:fs/readFileSync -- workerd has no fs) and round-trip through the same zip/decode path src/typed/xlsx.test.ts already exercises under node. This is the runtime proof for ooxml.js issue #17. The second test extends the same proof to the DocumentPackage boundary readXlsx/buildXlsxPackage sit on, since a structural transform is exactly the sort of pure-object code that could quietly acquire a Node dependency without any test noticing under node.
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

// A complete minimal xlsx package: the parts every spreadsheet reader needs (root content-types, root rels, workbook, workbook rels, one worksheet). The worksheet carries a single row with a single inline-string cell (t="inlineStr") so no shared-strings part is required -- the cell's own <is><t> holds its value directly.
function minimalXlsxParts(): Record<string, Uint8Array> {
  return {
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
}

describe('ooxml.js xlsx decode and package assembly under the Cloudflare Workers runtime', () => {
  it('decodes a minimal xlsx built inline and reads it back as a spreadsheet content document', () => {
    // zipPackage (fflate) -> decodePackage -> readXlsxContent: the full decode path src/typed/xlsx.test.ts exercises under node, now running inside a workerd isolate. No Node Buffer, no fs, no process.
    const bytes = zipPackage(minimalXlsxParts());
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

  it('assembles and writes the tree-form DocumentPackage inside the isolate too', () => {
    // The DocumentPackage boundary (document-schema.js's decompose/factorStyles on the way out, flattenPackage on the way back in) is pure structural transformation over plain objects, so it belongs on the Worker-isomorphic side of this package exactly as the codecs do -- asserted rather than assumed, since the whole point of this suite is that nothing in the published path quietly reaches for a Node API.
    const pkg = decodePackage(zipPackage(minimalXlsxParts()));
    const document = readXlsx(pkg);

    expect(document.kind).toBe('spreadsheet');
    expect(document.kind === 'spreadsheet' ? document.children[0]?.node.name : undefined).toBe('Sheet1');
    // The tree's inverse, run in the isolate: flattening it back reproduces exactly what the content-level reader returns.
    expect(flattenPackage(document)).toEqual(readXlsxContent(pkg));

    // And the write side, all the way back out to bytes. What survives the pair is src/typed/document-package.test.ts's business, not this suite's -- here the point is only that every step of it executes under workerd, so this asserts the cell rather than the whole package.
    const rewritten = readXlsx(decodePackage(encodePackage(buildXlsxPackage(document))));
    expect(rewritten.kind === 'spreadsheet' ? rewritten.children[0]?.node.cells[0]?.value : undefined).toEqual({ kind: 'string', value: 'Hello from workerd' });
  });
});
