import type { ContentParagraph, ContentRun } from "document-schema.js";
import { DocFormatError } from "../errors";
import { type PropertyBinTable } from "../prop/fkp";
import {
  applyCharacterSprms,
  characterIstdFromGrpprl,
  type CharacterProperties,
} from "../prop/chp";
import { applyParagraphSprms, type ParagraphProperties } from "../prop/pap";
import { readGrpprl, type Prl } from "../prop/sprm";
import {
  headingLevelFromIstd,
  resolveStyleFormatting,
  type StyleSheet,
} from "../style/stsh";
import {
  FIELD_BEGIN,
  FIELD_END,
  FIELD_SEPARATOR,
  LINE_BREAK,
  PARAGRAPH_MARK,
  endsParagraph,
  isAnchorOnly,
} from "./special";

// The paragraph-level read shared by every document-stream range this package reads (the main document, and -- notes.ts/headers-footers.ts -- the footnote, endnote, comment, and header/footer subdocuments): splitting a logical text stream into paragraphs at the marks [MS-DOC] 2.4.2 names as paragraph ends, and each paragraph into runs at the boundaries of the character-formatting exceptions covering it. Every one of those ranges lives in the same WordDocument stream and is addressed through the same ChpxFkp/PapxFkp bin tables and style sheet, so this module carries no notion of which range it is reading -- that is entirely the caller's concern (which text/fcs it hands in), which is what lets read.ts's own DocContent.sections read and notes.ts's plain-text footnote/endnote/comment bodies share one implementation rather than two that could drift apart.

export interface ReadContext {
  readonly chpxTable: PropertyBinTable;
  readonly papxTable: PropertyBinTable;
  readonly styles: StyleSheet | undefined;
  /** The font names sprmCRgFtc0's operand indexes into, or undefined when the document carries no SttbfFfn at all. */
  readonly fonts: readonly string[] | undefined;
  // Character properties already folded out of one Chpx, keyed by that Chpx's own position and length in the WordDocument stream. It belongs to the whole read rather than to one paragraph because a Chpx routinely spans many paragraphs -- a document in one font is one exception covering all of it -- so a per-paragraph cache would re-parse the same grpprl once per paragraph and never hit. Shared across every document-stream range a caller reads through this context, since the same byte offset in the WordDocument stream means the same Chpx regardless of which subdocument's own CP space is being walked.
  readonly characterProperties: Map<string, CharacterProperties>;
}

/** One paragraph/cell/row-ending mark, still flat -- table/read.ts's assembleBlocks is what folds a run of these into a real ContentTable. `properties` and `grpprl` are carried alongside the already-built `paragraph` because table grouping needs sprmPFInTable/sprmPFTtp/sprmPItap (properties) and, on a row's own mark, its table-defining sgc-5 sprms (grpprl) -- neither of which survives onto a plain ContentParagraph. */
export interface ParagraphEntry {
  readonly paragraph: ContentParagraph;
  readonly properties: ParagraphProperties;
  readonly grpprl: readonly Prl[];
  /** The character that terminated this paragraph in the text stream: PARAGRAPH_MARK, CELL_MARK, or SECTION_MARK. */
  readonly terminator: number;
  /** The character position immediately after this paragraph's own terminator (or, for the trailing no-mark case, the text's own length) -- comparable directly to a boundary plex's own CPs (PlcfSed.aCp, PlcffndTxt.aCp, Plcfhdd's aCp, ...) as long as `text` was itself read starting from that plex's own CP 0. read.ts's splitIntoSections and notes.ts/headers-footers.ts's own splitting use it to locate a story's real boundary. */
  readonly endCp: number;
}

