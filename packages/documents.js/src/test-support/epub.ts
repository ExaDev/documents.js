import { EPUB_MIME_TYPE, zipPackage } from "epub-codec";

// Never generated via this package's own epub wiring or epub-codec's own writeEpubContent -- hand-authored literal OCF/OPF/XHTML XML, zipped via epub-codec's own public zipPackage, matching this directory's own fixture-independence convention (docx.ts/odt.ts/pptx.ts/odp.ts/ods.ts/odg.ts: a fixture built independently of the very code under test, so a bug in that code cannot hide behind a fixture the same code produced). Structurally the same minimal shape epub-codec's own src/test-support/epub3-fixture.ts uses (mimetype first and stored, a real container.xml/content.opf/nav.xhtml/one content document), trimmed to a single heading and paragraph -- the same "Hello from X" single-paragraph shape odt.ts/odp.ts use for their own minimal fixtures.

function enc(s: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(s);
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
    <dc:identifier id="pub-id">urn:uuid:documents-js-fixture-epub</dc:identifier>
    <dc:title>Fixture Book</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
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
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Chapter One</title></head>
  <body>
    <h1>Hello from epub</h1>
    <p>Second paragraph with <strong>bold text</strong> inside.</p>
  </body>
</html>
`;

// A minimal but structurally authentic EPUB 3 package (mimetype part first and stored, a real container.xml/content.opf/nav.xhtml/one content document) -- enough to round-trip through readEpubContent without needing a real EPUB-authoring-tool-exported binary.
export function minimalEpubBytes(): Uint8Array<ArrayBuffer> {
  return zipPackage([
    ["mimetype", { bytes: enc(EPUB_MIME_TYPE), stored: true }],
    ["META-INF/container.xml", { bytes: enc(CONTAINER_XML) }],
    ["OEBPS/content.opf", { bytes: enc(CONTENT_OPF) }],
    ["OEBPS/nav.xhtml", { bytes: enc(NAV_XHTML) }],
    ["OEBPS/chapter1.xhtml", { bytes: enc(CHAPTER1_XHTML) }],
  ]);
}
