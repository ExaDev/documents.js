import type {
  Alignment,
  Color,
  ContentParagraph,
  ContentRun,
} from "document-schema.js";
import { resolveSchemeColor } from "./document/color-scheme";
import {
  type MasterStyleTable,
  resolveCharacterProperties,
  resolveParagraphProperties,
} from "./document/master";
import { splitParagraphs } from "./text/atoms";
import {
  ALIGN_CENTER,
  ALIGN_JUSTIFY,
  ALIGN_LEFT,
  ALIGN_RIGHT,
  type CharacterProperties,
  type ParagraphProperties,
  type RgbColor,
  type RunColor,
  type StyleRun,
  type StyleTextProps,
} from "./text/style";
import { masterUnitsToPoints } from "./units";

// The mapping from [MS-PPT]'s own text model onto document-schema.js's shared content vocabulary. The two disagree structurally: PowerPoint stores a shape's text as one flat character array with formatting expressed as character-counted runs over it, while the schema stores paragraphs each holding their own runs. Turning one into the other is an intersection of two independent partitions of the same character range -- paragraphs by separator, formatting by run count -- which is why it lives here rather than inside either reader.

const BYTE_MAX = 255;

// TextAlignmentEnum has seven members and the shared schema's Alignment has four. The three with no counterpart (distributed, Thai distributed, justify-low) map to nothing rather than to an approximation: an absent alignment means "the format did not say", which is true, whereas rounding Thai distribution to "justify" would state something the file does not.
function mapAlignment(alignment: number | undefined): Alignment | undefined {
  switch (alignment) {
    case ALIGN_LEFT:
      return "left";
    case ALIGN_CENTER:
      return "center";
    case ALIGN_RIGHT:
      return "right";
    case ALIGN_JUSTIFY:
      return "justify";
    default:
      return undefined;
  }
}

/** ParaSpacing's own percentage form (0-13200, value/100 = percent of line height) is the only one document-schema.js's lineSpacing (a plain multiple of single line height) can express -- the negative, absolute-master-units form has no multiplier to convert to without knowing the paragraph's actual rendered line height, so it maps to nothing rather than a guess. */
function paraSpacingToLineSpacing(raw: number | undefined): number | undefined {
  if (raw === undefined || raw < 0) {
    return undefined;
  }
  return raw / 100;
}

/** ParaSpacing's own negative (absolute master-units) form is the only one document-schema.js's spacingBeforePt/spacingAfterPt (plain points) can express -- the positive percentage-of-line-height form has no point value to convert to without knowing the actual rendered line height, so it maps to nothing rather than a guess. */
function paraSpacingToPoints(raw: number | undefined): number | undefined {
  if (raw === undefined || raw >= 0) {
    return undefined;
  }
  return masterUnitsToPoints(-raw);
}

/** MarginOrIndent is always an absolute signed master-unit offset, with no percentage form to disambiguate -- unlike ParaSpacing, every value converts cleanly. */
function marginOrIndentToPoints(raw: number | undefined): number | undefined {
  return raw === undefined ? undefined : masterUnitsToPoints(raw);
}

function mapColor(color: RgbColor | undefined): Color | undefined {
  if (color === undefined) {
    return undefined;
  }
  return {
    r: color.red / BYTE_MAX,
    g: color.green / BYTE_MAX,
    b: color.blue / BYTE_MAX,
  };
}

// The scheme-colour resolution [MS-PPT] describes as a wholly separate step from master text-formatting inheritance (see document/master.ts's own top comment): a run's own colour reference, once the cascade has picked one, is either already a literal RGB triple or a scheme-slot index that still needs looking up against colorScheme -- the slide's own SlideSchemeColorSchemeAtom, or its master's when the slide states none (see read.ts's own colour-scheme resolution).
function resolveRunColor(
  color: RunColor | undefined,
  colorScheme: readonly RgbColor[],
): RgbColor | undefined {
  if (color === undefined) {
    return undefined;
  }
  return color.kind === "rgb"
    ? color.rgb
    : resolveSchemeColor(color.schemeIndex, colorScheme);
}

// One character-counted run's extent within the text body, paired with its properties. A run array states only lengths, so the absolute range each run covers has to be accumulated before any of them can be intersected with a paragraph.
interface RunExtent<T> {
  readonly start: number;
  readonly end: number;
  readonly properties: T;
}

function toExtents<T>(runs: readonly StyleRun<T>[]): RunExtent<T>[] {
  const extents: RunExtent<T>[] = [];
  let at = 0;
  for (const run of runs) {
    extents.push({
      start: at,
      end: at + run.count,
      properties: run.properties,
    });
    at += run.count;
  }
  return extents;
}

