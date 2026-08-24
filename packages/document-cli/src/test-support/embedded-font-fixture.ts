// Real docx/pptx/odt fixtures that genuinely embed a source font face -- the shape `extractSourceFonts`/`extractOoxmlEmbeddedFonts`/`extractOdfEmbeddedFonts` (documents.js's own `src/fonts/*`) actually read, not a synthetic stand-in for it. documents.js's own live-view editors (`DocxEditor`/`PptxEditor`/`OdtEditor`) have no write side for font embedding at all -- embedding a font is a source-application concern (Word/PowerPoint/LibreOffice's own "Embed fonts in the document" option), never something this package's own editors produce -- so each builder here starts from a real editor-built package (`createDocx()`/`createPptx()`/`createOdt()`) and then adds exactly the parts/relationships/declarations documents.js's own extractors read, using only the low-level XML/package primitives documents.js and odf.js already re-export (never ooxml.js directly, which is not a dependency of this repo -- see `ooxml-fixture.ts`).
//
// The docx/pptx font part is stored CLEAR (unobfuscated), not XORed against a `w:fontKey`: documents.js's own `deobfuscateEmbeddedFont` sniffs the leading sfnt signature first and returns bytes unchanged whenever they already look like a real font, which is also pptx's own real-world convention (see that function's doc comment) -- so a clear part is both simpler to build and a genuine, spec-legal shape a docx producer can write.
import {
  bytesToBase64,
  createDocx,
  createOdt,
  createPptx,
  encodeDocumentPackage,
  encodePackage,
  rootElement,
  type Package,
  type XmlElement,
} from "documents.js";
import {
  bytesToBase64 as odfBytesToBase64,
  el as odfEl,
  rootElement as odfRootElement,
} from "odf.js";
import { el, xmlDeclaration } from "./ooxml-fixture";

const R_NS =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const RELS_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const WORDML_NS =
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const FONT_REL_TYPE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/font";
const FONT_TABLE_REL_TYPE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable";

export interface EmbeddedFontFixtureOptions {
  readonly family: string;
  readonly fontBytes: Uint8Array<ArrayBuffer>;
}

// Appends `child` as a new last child of the real, already-existing root element at `partPath` -- used both for a `.rels` part a scaffold already created (`word/_rels/document.xml.rels`, `ppt/_rels/presentation.xml.rels`) and for `ppt/presentation.xml`'s own root. Throws rather than creating the part on demand: every call site here targets a part `createDocx()`/`createPptx()` is already known to scaffold, so a missing part means this fixture builder's own assumption about that scaffold broke, not a legitimate "create it fresh" case.
function appendChild(pkg: Package, partPath: string, child: XmlElement): void {
  const part = pkg.parts[partPath];
  if (part?.kind !== "xml") {
    throw new Error(
      `embedded-font-fixture: ${partPath} is missing from the scaffolded package, or is not an XML part`,
    );
  }
  const root = rootElement(part);
  if (root === undefined) {
    throw new Error(`embedded-font-fixture: ${partPath} has no root element`);
  }
  root.children.push(child);
}

// A real docx that embeds one face under `word/fontTable.xml`'s own `w:font/w:embedRegular`, resolved through `word/document.xml`'s own relationship to the font table (`extractOoxmlEmbeddedFonts`'s `extractDocxFonts` never assumes the conventional path -- it walks the relationship graph, so this fixture must too).
export function buildDocxWithEmbeddedFont(
  options: EmbeddedFontFixtureOptions,
): Uint8Array<ArrayBuffer> {
  const editor = createDocx();
  editor.body
    .appendParagraph()
    .appendRun({ text: "A paragraph of ordinary body text." });
  const pkg = editor.toPackage();

  pkg.parts["word/fonts/font1.fntdata"] = {
    kind: "binary",
    base64: bytesToBase64(options.fontBytes),
  };
  pkg.parts["word/fontTable.xml"] = {
    kind: "xml",
    nodes: [
      xmlDeclaration(),
      el("w:fonts", { "xmlns:w": WORDML_NS, "xmlns:r": R_NS }, [
        el("w:font", { "w:name": options.family }, [
          el("w:embedRegular", { "r:id": "rId1" }),
        ]),
      ]),
    ],
  };
  pkg.parts["word/_rels/fontTable.xml.rels"] = {
    kind: "xml",
    nodes: [
      xmlDeclaration(),
      el("Relationships", { xmlns: RELS_NS }, [
        el("Relationship", {
          Id: "rId1",
          Type: FONT_REL_TYPE,
          Target: "fonts/font1.fntdata",
        }),
      ]),
    ],
  };
  appendChild(
    pkg,
    "word/_rels/document.xml.rels",
    el("Relationship", {
      Id: "rIdFontTable",
      Type: FONT_TABLE_REL_TYPE,
      Target: "fontTable.xml",
    }),
  );

  return encodePackage(pkg);
}

