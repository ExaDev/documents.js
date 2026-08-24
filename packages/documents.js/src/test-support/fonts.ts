// Never imported by src/index.ts and never reaches dist/. See docx.ts's top-of-file comment -- the same reasoning applies here, with one addition specific to fonts: a font-embedding fixture is only worth anything if the embedded bytes are a REAL font, so these fixtures embed genuine Caladea faces rather than a hand-authored stub. The bytes come from pdf-codec's own vendored, OFL-licensed Caladea assets (the faces its font registry already falls back to as metric-compatible Cambria substitutes), inflated at fixture-build time -- so this repository commits no font binary of its own, and the fixtures still exercise the real parse/OS-2/cmap paths a hand-rolled stub could not.
//
// The docx fixture's obfuscation deliberately does NOT go through src/fonts/obfuscation.ts. It XORs the prefix with 16 literal key bytes, and for the first face those bytes are the ones ECMA-376 Part 4, 2.8.1 states for its own worked-example GUID, quoted from the specification rather than computed here. That keeps the round trip honest in the one place it could otherwise be circular: the production code derives those key bytes from the GUID string, the fixture never does, so a wrong derivation cannot cancel itself out -- it produces bytes that fail the sfnt-signature check. (The SECOND key below has no specification worked example behind it and IS hand-derived here; it exists only to prove that two faces of one family are deobfuscated with their own separate keys, not that the derivation is right.)
import type { Package as OoxmlPackage } from "ooxml.js";
import type { Package as OdfPackage } from "odf.js";
import {
  decodePackage as decodeOoxmlPackage,
  zipPackage as zipOoxmlPackage,
} from "ooxml.js";
import {
  decodePackage as decodeOdfPackage,
  ODF_MEDIA_TYPES,
  zipPackage as zipOdfPackage,
} from "odf.js";
import { CALADEA_BOLD_FONT_DEFLATED_BASE64 } from "pdf-codec/assets/caladea-bold";
import { CALADEA_ITALIC_FONT_DEFLATED_BASE64 } from "pdf-codec/assets/caladea-italic";
import { CALADEA_REGULAR_FONT_DEFLATED_BASE64 } from "pdf-codec/assets/caladea-regular";
import { base64ToBytes } from "ooxml.js";
import { inflateSync } from "fflate";

// ECMA-376 Part 4, 2.8.1's own worked example: this GUID and these key bytes are quoted from the specification, not computed here. deriveFontKey must reproduce SPEC_FONT_KEY_BYTES from SPEC_FONT_KEY_GUID exactly.
export const SPEC_FONT_KEY_GUID = "{001B70DC-AA60-4AD5-90EC-18A0948E1EAE}";
export const SPEC_FONT_KEY_BYTES: readonly number[] = [
  0xae, 0x1e, 0x8e, 0x94, 0xa0, 0x18, 0xec, 0x90, 0xd5, 0x4a, 0x60, 0xaa, 0xdc,
  0x70, 0x1b, 0x00,
];

// A second, unrelated GUID, so a fixture can prove two faces of the same family are deobfuscated with their own separate keys rather than one shared one.
export const SECOND_FONT_KEY_GUID = "{7B2F4E11-C3A9-4D68-8F05-2E6D1A9C4B37}";
export const SECOND_FONT_KEY_BYTES: readonly number[] = [
  0x37, 0x4b, 0x9c, 0x1a, 0x6d, 0x2e, 0x05, 0x8f, 0x68, 0x4d, 0xa9, 0xc3, 0x11,
  0x4e, 0x2f, 0x7b,
];

const OBFUSCATED_PREFIX_LENGTH = 32;

function enc(s: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(s);
}

function inflateFont(deflatedBase64: string): Uint8Array<ArrayBuffer> {
  const inflated = inflateSync(base64ToBytes(deflatedBase64));
  const bytes = new Uint8Array(inflated.length);
  bytes.set(inflated);
  return bytes;
}

// Cached because inflating an 80 KB font on every fixture call would dominate the suite's runtime for no benefit -- every caller treats the bytes as immutable.
let caladeaRegular: Uint8Array<ArrayBuffer> | undefined;
let caladeaBold: Uint8Array<ArrayBuffer> | undefined;
let caladeaItalic: Uint8Array<ArrayBuffer> | undefined;

