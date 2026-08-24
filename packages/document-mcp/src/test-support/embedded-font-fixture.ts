// A real odt that genuinely embeds a source font face -- the shape extractOdfEmbeddedFonts (documents.js's src/fonts/odf.ts) actually reads, not a synthetic stand-in for it. documents.js's own live-view editors have no write side for font embedding at all (embedding a font is a source-application concern -- Word/PowerPoint/LibreOffice's own "Embed fonts in the document" option), so this starts from a real editor-built package (createOdt()) and adds exactly the part/declaration extractOdfEmbeddedFonts reads, using odf.js's own low-level XML/package primitives directly -- a genuine direct dependency of this package, unlike ooxml.js (see ooxml-fixture.ts, which stands in for that one). Ported from document-cli's own src/test-support/embedded-font-fixture.ts (buildOdtWithEmbeddedFont).
import { createOdt, encodeDocumentPackage, type Package } from "documents.js";
import { bytesToBase64, el, rootElement } from "odf.js";

export interface EmbeddedFontFixtureOptions {
  readonly family: string;
  readonly fontBytes: Uint8Array<ArrayBuffer>;
}

// A real odt that embeds one face under content.xml's own office:font-face-decls/style:font-face, referencing the font part directly by package path (svg:font-face-uri's own xlink:href) -- ODF has no relationship indirection and no obfuscation at all, so the binary part just has to exist at the href it names. loext:font-weight/loext:font-style are deliberately omitted: with neither present, extractOdfEmbeddedFonts falls back to the font's own OS/2 fsSelection bits, which options.fontBytes (a real sfnt face) genuinely carries.
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
  // office:document-content's own child sequence is office:scripts?, office:font-face-decls?, office:automatic-styles?, office:body -- inserted at index 0 (createOdt()'s scaffold starts with [office:automatic-styles, office:body]) keeps that order.
  root.children.unshift(
    el("office:font-face-decls", {}, [
      el(
        "style:font-face",
        { "style:name": options.family, "svg:font-family": options.family },
        [
          el("svg:font-face-src", {}, [
            el("svg:font-face-uri", {
              "xlink:href": "Fonts/font1.ttf",
              "xlink:type": "simple",
            }),
          ]),
        ],
      ),
    ]),
  );

  return encodeDocumentPackage("odt", pkg);
}
