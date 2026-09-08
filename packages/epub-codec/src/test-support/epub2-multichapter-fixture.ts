import { EPUB_MIME_TYPE } from "../format";
import { zipPackage } from "../zip";

// A hand-authored, real two-chapter EPUB 2 fixture -- built directly via zipPackage from literal XML strings, matching test-support/epub2-fixture.ts's own precedent. Exists specifically for ExaDev/documents.js#963's own named shape: a footnote reference in one spine document (chapter1.xhtml) whose body lives in a separate "notes.xhtml"-style document (chapter2.xhtml) -- the EPUB 2 linked-anchor idiom (no epub:type vocabulary at all, just the class="footnote" convention) is, per the issue's own wording, "the more common real-world EPUB 2 shape" this gap targets.

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;

const CONTENT_OPF = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="pub-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">urn:uuid:fixture-epub2-multichapter</dc:identifier>
    <dc:title>Fixture Book (EPUB 2, multi-chapter)</dc:title>
    <dc:creator>Charles Babbage</dc:creator>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="chapter2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="chapter1"/>
    <itemref idref="chapter2"/>
  </spine>
</package>
`;

const TOC_NCX = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="urn:uuid:fixture-epub2-multichapter"/>
  </head>
  <docTitle><text>Fixture Book (EPUB 2, multi-chapter)</text></docTitle>
  <navMap>
    <navPoint id="np1" playOrder="1">
      <navLabel><text>Chapter One</text></navLabel>
      <content src="chapter1.xhtml"/>
    </navPoint>
    <navPoint id="np2" playOrder="2">
      <navLabel><text>Chapter Two</text></navLabel>
      <content src="chapter2.xhtml"/>
    </navPoint>
  </navMap>
</ncx>
`;

// The reference site carries the class="footnote" signal (the EPUB 2 idiom src/xhtml/footnote.ts's isFootnoteReference recognises absent any epub:type); its target -- a separate <p id="note1"> -- lives in chapter2.xhtml, not this document.
const CHAPTER1_XHTML = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Chapter One</title></head>
  <body>
    <h1>Chapter One</h1>
    <p>This is the main text with a cross-document footnote reference<a class="footnote" href="chapter2.xhtml#note1">1</a> in the old EPUB 2 style.</p>
  </body>
</html>
`;

const CHAPTER2_XHTML = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Chapter Two</title></head>
  <body>
    <h1>Chapter Two</h1>
    <p id="note1">1. This footnote's own body lives in a different spine document than its reference.</p>
  </body>
</html>
`;

export function fixtureEpub2MultichapterBytes(): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  return zipPackage([
    ["mimetype", { bytes: encoder.encode(EPUB_MIME_TYPE), stored: true }],
    ["META-INF/container.xml", { bytes: encoder.encode(CONTAINER_XML) }],
    ["OEBPS/content.opf", { bytes: encoder.encode(CONTENT_OPF) }],
    ["OEBPS/toc.ncx", { bytes: encoder.encode(TOC_NCX) }],
    ["OEBPS/chapter1.xhtml", { bytes: encoder.encode(CHAPTER1_XHTML) }],
    ["OEBPS/chapter2.xhtml", { bytes: encoder.encode(CHAPTER2_XHTML) }],
  ]);
}