export function caladeaRegularBytes(): Uint8Array<ArrayBuffer> {
  caladeaRegular ??= inflateFont(CALADEA_REGULAR_FONT_DEFLATED_BASE64);
  return caladeaRegular;
}

export function caladeaBoldBytes(): Uint8Array<ArrayBuffer> {
  caladeaBold ??= inflateFont(CALADEA_BOLD_FONT_DEFLATED_BASE64);
  return caladeaBold;
}

export function caladeaItalicBytes(): Uint8Array<ArrayBuffer> {
  caladeaItalic ??= inflateFont(CALADEA_ITALIC_FONT_DEFLATED_BASE64);
  return caladeaItalic;
}

// The write-side half of ECMA-376 2.8.1, taking the 16 key bytes DIRECTLY rather than a GUID string -- see this file's top comment for why that separation is what keeps the round-trip test non-circular.
export function obfuscateFontBytes(
  bytes: Uint8Array<ArrayBuffer>,
  keyBytes: readonly number[],
): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(bytes.length);
  out.set(bytes);
  for (let i = 0; i < OBFUSCATED_PREFIX_LENGTH; i++) {
    const keyByte = keyBytes[i % keyBytes.length];
    const clearByte = out[i];
    if (keyByte === undefined || clearByte === undefined) {
      throw new Error(`obfuscateFontBytes: byte ${String(i)} is out of range`);
    }
    out[i] = clearByte ^ keyByte;
  }
  return out;
}

const CONTENT_TYPES_XML = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="odttf" ContentType="application/vnd.openxmlformats-officedocument.obfuscatedFont"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/></Types>',
);

const DOCX_ROOT_RELS_XML = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
);

const DOCX_DOCUMENT_RELS_XML = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable" Target="fontTable.xml"/></Relationships>',
);

const DOCX_DOCUMENT_XML = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:rFonts w:ascii="Caladea" w:hAnsi="Caladea"/></w:rPr><w:t>Embedded font sample</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>',
);

