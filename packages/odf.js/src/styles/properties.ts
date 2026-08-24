import { z } from "zod";
import { AlignmentSchema, ColorSchema } from "document-schema.js";
import type { Attribute, XmlElement } from "../model/node";
import { encodeXmlText } from "../xml/entities";
import { parseOdfLength, formatOdfLength } from "../typed/shared/units";
import { parseOdfColor, formatOdfColor } from "../typed/shared/color";

// ODF has no direct/inline formatting at all: a docx run can carry bold/color/size straight on w:rPr, but an ODF text:span can only ever reference a NAMED style by @text:style-name -- every formatting difference becomes (or reuses) a named "automatic style" declared in <office:automatic-styles>. This module is the property-bag half of that machinery: a plain, serializable value covering the paragraph/run-level fields document-schema.js's ContentRun/ContentParagraph need to round-trip, plus the parse (style:style attributes -> bag) and build (bag -> style:style attributes) directions between it and real ODF XML. registry.ts and serialize.ts (siblings in this directory) are the callers; span.ts is the sibling that actually wraps a character range in a text:span referencing an interned style name.
//
// Every attribute name below was verified against real style:style/style:text-properties/style:paragraph-properties output from LibreOffice 26.2 (via `soffice --headless --convert-to odt/ods` on hand-built HTML/CSV fixtures -- see the odf-groundtruth scratch directory referenced in the accompanying commit) and cross-checked against the OASIS ODF 1.2 schema reference (datypic.com's ODF 1.1/1.2 schema browser, itself mirroring the OASIS RNG/XSD). Two things are easy to get wrong by guessing:
// - fo:font-family is used here (a direct, spec-valid attribute -- OASIS ODF 1.2 part 1 section 20.190) rather than style:font-name, which is LibreOffice's own preferred *shorthand* that instead references a <style:font-face> declared in <office:font-face-decls>. odf.js does not yet manage font-face-decls, so fo:font-family is the correct, self-contained choice: it carries the family name directly on the property itself, with nothing else to keep in sync.
// - Lengths (fo:font-size, fo:margin-*, fo:text-indent) are written here in "pt" (e.g. "12pt"), not the "cm" LibreOffice's own UI defaults to -- both are valid per the ODF `length` datatype (pattern `-?(\d+(\.\d+)?|\.\d+)(cm|mm|in|pt|pc|px)`, confirmed against datypic.com/sc/odf/t-length or equivalent), and "pt" avoids a unit-conversion rounding step entirely since this package's own model (and document-schema.js's) is already pt-based throughout. Parsing (../typed/shared/units.ts's parseOdfLength, exported from this package's own barrel as parseLength -- the canonical, single implementation of ODF length parsing/formatting every reader in this package shares) accepts all six units, since an adopted real-world document may use any of them.

export const StylePropertiesSchema = z.object({
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  strike: z.boolean().optional(),
  fontFamily: z.string().optional(),
  sizePt: z.number().optional(),
  color: ColorSchema.optional(),
  alignment: AlignmentSchema.optional(),
  spacingBeforePt: z.number().optional(),
  spacingAfterPt: z.number().optional(),
  lineSpacing: z.number().optional(),
  indentLeftPt: z.number().optional(),
  indentFirstLinePt: z.number().optional(),
  pageBreakBefore: z.boolean().optional(),
  pageBreakAfter: z.boolean().optional(),
});
export type StyleProperties = z.infer<typeof StylePropertiesSchema>;

// Result of parsing one style:text-properties or style:paragraph-properties element (or a whole style:style, via parseStyleElementProperties): the subset of StyleProperties this module could actually interpret, plus whether the source element carried anything it couldn't. `hasUnknown` is the load-bearing half for registry.ts's adoption rule: a style with unknown content must never be silently reused/overwritten by a future intern() call, since we cannot prove reusing it wouldn't destroy formatting information this reader doesn't understand.
export interface ParsedProperties {
  properties: Partial<StyleProperties>;
  hasUnknown: boolean;
}