// Splits the logical text stream into paragraphs at the marks [MS-DOC] 2.4.2 names as paragraph ends, and each paragraph into runs at the boundaries of the character-formatting exceptions covering it.
export function readParagraphs(
  text: string,
  fcs: readonly number[],
  context: ReadContext,
): ParagraphEntry[] {
  const entries: ParagraphEntry[] = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (!endsParagraph(code)) continue;
    // The mark's own byte offset is what the paragraph's PAPX is keyed on, and the mark itself is structure rather than text, so it ends the range without joining it.
    const markFc = fcs[index];
    if (markFc === undefined) {
      throw new DocFormatError(
        `character ${index} has no byte offset, so its paragraph's properties cannot be located`,
      );
    }
    entries.push(
      buildParagraph(
        text.slice(start, index),
        fcs.slice(start, index),
        markFc,
        code,
        index + 1,
        context,
      ),
    );
    start = index + 1;
  }
  // A document whose last character is not a paragraph mark is malformed by [MS-DOC]'s own account, but its trailing text is real and the honest thing is to keep it rather than drop content on a technicality. Its properties are located from its first character instead of a mark it does not have; PARAGRAPH_MARK stands in for the terminator this trailing text does not have.
  if (start < text.length) {
    const firstFc = fcs[start];
    if (firstFc === undefined) {
      throw new DocFormatError(
        `character ${start} has no byte offset, so the trailing paragraph's properties cannot be located`,
      );
    }
    entries.push(
      buildParagraph(
        text.slice(start),
        fcs.slice(start),
        firstFc,
        PARAGRAPH_MARK,
        text.length,
        context,
      ),
    );
  }
  return entries;
}

function buildParagraph(
  text: string,
  fcs: readonly number[],
  propertyFc: number,
  terminator: number,
  endCp: number,
  context: ReadContext,
): ParagraphEntry {
  const papx = context.papxTable.papx(propertyFc);
  const properties: ParagraphProperties = {};
  const grpprl = papx !== undefined ? readGrpprl(papx.grpprl) : [];
  if (papx !== undefined) {
    // The istd comes from the GrpPrlAndIstd's own field, and a sprmPIstd inside the grpprl can then replace it -- so it is seeded first and the fold is allowed to overwrite it.
    properties.istd = papx.istd;
    // The paragraph style's own formatting is resolved and folded in BEFORE the direct PAPX exception, [MS-DOC] 2.4.6.6 Part 2's own order -- style first, then the paragraph's own grpprl on top, so the direct exception can override whatever the style (and its own base-style chain) supplied. Resolved from papx.istd specifically, not properties.istd, since a rare embedded sprmPIstd inside grpprl replaces what gets reported going forward without retroactively changing which style's formatting was already applied beneath it (see #1005's own README scope note).
    if (context.styles !== undefined) {
      applyParagraphSprms(
        resolveStyleFormatting(context.styles, papx.istd).paragraphPrls,
        properties,
      );
    }
    applyParagraphSprms(grpprl, properties);
  }

  const paragraph: ContentParagraph = {
    kind: "paragraph",
    runs: buildRuns(text, fcs, context, papx?.istd),
  };
  return {
    paragraph: { ...paragraph, ...paragraphAttributes(properties, context) },
    properties,
    grpprl,
    terminator,
    endCp,
  };
}

function paragraphAttributes(
  properties: ParagraphProperties,
  context: ReadContext,
): Partial<ContentParagraph> {
  const attributes: Partial<ContentParagraph> = {};
  const istd = properties.istd;
  if (istd !== undefined) {
    const style = context.styles?.styles[istd];
    if (style !== undefined && style.name !== "") {
      attributes.styleId = style.name;
    }
    const headingLevel = headingLevelFromIstd(istd);
    if (headingLevel !== undefined) attributes.headingLevel = headingLevel;
  }
  // sprmPOutLvl states an outline level directly and is the more specific statement where both are present, so it wins over the istd-derived one. [MS-DOC] makes the reverse precedence explicit -- sprmPOutLvl "MUST be ignored if the paragraph has an istd that is greater than or equal to 0x1 and less than or equal to 0x9" -- so it only applies where the istd did not already supply a level.
  if (
    attributes.headingLevel === undefined &&
    properties.outlineLevel !== undefined
  ) {
    attributes.headingLevel = properties.outlineLevel + 1;
  }
  if (properties.alignment !== undefined)
    attributes.alignment = properties.alignment;
  if (properties.spacingBeforePt !== undefined) {
    attributes.spacingBeforePt = properties.spacingBeforePt;
  }
  if (properties.spacingAfterPt !== undefined) {
    attributes.spacingAfterPt = properties.spacingAfterPt;
  }
  if (properties.lineSpacing !== undefined) {
    attributes.lineSpacing = properties.lineSpacing;
  }
  if (properties.indentLeftPt !== undefined) {
    attributes.indentLeftPt = properties.indentLeftPt;
  }
  if (properties.indentRightPt !== undefined) {
    attributes.indentRightPt = properties.indentRightPt;
  }
  if (properties.indentFirstLinePt !== undefined) {
    attributes.indentFirstLinePt = properties.indentFirstLinePt;
  }
  if (properties.pageBreakBefore === true) attributes.pageBreakBefore = true;
  if (properties.listId !== undefined) {
    attributes.list = {
      numId: String(properties.listId),
      level: properties.listLevel ?? 0,
    };
  }
  return attributes;
}

