import { describe, expect, it } from "vitest";
import { decodePackage, encodePackage, zipPackage } from "./index";

function enc(s: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(s);
}

const CONTENT_TYPES_DOCX = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/media/image1.png" ContentType="image/png"/></Types>',
);
const CONTENT_TYPES_PPTX = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>',
);
const CONTENT_TYPES_XLSX = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
);

const ROOT_RELS_DOCX = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
);
const ROOT_RELS_PPTX = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>',
);
const ROOT_RELS_XLSX = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
);

const PNG_BYTES: Uint8Array<ArrayBuffer> = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5,
]);

function docxParts(): Record<string, Uint8Array<ArrayBuffer>> {
  return {
    "[Content_Types].xml": CONTENT_TYPES_DOCX,
    "_rels/.rels": ROOT_RELS_DOCX,
    "word/document.xml": enc(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p w:rsidR="00112233"><w:r><w:t xml:space="preserve">Hello &amp; world </w:t></w:r></w:p></w:body></w:document>',
    ),
    "word/media/image1.png": PNG_BYTES,
  };
}

function pptxParts(): Record<string, Uint8Array<ArrayBuffer>> {
  return {
    "[Content_Types].xml": CONTENT_TYPES_PPTX,
    "_rels/.rels": ROOT_RELS_PPTX,
    "ppt/presentation.xml": enc(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId r:id="rId1"/></p:sldIdLst></p:presentation>',
    ),
    "ppt/_rels/presentation.xml.rels": enc(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>',
    ),
    "ppt/slides/slide1.xml": enc(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Slide text</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>',
    ),
  };
}

function xlsxParts(): Record<string, Uint8Array<ArrayBuffer>> {
  return {
    "[Content_Types].xml": CONTENT_TYPES_XLSX,
    "_rels/.rels": ROOT_RELS_XLSX,
    "xl/workbook.xml": enc(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>',
    ),
    "xl/_rels/workbook.xml.rels": enc(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    ),
    "xl/worksheets/sheet1.xml": enc(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1"><v>42</v></c></row></sheetData></worksheet>',
    ),
  };
}

// The core guarantee: decode -> encode -> decode is idempotent, so the Package model is a fixed point and the encoded bytes carry the same content as the decoded input.
describe("package round-trip (decode -> encode -> decode)", () => {
  for (const [format, parts] of [
    ["docx", docxParts()],
    ["pptx", pptxParts()],
    ["xlsx", xlsxParts()],
  ] as const) {
    it(`${format}: is idempotent`, () => {
      const pkg1 = decodePackage(zipPackage(parts));
      const pkg2 = decodePackage(encodePackage(pkg1));
      expect(pkg2).toEqual(pkg1);
    });

    it(`${format}: preserves the part set`, () => {
      const pkg1 = decodePackage(zipPackage(parts));
      expect(Object.keys(pkg1.parts).sort()).toEqual(Object.keys(parts).sort());
    });
  }

  it("docx: binary part round-trips losslessly", () => {
    const pkg1 = decodePackage(zipPackage(docxParts()));
    const binary = pkg1.parts["word/media/image1.png"];
    expect(binary?.kind === "binary").toBe(true);
    const pkg2 = decodePackage(encodePackage(pkg1));
    expect(pkg2.parts["word/media/image1.png"]).toEqual(binary);
  });

  it("docx: XML part preserves namespaced attributes and entities", () => {
    const pkg = decodePackage(zipPackage(docxParts()));
    const document = pkg.parts["word/document.xml"];
    expect(document?.kind === "xml").toBe(true);
    if (document?.kind === "xml") {
      const xml = new TextDecoder().decode(
        new TextEncoder().encode(JSON.stringify(document)),
      );
      expect(xml).toContain("Hello &amp; world");
      expect(xml).toContain("w:rsidR");
    }
  });
});
