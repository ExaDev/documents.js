import { EPUB_MIME_TYPE } from "../format";
import { zipPackage } from "../zip";

// A hand-authored, real EPUB 2 fixture -- built directly via zipPackage from literal XML strings, never through this package's own writer (which only ever writes EPUB 3, per ExaDev/documents.js#801's own explicit scope: EPUB 2 is read-only). Covers the two EPUB 2-specific constructs this package's own hand-authored corpus needs: NCX navigation (no EPUB 3 nav document at all) and the linked-anchor footnote idiom (a plain <a href="#id"> reference/target pair, with no epub:type vocabulary to name the relationship -- recognised here via the class="footnote" convention src/xhtml/footnote.ts documents).

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
    <dc:identifier id="pub-id">urn:uuid:fixture-epub2</dc:identifier>
    <dc:title>Fixture Book (EPUB 2)</dc:title>
    <dc:creator>Charles Babbage</dc:creator>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="chapter1"/>
  </spine>
</package>
`;

const TOC_NCX = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="urn:uuid:fixture-epub2"/>
  </head>
  <docTitle><text>Fixture Book (EPUB 2)</text></docTitle>
  <navMap>
    <navPoint id="np1" playOrder="1">
      <navLabel><text>Chapter One</text></navLabel>
      <content src="chapter1.xhtml"/>
    </navPoint>
  </navMap>
</ncx>
`;

// The EPUB 2 linked-anchor footnote idiom: the reference site carries no epub:type at all (that vocabulary didn't exist yet), just an ordinary <a href="#note1">; the target is a plain <p id="note1"> elsewhere in the same document. Real producers vary in exactly which element carries a "footnote"-naming class -- this fixture puts it on the reference, matching src/xhtml/footnote.test.ts's own primary case.
const CHAPTER1_XHTML = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Chapter One</title></head>
  <body>
    <h1>Chapter One</h1>
    <p>This is the main text with a footnote reference<a class="footnote" href="#note1">1</a> in the old EPUB 2 style.</p>
    <p id="note1">1. This is the footnote's own body text.</p>
  </body>
</html>
`;

export function fixtureEpub2Bytes(): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  return zipPackage([
    ["mimetype", { bytes: encoder.encode(EPUB_MIME_TYPE), stored: true }],
    ["META-INF/container.xml", { bytes: encoder.encode(CONTAINER_XML) }],
    ["OEBPS/content.opf", { bytes: encoder.encode(CONTENT_OPF) }],
    ["OEBPS/toc.ncx", { bytes: encoder.encode(TOC_NCX) }],
    ["OEBPS/chapter1.xhtml", { bytes: encoder.encode(CHAPTER1_XHTML) }],
  ]);
}