// Groups the paragraph's characters into runs of identical direct character formatting. The grouping key is the identity of the Chpx covering each character -- its position and length within the WordDocument stream -- rather than the resolved properties, so two runs that happen to resolve to the same values but come from different exceptions stay distinct, exactly as the file states them. The paragraph's own istd joins the key too: the SAME raw Chpx bytes routinely cover runs in different paragraphs (a Chpx exception spans until the next one, paragraph boundaries notwithstanding), and since a paragraph's style now contributes character defaults, two paragraphs in different styles sharing one Chpx no longer resolve to the same properties.
function buildRuns(
  text: string,
  fcs: readonly number[],
  context: ReadContext,
  paragraphIstd: number | undefined,
): ContentRun[] {
  const runs: ContentRun[] = [];
  let currentKey: string | undefined;
  let currentText = "";
  let currentProperties: CharacterProperties = {};
  // The paragraph style's own character defaults (StkParaGRLPUPX.lpUpxChpx), resolved once per paragraph rather than per run -- every run in this paragraph starts from the identical base, [MS-DOC] 2.4.6.6 Part 2 step 4's own "obtain any character property modifications specified by GrpprlAndIstd.istd... apply [them] to the character properties" applied before step 5's direct formatting.
  const paragraphStyleCharacterPrls: readonly Prl[] =
    context.styles !== undefined && paragraphIstd !== undefined
      ? resolveStyleFormatting(context.styles, paragraphIstd).characterPrls
      : [];
  // Field state, per [MS-DOC] 2.8.25's field characters: everything between a begin (0x13) and a separator (0x14) is the field's instruction rather than its displayed result, and a field with no separator displays nothing at all.
  //
  // A stack rather than a depth counter, because fields nest and the enclosing field's own state has to survive the inner one. A nested field appears inside the OUTER field's instruction as often as inside its result, so on reaching the inner field's end, whether text resumes depends on which side of its own separator the outer field had reached -- a counter cannot express that, and would resume in instruction mode (dropping real text) whenever an inner field closed inside an outer field's result.
  const enclosingInstruction: boolean[] = [];
  let inInstruction = false;

  const flush = (): void => {
    if (currentText !== "") {
      runs.push({ text: currentText, ...currentProperties });
    }
    currentText = "";
  };

  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code === FIELD_BEGIN) {
      flush();
      enclosingInstruction.push(inInstruction);
      inInstruction = true;
      continue;
    }
    if (code === FIELD_SEPARATOR) {
      inInstruction = false;
      continue;
    }
    if (code === FIELD_END) {
      // An unmatched end -- one the text carries with no begin before it -- pops nothing and leaves the state alone rather than flipping it, so malformed field nesting cannot swallow the rest of the paragraph.
      inInstruction = enclosingInstruction.pop() ?? inInstruction;
      continue;
    }
    if (inInstruction || isAnchorOnly(code)) continue;

    const fc = fcs[index];
    if (fc === undefined) {
      throw new DocFormatError(
        `character ${index} of a paragraph has no byte offset, so its formatting cannot be located`,
      );
    }
    const grpprl = context.chpxTable.chpxGrpprl(fc);
    const chpxKey =
      grpprl === undefined
        ? "none"
        : `${grpprl.byteOffset}:${grpprl.byteLength}`;
    const key = `${paragraphIstd ?? "none"}:${chpxKey}`;
    if (key !== currentKey) {
      flush();
      currentKey = key;
      let properties = context.characterProperties.get(key);
      if (properties === undefined) {
        properties = {};
        applyCharacterSprms(
          paragraphStyleCharacterPrls,
          properties,
          context.fonts,
        );
        if (grpprl !== undefined) {
          const runPrls = readGrpprl(grpprl);
          // A run's own sprmCIstd names a character style, which is resolved and folded in AFTER the paragraph style's own defaults but BEFORE the run's direct exceptions -- the same "more specific wins" precedence the paragraph/direct-exception layering above already follows, applied one level deeper.
          const characterIstd = characterIstdFromGrpprl(runPrls);
          if (characterIstd !== undefined && context.styles !== undefined) {
            applyCharacterSprms(
              resolveStyleFormatting(context.styles, characterIstd)
                .characterPrls,
              properties,
              context.fonts,
            );
          }
          applyCharacterSprms(runPrls, properties, context.fonts);
        }
        context.characterProperties.set(key, properties);
      }
      currentProperties = properties;
    }
    // A line break inside a paragraph is a real break in the text rather than a paragraph boundary, so it survives as a newline instead of being dropped as a control character. Rebuilt from the code unit already in hand rather than indexed back out of the string, which the loop bound has established is present but the type of an indexed read cannot.
    currentText += String.fromCharCode(code === LINE_BREAK ? 0x0a : code);
  }
  flush();
  return runs;
}

