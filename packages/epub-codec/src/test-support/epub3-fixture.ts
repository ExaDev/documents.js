import { EPUB_MIME_TYPE } from "../format";
import { zipPackage } from "../zip";

// A hand-authored, real EPUB 3 fixture — built directly via zipPackage from literal XML strings, never through this package's own writer (writeEpubContent), so a bug in the writer cannot hide behind a fixture built with the same code (the identical convention documents.js's own test-support/docx.ts and odt.ts already state for their own hand-authored fixtures). Covers the EPUB 3-specific constructs this package's own hand-authored corpus needs: a real <nav epub:type="toc"> navigation document, and a footnote via the structured epub:type="footnote"/"noteref" idiom.

// Mirrors dimensions.ts's own private layout constants (see image/dimensions.test.ts, which names these identically) so this fixture stays tied to the format's real structure rather than restating its offsets as independent literals.
const PNG_SIG_HIGH_BIT_MARKER = 0x89;
const PNG_SIG_P = 0x50;
const PNG_SIG_N = 0x4e;
const PNG_SIG_G = 0x47;
const PNG_SIG_CR = 0x0d;
const PNG_SIG_LF = 0x0a;
const PNG_SIG_LINE_ENDING_DETECTOR = 0x1a;
const PNG_SIG = [
  PNG_SIG_HIGH_BIT_MARKER,
  PNG_SIG_P,
  PNG_SIG_N,
  PNG_SIG_G,
  PNG_SIG_CR,
  PNG_SIG_LF,
  PNG_SIG_LINE_ENDING_DETECTOR,
  PNG_SIG_LF,
];
const IHDR_TAG_I = 0x49;
const IHDR_TAG_H = 0x48;
const IHDR_TAG_D = 0x44;
const IHDR_TAG_R = 0x52;
const IHDR_TAG_BYTES = [IHDR_TAG_I, IHDR_TAG_H, IHDR_TAG_D, IHDR_TAG_R];
const UINT32_BYTES = 4;
const PNG_CHUNK_TYPE_OFFSET = PNG_SIG.length + UINT32_BYTES; // 12
const PNG_IHDR_WIDTH_OFFSET = PNG_CHUNK_TYPE_OFFSET + UINT32_BYTES; // 16
const PNG_IHDR_HEIGHT_OFFSET = PNG_IHDR_WIDTH_OFFSET + UINT32_BYTES; // 20
const PNG_HEADER_BYTES = PNG_IHDR_HEIGHT_OFFSET + UINT32_BYTES; // 24
const FIXTURE_IMAGE_SIZE_PX = 2;

// A PNG carrying only what src/image/dimensions.ts reads: the signature, then just enough of an IHDR chunk to declare 2x2 (PNG_HEADER_BYTES's own 24 bytes). Deliberately stops there: this package's own reader never looks past that offset for a PNG (no chunk-length or bit-depth/colour-type validation, no real IDAT/IEND), so writing bytes beyond it would carry no signal any reader here, or any test of this fixture, could ever observe.
function fakePng2x2(): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(PNG_HEADER_BYTES);
  bytes.set(PNG_SIG, 0);
  bytes.set(IHDR_TAG_BYTES, PNG_CHUNK_TYPE_OFFSET);
  new DataView(bytes.buffer).setUint32(
    PNG_IHDR_WIDTH_OFFSET,
    FIXTURE_IMAGE_SIZE_PX,
  );
  new DataView(bytes.buffer).setUint32(
    PNG_IHDR_HEIGHT_OFFSET,
    FIXTURE_IMAGE_SIZE_PX,
  );
  return bytes;
}

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;

const CONTENT_OPF = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">urn:uuid:fixture-epub3</dc:identifier>
    <dc:title>Fixture Book (EPUB 3)</dc:title>
    <dc:creator>Ada Lovelace</dc:creator>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="cover" href="images/cover.png" media-type="image/png"/>
  </manifest>
  <spine>
    <itemref idref="chapter1"/>
  </spine>
</package>
`;

const NAV_XHTML = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <head><title>Table of Contents</title></head>
  <body>
    <nav epub:type="toc">
      <h1>Table of Contents</h1>
      <ol>
        <li><a href="chapter1.xhtml">Chapter One</a></li>
      </ol>
    </nav>
  </body>
</html>
`;

const CHAPTER1_XHTML = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <head><title>Chapter One</title></head>
  <body>
    <h1>Chapter One</h1>
    <p>This paragraph has <strong>bold</strong> and <em>italic</em> text, a <a href="https://example.com">link</a>, and a footnote reference<a epub:type="noteref" href="#fn1">1</a>.</p>
    <ul>
      <li>First item</li>
      <li>Second item</li>
    </ul>
    <p><img src="images/cover.png" alt="the cover image"/></p>
    <aside epub:type="footnote" id="fn1">
      <p>This is the footnote's own body text.</p>
    </aside>
  </body>
</html>
`;

export function fixtureEpub3Bytes(): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  return zipPackage([
    ["mimetype", { bytes: encoder.encode(EPUB_MIME_TYPE), stored: true }],
    ["META-INF/container.xml", { bytes: encoder.encode(CONTAINER_XML) }],
    ["OEBPS/content.opf", { bytes: encoder.encode(CONTENT_OPF) }],
    ["OEBPS/nav.xhtml", { bytes: encoder.encode(NAV_XHTML) }],
    ["OEBPS/chapter1.xhtml", { bytes: encoder.encode(CHAPTER1_XHTML) }],
    ["OEBPS/images/cover.png", { bytes: fakePng2x2() }],
  ]);
}
