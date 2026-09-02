import { EPUB_MIME_TYPE } from "../format";
import { zipPackage } from "../zip";

// A hand-authored, real EPUB 3 fixture -- built directly via zipPackage from literal XML strings, never through this package's own writer (writeEpubContent), so a bug in the writer cannot hide behind a fixture built with the same code (the identical convention documents.js's own test-support/docx.ts and odt.ts already state for their own hand-authored fixtures). Covers the EPUB 3-specific constructs this package's own hand-authored corpus needs: a real <nav epub:type="toc"> navigation document, and a footnote via the structured epub:type="footnote"/"noteref" idiom.

// A PNG carrying only what src/image/dimensions.ts reads: the signature plus an IHDR chunk declaring 2x2 -- this package's own reader never walks past IHDR, so a real IDAT/IEND is not needed.
function fakePng2x2(): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, 2);
  view.setUint32(20, 2);
  bytes.set([8, 6, 0, 0, 0], 24);
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
