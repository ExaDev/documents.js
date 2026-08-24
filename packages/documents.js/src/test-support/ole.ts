import { encodePng } from "byte-codec";
import { zipPackage } from "ooxml.js";

// Never imported by src/index.ts and never reaches dist/ (see docx.ts's top-of-file comment for the reasoning). Host fixtures carrying a real OLE-embedded object -- the markup shape ooxml.js's OLE readers recover a ContentEmbeddedObjectBlock from (pptx: a p:graphicFrame whose p:oleObj names an embeddings relationship; docx: a w:object whose o:OLEObject does the same, with the classic VML preview spelling alongside). Each host's embeddings relationship targets a part whose bytes are a genuine minimal xlsx package, so a reader under test recovers a real nested spreadsheet document (a named sheet and a distinctive cell a test can assert on), never an empty envelope. Shared by the bijection corpus (src/convert/bijection.test.ts), which is why the builders return bytes: every corpus entry goes through the same real decode the conversions themselves use.

function enc(s: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(s);
}

// A real 2x2 PNG, so the pptx fixture's fallback picture (the raster a renderer displays in the OLE frame's place) is an image a layout engine can genuinely decode and paint, not just magic bytes a sniffer accepts.
function oleFallbackPng(): Uint8Array<ArrayBuffer> {
  return encodePng({
    width: 2,
    height: 2,
    channels: 3,
    data: new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]),
  });
}

// The embedded payload itself: a minimal but genuinely real xlsx package (workbook + one worksheet, one inline-string cell), the way a modern producer writes an embedded workbook. Mirrors ooxml.js's own src/test-support/embedded.ts fixture byte-for-byte in content, rebuilt locally because that package's test-support is deliberately excluded from its published dist.
export function embeddedXlsxBytes(): Uint8Array<ArrayBuffer> {
  return zipPackage({
    "[Content_Types].xml": enc(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    ),
    "_rels/.rels": enc(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    ),
    "xl/workbook.xml": enc(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Embedded" sheetId="1" r:id="rId1"/></sheets></workbook>',
    ),
    "xl/_rels/workbook.xml.rels": enc(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    ),
    "xl/worksheets/sheet1.xml": enc(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Recovered cell</t></is></c></row></sheetData></worksheet>',
    ),
  });
}

// A one-slide host pptx whose slide carries an OLE graphic frame in the real-world spelling: mc:AlternateContent wraps the mc:Choice side's p:oleObj (naming the payload relationship) and the mc:Fallback side's p:oleObj carrying the raster picture every renderer actually displays. The embeddings part the payload relationship targets really exists and is a genuine xlsx, so the read recovers both the fallback image block and the embedded spreadsheet beside it.
export function oleEmbeddedPptxBytes(): Uint8Array<ArrayBuffer> {
  return zipPackage({
    "[Content_Types].xml": enc(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>',
    ),
    "_rels/.rels": enc(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>',
    ),
    "ppt/presentation.xml": enc(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>',
    ),
    "ppt/_rels/presentation.xml.rels": enc(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>',
    ),
    "ppt/slides/slide1.xml": enc(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><p:cSld><p:spTree><p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="2" name="Object 1"/></p:nvGraphicFramePr><p:xfrm><a:off x="914400" y="1828800"/><a:ext cx="4572000" cy="2743200"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/presentationml/2006/ole"><mc:AlternateContent><mc:Choice Requires="v"><p:oleObj spid="3" r:id="rIdOle" progId="Excel.Sheet.12" showAsIcon="0"><p:embed/></p:oleObj></mc:Choice><mc:Fallback><p:oleObj spid="3" r:id="rIdOle" progId="Excel.Sheet.12"><p:pic><p:nvPicPr><p:cNvPr id="4" name="Fallback Picture"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rIdFallback"/></p:blipFill></p:pic></p:oleObj></mc:Fallback></mc:AlternateContent></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:cSld></p:sld>',
    ),
    "ppt/slides/_rels/slide1.xml.rels": enc(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdOle" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject" Target="../embeddings/oleObject1.xlsx"/><Relationship Id="rIdFallback" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/oleFallback.png"/></Relationships>',
    ),
    "ppt/embeddings/oleObject1.xlsx": embeddedXlsxBytes(),
    "ppt/media/oleFallback.png": oleFallbackPng(),
  });
}

// A one-paragraph host docx whose single run carries a w:object in the real-world inline spelling: w:dxaOrig/w:dyaOrig size it, the VML v:shape > v:imagedata names the preview picture rendered in its place (a spelling the docx reader has no path for, so the preview contributes no image block), and o:OLEObject names the payload relationship, whose target part really exists and is a genuine xlsx -- so the read recovers the embedded spreadsheet as a sibling block beside the paragraph's own.
export function oleEmbeddedDocxBytes(): Uint8Array<ArrayBuffer> {
  return zipPackage({
    "[Content_Types].xml": enc(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ),
    "_rels/.rels": enc(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    ),
    "word/document.xml": enc(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:r><w:object w:dxaOrig="1920" w:dyaOrig="1200"><v:shape id="_x0000_i1025" type="#_x0000_t75" style="width:96pt;height:60pt"><v:imagedata r:id="rIdPreview" o:title=""/></v:shape><o:OLEObject Type="Embed" ProgID="Excel.Sheet.12" ShapeID="_x0000_i1025" DrawAspect="Content" ObjectID="_1702998213" r:id="rIdOle"/></w:object></w:r></w:p><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>',
    ),
    "word/_rels/document.xml.rels": enc(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdOle" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject" Target="embeddings/oleObject1.xlsx"/><Relationship Id="rIdPreview" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/olePreview.png"/></Relationships>',
    ),
    "word/embeddings/oleObject1.xlsx": embeddedXlsxBytes(),
    "word/media/olePreview.png": oleFallbackPng(),
  });
}