// Splits a flat span of paragraph entries into `boundaries.length - 1` groups by a boundary plex's own CPs -- read.ts's own splitIntoSections generalised for reuse by notes.ts (PlcffndTxt/PlcfandTxt/PlcfendTxt) and headers-footers.ts (Plcfhdd), all of which divide a document-stream range into consecutive stories the identical way [MS-DOC] states PlcfSed does. Unlike splitIntoSections -- whose last section absorbs every remaining entry, since a section genuinely has no upper CP bound of its own -- this stops emitting once `boundaries` is exhausted: an entry past the final real boundary belongs to no story at all (the trailing "ignored" PLC slot [MS-DOC] states for PlcffndTxt/PlcfandTxt/PlcfendTxt, or a guard paragraph mark that is "not considered part of the story contents" per the Headers page), so it is dropped rather than folded into whichever story happens to be open.
//
// A zero-width group -- boundaries[i] === boundaries[i+1], [MS-DOC]'s own "the story is considered empty" -- is skipped past unconditionally rather than left for the next entry to close: no character position can ever fall inside a range with no width, so nothing would ever advance `index` past it on its own, and every real entry from that point on would be misassigned to the empty group instead of its own. advancePastEmptyGroups runs before the very first entry (an empty leading story) and again after every group closes (a run of several empty stories in a row), so any number of consecutive empty groups are skipped correctly.
export function splitEntriesByBoundaries(
  entries: readonly ParagraphEntry[],
  boundaries: readonly number[],
): ParagraphEntry[][] {
  const groupCount = Math.max(boundaries.length - 1, 0);
  const groups: ParagraphEntry[][] = Array.from(
    { length: groupCount },
    () => [],
  );
  let index = 0;
  const advancePastEmptyGroups = (): void => {
    while (index < groupCount && boundaries[index] === boundaries[index + 1]) {
      index += 1;
    }
  };
  advancePastEmptyGroups();
  for (const entry of entries) {
    const group = groups[index];
    if (group === undefined) break;
    group.push(entry);
    if (entry.endCp === boundaries[index + 1]) {
      index += 1;
      advancePastEmptyGroups();
    }
  }
  return groups;
}
