import type { XmlElement } from "../../model/node";
import type { Alignment, Color } from "document-schema.js";
import { rgbHexToColor } from "document-schema.js";
import {
  halfPointsToPt,
  lineUnitsToMultiplier,
  twipsToPt,
} from "../shared/units";
import type { DrawingTheme } from "../shared/drawingml";
import { attr, childrenWithTag, elementsWithTag } from "../util";

// The WordprocessingML style cascade: docDefaults -> the default paragraph/character style -> a paragraph or run's own named style resolved through its w:basedOn chain (root-first, cycle-guarded) -> the paragraph's own direct w:pPr/w:rPr. Skipping the paragraph-mark run properties (w:pPr/w:rPr, a run-level baseline every run in the paragraph inherits before its own character style/direct formatting) is exactly why naive converters render headings at body size -- ECMA-376 defines it as part of CT_PPr precisely so a paragraph style like "Heading1" can set a heading-sized default for runs that don't override it themselves. Ported from documents.js's src/ooxml/docx/styles.ts.
//
// DocxStyleContext/ResolvedParagraphProperties/ResolvedRunProperties are internal cascade-resolution types, not part of DocxDocument's own published shape -- they carry a DrawingTheme (itself holding a Map, not a natural Zod target) and exist only to thread state through the resolve* functions below, so (matching documents.js's own choice) they stay plain TypeScript interfaces rather than Zod-schema'd model types.

export interface DocxStyleContext {
  readonly stylesRoot: XmlElement | undefined;
  readonly theme: DrawingTheme;
}

export interface ResolvedParagraphProperties {
  readonly alignment?: Alignment;
  readonly spacingBeforePt?: number;
  readonly spacingAfterPt?: number;
  readonly lineSpacing?: number;
  readonly indentLeftPt?: number;
  readonly indentFirstLinePt?: number;
  // w:pPr/w:outlineLvl verbatim, 0-based (0 is a level-1 heading). This is ECMA-376's own "this paragraph style is a heading at level N" mechanism, inherited through w:basedOn like every other field here -- which is why a custom style based on Heading2 resolves without name-matching the styleId. Kept raw because this interface mirrors the cascade; readParagraph converts it to the schema's 1-based headingLevel.
  readonly outlineLvl?: number;
}

export interface ResolvedRunProperties {
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly underline?: boolean;
  readonly strike?: boolean;
  readonly fontFamily?: string;
  readonly sizePt?: number;
  readonly color?: Color;
}

function mergeParagraphLayer(
  base: ResolvedParagraphProperties,
  layer: ResolvedParagraphProperties,
): ResolvedParagraphProperties {
  return {
    alignment: layer.alignment ?? base.alignment,
    spacingBeforePt: layer.spacingBeforePt ?? base.spacingBeforePt,
    spacingAfterPt: layer.spacingAfterPt ?? base.spacingAfterPt,
    lineSpacing: layer.lineSpacing ?? base.lineSpacing,
    indentLeftPt: layer.indentLeftPt ?? base.indentLeftPt,
    indentFirstLinePt: layer.indentFirstLinePt ?? base.indentFirstLinePt,
    outlineLvl: layer.outlineLvl ?? base.outlineLvl,
  };
}

function mergeRunLayer(
  base: ResolvedRunProperties,
  layer: ResolvedRunProperties,
): ResolvedRunProperties {
  return {
    bold: layer.bold ?? base.bold,
    italic: layer.italic ?? base.italic,
    underline: layer.underline ?? base.underline,
    strike: layer.strike ?? base.strike,
    fontFamily: layer.fontFamily ?? base.fontFamily,
    sizePt: layer.sizePt ?? base.sizePt,
    color: layer.color ?? base.color,
  };
}

// A WordprocessingML toggle property (w:b, w:i, w:strike, ...) is ON by simply being present, with an optional w:val attribute that turns it back OFF ("0"/"false"/"off"). Absence of the element itself means "not specified at this layer", not "off" -- that distinction is exactly what lets a lower cascade layer's off-by-inheritance be overridden by a higher layer's on, or vice versa.
function readToggle(el: XmlElement | undefined): boolean | undefined {
  if (el === undefined) {
    return undefined;
  }
  const val = attr(el, "w:val");
  return val === undefined || (val !== "0" && val !== "false" && val !== "off");
}

// w:u/@w:val is one of many underline styles (single/double/thick/dotted/...); "none" is the only value that means off. Unlike the toggle properties above, w:u always carries @w:val -- there's no bare-presence-means-on form.
function readUnderline(u: XmlElement | undefined): boolean | undefined {
  if (u === undefined) {
    return undefined;
  }
  const val = attr(u, "w:val");
  return val !== undefined && val !== "none";
}

