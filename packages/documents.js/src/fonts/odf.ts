// Source-embedded font extraction for ODF packages -- the odt/odp/ods/odg counterpart to ooxml.ts, and a materially simpler one. ODF has no obfuscation convention at all: a style:font-face that embeds its face writes a plain, unmodified font file into a package-root Fonts/ directory and points at it by package path through svg:font-face-src/svg:font-face-uri's own xlink:href, exactly the way draw:image references a picture. No relationship-id indirection, no font key, no XOR.
//
// The declarations live in office:font-face-decls, which appears in BOTH content.xml and styles.xml, and a real LibreOffice-saved document repeats the same declaration in both. This module scans both parts and de-duplicates by referenced part path, keeping the first declaration seen -- the alternative (returning the same face twice) would be harmless for createFontRegistry's own exact-match lookup but is plainly wrong as a description of what the package contains.
//
// A face's weight/style comes from loext:font-style/loext:font-weight on the svg:font-face-uri when present. When absent -- the OASIS-standard attribute set carries no per-source style/weight at all, so a strictly-conforming producer legitimately writes none -- this falls back to the font's OWN OS/2 fsSelection bits, which is the better signal regardless: the loext attributes are a producer's claim about a file, fsSelection is that file's own declaration about itself. Only the family-level declaration cannot be recovered from the bytes, and that comes from svg:font-family (or style:name) on the enclosing style:font-face.
import type { Package, XmlElement } from "odf.js";
import type { ProvidedFont } from "document-schema.js";
import {
  attrValue,
  base64ToBytes,
  childrenWithTag,
  decodeXmlText,
  rootElement,
} from "odf.js";
import { parseSfnt } from "pdf-codec/sfnt";
import { parseOs2 } from "pdf-codec/font-tables";
import { looksLikeSfnt } from "./obfuscation";

// The two parts an office:font-face-decls block can appear in, in the order a face's first declaration should win.
const FONT_FACE_DECL_PARTS = ["content.xml", "styles.xml"] as const;

// OS/2 fsSelection, per the OpenType specification: bit 0 ITALIC, bit 5 BOLD.
const FS_SELECTION_ITALIC = 0x0001;
const FS_SELECTION_BOLD = 0x0020;

// CSS/SVG font-weight: anything numerically at or above 600, or the keyword "bold"/"bolder", counts as a bold face. 600 rather than 700 because the OpenType/CSS mapping puts semi-bold at 600 and every weight above it renders bolder than regular -- there is no third state for this package's boolean `bold` to land in.
const BOLD_WEIGHT_THRESHOLD = 600;

export class OdfEmbeddedFontError extends Error {
  constructor(detail: string) {
    super(`extractOdfEmbeddedFonts: ${detail}`);
    this.name = "OdfEmbeddedFontError";
  }
}

// svg:font-family is a CSS font-family value, so LibreOffice quotes any name containing a space -- and, since odf.js's model keeps attribute values exactly as they appeared in the source XML (entities raw, matching this package's own src/xml/entities.ts note about ooxml.js), a quoted name arrives here as the literal text "&apos;Liberation Serif&apos;". Decode the entities first, then strip one matching pair of surrounding quotes and take the first comma-separated entry, which is the face's own name rather than the generic fallbacks after it.
function normaliseFamily(value: string): string {
  const first = decodeXmlText(value).split(",")[0]?.trim() ?? "";
  const quoted = /^'(.*)'$|^"(.*)"$/.exec(first);
  return (quoted?.[1] ?? quoted?.[2] ?? first).trim();
}

function boldFromWeightAttribute(weight: string): boolean | undefined {
  const keyword = weight.trim().toLowerCase();
  if (keyword === "bold" || keyword === "bolder") {
    return true;
  }
  if (keyword === "normal" || keyword === "lighter") {
    return false;
  }
  const numeric = Number.parseInt(keyword, 10);
  return Number.isNaN(numeric) ? undefined : numeric >= BOLD_WEIGHT_THRESHOLD;
}

function italicFromStyleAttribute(style: string): boolean | undefined {
  const keyword = style.trim().toLowerCase();
  if (keyword === "italic" || keyword === "oblique") {
    return true;
  }
  return keyword === "normal" ? false : undefined;
}

