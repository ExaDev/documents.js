import type {
  Alignment,
  Color,
  ContentParagraph,
  ContentRun,
} from "document-schema.js";
import { splitParagraphs } from "./text/atoms";
import {
  ALIGN_CENTER,
  ALIGN_JUSTIFY,
  ALIGN_LEFT,
  ALIGN_RIGHT,
  type CharacterProperties,
  type ParagraphProperties,
  type RgbColor,
  type StyleRun,
  type StyleTextProps,
} from "./text/style";

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
    color: mapColor(properties.color),
  };
}

// A shape's whole text body plus its formatting, as the schema's paragraphs. `fontNames` is the document's font collection, which is what a run's FontIndexRef indexes.
export function buildParagraphs(
  text: string,
  style: StyleTextProps,
  fontNames: readonly string[],
): ContentParagraph[] {
  const paragraphExtents = toExtents<ParagraphProperties>(style.paragraphRuns);
  const characterExtents = toExtents<CharacterProperties>(style.characterRuns);

  return splitParagraphs(text).map((paragraph) => {
    const end = paragraph.start + paragraph.text.length;
    const paragraphProperties = paragraphExtents.find(
      (extent) =>
        paragraph.start >= extent.start && paragraph.start < extent.end,
    )?.properties;

    const runs: ContentRun[] = [];
    for (const extent of characterExtents) {
      const from = Math.max(extent.start, paragraph.start);
      const to = Math.min(extent.end, end);
      if (from >= to) {
        continue;
      }
      runs.push(
        runFrom(
          paragraph.text.slice(from - paragraph.start, to - paragraph.start),
          extent.properties,
          fontNames,
        ),
      );
    }
    // A text body whose style atom is absent, shorter than the text, or missing entirely still has to yield its text: the formatting is what is missing, not the characters. An empty paragraph yields no run at all, since a run carrying no text is not a thing the schema needs to represent.
    if (runs.length === 0 && paragraph.text.length > 0) {
      runs.push({ text: paragraph.text });
    }

    const alignment = mapAlignment(paragraphProperties?.alignment);
    const indentLevel = paragraphProperties?.indentLevel ?? 0;
    return {
      kind: "paragraph" as const,
      runs,
      alignment,
      // [MS-PPT] states an indent level on every paragraph run, including level 0, which is the ordinary un-indented body text rather than a list. Only a level above zero is reported as list membership, matching how ooxml.js reads a drawing paragraph's a:pPr/@lvl.
      list: indentLevel > 0 ? { level: indentLevel } : undefined,
    };
  });
}