// w:color/@w:themeColor's own ST_ThemeColor enumeration, mapped to the a:clrScheme slot names DrawingTheme.colorScheme is keyed by (see shared/drawingml.ts's own CLR_SCHEME_SLOTS). background1/text1/background2/text2 are WordprocessingML's logical names for the identical dark1/light1/dark2/light2 pair -- unlike PresentationML, WordprocessingML has no p:clrMap indirection a docx theme reference resolves through, so this mapping is the fixed, direct pairing ECMA-376/real Word output always uses, not a live lookup.
const THEME_COLOR_SLOT: ReadonlyMap<string, string> = new Map([
  ["dark1", "dk1"],
  ["light1", "lt1"],
  ["dark2", "dk2"],
  ["light2", "lt2"],
  ["accent1", "accent1"],
  ["accent2", "accent2"],
  ["accent3", "accent3"],
  ["accent4", "accent4"],
  ["accent5", "accent5"],
  ["accent6", "accent6"],
  ["hyperlink", "hlink"],
  ["followedHyperlink", "folHlink"],
  ["background1", "lt1"],
  ["text1", "dk1"],
  ["background2", "lt2"],
  ["text2", "dk2"],
]);

// w:color/@w:val is a 6-hex-digit RGB string or the literal "auto" (the automatic/theme-inherited colour, almost always rendering as black-on-white in practice). "auto" defers to a lower-priority layer rather than asserting black outright, since a lower layer (or the final default) may already resolve to the right colour. w:color/@w:themeColor references a theme colour scheme slot instead of a literal value (see THEME_COLOR_SLOT); when present it takes precedence over w:val, per ECMA-376 -- w:val in that case is merely Word's own cached fallback for a consumer that can't resolve the theme, so it's only consulted here if the theme reference itself fails to resolve (an unknown themeColor value, or a theme missing that slot entirely). w:themeShade/w:themeTint (a further shade/tint refinement of the resolved theme colour) are deliberately not applied -- a real, tracked scope narrowing, not a silent approximation: WordprocessingML encodes these as a raw 00-FF byte fraction, a materially different convention from DrawingML's own thousandths-of-a-percent a:shade/a:tint (shared/color.ts's applyColorTransforms), so reusing that module's algorithm without first verifying WordprocessingML's own byte-domain formula against real Word-rendered output would risk silently miscolouring text; the base theme colour itself still resolves correctly, only this secondary refinement is skipped.
function readRunColor(
  colorEl: XmlElement | undefined,
  theme: DrawingTheme,
): Color | undefined {
  if (colorEl === undefined) {
    return undefined;
  }
  const themeColor = attr(colorEl, "w:themeColor");
  if (themeColor !== undefined) {
    const slot = THEME_COLOR_SLOT.get(themeColor);
    const resolved =
      slot === undefined ? undefined : theme.colorScheme.get(slot);
    if (resolved !== undefined) {
      return resolved;
    }
  }
  const val = attr(colorEl, "w:val");
  return val === undefined || val === "auto" ? undefined : rgbHexToColor(val);
}

// w:ascii (a literal font name) takes precedence over w:asciiTheme (a theme font reference) when both are present, per ECMA-376's own precedence rule. Only the Latin (ascii/asciiTheme) slot is read -- East Asian/complex-script fonts are out of scope.
function readRunFontFamily(
  rFonts: XmlElement | undefined,
  theme: DrawingTheme,
): string | undefined {
  if (rFonts === undefined) {
    return undefined;
  }
  const ascii = attr(rFonts, "w:ascii");
  if (ascii !== undefined) {
    return ascii;
  }
  const asciiTheme = attr(rFonts, "w:asciiTheme");
  if (asciiTheme === "majorHAnsi" || asciiTheme === "majorAscii") {
    return theme.majorFont;
  }
  if (asciiTheme === "minorHAnsi" || asciiTheme === "minorAscii") {
    return theme.minorFont;
  }
  return undefined;
}

function readRunPropertiesLayer(
  rPr: XmlElement | undefined,
  theme: DrawingTheme,
): ResolvedRunProperties {
  if (rPr === undefined) {
    return {};
  }
  const sz = childrenWithTag(rPr, "w:sz")[0];
  const szVal = sz === undefined ? undefined : attr(sz, "w:val");
  return {
    bold: readToggle(childrenWithTag(rPr, "w:b")[0]),
    italic: readToggle(childrenWithTag(rPr, "w:i")[0]),
    underline: readUnderline(childrenWithTag(rPr, "w:u")[0]),
    strike: readToggle(childrenWithTag(rPr, "w:strike")[0]),
    fontFamily: readRunFontFamily(childrenWithTag(rPr, "w:rFonts")[0], theme),
    sizePt: szVal === undefined ? undefined : halfPointsToPt(Number(szVal)),
    color: readRunColor(childrenWithTag(rPr, "w:color")[0], theme),
  };
}