function runFrom(
  text: string,
  properties: CharacterProperties,
  fontNames: readonly string[],
  colorScheme: readonly RgbColor[],
): ContentRun {
  return {
    text,
    bold: properties.bold,
    italic: properties.italic,
    underline: properties.underline,
    // A FontIndexRef naming no entry in the collection leaves the family absent rather than substituting one: the run's typeface is then genuinely unknown, and inventing a name would be a worse answer than none.
    fontFamily:
      properties.fontRef === undefined
        ? undefined
        : fontNames[properties.fontRef],
    sizePt: properties.sizePt,
    color: mapColor(resolveRunColor(properties.color, colorScheme)),
  };
}

// A shape's whole text body plus its formatting, as the schema's paragraphs. `fontNames` is the document's font collection, which is what a run's FontIndexRef indexes. `masterStyles`/`textType` resolve a run's own unstated formatting against [MS-PPT] 2.9.35's master-style cascade (document/master.ts), and `colorScheme` resolves a scheme-slot colour reference to an actual RGB value (document/color-scheme.ts) -- both genuinely per-shape, since a placeholder's own TextHeaderAtom states which TextTypeEnum member it is and a slide's own colour scheme can differ from its master's.
export function buildParagraphs(
  text: string,
  style: StyleTextProps,
  fontNames: readonly string[],
  masterStyles: MasterStyleTable,
  textType: number,
  colorScheme: readonly RgbColor[],
): ContentParagraph[] {
  const paragraphExtents = toExtents<ParagraphProperties>(style.paragraphRuns);
  const characterExtents = toExtents<CharacterProperties>(style.characterRuns);

  return splitParagraphs(text).map((paragraph) => {
    const end = paragraph.start + paragraph.text.length;
    const rawParagraphProperties = paragraphExtents.find(
      (extent) =>
        paragraph.start >= extent.start && paragraph.start < extent.end,
    )?.properties;
    // The run's own stated (or, absent one, default-zero) outline depth -- never itself resolved from the master, since it is what selects which of the master's own levels apply in the first place.
    const indentLevel = rawParagraphProperties?.indentLevel ?? 0;
    const paragraphProperties = resolveParagraphProperties(
      rawParagraphProperties,
      masterStyles,
      textType,
      indentLevel,
    );

    const runs: ContentRun[] = [];
    for (const extent of characterExtents) {
      const from = Math.max(extent.start, paragraph.start);
      const to = Math.min(extent.end, end);
      if (from >= to) {
        continue;
      }
      const resolvedCharacterProperties = resolveCharacterProperties(
        extent.properties,
        masterStyles,
        textType,
        indentLevel,
      );
      runs.push(
        runFrom(
          paragraph.text.slice(from - paragraph.start, to - paragraph.start),
          resolvedCharacterProperties,
          fontNames,
          colorScheme,
        ),
      );
    }
    // A text body whose style atom is absent, shorter than the text, or missing entirely still has to yield its text: the formatting is what is missing, not the characters -- and even then, the master cascade can still supply it. An empty paragraph yields no run at all, since a run carrying no text is not a thing the schema needs to represent.
    if (runs.length === 0 && paragraph.text.length > 0) {
      const resolvedCharacterProperties = resolveCharacterProperties(
        undefined,
        masterStyles,
        textType,
        indentLevel,
      );
      runs.push(
        runFrom(
          paragraph.text,
          resolvedCharacterProperties,
          fontNames,
          colorScheme,
        ),
      );
    }

    const alignment = mapAlignment(paragraphProperties.alignment);
    return {
      kind: "paragraph" as const,
      runs,
      alignment,
      // [MS-PPT] states an indent level on every paragraph run, including level 0, which is the ordinary un-indented body text rather than a list. Only a level above zero is reported as list membership, matching how ooxml.js reads a drawing paragraph's a:pPr/@lvl.
      list: indentLevel > 0 ? { level: indentLevel } : undefined,
      spacingBeforePt: paraSpacingToPoints(paragraphProperties.spaceBefore),
      spacingAfterPt: paraSpacingToPoints(paragraphProperties.spaceAfter),
      lineSpacing: paraSpacingToLineSpacing(paragraphProperties.lineSpacing),
      indentLeftPt: marginOrIndentToPoints(paragraphProperties.leftMargin),
      indentFirstLinePt: marginOrIndentToPoints(paragraphProperties.indent),
    };
  });
}