const ATTR = {
  fontWeight: "fo:font-weight",
  fontStyle: "fo:font-style",
  underlineStyle: "style:text-underline-style",
  underlineWidth: "style:text-underline-width",
  underlineColor: "style:text-underline-color",
  lineThroughStyle: "style:text-line-through-style",
  lineThroughType: "style:text-line-through-type",
  fontFamily: "fo:font-family",
  fontSize: "fo:font-size",
  color: "fo:color",
  textAlign: "fo:text-align",
  marginTop: "fo:margin-top",
  marginBottom: "fo:margin-bottom",
  lineHeight: "fo:line-height",
  marginLeft: "fo:margin-left",
  textIndent: "fo:text-indent",
  breakBefore: "fo:break-before",
  breakAfter: "fo:break-after",
} as const;

const TEXT_ATTR_NAMES: ReadonlySet<string> = new Set([
  ATTR.fontWeight,
  ATTR.fontStyle,
  ATTR.underlineStyle,
  ATTR.underlineWidth,
  ATTR.underlineColor,
  ATTR.lineThroughStyle,
  ATTR.lineThroughType,
  ATTR.fontFamily,
  ATTR.fontSize,
  ATTR.color,
]);

const PARAGRAPH_ATTR_NAMES: ReadonlySet<string> = new Set([
  ATTR.textAlign,
  ATTR.marginTop,
  ATTR.marginBottom,
  ATTR.lineHeight,
  ATTR.marginLeft,
  ATTR.textIndent,
  ATTR.breakBefore,
  ATTR.breakAfter,
]);

function attributeMap(element: XmlElement): Map<string, string> {
  const map = new Map<string, string>();
  for (const attribute of element.attributes) {
    map.set(attribute.name, attribute.value);
  }
  return map;
}

// The canonical ODF length parse/format pair now lives in ../typed/shared/units.ts, shared with every other reader in this package (and future odt/ods/odp/odg readers) rather than duplicated here -- see that module's own top-of-file note for the unit-conversion constants and their verification. parseOdfLength's own public name (index.ts renames it to this module's established parseLength) needs no restatement here; formatPt is this module's own real function, formatOdfLength pinned to "pt" -- this package's own writers' one and only output unit (see the top-of-file note above).
export function formatPt(valuePt: number): string {
  return formatOdfLength(valuePt, "pt");
}

const PERCENTAGE_PATTERN = /^(-?(?:\d+(?:\.\d+)?|\.\d+))%$/;

// fo:line-height as a percentage (e.g. "150%") maps to document-schema.js's ContentParagraph.lineSpacing, which is a multiplier (1.5), not a percentage (150) -- see ooxml.js's own docx/pptx line-spacing readers, which establish this convention (`expect(props.lineSpacing).toBe(1.5)` for what OOXML calls 360/240). An absolute-length fo:line-height (e.g. "12pt") or the literal value "normal" is valid ODF but outside this multiplier-only model, so it parses as undefined here (triggering the caller's hasUnknown, not a silent misinterpretation).
function parsePercentageMultiplier(value: string): number | undefined {
  const match = PERCENTAGE_PATTERN.exec(value);
  if (match === null) {
    return undefined;
  }
  const numeric = match[1];
  if (numeric === undefined) {
    return undefined;
  }
  return Number(numeric) / 100;
}

export function formatPercentageMultiplier(multiplier: number): string {
  return `${multiplier * 100}%`;
}

// The canonical ODF colour parse/format pair now lives in ../typed/shared/color.ts, shared with every other reader in this package rather than duplicated here -- see that module's own top-of-file note on the text:color datatype. This module calls parseOdfColor/formatOdfColor directly (see parseTextProperties/textPropertiesToAttributes below) rather than through a local alias.

