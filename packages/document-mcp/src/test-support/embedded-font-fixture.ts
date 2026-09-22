// A real odt that genuinely embeds a source font face — the shape extractOdfEmbeddedFonts (documents.js's src/fonts/odf.ts) actually reads, not a synthetic stand-in for it. documents.js's own live-view editors have no write side for font embedding at all (embedding a font is a source-application concern — Word/PowerPoint/LibreOffice's own "Embed fonts in the document" option), so this starts from a real editor-built package (createOdt()) and adds exactly the part/declaration extractOdfEmbeddedFonts reads, using odf.js's own low-level XML/package primitives directly — a genuine direct dependency of this package, unlike ooxml.js (see ooxml-fixture.ts, which stands in for that one). Ported from document-cli's own src/test-support/embedded-font-fixture.ts (buildOdtWithEmbeddedFont).
import {
  createOdt,
  encodeDocumentPackage,
  type Package,
  type XmlElement,
} from "documents.js";
import { bytesToBase64, el, rootElement } from "odf.js";

export interface EmbeddedFontFixtureOptions {
  readonly family: string;
  readonly fontBytes: Uint8Array<ArrayBuffer>;
}

// createOdt() is always expected to produce a real content.xml with a real root element — these two checks exist for a genuinely malformed Package this fixture has never actually been given, so there is no real createOdt() output that exercises either throw. Extracted as its own function (taking a plain Package rather than calling createOdt() itself) so a test can drive both guards directly with a hand-built Package, rather than the throws being permanently untestable dead code.
export function requireOdtContentRoot(pkg: Package): XmlElement {
  const contentPart = pkg.parts["content.xml"];
  if (contentPart?.kind !== "xml") {
    throw new Error(
      "embedded-font-fixture: createOdt() produced a package with no 'content.xml' XML part",
    );
  }
  const root = rootElement(contentPart.nodes);
  if (root === undefined) {
    throw new Error("embedded-font-fixture: 'content.xml' has no root element");
  }
  return root;
}

// The office:font-face-decls element this fixture inserts, referencing the embedded font part directly by package path (svg:font-face-uri's own xlink:href) — ODF has no relationship indirection and no obfuscation at all, so the binary part just has to exist at the href it names. loext:font-weight/loext:font-style are deliberately omitted: with neither present, extractOdfEmbeddedFonts falls back to the font's own OS/2 fsSelection bits, which options.fontBytes (a real sfnt face) genuinely carries.
export function buildFontFaceDeclsElement(family: string): XmlElement {
  return el("office:font-face-decls", {}, [
    el("style:font-face", { "style:name": family, "svg:font-family": family }, [
      el("svg:font-face-src", {}, [
        el("svg:font-face-uri", {
          "xlink:href": "Fonts/font1.ttf",
          "xlink:type": "simple",
        }),
      ]),
    ]),
  ]);
}

// A real odt that embeds one face under content.xml's own office:font-face-decls/style:font-face — see buildFontFaceDeclsElement's own comment above for exactly what that declaration carries and why.
export function buildOdtWithEmbeddedFont(
  options: EmbeddedFontFixtureOptions,
): Uint8Array<ArrayBuffer> {
  const editor = createOdt();
  editor.body
    .appendParagraph()
    .appendRun({ text: "A paragraph of ordinary body text." });
  const pkg: Package = editor.toPackage();

  pkg.parts["Fonts/font1.ttf"] = {
    kind: "binary",
    base64: bytesToBase64(options.fontBytes),
  };

  const root = requireOdtContentRoot(pkg);
  // office:document-content's own child sequence is office:scripts?, office:font-face-decls?, office:automatic-styles?, office:body — inserted at index 0 (createOdt()'s scaffold starts with [office:automatic-styles, office:body]) keeps that order.
  root.children.unshift(buildFontFaceDeclsElement(options.family));

  return encodeDocumentPackage("odt", pkg);
}
