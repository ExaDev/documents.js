import { EPUB_MIME_TYPE } from "../format";
import { zipPackage } from "../zip";

// A hand-authored, real two-chapter EPUB 3 fixture -- built directly via zipPackage from literal XML strings, never through this package's own writer, matching test-support/epub3-fixture.ts's own precedent. Exists specifically for ExaDev/documents.js#963's cross-document constructs: chapter1.xhtml carries a same-document internal link (a heading id local to itself), an external link (unchanged by #963), and a cross-document internal link into chapter2.xhtml; chapter2.xhtml carries the target heading, plus a cross-document EPUB 3 noteref/footnote pair split across the two chapters (the more common real-world EPUB 2 shape #963 names, reproduced here in EPUB 3 markup since this fixture's whole point is exercising this package's own reader/writer, not corpus-tolerance for EPUB 2's unstructured idiom -- see test-support/epub2-fixture.ts for that).

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
    <dc:identifier id="pub-id">urn:uuid:fixture-epub3-multichapter</dc:identifier>
    <dc:title>Fixture Book (multi-chapter)</dc:title>
    <dc:creator>Grace Hopper</dc:creator>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="chapter2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="chapter1"/>
    <itemref idref="chapter2"/>
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
        <li><a href="chapter2.xhtml">Chapter Two</a></li>
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
    <p>See the <a href="#sec1b">next section</a>, an <a href="https://example.com">external site</a>, and <a href="chapter2.xhtml#sec2">Chapter Two</a>, plus a cross-document footnote reference<a epub:type="noteref" href="chapter2.xhtml#note1">1</a>.</p>
    <h2 id="sec1b">Section 1B</h2>
    <p>The target of the same-document link above.</p>
  </body>
</html>
`;

const CHAPTER2_XHTML = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <head><title>Chapter Two</title></head>
  <body>
    <h2 id="sec2">Section 2</h2>
    <p>The target of the cross-document link from Chapter One.</p>
    <aside epub:type="footnote" id="note1">
      <p>This footnote's own body lives in a different spine document than its reference.</p>
    </aside>
  </body>
</html>
`;

export function fixtureEpubMultichapterBytes(): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  return zipPackage([
    ["mimetype", { bytes: encoder.encode(EPUB_MIME_TYPE), stored: true }],
    ["META-INF/container.xml", { bytes: encoder.encode(CONTAINER_XML) }],
    ["OEBPS/content.opf", { bytes: encoder.encode(CONTENT_OPF) }],
    ["OEBPS/nav.xhtml", { bytes: encoder.encode(NAV_XHTML) }],
    ["OEBPS/chapter1.xhtml", { bytes: encoder.encode(CHAPTER1_XHTML) }],
    ["OEBPS/chapter2.xhtml", { bytes: encoder.encode(CHAPTER2_XHTML) }],
  ]);
}