// Reads a boolean tri-state (true/false/absent) plus an "unrecognised combination" outcome from ODF's compound line-decoration attributes (underline: style+width+color; strike: style+type). Ground truth (LibreOffice 26.2): underline "on" is `style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"`; strike "on" is `style:text-line-through-style="solid" style:text-line-through-type="single"`. Only that exact canonical "on" shape, or a plain "none" with no companion attributes, parses cleanly -- anything else (a custom underline colour, a dotted style, a companion attribute present alongside "none") is real formatting information this boolean model cannot represent, so it comes back as 'unknown' rather than being silently approximated.
function parseLineDecoration(
  style: string | undefined,
  companionA: string | undefined,
  companionAOnValue: string,
  companionB: string | undefined,
  companionBOnValue: string,
): boolean | undefined | "unknown" {
  if (
    style === undefined &&
    companionA === undefined &&
    companionB === undefined
  ) {
    return undefined;
  }
  if (
    style === "solid" &&
    (companionA === undefined || companionA === companionAOnValue) &&
    (companionB === undefined || companionB === companionBOnValue)
  ) {
    return true;
  }
  if (
    style === "none" &&
    companionA === undefined &&
    companionB === undefined
  ) {
    return false;
  }
  return "unknown";
}

// Attributes on the outer style:style element (not inside style:text-properties/style:paragraph-properties) that carry behavioural side effects beyond pure formatting: style:master-page-name triggers a page break when this style is applied, style:next-style-name changes what style a following paragraph gets. Reusing a style for its properties alone while silently carrying one of these along would be a real semantic change, not just a formatting one -- so their presence opts a style out of fingerprint reuse the same way an unmodeled text/paragraph-properties attribute does, even though the task's own example scoped the rule to the properties sub-elements specifically. style:display-name and style:class are purely cosmetic/informational and are not included here.
const RISKY_STYLE_ELEMENT_ATTRS: ReadonlySet<string> = new Set([
  "style:master-page-name",
  "style:next-style-name",
]);

export function parseTextProperties(element: XmlElement): ParsedProperties {
  const attrs = attributeMap(element);
  const properties: Partial<StyleProperties> = {};
  let hasUnknown = false;

  for (const name of attrs.keys()) {
    if (!TEXT_ATTR_NAMES.has(name)) {
      hasUnknown = true;
    }
  }

  const fontWeight = attrs.get(ATTR.fontWeight);
  if (fontWeight === "bold") {
    properties.bold = true;
  } else if (fontWeight === "normal") {
    properties.bold = false;
  } else if (fontWeight !== undefined) {
    hasUnknown = true;
  }

  const fontStyle = attrs.get(ATTR.fontStyle);
  if (fontStyle === "italic") {
    properties.italic = true;
  } else if (fontStyle === "normal") {
    properties.italic = false;
  } else if (fontStyle !== undefined) {
    hasUnknown = true;
  }

  const underline = parseLineDecoration(
    attrs.get(ATTR.underlineStyle),
    attrs.get(ATTR.underlineWidth),
    "auto",
    attrs.get(ATTR.underlineColor),
    "font-color",
  );
  if (underline === "unknown") {
    hasUnknown = true;
  } else if (underline !== undefined) {
    properties.underline = underline;
  }

  const strike = parseLineDecoration(
    attrs.get(ATTR.lineThroughStyle),
    attrs.get(ATTR.lineThroughType),
    "single",
    undefined,
    "",
  );
  if (strike === "unknown") {
    hasUnknown = true;
  } else if (strike !== undefined) {
    properties.strike = strike;
  }

  const fontFamily = attrs.get(ATTR.fontFamily);
  if (fontFamily !== undefined) {
    properties.fontFamily = fontFamily;
  }

  const fontSize = attrs.get(ATTR.fontSize);
  if (fontSize !== undefined) {
    const pt = parseOdfLength(fontSize);
    if (pt === undefined) {
      hasUnknown = true;
    } else {
      properties.sizePt = pt;
    }
  }

  const color = attrs.get(ATTR.color);
  if (color !== undefined) {
    const parsed = parseOdfColor(color);
    if (parsed === undefined) {
      hasUnknown = true;
    } else {
      properties.color = parsed;
    }
  }

  return { properties, hasUnknown };
}

