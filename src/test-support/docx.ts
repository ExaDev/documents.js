import type { Package } from 'ooxml.js';
import { decodePackage, zipPackage } from 'ooxml.js';

// Never imported by src/index.ts and never reaches dist/ -- this module exists purely to give tests a realistic, hand-authored docx fixture without committing a binary Office file. Built from XML string constants and zipped via ooxml.js's own zipPackage/decodePackage -- never via this package's own createEmptyDocxPackage (src/edit/docx/scaffold.ts), so a bug in that scaffold cannot hide behind a fixture built with the same code.

function enc(s: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(s);
}

const CONTENT_TYPES_XML = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
);

const ROOT_RELS_XML = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
);

const DOCUMENT_RELS_XML = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
);

// Parameterised by family purely so a second fixture can ask for a standard-14-resolvable one; STYLES_XML below pins the default at Calibri, which is what every existing caller of minimalDocxPackage/minimalDocxBytes has always got (and is what Word itself writes).
function stylesXml(fontFamily: string): Uint8Array<ArrayBuffer> {
  return enc(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${fontFamily}" w:hAnsi="${fontFamily}"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style></w:styles>`,
  );
}

const STYLES_XML = stylesXml('Calibri');

const DOCUMENT_XML = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t xml:space="preserve">Hello, world!</w:t></w:r></w:p><w:tbl><w:tblGrid><w:gridCol w:w="4500"/><w:gridCol w:w="4500"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B1</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>',
);

function docxParts(styles: Uint8Array<ArrayBuffer> = STYLES_XML): Record<string, Uint8Array<ArrayBuffer>> {
  return {
    '[Content_Types].xml': CONTENT_TYPES_XML,
    '_rels/.rels': ROOT_RELS_XML,
    'word/document.xml': DOCUMENT_XML,
    'word/_rels/document.xml.rels': DOCUMENT_RELS_XML,
    'word/styles.xml': styles,
  };
}

// A minimal but structurally authentic docx package: one paragraph, one 2x1 table, and a styles part with a docDefaults -> Normal -> Heading1 basedOn chain (enough to exercise the style cascade). Its docDefaults ask for Calibri, which is what Word writes and therefore what most fixtures want -- but note that Calibri is one of the two families pdf-codec's font registry has a vendored metric-compatible substitute for, so converting this fixture to PDF genuinely embeds a Carlito face rather than falling back to a standard-14 one. Use standardFontDocxBytes below wherever a test needs the standard-14 path instead.
export function minimalDocxPackage(): Package {
  return decodePackage(zipPackage(docxParts()));
}

export function minimalDocxBytes(): Uint8Array<ArrayBuffer> {
  return zipPackage(docxParts());
}

// The same document, asking for Arial: a family the standard 14 covers directly (Helvetica is metric-compatible with it) and which no vendored substitute claims, so a conversion of this fixture resolves every run to a standard font and embeds nothing.
export function standardFontDocxBytes(): Uint8Array<ArrayBuffer> {
  return zipPackage(docxParts(stylesXml('Arial')));
}
