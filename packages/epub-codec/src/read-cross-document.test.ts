import { describe, expect, it } from "vitest";
import { readEpubContent } from "./read";
import { EPUB_MIME_TYPE } from "./format";
import { zipPackage } from "./zip";

// Regression coverage for buildCrossDocumentAnchorRegistry's own two ordering/self-reference edges (src/read.ts) — neither is reachable through this package's own hand-authored fixtures (fixtureEpubMultichapterBytes has exactly one referrer per target, and never a document referencing itself by full path instead of a bare fragment), so both need a bespoke, minimal fixture built directly here.

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`;

const CONTENT_OPF = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">urn:uuid:fixture-cross-doc</dc:identifier>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="chapter2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>
    <item id="chapter3" href="chapter3.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="chapter1"/>
    <itemref idref="chapter2"/>
    <itemref idref="chapter3"/>
  </spine>
</package>`;

// The footnote-shaped referrer (epub:type="noteref") comes FIRST in spine order, a plain bookmark-shaped referrer to the SAME target comes SECOND — the one ordering that actually exercises buildCrossDocumentAnchorRegistry's own "a footnote-shaped referrer always wins" guard: the guard only ever has anything to protect once an entry is ALREADY footnote-classified and a later referrer, read second, would otherwise downgrade it.
const CHAPTER1_XHTML = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <head><title>Chapter One</title></head>
  <body>
    <h2 id="sec1b">Section 1B</h2>
    <p>A footnote reference<a epub:type="noteref" href="chapter3.xhtml#shared">1</a> and an explicit, full-path self-link back to <a href="chapter1.xhtml#sec1b">this same document's own heading</a>.</p>
  </body>
</html>`;

// Also references chapter1's own "sec1b" heading by full path, genuinely cross-document from here — this is what populates buildCrossDocumentAnchorRegistry's own targetsByHref["OEBPS/chapter1.xhtml"]["sec1b"] entry, the entry chapter1's own resolveHref self-reference guard (targetHref === sourceHref) must refuse to reuse for its OWN, different, same-document reference to the identical heading below.
const CHAPTER2_XHTML = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <head><title>Chapter Two</title></head>
  <body>
    <p>A second, plain (non-noteref, non-class) reference to <a href="chapter3.xhtml#shared">the same shared target</a>, and a genuine cross-document link back to <a href="chapter1.xhtml#sec1b">Chapter One's own Section 1B</a>.</p>
  </body>
</html>`;

const CHAPTER3_XHTML = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <head><title>Chapter Three</title></head>
  <body>
    <p id="shared">The shared target, referenced by both earlier chapters.</p>
  </body>
</html>`;

function fixtureBytes(): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  return zipPackage([
    ["mimetype", { bytes: encoder.encode(EPUB_MIME_TYPE), stored: true }],
    ["META-INF/container.xml", { bytes: encoder.encode(CONTAINER_XML) }],
    ["OEBPS/content.opf", { bytes: encoder.encode(CONTENT_OPF) }],
    ["OEBPS/chapter1.xhtml", { bytes: encoder.encode(CHAPTER1_XHTML) }],
    ["OEBPS/chapter2.xhtml", { bytes: encoder.encode(CHAPTER2_XHTML) }],
    ["OEBPS/chapter3.xhtml", { bytes: encoder.encode(CHAPTER3_XHTML) }],
  ]);
}

describe("buildCrossDocumentAnchorRegistry: a footnote-shaped referrer read first is never downgraded by a plain referrer read second", () => {
  it("keeps the shared target, and the second (plain) referrer's own construct, footnote-classified", () => {
    const document = readEpubContent(fixtureBytes());
    expect(document.kind).toBe("wordprocessing");
    if (document.kind !== "wordprocessing") return;

    const chapter2Paragraph = document.sections[1]?.blocks[0];
    expect(chapter2Paragraph?.kind).toBe("paragraph");
    const secondReferrerExtent =
      chapter2Paragraph?.kind === "paragraph"
        ? chapter2Paragraph.constructs?.[0]
        : undefined;
    // Real code: still footnote (the first referrer's own classification wins). Mutated (guard always overwrites): downgraded to an ordinary internal "link", not an "anchor".
    expect(secondReferrerExtent?.descriptor).toEqual({
      kind: "anchor",
      anchorType: "footnote",
      name: "OEBPS/chapter3.xhtml#shared",
    });

    const chapter3Start = document.sections[2]?.blocks.find(
      (b) => b.kind === "constructStart",
    );
    expect(chapter3Start?.kind).toBe("constructStart");
    expect(
      chapter3Start?.kind === "constructStart" && chapter3Start.descriptor,
    ).toEqual({
      kind: "anchor",
      anchorType: "footnote",
      name: "OEBPS/chapter3.xhtml#shared",
    });
  });
});

describe("buildCrossDocumentAnchorRegistry.resolveHref: an explicit full-path self-reference is not treated as cross-document", () => {
  it("degrades to a plain, unresolved hyperlink rather than an internal link construct pointing at its own document", () => {
    const document = readEpubContent(fixtureBytes());
    expect(document.kind).toBe("wordprocessing");
    if (document.kind !== "wordprocessing") return;

    const chapter1Paragraph = document.sections[0]?.blocks.find(
      (b) =>
        b.kind === "paragraph" &&
        b.runs.some((r) => r.text === "this same document's own heading"),
    );
    expect(chapter1Paragraph?.kind).toBe("paragraph");
    if (chapter1Paragraph?.kind !== "paragraph") return;

    // Real code: resolveHref refuses to treat a same-document target (targetHref === sourceHref) as a cross-document match, so appendAnchor's own target lookup comes back undefined and the href rides ContentRun.hyperlink verbatim, unresolved. Mutated (guard always returns the match): this would instead become an internal link construct naming "sec1b".
    expect(chapter1Paragraph.runs).toContainEqual({
      text: "this same document's own heading",
      hyperlink: "chapter1.xhtml#sec1b",
    });
    const internalLinkToOwnHeading = (chapter1Paragraph.constructs ?? []).find(
      (c) =>
        c.descriptor.kind === "link" &&
        c.descriptor.target.kind === "internal" &&
        c.descriptor.target.anchor === "sec1b",
    );
    expect(internalLinkToOwnHeading).toBeUndefined();
  });
});
