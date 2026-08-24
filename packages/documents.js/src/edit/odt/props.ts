import type { Package, StyleFamily, StyleProperties, XmlElement } from "odf.js";
import { resolveStyle, StyleRegistry } from "odf.js";
import { attr } from "ooxml.js";
import { setAttr } from "../../xml/edit";
import { CONTENT_PART_PATH } from "./automatic-styles";

// ODF has no equivalent of WordprocessingML's inline w:rPr/w:pPr: formatting is ALWAYS expressed by reference to a named style (text:style-name on a text:span/text:p, resolved against a style:style element in office:automatic-styles or office:styles), never as an attribute on the content element itself. This module is the ODF-specific substitute for src/edit/docx/props.ts's inline-attribute get/set helpers -- every OdtRun/OdtParagraph setter (run.ts, paragraph.ts) goes through applyStyleChange below, and every getter goes through readCurrentStyleProperties, so "mutate this run/paragraph's formatting" always means "resolve the current cascaded style, merge in the change, intern the merged set as a (possibly reused, possibly freshly minted) automatic style, and repoint text:style-name at it" -- never an in-place attribute edit.

export const STYLE_NAME_ATTR = "text:style-name";

// Resolves `element`'s current text:style-name attribute against the FULL cascade (default-style -> style:parent-style-name chain, searched across both content.xml and styles.xml -- odf.js's own resolveStyle) for the given family. This is deliberately the cascaded, effective view, not merely local/direct formatting the way DocxRun/DocxParagraph's own getters are (see props.ts's own comment there) -- ODF's style-name-only model has no separate "direct formatting" layer to read instead; the referenced style IS the formatting.
export function readCurrentStyleProperties(
  pkg: Package,
  element: XmlElement,
  family: StyleFamily,
): StyleProperties {
  const styleName = attr(element, STYLE_NAME_ATTR);
  return resolveStyle(styleName, family, pkg).properties;
}

// Merges `change` into `element`'s current cascaded properties, interns the merged set via a fresh StyleRegistry.forPart(pkg, 'content.xml') (which only ever appends a brand-new style:style entry to office:automatic-styles, or reuses an existing entry with an identical fingerprint -- see StyleRegistry.intern's own doc comment; it never mutates or removes an existing entry, the property assertAutomaticStylesOnlyAppended in src/test-support verifies), and repoints element's own text:style-name at the (possibly reused, possibly freshly minted) result.
//
// A consequence worth being explicit about: each setter call interns independently, so setting two properties on the same run/paragraph via two separate calls (run.bold = true; run.color = {...}) mints an intermediate style for the {bold}-only state, then a second style for the {bold, color} state the run actually ends up pointing at -- the first is left behind in office:automatic-styles, unreferenced. This is harmless (LibreOffice and every other real ODF consumer tolerate unreferenced automatic styles without issue) and is the direct, accepted cost of every setter resolving-merging-interning independently rather than batching -- odf.js's own StyleRegistry.gc(referenced) exists for a caller that wants to sweep these before a final save, which this editor does not do automatically.
export function applyStyleChange(
  pkg: Package,
  element: XmlElement,
  family: StyleFamily,
  change: Partial<StyleProperties>,
): void {
  const current = readCurrentStyleProperties(pkg, element, family);
  const merged: StyleProperties = { ...current, ...change };
  const name = StyleRegistry.forPart(pkg, CONTENT_PART_PATH).intern({
    family,
    properties: merged,
  });
  setAttr(element, STYLE_NAME_ATTR, name);
}