// A real pptx that embeds one face under `ppt/presentation.xml`'s own `p:embeddedFontLst/p:embeddedFont`, with the face's own `p:regular` resolved through the presentation part's own relationships -- pptx carries no font-key attribute at all (`extractOoxmlEmbeddedFonts`'s `extractPptxFonts`), so there is no obfuscation concern here even in principle.
export function buildPptxWithEmbeddedFont(
  options: EmbeddedFontFixtureOptions,
): Uint8Array<ArrayBuffer> {
  const editor = createPptx();
  const pkg = editor.toPackage();

  pkg.parts["ppt/fonts/font1.fntdata"] = {
    kind: "binary",
    base64: bytesToBase64(options.fontBytes),
  };
  appendChild(
    pkg,
    "ppt/_rels/presentation.xml.rels",
    el("Relationship", {
      Id: "rIdEmbeddedFont",
      Type: FONT_REL_TYPE,
      Target: "fonts/font1.fntdata",
    }),
  );
  appendChild(
    pkg,
    "ppt/presentation.xml",
    el("p:embeddedFontLst", {}, [
      el("p:embeddedFont", {}, [
        el("p:font", { typeface: options.family }),
        el("p:regular", { "r:id": "rIdEmbeddedFont" }),
      ]),
    ]),
  );

  return encodePackage(pkg);
}

// A real odt that embeds one face under `content.xml`'s own `office:font-face-decls/style:font-face`, referencing the font part directly by package path (`svg:font-face-uri`'s own `xlink:href`) -- ODF has no relationship indirection and no obfuscation at all (`extractOdfEmbeddedFonts`), so the binary part just has to exist at the href it names. `loext:font-weight`/`loext:font-style` are deliberately omitted: with neither present, `extractOdfEmbeddedFonts` falls back to the font's own `OS/2` `fsSelection` bits, which `options.fontBytes` (a real sfnt face) genuinely carries.
export function buildOdtWithEmbeddedFont(
  options: EmbeddedFontFixtureOptions,
): Uint8Array<ArrayBuffer> {
  const editor = createOdt();
  editor.body
    .appendParagraph()
    .appendRun({ text: "A paragraph of ordinary body text." });
  const pkg = editor.toPackage();

  pkg.parts["Fonts/font1.ttf"] = {
    kind: "binary",
    base64: odfBytesToBase64(options.fontBytes),
  };

  const contentPart = pkg.parts["content.xml"];
  if (contentPart?.kind !== "xml") {
    throw new Error(
      "embedded-font-fixture: createOdt() produced a package with no 'content.xml' XML part",
    );
  }
  const root = odfRootElement(contentPart.nodes);
  if (root === undefined) {
    throw new Error("embedded-font-fixture: 'content.xml' has no root element");
  }
  // office:document-content's own child sequence is office:scripts?, office:font-face-decls?, office:automatic-styles?, office:body -- inserted at index 0 (createEmptyOdtPackage's scaffold starts with [office:automatic-styles, office:body]) keeps that order.
  root.children.unshift(
    odfEl("office:font-face-decls", {}, [
      odfEl(
        "style:font-face",
        { "style:name": options.family, "svg:font-family": options.family },
        [
          odfEl("svg:font-face-src", {}, [
            odfEl("svg:font-face-uri", {
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
