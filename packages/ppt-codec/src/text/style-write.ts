import { concatBytes, i16le, u16le, u32le, writeAtom } from "../record/write";
import { RT_StyleTextPropAtom } from "../record/types";
import {
  CF_BOLD,
  CF_COLOR,
  CF_ITALIC,
  CF_SIZE,
  CF_TYPEFACE,
  CF_UNDERLINE,
  COLOR_INDEX_SRGB,
  type CharacterProperties,
  PF_ALIGN,
  PF_INDENT,
  PF_LEFT_MARGIN,
  PF_LINE_SPACING,
  PF_SPACE_AFTER,
  PF_SPACE_BEFORE,
  type ParagraphProperties,
  type RgbColor,
  STYLE_BOLD,
  STYLE_ITALIC,
  STYLE_UNDERLINE,
  type StyleRun,
  type StyleTextProps,
} from "./style";

// The write-side mirror of text/style.ts's readStyleTextPropAtom: given the same StyleRun<ParagraphProperties>/StyleRun<CharacterProperties> arrays the reader produces, emits a real StyleTextPropAtom whose bytes that reader parses back to an equal value. Every field is written in the identical declared order style.ts's own comment states the reader uses (masks, then each optional field in spec order) -- the two functions are inverses of literally the same byte layout, not independently derived from the spec a second time.

function writeColorIndexStruct(color: RgbColor): Uint8Array<ArrayBuffer> {
  return new Uint8Array([color.red, color.green, color.blue, COLOR_INDEX_SRGB]);
}

// A TextPFException carrying textAlignment, lineSpacing/spaceBefore/spaceAfter, and leftMargin/indent -- every field this writer states, in the spec's own declared order (masks, then textAlignment, lineSpacing, spaceBefore, spaceAfter, leftMargin, indent). Every other PFMasks field (bullets, tab stops, wrapping, direction) is left unset, which round-trips as "the format did not say" through the reader's own undefined-on-unset-mask behaviour -- exactly the same absence a run whose writer never set the bit already produces for those fields today.
function writeTextPFException(
  properties: ParagraphProperties,
): Uint8Array<ArrayBuffer> {
  let masks = 0;
  const fields: Uint8Array<ArrayBuffer>[] = [];
  if (properties.alignment !== undefined) {
    masks |= PF_ALIGN;
    fields.push(u16le(properties.alignment));
  }
  if (properties.lineSpacing !== undefined) {
    masks |= PF_LINE_SPACING;
    fields.push(i16le(properties.lineSpacing));
  }
  if (properties.spaceBefore !== undefined) {
    masks |= PF_SPACE_BEFORE;
    fields.push(i16le(properties.spaceBefore));
  }
  if (properties.spaceAfter !== undefined) {
    masks |= PF_SPACE_AFTER;
    fields.push(i16le(properties.spaceAfter));
  }
  if (properties.leftMargin !== undefined) {
    masks |= PF_LEFT_MARGIN;
    fields.push(i16le(properties.leftMargin));
  }
  if (properties.indent !== undefined) {
    masks |= PF_INDENT;
    fields.push(i16le(properties.indent));
  }
  return concatBytes(u32le(masks), ...fields);
}

function writeTextCFException(
  properties: CharacterProperties,
): Uint8Array<ArrayBuffer> {
  let masks = 0;
  let fontStyle = 0;
  const hasFontStyle =
    properties.bold !== undefined ||
    properties.italic !== undefined ||
    properties.underline !== undefined;
  if (properties.bold !== undefined) {
    masks |= CF_BOLD;
    if (properties.bold) {
      fontStyle |= STYLE_BOLD;
    }
  }
  if (properties.italic !== undefined) {
    masks |= CF_ITALIC;
    if (properties.italic) {
      fontStyle |= STYLE_ITALIC;
    }
  }
  if (properties.underline !== undefined) {
    masks |= CF_UNDERLINE;
    if (properties.underline) {
      fontStyle |= STYLE_UNDERLINE;
    }
  }
  if (properties.fontRef !== undefined) {
    masks |= CF_TYPEFACE;
  }
  if (properties.sizePt !== undefined) {
    masks |= CF_SIZE;
  }
  if (properties.color !== undefined) {
    masks |= CF_COLOR;
  }

  // Field order matches readTextCFException exactly: masks, fontStyle, fontRef, [oldEA/ansi/symbol typeface -- never written], sizePt, color, [position -- never written].
  const fields: Uint8Array<ArrayBuffer>[] = [u32le(masks)];
  if (hasFontStyle) {
    fields.push(u16le(fontStyle));
  }
  if (properties.fontRef !== undefined) {
    fields.push(u16le(properties.fontRef));
  }
  if (properties.sizePt !== undefined) {
    fields.push(i16le(Math.round(properties.sizePt)));
  }
  if (properties.color !== undefined) {
    fields.push(writeColorIndexStruct(properties.color));
  }
  return concatBytes(...fields);
}

function writeParagraphRun(
  run: StyleRun<ParagraphProperties>,
): Uint8Array<ArrayBuffer> {
  return concatBytes(
    u32le(run.count),
    u16le(run.properties.indentLevel),
    writeTextPFException(run.properties),
  );
}

function writeCharacterRun(
  run: StyleRun<CharacterProperties>,
): Uint8Array<ArrayBuffer> {
  return concatBytes(u32le(run.count), writeTextCFException(run.properties));
}

// Emits a real StyleTextPropAtom: the paragraph run array followed by the character run array, each run's count field first and its exception payload after -- the identical layout readStyleTextPropAtom parses.
export function writeStyleTextPropAtom(
  style: StyleTextProps,
): Uint8Array<ArrayBuffer> {
  return writeAtom(
    RT_StyleTextPropAtom,
    concatBytes(
      ...style.paragraphRuns.map(writeParagraphRun),
      ...style.characterRuns.map(writeCharacterRun),
    ),
  );
}