function readAlignment(jc: XmlElement | undefined): Alignment | undefined {
  const val = jc === undefined ? undefined : attr(jc, "w:val");
  if (val === "left" || val === "start") {
    return "left";
  }
  if (val === "center") {
    return "center";
  }
  if (val === "right" || val === "end") {
    return "right";
  }
  if (val === "both" || val === "distribute") {
    return "justify";
  }
  return undefined;
}

// w:ind's firstLine (positive: indented further than the body) and hanging (positive value meaning "pull back by this much", i.e. a negative first-line indent) are mutually exclusive per ECMA-376; hanging is stored as the signed inverse to match ContentParagraph.indentFirstLinePt's own convention (negative for a hanging/bullet indent).
function readParagraphPropertiesLayer(
  pPr: XmlElement | undefined,
): ResolvedParagraphProperties {
  if (pPr === undefined) {
    return {};
  }
  const spacing = childrenWithTag(pPr, "w:spacing")[0];
  const before = spacing === undefined ? undefined : attr(spacing, "w:before");
  const after = spacing === undefined ? undefined : attr(spacing, "w:after");
  const line = spacing === undefined ? undefined : attr(spacing, "w:line");
  const lineRule =
    spacing === undefined ? undefined : attr(spacing, "w:lineRule");
  const ind = childrenWithTag(pPr, "w:ind")[0];
  const left =
    ind === undefined
      ? undefined
      : (attr(ind, "w:left") ?? attr(ind, "w:start"));
  const firstLine = ind === undefined ? undefined : attr(ind, "w:firstLine");
  const hanging = ind === undefined ? undefined : attr(ind, "w:hanging");
  const outlineLvl = childrenWithTag(pPr, "w:outlineLvl")[0];
  const outlineLvlVal =
    outlineLvl === undefined ? undefined : attr(outlineLvl, "w:val");
  return {
    alignment: readAlignment(childrenWithTag(pPr, "w:jc")[0]),
    spacingBeforePt:
      before === undefined ? undefined : twipsToPt(Number(before)),
    spacingAfterPt: after === undefined ? undefined : twipsToPt(Number(after)),
    // Only lineRule="auto" (the default when lineRule is absent) expresses w:line as a multiplier of single spacing; "exact"/"atLeast" express it as an absolute twips height, a different unit this field doesn't model.
    lineSpacing:
      line === undefined || lineRule === "exact" || lineRule === "atLeast"
        ? undefined
        : lineUnitsToMultiplier(Number(line)),
    indentLeftPt: left === undefined ? undefined : twipsToPt(Number(left)),
    indentFirstLinePt:
      firstLine !== undefined
        ? twipsToPt(Number(firstLine))
        : hanging !== undefined
          ? -twipsToPt(Number(hanging))
          : undefined,
    outlineLvl: outlineLvlVal === undefined ? undefined : Number(outlineLvlVal),
  };
}

type StyleType = "paragraph" | "character";

function findStyle(
  stylesRoot: XmlElement,
  styleId: string,
  type: StyleType,
): XmlElement | undefined {
  return elementsWithTag([stylesRoot], "w:style").find(
    (s) => attr(s, "w:type") === type && attr(s, "w:styleId") === styleId,
  );
}

function findDefaultStyle(
  stylesRoot: XmlElement,
  type: StyleType,
): XmlElement | undefined {
  return elementsWithTag([stylesRoot], "w:style").find(
    (s) => attr(s, "w:type") === type && attr(s, "w:default") === "1",
  );
}

// Root-first order (the ultimate ancestor first, styleId's own style last), so later merge layers correctly override earlier ones. Cycle-guarded against a malformed w:basedOn loop.
function resolveBasedOnChain(
  stylesRoot: XmlElement,
  styleId: string,
  type: StyleType,
): XmlElement[] {
  const chain: XmlElement[] = [];
  const visited = new Set<string>();
  let currentId: string | undefined = styleId;
  while (currentId !== undefined && !visited.has(currentId)) {
    visited.add(currentId);
    const style = findStyle(stylesRoot, currentId, type);
    if (style === undefined) {
      break;
    }
    chain.unshift(style);
    const basedOn = childrenWithTag(style, "w:basedOn")[0];
    currentId = basedOn === undefined ? undefined : attr(basedOn, "w:val");
  }
  return chain;
}

