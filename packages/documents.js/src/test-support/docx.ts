import type { Package } from "ooxml.js";
import { decodePackage, zipPackage } from "ooxml.js";

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

const STYLES_XML = stylesXml("Calibri");

const DOCUMENT_XML = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t xml:space="preserve">Hello, world!</w:t></w:r></w:p><w:tbl><w:tblGrid><w:gridCol w:w="4500"/><w:gridCol w:w="4500"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B1</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>',
);

function docxParts(
  styles: Uint8Array<ArrayBuffer> = STYLES_XML,
): Record<string, Uint8Array<ArrayBuffer>> {
  return {
    "[Content_Types].xml": CONTENT_TYPES_XML,
    "_rels/.rels": ROOT_RELS_XML,
    "word/document.xml": DOCUMENT_XML,
    "word/_rels/document.xml.rels": DOCUMENT_RELS_XML,
    "word/styles.xml": styles,
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
  return zipPackage(docxParts(stylesXml("Arial")));
}

// A second, structurally authentic docx package exercising every part readDocx (ooxml.js) reads that readDocxContent (./read.ts, this package) does not carry through ContentDocument at all -- comments, footnotes (including the separator/continuationSeparator pair readDocx's own readFootnotes filters out), headers/footers, and a numbering (abstractNum/num) definition -- for readDocxExtras' (./extras.ts) own round-trip test. Full content-type overrides and relationships are included for realism even though readDocx itself locates comments/footnotes/numbering by fixed part path and headers/footers by path prefix, needing no relationship at all.
const EXTRAS_CONTENT_TYPES_XML = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/><Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>',
);

const EXTRAS_DOCUMENT_RELS_XML = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/><Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>',
);

const EXTRAS_DOCUMENT_XML = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    "<w:body>" +
    '<w:p><w:commentRangeStart w:id="0"/><w:r><w:t xml:space="preserve">Reviewed text</w:t></w:r><w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p>' +
    '<w:p><w:r><w:t xml:space="preserve">See the note below</w:t></w:r><w:r><w:footnoteReference w:id="1"/></w:r></w:p>' +
    '<w:p><w:pPr><w:numPr><w:numId w:val="1"/><w:ilvl w:val="0"/></w:numPr></w:pPr><w:r><w:t xml:space="preserve">First item</w:t></w:r></w:p>' +
    '<w:sectPr><w:headerReference w:type="default" r:id="rId5" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/><w:footerReference w:type="default" r:id="rId6" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>' +
    "</w:body></w:document>",
);

const EXTRAS_COMMENTS_XML = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:comment w:id="0" w:author="Jane Doe"><w:p><w:r><w:t>This needs a citation.</w:t></w:r></w:p></w:comment></w:comments>',
);

const EXTRAS_FOOTNOTES_XML = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' +
    '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>' +
    '<w:footnote w:id="1"><w:p><w:r><w:t>See appendix A for details.</w:t></w:r></w:p></w:footnote>' +
    "</w:footnotes>",
);

const EXTRAS_NUMBERING_XML = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum>' +
    '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' +
    "</w:numbering>",
);

const EXTRAS_HEADER_XML = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Header text</w:t></w:r></w:p></w:hdr>',
);

const EXTRAS_FOOTER_XML = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Footer text</w:t></w:r></w:p></w:ftr>',
);

export function docxWithExtrasPackage(): Package {
  return decodePackage(
    zipPackage({
      "[Content_Types].xml": EXTRAS_CONTENT_TYPES_XML,
      "_rels/.rels": ROOT_RELS_XML,
      "word/document.xml": EXTRAS_DOCUMENT_XML,
      "word/_rels/document.xml.rels": EXTRAS_DOCUMENT_RELS_XML,
      "word/styles.xml": STYLES_XML,
      "word/comments.xml": EXTRAS_COMMENTS_XML,
      "word/footnotes.xml": EXTRAS_FOOTNOTES_XML,
      "word/numbering.xml": EXTRAS_NUMBERING_XML,
      "word/header1.xml": EXTRAS_HEADER_XML,
      "word/footer1.xml": EXTRAS_FOOTER_XML,
    }),
  );
}

// A one-row, two-column table whose SECOND cell's paragraph carries nothing but an inline m:oMath equation -- the case spliceDocxEmbeddedObjects used to skip entirely (collectBodyParagraphs deliberately excluded w:tbl, so a cell's equation had no paragraph-ordinal correspondence and no top-level position to splice into). The first cell is ordinary text, so a correct recovery leaves it untouched and recovers only the second cell's equation.
const TABLE_CELL_EQUATION_DOCUMENT_XML = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:body><w:tbl><w:tblGrid><w:gridCol w:w="4500"/><w:gridCol w:w="4500"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>plain cell</w:t></w:r></w:p></w:tc><w:tc><w:p><m:oMath><m:r><m:t>x</m:t></m:r></m:oMath></w:p></w:tc></w:tr></w:tbl><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>',
);

export function docxWithTableCellEquationPackage(): Package {
  return decodePackage(
    zipPackage({
      "[Content_Types].xml": CONTENT_TYPES_XML,
      "_rels/.rels": ROOT_RELS_XML,
      "word/document.xml": TABLE_CELL_EQUATION_DOCUMENT_XML,
      "word/_rels/document.xml.rels": DOCUMENT_RELS_XML,
      "word/styles.xml": STYLES_XML,
    }),
  );
}
