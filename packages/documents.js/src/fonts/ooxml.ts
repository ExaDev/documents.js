// Source-embedded font extraction for OOXML packages. A docx/pptx that embeds its fonts already carries the exact bytes the document was authored against, which beats every substitute this package could reach for: the vendored Carlito/Caladea faces pdf-codec falls back to are metric-compatible with Calibri/Cambria and nothing else, and the standard-14 faces are metric-compatible with Arial/Times New Roman and nothing else. Whenever the source package embedded a face, using it is not an optimisation but the only path that renders the document's real typeface at its real metrics.
//
// The two formats declare embedded fonts in completely different parts, but resolve to the same three facts per face: a family name, a bold/italic pair, and a relationship id pointing at the font part. docx puts them in word/fontTable.xml (w:font/w:name plus w:embedRegular/w:embedBold/w:embedItalic/w:embedBoldItalic, each with r:id and a w:fontKey GUID); pptx puts them in ppt/presentation.xml (p:embeddedFontLst/p:embeddedFont, whose p:font carries `typeface` and whose p:regular/p:bold/p:italic/p:boldItalic carry r:id alone, with no font key). Everything downstream of resolving those three facts -- reading the part, sniffing whether its bytes are obfuscated, XORing them back -- is shared.
//
// A face this extractor recovers is deliberately NOT filtered by what the document actually uses. Word and PowerPoint both subset an embedded font to the glyphs the document contained at save time, so a character this package synthesises rather than reads (a list bullet, sheets.ts's own ### column-overflow marker) can legitimately be absent from a face that is otherwise exactly right for every real character on the page. That is a per-character concern, resolved per character by pdf-codec's own writePdf: a cmap miss on an embedded face reports through onMissingGlyph and falls back for that one character, never failing the run. Dropping the whole face here because one synthesised glyph might be missing would trade a faithful render for a substituted one over a character the source document never contained.
import type { Package, Relationship, XmlElement } from "ooxml.js";
import type { ProvidedFont } from "document-schema.js";
import {
  attr,
  base64ToBytes,
  childrenWithTag,
  decodeEntities,
  resolveRelationships,
  rootElement,
} from "ooxml.js";
import { deobfuscateEmbeddedFont } from "./obfuscation";

const OFFICE_DOCUMENT_RELATIONSHIP =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument";
const FONT_TABLE_RELATIONSHIP =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable";
const ROOT_RELS_PART = "_rels/.rels";

// The four docx w:font children that reference an embedded face, paired with the bold/italic combination each one means. Order is the declaration order ECMA-376 gives them in the CT_Font sequence, so a package with all four yields faces in a stable, document-faithful order.
const DOCX_EMBED_ELEMENTS: readonly (readonly [
  tag: string,
  bold: boolean,
  italic: boolean,
])[] = [
  ["w:embedRegular", false, false],
  ["w:embedBold", true, false],
  ["w:embedItalic", false, true],
  ["w:embedBoldItalic", true, true],
];

// pptx's own equivalent, inside p:embeddedFont. Same four faces, different vocabulary, and no font-key attribute anywhere -- see obfuscation.ts on why that does not need a format branch here.
const PPTX_EMBED_ELEMENTS: readonly (readonly [
  tag: string,
  bold: boolean,
  italic: boolean,
])[] = [
  ["p:regular", false, false],
  ["p:bold", true, false],
  ["p:italic", false, true],
  ["p:boldItalic", true, true],
];

export class OoxmlEmbeddedFontError extends Error {
  constructor(detail: string) {
    super(`extractOoxmlEmbeddedFonts: ${detail}`);
    this.name = "OoxmlEmbeddedFontError";
  }
}

// The part `fromPartPath` reaches through a relationship of the given type, or undefined when it declares none. Resolution goes through ooxml.js's own resolveRelationships rather than assuming a conventional path, so a producer that names its font table something other than word/fontTable.xml still resolves -- resolveRelationships already turns a Relationship's own directory-relative Target into a package-relative part path.
function relatedPartPath(
  pkg: Package,
  fromPartPath: string,
  relationshipType: string,
): string | undefined {
  for (const relationship of resolveRelationships(pkg, fromPartPath).values()) {
    if (
      relationship.type === relationshipType &&
      relationship.targetMode === undefined
    ) {
      return relationship.target;
    }
  }
  return undefined;
}