function docDefaultsElement(
  stylesRoot: XmlElement | undefined,
  wrapperTag: "w:pPrDefault" | "w:rPrDefault",
  innerTag: "w:pPr" | "w:rPr",
): XmlElement | undefined {
  const docDefaults =
    stylesRoot === undefined
      ? undefined
      : childrenWithTag(stylesRoot, "w:docDefaults")[0];
  const wrapper =
    docDefaults === undefined
      ? undefined
      : childrenWithTag(docDefaults, wrapperTag)[0];
  return wrapper === undefined
    ? undefined
    : childrenWithTag(wrapper, innerTag)[0];
}

// Cascade: docDefaults -> default paragraph style -> the paragraph's own named style chain (root-first) -> the paragraph's own direct w:pPr. Numbering-level properties are deliberately not merged in here -- list indentation/marker layout is a layout-engine concern once a paragraph's list membership (numId/level) is known, not a style-resolution one.
export function resolveParagraphProperties(
  paragraph: XmlElement,
  context: DocxStyleContext,
): ResolvedParagraphProperties {
  const pPr = childrenWithTag(paragraph, "w:pPr")[0];
  const pStyleEl =
    pPr === undefined ? undefined : childrenWithTag(pPr, "w:pStyle")[0];
  const styleId = pStyleEl === undefined ? undefined : attr(pStyleEl, "w:val");

  let resolved = readParagraphPropertiesLayer(
    docDefaultsElement(context.stylesRoot, "w:pPrDefault", "w:pPr"),
  );

  if (context.stylesRoot !== undefined) {
    const defaultStyle = findDefaultStyle(context.stylesRoot, "paragraph");
    if (defaultStyle !== undefined) {
      resolved = mergeParagraphLayer(
        resolved,
        readParagraphPropertiesLayer(childrenWithTag(defaultStyle, "w:pPr")[0]),
      );
    }
    if (styleId !== undefined) {
      for (const style of resolveBasedOnChain(
        context.stylesRoot,
        styleId,
        "paragraph",
      )) {
        resolved = mergeParagraphLayer(
          resolved,
          readParagraphPropertiesLayer(childrenWithTag(style, "w:pPr")[0]),
        );
      }
    }
  }

  return mergeParagraphLayer(resolved, readParagraphPropertiesLayer(pPr));
}

// Cascade: docDefaults -> default paragraph style's own rPr -> the paragraph's named style chain's rPr -> the paragraph-mark run properties (w:pPr/w:rPr, the run-level baseline every run in the paragraph inherits before anything run-specific) -> the run's own character style chain (w:rStyle, resolved through its own w:basedOn chain) -> the run's own direct w:rPr.
export function resolveRunProperties(
  run: XmlElement,
  paragraph: XmlElement,
  context: DocxStyleContext,
): ResolvedRunProperties {
  const pPr = childrenWithTag(paragraph, "w:pPr")[0];
  const pStyleEl =
    pPr === undefined ? undefined : childrenWithTag(pPr, "w:pStyle")[0];
  const pStyleId = pStyleEl === undefined ? undefined : attr(pStyleEl, "w:val");

  let resolved = readRunPropertiesLayer(
    docDefaultsElement(context.stylesRoot, "w:rPrDefault", "w:rPr"),
    context.theme,
  );

  if (context.stylesRoot !== undefined) {
    const defaultStyle = findDefaultStyle(context.stylesRoot, "paragraph");
    if (defaultStyle !== undefined) {
      resolved = mergeRunLayer(
        resolved,
        readRunPropertiesLayer(
          childrenWithTag(defaultStyle, "w:rPr")[0],
          context.theme,
        ),
      );
    }
    if (pStyleId !== undefined) {
      for (const style of resolveBasedOnChain(
        context.stylesRoot,
        pStyleId,
        "paragraph",
      )) {
        resolved = mergeRunLayer(
          resolved,
          readRunPropertiesLayer(
            childrenWithTag(style, "w:rPr")[0],
            context.theme,
          ),
        );
      }
    }
  }

  const paragraphMarkRPr =
    pPr === undefined ? undefined : childrenWithTag(pPr, "w:rPr")[0];
  resolved = mergeRunLayer(
    resolved,
    readRunPropertiesLayer(paragraphMarkRPr, context.theme),
  );

  const rPr = childrenWithTag(run, "w:rPr")[0];
  const rStyleEl =
    rPr === undefined ? undefined : childrenWithTag(rPr, "w:rStyle")[0];
  const rStyleId = rStyleEl === undefined ? undefined : attr(rStyleEl, "w:val");
  if (context.stylesRoot !== undefined && rStyleId !== undefined) {
    for (const style of resolveBasedOnChain(
      context.stylesRoot,
      rStyleId,
      "character",
    )) {
      resolved = mergeRunLayer(
        resolved,
        readRunPropertiesLayer(
          childrenWithTag(style, "w:rPr")[0],
          context.theme,
        ),
      );
    }
  }

  return mergeRunLayer(resolved, readRunPropertiesLayer(rPr, context.theme));
}