// The exact shape Word writes for a document saved with font embedding on: one w:font per family, its w:embed* children each carrying an r:id and the w:fontKey GUID that part's own bytes were obfuscated with, plus w:subsetted="true" (informational -- see src/fonts/ooxml.ts on why a subsetted face is still worth keeping). Two different key GUIDs, one per face, so the extractor cannot pass by reusing a single key.
const DOCX_FONT_TABLE_XML = enc(
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:fonts xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:font w:name="Caladea"><w:panose1 w:val="02040503050406030204"/><w:charset w:val="00"/><w:family w:val="roman"/><w:pitch w:val="variable"/><w:embedRegular r:id="rId1" w:fontKey="${SPEC_FONT_KEY_GUID}" w:subsetted="true"/><w:embedBold r:id="rId2" w:fontKey="${SECOND_FONT_KEY_GUID}" w:subsetted="true"/></w:font></w:fonts>`,
);

const DOCX_FONT_TABLE_RELS_XML = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/font" Target="fonts/font1.odttf"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/font" Target="fonts/font2.odttf"/></Relationships>',
);

function embeddedFontDocxParts(): Record<string, Uint8Array<ArrayBuffer>> {
  return {
    "[Content_Types].xml": CONTENT_TYPES_XML,
    "_rels/.rels": DOCX_ROOT_RELS_XML,
    "word/document.xml": DOCX_DOCUMENT_XML,
    "word/_rels/document.xml.rels": DOCX_DOCUMENT_RELS_XML,
    "word/fontTable.xml": DOCX_FONT_TABLE_XML,
    "word/_rels/fontTable.xml.rels": DOCX_FONT_TABLE_RELS_XML,
    "word/fonts/font1.odttf": obfuscateFontBytes(
      caladeaRegularBytes(),
      SPEC_FONT_KEY_BYTES,
    ),
    "word/fonts/font2.odttf": obfuscateFontBytes(
      caladeaBoldBytes(),
      SECOND_FONT_KEY_BYTES,
    ),
  };
}

// A docx embedding two genuinely obfuscated Caladea faces (regular under the ECMA-376 worked-example key, bold under a second key), each reached through a real r:id -> word/_rels/fontTable.xml.rels -> part-path chain.
export function embeddedFontDocxPackage(): OoxmlPackage {
  return decodeOoxmlPackage(zipOoxmlPackage(embeddedFontDocxParts()));
}

const PPTX_CONTENT_TYPES_XML = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="fntdata" ContentType="application/x-fontdata"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>',
);

const PPTX_ROOT_RELS_XML = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>',
);

// PowerPoint's own embedded-font declaration: p:embeddedFontLst inside p:presentation, one p:embeddedFont per family, its p:regular/p:bold/... children carrying an r:id and nothing else -- no font key anywhere, because the referenced .fntdata parts are stored unobfuscated.
const PPTX_PRESENTATION_XML = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" embedTrueTypeFonts="1"><p:sldSz cx="12192000" cy="6858000"/><p:embeddedFontLst><p:embeddedFont><p:font typeface="Caladea" panose="02040503050406030204" pitchFamily="18" charset="0"/><p:regular r:id="rId2"/><p:italic r:id="rId3"/></p:embeddedFont></p:embeddedFontLst></p:presentation>',
);

const PPTX_PRESENTATION_RELS_XML = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/font" Target="fonts/font1.fntdata"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/font" Target="fonts/font2.fntdata"/></Relationships>',
);

function embeddedFontPptxParts(): Record<string, Uint8Array<ArrayBuffer>> {
  return {
    "[Content_Types].xml": PPTX_CONTENT_TYPES_XML,
    "_rels/.rels": PPTX_ROOT_RELS_XML,
    "ppt/presentation.xml": PPTX_PRESENTATION_XML,
    "ppt/_rels/presentation.xml.rels": PPTX_PRESENTATION_RELS_XML,
    "ppt/fonts/font1.fntdata": caladeaRegularBytes(),
    "ppt/fonts/font2.fntdata": caladeaItalicBytes(),
  };
}

// A pptx embedding two unobfuscated Caladea faces, exercising the sniff-first half of deobfuscateEmbeddedFont: no w:fontKey exists anywhere in this package, so the bytes must be recognised as already-clear from their own sfnt signature.
export function embeddedFontPptxPackage(): OoxmlPackage {
  return decodeOoxmlPackage(zipOoxmlPackage(embeddedFontPptxParts()));
}

const ODT_MIMETYPE = enc(ODF_MEDIA_TYPES.odt);

// LibreOffice's own embedded-font markup, reproduced faithfully: office:font-face-decls in BOTH content.xml and styles.xml (the same declaration, repeated -- which is why the extractor de-duplicates by href), a Fonts/ part path referenced directly by xlink:href with no relationship indirection, and svg:font-face-format naming the format. The regular face carries explicit loext:font-style/loext:font-weight; the bold face deliberately carries NEITHER, so its bold flag can only come from the font's own OS/2 fsSelection bits.
const ODT_FONT_FACE_DECLS =
  '<office:font-face-decls><style:font-face style:name="Caladea" svg:font-family="Caladea" style:font-family-generic="roman" style:font-pitch="variable"><svg:font-face-src><svg:font-face-uri xlink:href="Fonts/Caladea_Regular.ttf" xlink:type="simple" xlink:actuate="onRequest" loext:font-style="normal" loext:font-weight="normal"><svg:font-face-format svg:string="truetype"/></svg:font-face-uri></svg:font-face-src></style:font-face><style:font-face style:name="Caladea1" svg:font-family="Caladea"><svg:font-face-src><svg:font-face-uri xlink:href="Fonts/Caladea_Bold.ttf" xlink:type="simple" xlink:actuate="onRequest"><svg:font-face-format svg:string="truetype"/></svg:font-face-uri></svg:font-face-src></style:font-face></office:font-face-decls>';

const ODF_NS =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:loext="urn:org:documentfoundation:names:experimental:office:xmlns:loext:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"';

const ODT_CONTENT_XML = enc(
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<office:document-content ${ODF_NS}>${ODT_FONT_FACE_DECLS}<office:automatic-styles><style:style style:name="T1" style:family="text"><style:text-properties style:font-name="Caladea"/></style:style></office:automatic-styles><office:body><office:text><text:p><text:span text:style-name="T1">Embedded font sample</text:span></text:p></office:text></office:body></office:document-content>`,
);

