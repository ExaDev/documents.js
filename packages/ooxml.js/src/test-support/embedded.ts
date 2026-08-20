import { zipPackage } from '../zip';

// Minimal but genuinely real OOXML package bytes for embedded-object fixtures: each builder mints a valid single-document package zipped from raw parts (the same pattern test/workers/ooxml.test.ts uses for its standalone xlsx), carrying distinctive content a test can assert on so a passing test proves the nested reader genuinely recovered the sub-document rather than an empty envelope. Shared by every suite that needs embedded-payload bytes -- typed/embedded.test.ts (helper-level), typed/pptx/read.test.ts (host-pptx integration), and the workerd proof in test/workers -- so the payloads stay identical across all three. Test-support only: tsdown.config.ts excludes src/test-support from the published dist, per the family convention odf.js established.

const enc = (s: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(s);

const CONTENT_TYPES_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>';
const ROOT_RELS_FOR = (target: string): Uint8Array<ArrayBuffer> =>
  enc(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${target}"/></Relationships>`,
  );

export function minimalXlsxBytes(): Uint8Array<ArrayBuffer> {
  return zipPackage({
    '[Content_Types].xml': enc(
      `${CONTENT_TYPES_HEADER}<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    ),
    '_rels/.rels': ROOT_RELS_FOR('xl/workbook.xml'),
    'xl/workbook.xml': enc(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Embedded" sheetId="1" r:id="rId1"/></sheets></workbook>',
    ),
    'xl/_rels/workbook.xml.rels': enc(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    ),
    'xl/worksheets/sheet1.xml': enc(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Recovered cell</t></is></c></row></sheetData></worksheet>',
    ),
  });
}

export function minimalDocxBytes(): Uint8Array<ArrayBuffer> {
  return zipPackage({
    '[Content_Types].xml': enc(
      `${CONTENT_TYPES_HEADER}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    ),
    '_rels/.rels': ROOT_RELS_FOR('word/document.xml'),
    'word/document.xml': enc(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Embedded memo</w:t></w:r></w:p></w:body></w:document>',
    ),
  });
}

export function minimalPptxBytes(): Uint8Array<ArrayBuffer> {
  return zipPackage({
    '[Content_Types].xml': enc(
      `${CONTENT_TYPES_HEADER}<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>`,
    ),
    '_rels/.rels': ROOT_RELS_FOR('ppt/presentation.xml'),
    'ppt/presentation.xml': enc(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId r:id="rId1"/></p:sldIdLst></p:presentation>',
    ),
    'ppt/_rels/presentation.xml.rels': enc(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>',
    ),
    'ppt/slides/slide1.xml': enc(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:t>Embedded slide</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>',
    ),
  });
}