export function parseParagraphProperties(
  element: XmlElement,
): ParsedProperties {
  const attrs = attributeMap(element);
  const properties: Partial<StyleProperties> = {};
  let hasUnknown = false;

  for (const name of attrs.keys()) {
    if (!PARAGRAPH_ATTR_NAMES.has(name)) {
      hasUnknown = true;
    }
  }

  const textAlign = attrs.get(ATTR.textAlign);
  if (
    textAlign === "left" ||
    textAlign === "center" ||
    textAlign === "right" ||
    textAlign === "justify"
  ) {
    properties.alignment = textAlign;
  } else if (textAlign !== undefined) {
    hasUnknown = true;
  }

  const marginTop = attrs.get(ATTR.marginTop);
  if (marginTop !== undefined) {
    const pt = parseOdfLength(marginTop);
    if (pt === undefined) {
      hasUnknown = true;
    } else {
      properties.spacingBeforePt = pt;
    }
  }

  const marginBottom = attrs.get(ATTR.marginBottom);
  if (marginBottom !== undefined) {
    const pt = parseOdfLength(marginBottom);
    if (pt === undefined) {
      hasUnknown = true;
    } else {
      properties.spacingAfterPt = pt;
    }
  }

  const marginLeft = attrs.get(ATTR.marginLeft);
  if (marginLeft !== undefined) {
    const pt = parseOdfLength(marginLeft);
    if (pt === undefined) {
      hasUnknown = true;
    } else {
      properties.indentLeftPt = pt;
    }
  }

  const textIndent = attrs.get(ATTR.textIndent);
  if (textIndent !== undefined) {
    const pt = parseOdfLength(textIndent);
    if (pt === undefined) {
      hasUnknown = true;
    } else {
      properties.indentFirstLinePt = pt;
    }
  }

  const lineHeight = attrs.get(ATTR.lineHeight);
  if (lineHeight !== undefined) {
    const multiplier = parsePercentageMultiplier(lineHeight);
    if (multiplier === undefined) {
      hasUnknown = true;
    } else {
      properties.lineSpacing = multiplier;
    }
  }

  // fo:break-before/fo:break-after are enumerated by the OASIS ODF 1.2 schema to exactly auto/column/page/even-page/odd-page (OpenDocument v1.3 part 3, section 20.185): "page" is the page break this boolean model carries, "auto" its explicit absence (the same normal/false split fo:font-weight takes), and "column"/"even-page"/"odd-page" each carry a meaning the boolean cannot hold -- a column break is not a page break at all, and the two parity variants name WHICH page the break lands on -- so those stay unknown and quarantine as residue rather than silently losing the extra fact.
  const breakBefore = attrs.get(ATTR.breakBefore);
  if (breakBefore === "page") {
    properties.pageBreakBefore = true;
  } else if (breakBefore === "auto") {
    properties.pageBreakBefore = false;
  } else if (breakBefore !== undefined) {
    hasUnknown = true;
  }

  const breakAfter = attrs.get(ATTR.breakAfter);
  if (breakAfter === "page") {
    properties.pageBreakAfter = true;
  } else if (breakAfter === "auto") {
    properties.pageBreakAfter = false;
  } else if (breakAfter !== undefined) {
    hasUnknown = true;
  }

  return { properties, hasUnknown };
}

// Parses a whole style:style element: its style:text-properties and style:paragraph-properties children (if present), combined into one bag. Any OTHER property-bearing child (style:table-properties, style:table-cell-properties, style:graphic-properties, style:map, ...) carries formatting this module has no vocabulary for at all, so it unconditionally sets hasUnknown -- this package only models paragraph/run-level text-document formatting, never table/graphic properties. The outer style:style element's own style:master-page-name/style:next-style-name attributes are checked too, for the behavioural-side-effect reason documented at RISKY_STYLE_ELEMENT_ATTRS above.
export function parseStyleElementProperties(styleElement: XmlElement): {
  properties: StyleProperties;
  hasUnknown: boolean;
} {
  let properties: StyleProperties = {};
  let hasUnknown = false;

  for (const attribute of styleElement.attributes) {
    if (RISKY_STYLE_ELEMENT_ATTRS.has(attribute.name)) {
      hasUnknown = true;
    }
  }

  for (const child of styleElement.children) {
    if (child.type !== "element") {
      continue;
    }
    if (child.tag === "style:text-properties") {
      const result = parseTextProperties(child);
      properties = { ...properties, ...result.properties };
      if (result.hasUnknown) {
        hasUnknown = true;
      }
    } else if (child.tag === "style:paragraph-properties") {
      const result = parseParagraphProperties(child);
      properties = { ...properties, ...result.properties };
      if (result.hasUnknown) {
        hasUnknown = true;
      }
    } else {
      hasUnknown = true;
    }
  }

  return { properties, hasUnknown };
}