// The package's main document part (word/document.xml, ppt/presentation.xml), resolved from _rels/.rels the same way every OOXML consumer is required to. Read directly rather than through resolveRelationships: that function derives a part's .rels path from the part's own path, and the package root has no part path to derive one from -- passing an empty string yields "/_rels/.rels", with a leading slash no real package uses. A root Relationship's Target is always package-root-relative, so the only normalisation needed here is stripping an optional leading slash.
function officeDocumentPartPath(pkg: Package): string {
  const rels = rootElement(pkg.parts[ROOT_RELS_PART]);
  if (rels !== undefined) {
    for (const relationship of childrenWithTag(rels, "Relationship")) {
      if (
        attr(relationship, "Type") !== OFFICE_DOCUMENT_RELATIONSHIP ||
        attr(relationship, "TargetMode") !== undefined
      ) {
        continue;
      }
      const target = attr(relationship, "Target");
      if (target !== undefined) {
        return target.startsWith("/") ? target.slice(1) : target;
      }
    }
  }
  throw new OoxmlEmbeddedFontError(
    `the package declares no officeDocument relationship in ${ROOT_RELS_PART}`,
  );
}

// The raw bytes of a font part, given the id of a relationship declared by `fromPartPath`. Throws rather than skipping: a w:embedRegular naming an r:id that resolves to nothing, or to an XML part, is a structurally broken package, and quietly dropping the face would silently downgrade the render to a substitute for a reason no caller could see.
function fontPartBytes(
  pkg: Package,
  fromPartPath: string,
  relationships: ReadonlyMap<string, Relationship>,
  relationshipId: string,
): Uint8Array<ArrayBuffer> {
  const relationship = relationships.get(relationshipId);
  if (relationship === undefined) {
    throw new OoxmlEmbeddedFontError(
      `${fromPartPath} references relationship id ${JSON.stringify(relationshipId)}, which its .rels part does not declare`,
    );
  }
  const part = pkg.parts[relationship.target];
  if (part === undefined) {
    throw new OoxmlEmbeddedFontError(
      `relationship id ${JSON.stringify(relationshipId)} targets ${JSON.stringify(relationship.target)}, which is not a part of this package`,
    );
  }
  if (part.kind !== "binary") {
    throw new OoxmlEmbeddedFontError(
      `embedded font part ${JSON.stringify(relationship.target)} is an XML part, not binary font data`,
    );
  }
  return base64ToBytes(part.base64);
}

// One w:font / p:embeddedFont element's own faces, appended to `out`. `family` is the element's declared typeface name; a face whose reference element is absent simply contributes nothing, which is the normal case (most embedded families ship regular and bold only).
function collectFaces(
  pkg: Package,
  declaringPartPath: string,
  relationships: ReadonlyMap<string, Relationship>,
  fontElementChildren: readonly (readonly [
    tag: string,
    bold: boolean,
    italic: boolean,
  ])[],
  fontElement: XmlElement,
  family: string,
  fontKeyAttribute: string | undefined,
  out: ProvidedFont[],
): void {
  for (const [tag, bold, italic] of fontElementChildren) {
    for (const embed of childrenWithTag(fontElement, tag)) {
      const relationshipId = attr(embed, "r:id");
      if (relationshipId === undefined) {
        throw new OoxmlEmbeddedFontError(
          `<${tag}> for font ${JSON.stringify(family)} carries no r:id`,
        );
      }
      const fontKey =
        fontKeyAttribute === undefined
          ? undefined
          : attr(embed, fontKeyAttribute);
      out.push({
        family,
        bold,
        italic,
        bytes: deobfuscateEmbeddedFont(
          fontPartBytes(pkg, declaringPartPath, relationships, relationshipId),
          fontKey,
        ),
      });
    }
  }
}

