import type { Package } from "ooxml.js";
import { decodePackage, zipPackage } from "ooxml.js";

// Never imported by src/index.ts and never reaches dist/. See docx.ts's top-of-file comment -- the same reasoning applies here.

function enc(s: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(s);
}

const CONTENT_TYPES_XML = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>',
);

const ROOT_RELS_XML = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>',
);

// sldSz is 12192000 x 6858000 EMU -- PowerPoint's default 16:9 widescreen size (960 x 540 pt).
const PRESENTATION_XML = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>',
);

const PRESENTATION_RELS_XML = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>',
);

// One shape with an explicit xfrm (absolute EMU position/size) and one text run -- enough to exercise direct (non-inherited) geometry without needing a full placeholder/layout/master chain.
const SLIDE1_XML = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:spPr><a:xfrm><a:off x="914400" y="914400"/><a:ext cx="3657600" cy="914400"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:t>Slide text</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>',
);

function pptxParts(): Record<string, Uint8Array<ArrayBuffer>> {
  return {
    "[Content_Types].xml": CONTENT_TYPES_XML,
    "_rels/.rels": ROOT_RELS_XML,
    "ppt/presentation.xml": PRESENTATION_XML,
    "ppt/_rels/presentation.xml.rels": PRESENTATION_RELS_XML,
    "ppt/slides/slide1.xml": SLIDE1_XML,
  };
}

export function minimalPptxPackage(): Package {
  return decodePackage(zipPackage(pptxParts()));
}

export function minimalPptxBytes(): Uint8Array<ArrayBuffer> {
  return zipPackage(pptxParts());
}