// The properties -> attributes direction, one function per style:*-properties element kind. Both build a fixed-order Attribute[] regardless of which keys happen to be set on `properties` or what order they were assigned in JS -- that fixed order is what makes serialize.ts's canonical string (and therefore registry.ts's fingerprinting) deterministic. Order: bold, italic, underline (style/width/color), strike (style/type), fontFamily, sizePt, color for text; alignment, spacingBefore, spacingAfter, lineSpacing, indentLeft, indentFirstLine for paragraph.
export function textPropertiesToAttributes(
  properties: StyleProperties,
): Attribute[] {
  const attributes: Attribute[] = [];
  if (properties.bold !== undefined) {
    attributes.push({
      name: ATTR.fontWeight,
      value: properties.bold ? "bold" : "normal",
    });
  }
  if (properties.italic !== undefined) {
    attributes.push({
      name: ATTR.fontStyle,
      value: properties.italic ? "italic" : "normal",
    });
  }
  if (properties.underline !== undefined) {
    if (properties.underline) {
      attributes.push({ name: ATTR.underlineStyle, value: "solid" });
      attributes.push({ name: ATTR.underlineWidth, value: "auto" });
      attributes.push({ name: ATTR.underlineColor, value: "font-color" });
    } else {
      attributes.push({ name: ATTR.underlineStyle, value: "none" });
    }
  }
  if (properties.strike !== undefined) {
    if (properties.strike) {
      attributes.push({ name: ATTR.lineThroughStyle, value: "solid" });
      attributes.push({ name: ATTR.lineThroughType, value: "single" });
    } else {
      attributes.push({ name: ATTR.lineThroughStyle, value: "none" });
    }
  }
  if (properties.fontFamily !== undefined) {
    attributes.push({
      name: ATTR.fontFamily,
      value: encodeXmlText(properties.fontFamily),
    });
  }
  if (properties.sizePt !== undefined) {
    attributes.push({
      name: ATTR.fontSize,
      value: formatPt(properties.sizePt),
    });
  }
  if (properties.color !== undefined) {
    attributes.push({
      name: ATTR.color,
      value: formatOdfColor(properties.color),
    });
  }
  return attributes;
}

export function paragraphPropertiesToAttributes(
  properties: StyleProperties,
): Attribute[] {
  const attributes: Attribute[] = [];
  if (properties.alignment !== undefined) {
    attributes.push({ name: ATTR.textAlign, value: properties.alignment });
  }
  if (properties.spacingBeforePt !== undefined) {
    attributes.push({
      name: ATTR.marginTop,
      value: formatPt(properties.spacingBeforePt),
    });
  }
  if (properties.spacingAfterPt !== undefined) {
    attributes.push({
      name: ATTR.marginBottom,
      value: formatPt(properties.spacingAfterPt),
    });
  }
  if (properties.lineSpacing !== undefined) {
    attributes.push({
      name: ATTR.lineHeight,
      value: formatPercentageMultiplier(properties.lineSpacing),
    });
  }
  if (properties.indentLeftPt !== undefined) {
    attributes.push({
      name: ATTR.marginLeft,
      value: formatPt(properties.indentLeftPt),
    });
  }
  if (properties.indentFirstLinePt !== undefined) {
    attributes.push({
      name: ATTR.textIndent,
      value: formatPt(properties.indentFirstLinePt),
    });
  }
  if (properties.pageBreakBefore !== undefined) {
    attributes.push({
      name: ATTR.breakBefore,
      value: properties.pageBreakBefore ? "page" : "auto",
    });
  }
  if (properties.pageBreakAfter !== undefined) {
    attributes.push({
      name: ATTR.breakAfter,
      value: properties.pageBreakAfter ? "page" : "auto",
    });
  }
  return attributes;
}
