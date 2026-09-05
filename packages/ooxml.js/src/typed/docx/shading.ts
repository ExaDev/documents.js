import type {
  Color,
  ContentCellFill,
  ContentCellPatternType,
} from "document-schema.js";
import { colorToRgbHex, rgbHexToColor } from "document-schema.js";
import type { XmlElement } from "../../model/node";
import { el } from "../../xml/fragment";
import { attr, childrenWithTag } from "../util";

// A table cell's own w:shd (ECMA-376 Part 1 17.4.34) as document-schema.js's ContentCellFill (ExaDev/documents.js#951), read and written in one place -- the docx side of the identical shading model doc-codec's table/decoration.ts implements for the pre-2007 binary format, since [MS-DOC]'s own Ipat enumeration IS ST_Shd, extended with a handful of binary-only fine percentages that have no ECMA-376 equivalent (see that module's own top comment). w:val="clear" resolves to a 'solid' fill of the cell's own w:fill (the shading model's background colour, shown plain when no pattern is drawn over it); w:val="solid" resolves to a 'solid' fill of w:color instead (the pattern's own foreground, 100% coverage); every other named token resolves to a real 'pattern' fill via SHD_VAL_TO_PATTERN_TYPE, carrying whichever of w:color (the pattern's strokes) and w:fill (what shows through its gaps) states a concrete colour. w:val="nil" and an absent/unrecognised token resolve to no fill at all, the same fallback an "auto"/"none" colour on w:color or w:fill already gets (ECMA-376's own automatic-colour spelling, naming no concrete colour to draw with).

// Every ST_Shd token ECMA-376 Part 1 17.18.78 names beyond 'clear'/'solid'/'nil', mapped onto the ContentCellPatternType name document-schema.js's own ContentCellPatternTypeSchema gives that identical token (see that schema's own top comment for the full citation) -- the Word-family half of the shared vocabulary, 35 members, the identical set doc-codec's own IPAT_TO_PATTERN_TYPE resolves from [MS-DOC]'s binary Ipat enumeration.
const SHD_VAL_TO_PATTERN_TYPE: Readonly<
  Record<string, ContentCellPatternType>
> = {
  pct5: "percent5",
  pct10: "percent10",
  pct12: "percent12",
  pct15: "percent15",
  pct20: "percent20",
  pct25: "percent25",
  pct30: "percent30",
  pct35: "percent35",
  pct37: "percent37",
  pct40: "percent40",
  pct45: "percent45",
  pct50: "percent50",
  pct55: "percent55",
  pct60: "percent60",
  pct62: "percent62",
  pct65: "percent65",
  pct70: "percent70",
  pct75: "percent75",
  pct80: "percent80",
  pct85: "percent85",
  pct87: "percent87",
  pct90: "percent90",
  pct95: "percent95",
  horzStripe: "horizontalStripe",
  vertStripe: "verticalStripe",
  reverseDiagStripe: "reverseDiagonalStripe",
  diagStripe: "diagonalStripe",
  horzCross: "horizontalCross",
  diagCross: "diagonalCross",
  thinHorzStripe: "thinHorizontalStripe",
  thinVertStripe: "thinVerticalStripe",
  thinReverseDiagStripe: "thinReverseDiagonalStripe",
  thinDiagStripe: "thinDiagonalStripe",
  thinHorzCross: "thinHorizontalCross",
  thinDiagCross: "thinDiagonalCross",
};

/** The inverse of SHD_VAL_TO_PATTERN_TYPE, built from it rather than restated by hand so the two can never drift apart. Every ContentCellPatternType this writer is ever asked to state has an entry, since the Word-family half of the shared vocabulary is exactly SHD_VAL_TO_PATTERN_TYPE's own value set -- the SpreadsheetML-only members (mediumGray through gray0625) are absent, ST_Shd having no equivalent for them at all. */
const PATTERN_TYPE_TO_SHD_VAL: ReadonlyMap<ContentCellPatternType, string> =
  new Map(
    Object.entries(SHD_VAL_TO_PATTERN_TYPE).map(([val, patternType]) => [
      patternType,
      val,
    ]),
  );

/** w:shd/@w:color and @w:fill share the identical "auto"/"none" spelling for no concrete colour that w:color/@w:val already uses on a run -- both defer rather than asserting one. */
function shdColor(value: string | undefined): Color | undefined {
  return value === undefined || value === "auto" || value === "none"
    ? undefined
    : rgbHexToColor(value);
}

/** One <w:shd> element -> a ContentCellFill, or undefined where it states none. */
export function readCellShading(
  tcPr: XmlElement | undefined,
): ContentCellFill | undefined {
  const shd =
    tcPr === undefined ? undefined : childrenWithTag(tcPr, "w:shd")[0];
  if (shd === undefined) {
    return undefined;
  }
  const val = attr(shd, "w:val");
  const fill = shdColor(attr(shd, "w:fill"));
  const color = shdColor(attr(shd, "w:color"));
  if (val === undefined || val === "clear") {
    return fill === undefined ? undefined : { kind: "solid", color: fill };
  }
  if (val === "solid") {
    return color === undefined ? undefined : { kind: "solid", color };
  }
  const patternType = SHD_VAL_TO_PATTERN_TYPE[val];
  if (patternType === undefined) {
    // 'nil' (no shading at all) and any token this vocabulary does not recognise both resolve here.
    return undefined;
  }
  return {
    kind: "pattern",
    patternType,
    ...(color !== undefined ? { foregroundColor: color } : {}),
    ...(fill !== undefined ? { backgroundColor: fill } : {}),
  };
}

/** The inverse of readCellShading: a ContentCellFill's own single <w:shd> element. A 'solid' fill writes w:val="clear" with the colour stated as w:fill (the plain background a real producer's own solid cell fill is spelled with) and w:color left automatic. A 'pattern' fill writes its own token from PATTERN_TYPE_TO_SHD_VAL, with w:color/w:fill stated for whichever of foregroundColor/backgroundColor the fill actually carries and left automatic for the one it does not -- throwing for a SpreadsheetML-only pattern name ST_Shd has no member for, rather than writing the wrong pattern or silently dropping it. */
export function buildCellShading(fill: ContentCellFill): XmlElement {
  if (fill.kind === "solid") {
    return el("w:shd", {
      "w:val": "clear",
      "w:color": "auto",
      "w:fill": colorToRgbHex(fill.color),
    });
  }
  const val = PATTERN_TYPE_TO_SHD_VAL.get(fill.patternType);
  if (val === undefined) {
    throw new Error(
      `ooxml.js cannot write a '${fill.patternType}' cell fill: ECMA-376's own ST_Shd vocabulary has no member for it, that pattern name belonging only to SpreadsheetML's ST_PatternType half of ContentCellPatternType's shared vocabulary`,
    );
  }
  return el("w:shd", {
    "w:val": val,
    "w:color":
      fill.foregroundColor === undefined
        ? "auto"
        : colorToRgbHex(fill.foregroundColor),
    "w:fill":
      fill.backgroundColor === undefined
        ? "auto"
        : colorToRgbHex(fill.backgroundColor),
  });
}
