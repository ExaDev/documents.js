import type {
  Alignment,
  Color,
  ContentBlock,
  ContentParagraph,
  ContentRun,
} from "document-schema.js";
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
import { LINE_BREAK, PARAGRAPH_SEPARATOR } from "./text/atoms";

// The write-side mirror of content.ts: given a shape's ContentBlock list, produces the flat character-counted text body and the StyleTextProps runs [MS-PPT]'s StyleTextPropAtom carries alongside it -- the inverse of content.ts's buildParagraphs, which turns that same pairing back into ContentParagraph[]. Only 'paragraph' blocks contribute text; every other ContentBlock kind (image, table, embeddedObject, pageBreak, the two construct markers) is silently excluded from the written text body, the same documented-gap convention the reader's own README already uses for constructs it does not surface -- ppt-codec's writer covers text-box slides, not the full ContentBlock vocabulary.

const BYTE_MAX = 255;

function mapAlignmentToPpt(
  alignment: Alignment | undefined,
): number | undefined {
  switch (alignment) {
    case "left":
      return ALIGN_LEFT;
    case "center":
      return ALIGN_CENTER;
    case "right":
      return ALIGN_RIGHT;
    case "justify":
      return ALIGN_JUSTIFY;
    default:
      return undefined;
  }
}

function mapColorToPpt(color: Color | undefined): RgbColor | undefined {
  if (color === undefined) {
    return undefined;
  }
  return {
    red: Math.round(color.r * BYTE_MAX),
    green: Math.round(color.g * BYTE_MAX),
    blue: Math.round(color.b * BYTE_MAX),
  };
}

// A run's own text, with the schema's soft-line-break spelling ('\n') converted back to the stored codepoint (text/atoms.ts's LINE_BREAK, U+000B) -- the exact inverse of splitParagraphs' `.split(LINE_BREAK).join("\n")`.
function storedRunText(text: string): string {
  return text.split("\n").join(LINE_BREAK);
}

function characterPropertiesFrom(
  run: ContentRun,
  fontIndexOf: (family: string) => number,
): CharacterProperties {
  return {
    bold: run.bold,
    italic: run.italic,
    underline: run.underline,
    shadow: undefined,
    emboss: undefined,
    fontRef:
      run.fontFamily === undefined ? undefined : fontIndexOf(run.fontFamily),
    sizePt: run.sizePt,
    color: mapColorToPpt(run.color),
  };
}

const EMPTY_CHARACTER_PROPERTIES: CharacterProperties = {
  bold: undefined,
  italic: undefined,
  underline: undefined,
  shadow: undefined,
  emboss: undefined,
  fontRef: undefined,
  sizePt: undefined,
  color: undefined,
};

export interface TextBody {
  readonly text: string;
  readonly style: StyleTextProps;
}

// Builds one shape's whole text body and its StyleTextPropAtom runs from its ContentBlock list. Each paragraph's own PFRun/CFRun coverage is (paragraph text length) + 1: the extra character accounts for the paragraph's own trailing '\r' separator (every paragraph but the last) or the implicit final terminator characterCountOf's own comment describes ([MS-PPT]'s worked example: "a text body length of 22 because of the terminating line break character") -- attached to the last character run of each paragraph (or a zero-content synthetic run, for a paragraph with none), so the sum of every paragraph's contribution is exactly characterCountOf(text) with no separate accounting pass needed.
export function buildTextBody(
  blocks: readonly ContentBlock[],
  fontIndexOf: (family: string) => number,
): TextBody {
  const paragraphs = blocks.filter(
    (block): block is ContentParagraph => block.kind === "paragraph",
  );
  const bodies = paragraphs.map((paragraph) =>
    paragraph.runs.map((run) => storedRunText(run.text)).join(""),
  );
  const text = bodies.join(PARAGRAPH_SEPARATOR);

  const paragraphRuns: StyleRun<ParagraphProperties>[] = [];
  const characterRuns: StyleRun<CharacterProperties>[] = [];

  paragraphs.forEach((paragraph, index) => {
    const bodyText = bodies[index] ?? "";
    paragraphRuns.push({
      count: bodyText.length + 1,
      properties: {
        indentLevel: paragraph.list?.level ?? 0,
        alignment: mapAlignmentToPpt(paragraph.alignment),
      },
    });

    if (paragraph.runs.length === 0) {
      characterRuns.push({ count: 1, properties: EMPTY_CHARACTER_PROPERTIES });
      return;
    }
    paragraph.runs.forEach((run, runIndex) => {
      const isLastRunOfParagraph = runIndex === paragraph.runs.length - 1;
      characterRuns.push({
        count: storedRunText(run.text).length + (isLastRunOfParagraph ? 1 : 0),
        properties: characterPropertiesFrom(run, fontIndexOf),
      });
    });
  });

  return { text, style: { paragraphRuns, characterRuns } };
}

// Every distinct fontFamily a block's runs name, in first-seen order -- the order buildTextBody's fontIndexOf callback (built once per document, over every slide's every shape) must resolve against, matching the order the document's own FontCollectionContainer is written in.
export function collectFontFamilies(
  blocksList: readonly (readonly ContentBlock[])[],
): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const blocks of blocksList) {
    for (const block of blocks) {
      if (block.kind !== "paragraph") {
        continue;
      }
      for (const run of block.runs) {
        if (run.fontFamily !== undefined && !seen.has(run.fontFamily)) {
          seen.add(run.fontFamily);
          names.push(run.fontFamily);
        }
      }
    }
  }
  return names;
}