function extractDocxFonts(pkg: Package): ProvidedFont[] {
  const documentPartPath = officeDocumentPartPath(pkg);
  const fontTablePath = relatedPartPath(
    pkg,
    documentPartPath,
    FONT_TABLE_RELATIONSHIP,
  );
  if (fontTablePath === undefined) {
    return [];
  }
  const fontTablePart = pkg.parts[fontTablePath];
  if (fontTablePart?.kind !== "xml") {
    throw new OoxmlEmbeddedFontError(
      `font table part ${JSON.stringify(fontTablePath)} is missing or is not an XML part`,
    );
  }
  const fonts = rootElement(fontTablePart);
  if (fonts === undefined) {
    return [];
  }
  // Resolved once for the whole font table rather than per face: every w:embed* in the part reaches its bytes through this same .rels file.
  const relationships = resolveRelationships(pkg, fontTablePath);
  const out: ProvidedFont[] = [];
  for (const font of childrenWithTag(fonts, "w:font")) {
    const family = attr(font, "w:name");
    if (family === undefined) {
      throw new OoxmlEmbeddedFontError(
        `a <w:font> in ${JSON.stringify(fontTablePath)} carries no w:name`,
      );
    }
    // ooxml.js keeps attribute values exactly as they appeared in the source XML, entities included (see src/xml/entities.ts's own note), so a family like "AT&T Sans" arrives as "AT&amp;T Sans" and would never match a LayoutFont's own decoded family name.
    collectFaces(
      pkg,
      fontTablePath,
      relationships,
      DOCX_EMBED_ELEMENTS,
      font,
      decodeEntities(family),
      "w:fontKey",
      out,
    );
  }
  return out;
}

function extractPptxFonts(pkg: Package): ProvidedFont[] {
  const presentationPartPath = officeDocumentPartPath(pkg);
  const presentationPart = pkg.parts[presentationPartPath];
  if (presentationPart?.kind !== "xml") {
    throw new OoxmlEmbeddedFontError(
      `presentation part ${JSON.stringify(presentationPartPath)} is missing or is not an XML part`,
    );
  }
  const presentation = rootElement(presentationPart);
  if (presentation === undefined) {
    return [];
  }
  // Resolved once, same reasoning as the docx font table above.
  const relationships = resolveRelationships(pkg, presentationPartPath);
  const out: ProvidedFont[] = [];
  for (const list of childrenWithTag(presentation, "p:embeddedFontLst")) {
    for (const embeddedFont of childrenWithTag(list, "p:embeddedFont")) {
      const fontElement = childrenWithTag(embeddedFont, "p:font")[0];
      if (fontElement === undefined) {
        throw new OoxmlEmbeddedFontError(
          `a <p:embeddedFont> in ${JSON.stringify(presentationPartPath)} carries no <p:font>`,
        );
      }
      const family = attr(fontElement, "typeface");
      if (family === undefined) {
        throw new OoxmlEmbeddedFontError(
          `a <p:font> in ${JSON.stringify(presentationPartPath)} carries no typeface`,
        );
      }
      // Entities raw in the model, same as docx's w:name above.
      collectFaces(
        pkg,
        presentationPartPath,
        relationships,
        PPTX_EMBED_ELEMENTS,
        embeddedFont,
        decodeEntities(family),
        undefined,
        out,
      );
    }
  }
  return out;
}

// Every font face a docx or pptx package embeds, as pdf-codec's own ProvidedFont shape -- ready to hand straight to createFontRegistry's `sourceFonts`, where an exact family+bold+italic match wins over both a caller-supplied face and the vendored substitutes. An empty array means the package embedded nothing, which is the ordinary case for a document saved without font embedding turned on.
export function extractOoxmlEmbeddedFonts(
  pkg: Package,
  kind: "docx" | "pptx",
): ProvidedFont[] {
  return kind === "docx" ? extractDocxFonts(pkg) : extractPptxFonts(pkg);
}