const ODT_STYLES_XML = enc(
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<office:document-styles ${ODF_NS}>${ODT_FONT_FACE_DECLS}<office:styles/></office:document-styles>`,
);

const ODT_MANIFEST_XML = enc(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="Fonts/Caladea_Regular.ttf" manifest:media-type="application/x-font-ttf"/><manifest:file-entry manifest:full-path="Fonts/Caladea_Bold.ttf" manifest:media-type="application/x-font-ttf"/></manifest:manifest>',
);

// fontRequestOdtBytes below writes content.xml alone (no styles.xml), so it needs its own manifests rather than reusing the one above -- a manifest declaring a part the package does not contain is a broken document, not a harmlessly over-declared one.
const FONT_REQUEST_MANIFEST_ENTRIES =
  '<manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>';

const FONT_REQUEST_FONT_MANIFEST_ENTRIES =
  '<manifest:file-entry manifest:full-path="Fonts/Caladea_Regular.ttf" manifest:media-type="application/x-font-ttf"/><manifest:file-entry manifest:full-path="Fonts/Caladea_Bold.ttf" manifest:media-type="application/x-font-ttf"/>';

function fontRequestManifest(withFonts: boolean): Uint8Array<ArrayBuffer> {
  return enc(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">${FONT_REQUEST_MANIFEST_ENTRIES}${withFonts ? FONT_REQUEST_FONT_MANIFEST_ENTRIES : ""}</manifest:manifest>`,
  );
}

function embeddedFontOdtEntries(): (readonly [
  string,
  { readonly bytes: Uint8Array<ArrayBuffer>; readonly stored?: boolean },
])[] {
  return [
    ["mimetype", { bytes: ODT_MIMETYPE, stored: true }],
    ["content.xml", { bytes: ODT_CONTENT_XML }],
    ["styles.xml", { bytes: ODT_STYLES_XML }],
    ["META-INF/manifest.xml", { bytes: ODT_MANIFEST_XML }],
    ["Fonts/Caladea_Regular.ttf", { bytes: caladeaRegularBytes() }],
    ["Fonts/Caladea_Bold.ttf", { bytes: caladeaBoldBytes() }],
  ];
}

// An odt embedding two plain (never obfuscated) Caladea faces under Fonts/, declared in both content.xml and styles.xml exactly as LibreOffice writes them.
export function embeddedFontOdtPackage(): OdfPackage {
  return decodeOdfPackage(zipOdfPackage(embeddedFontOdtEntries()));
}

// An odt whose one paragraph asks for `family` by fo:font-family, optionally embedding the real Caladea faces alongside it. Deliberately a separate fixture from embeddedFontOdtPackage above rather than an option on it, because the two answer different questions: that one reproduces LibreOffice's own markup exactly (style:font-name on the text style, resolved through office:font-face-decls) to prove EXTRACTION, this one has to survive odf.js's own style reading all the way to a ContentRun.fontFamily so a whole conversion can be driven by it -- and odf.js resolves fo:font-family, not the style:font-name -> office:font-face-decls indirection. Both attributes are valid ODF; only the former currently reaches a ContentRun, which is why the extraction fixture above renders as the default family despite embedding real faces.
export function fontRequestOdtBytes(
  family: string,
  embedCaladea = false,
): Uint8Array<ArrayBuffer> {
  const declarations = embedCaladea ? ODT_FONT_FACE_DECLS : "";
  const content = enc(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<office:document-content ${ODF_NS}>${declarations}<office:automatic-styles><style:style style:name="T1" style:family="text"><style:text-properties fo:font-family="${family}"/></style:style></office:automatic-styles><office:body><office:text><text:p><text:span text:style-name="T1">Font sample</text:span></text:p></office:text></office:body></office:document-content>`,
  );
  const entries: (readonly [
    string,
    { readonly bytes: Uint8Array<ArrayBuffer>; readonly stored?: boolean },
  ])[] = [
    ["mimetype", { bytes: ODT_MIMETYPE, stored: true }],
    ["content.xml", { bytes: content }],
    ["META-INF/manifest.xml", { bytes: fontRequestManifest(embedCaladea) }],
  ];
  if (embedCaladea) {
    entries.push(
      ["Fonts/Caladea_Regular.ttf", { bytes: caladeaRegularBytes() }],
      ["Fonts/Caladea_Bold.ttf", { bytes: caladeaBoldBytes() }],
    );
  }
  return zipOdfPackage(entries);
}