// The bold/italic pair a font file declares about itself, read from its own OS/2 table. Undefined when the font carries no OS/2 table at all (a bare CFF-only or TrueType face predating OS/2), in which case there is genuinely nothing to read and the caller falls back to regular.
function styleFromFontBytes(
  bytes: Uint8Array<ArrayBuffer>,
): { readonly bold: boolean; readonly italic: boolean } | undefined {
  const font = parseSfnt(bytes);
  if (font === undefined) {
    return undefined;
  }
  const os2 = parseOs2(font);
  if (os2 === undefined) {
    return undefined;
  }
  return {
    bold: (os2.fsSelection & FS_SELECTION_BOLD) !== 0,
    italic: (os2.fsSelection & FS_SELECTION_ITALIC) !== 0,
  };
}

function fontPartBytes(pkg: Package, href: string): Uint8Array<ArrayBuffer> {
  const part = pkg.parts[href];
  if (part === undefined) {
    throw new OdfEmbeddedFontError(
      `svg:font-face-uri references ${JSON.stringify(href)}, which is not a part of this package`,
    );
  }
  if (part.kind !== "binary") {
    throw new OdfEmbeddedFontError(
      `embedded font part ${JSON.stringify(href)} is an XML part, not binary font data`,
    );
  }
  return base64ToBytes(part.base64);
}

function collectFontFace(
  pkg: Package,
  fontFace: XmlElement,
  seenHrefs: Set<string>,
  out: ProvidedFont[],
): void {
  const declaredFamily =
    attrValue(fontFace, "svg:font-family") ?? attrValue(fontFace, "style:name");
  for (const src of childrenWithTag(fontFace, "svg:font-face-src")) {
    for (const uri of childrenWithTag(src, "svg:font-face-uri")) {
      const rawHref = attrValue(uri, "xlink:href");
      if (rawHref === undefined) {
        throw new OdfEmbeddedFontError(
          "a <svg:font-face-uri> carries no xlink:href",
        );
      }
      // Entities raw in the model, same as svg:font-family above -- a package path containing '&' would arrive as "&amp;" and never match a real part key.
      const href = decodeXmlText(rawHref);
      if (seenHrefs.has(href)) {
        continue;
      }
      seenHrefs.add(href);
      if (declaredFamily === undefined) {
        throw new OdfEmbeddedFontError(
          `the <style:font-face> embedding ${JSON.stringify(href)} declares neither svg:font-family nor style:name`,
        );
      }
      const bytes = fontPartBytes(pkg, href);
      if (!looksLikeSfnt(bytes)) {
        throw new OdfEmbeddedFontError(
          `embedded font part ${JSON.stringify(href)} does not begin with a recognisable sfnt signature`,
        );
      }
      const declaredWeight = attrValue(uri, "loext:font-weight");
      const declaredStyle = attrValue(uri, "loext:font-style");
      const intrinsic = styleFromFontBytes(bytes);
      out.push({
        family: normaliseFamily(declaredFamily),
        bold:
          (declaredWeight === undefined
            ? undefined
            : boldFromWeightAttribute(declaredWeight)) ??
          intrinsic?.bold ??
          false,
        italic:
          (declaredStyle === undefined
            ? undefined
            : italicFromStyleAttribute(declaredStyle)) ??
          intrinsic?.italic ??
          false,
        bytes,
      });
    }
  }
}

// Every font face an ODF package embeds, as pdf-codec's own ProvidedFont shape -- the odt/odp/ods/odg counterpart to extractOoxmlEmbeddedFonts, feeding the identical createFontRegistry `sourceFonts` slot. An empty array means the package embedded nothing, the ordinary case for a document saved without "Embed fonts in the document" enabled.
export function extractOdfEmbeddedFonts(pkg: Package): ProvidedFont[] {
  const out: ProvidedFont[] = [];
  const seenHrefs = new Set<string>();
  for (const partPath of FONT_FACE_DECL_PARTS) {
    const part = pkg.parts[partPath];
    if (part?.kind !== "xml") {
      continue;
    }
    const root = rootElement(part.nodes);
    if (root === undefined) {
      continue;
    }
    for (const decls of childrenWithTag(root, "office:font-face-decls")) {
      for (const fontFace of childrenWithTag(decls, "style:font-face")) {
        collectFontFace(pkg, fontFace, seenHrefs, out);
      }
    }
  }
  return out;
}
