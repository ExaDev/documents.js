import { PptFormatError } from "../errors";
import { type PptRecord } from "../record/tree";
import { RT_SlideAtom } from "../record/types";
import {
  TEXT_TYPE_BODY,
  TEXT_TYPE_CENTER_BODY,
  TEXT_TYPE_CENTER_TITLE,
  TEXT_TYPE_HALF_BODY,
  TEXT_TYPE_QUARTER_BODY,
  TEXT_TYPE_TITLE,
} from "../text/atoms";
import {
  type CharacterProperties,
  type MasterStyleLevel,
  type MasterTextStyleAtom,
  type ParagraphProperties,
  type RgbColor,
} from "../text/style";

/** One master's own resolved facts: its text-style cascade table and its own colour scheme. Bundled together because both are keyed off the same masterIdRef a slide's SlideAtom names -- a caller resolving one always needs the other too. */
export interface MasterInfo {
  readonly styles: MasterStyleTable;
  readonly colorScheme: readonly RgbColor[];
}

// The master/scheme-colour inheritance cascade [MS-PPT] 2.9.35's own TextMasterStyleAtom and 2.5.2's own SlideAtom.masterIdRef together define: a run that states no size, typeface, alignment, or colour reference inherits it from the applicable master's own per-placeholder-type, per-outline-level style, and that applicable master is a genuinely per-slide choice (real files carry more than one design master), not always "the one master". Resolved against Apache POI's HSLFSlideMaster/HSLFTextParagraph/HSLFTextRun, Environment.java, and Slide.java (github.com/apache/poi). [MS-PPT] 2.9.35 TextMasterStyleAtom: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/5febad27-0c48-4f98-b655-562b986f5874 [MS-PPT] 2.5.2 SlideAtom: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/57e11e6c-e550-4c43-80b6-72731eee8abd

/** One master's own resolved text styles, keyed by TextTypeEnum member (text/atoms.ts's own TEXT_TYPE_* constants). A type absent from the map states nothing of its own; resolveCharacterProperties/resolveParagraphProperties below fall through to a sibling type in the same family (BODY/CENTER_BODY/HALF_BODY/QUARTER_BODY; TITLE/CENTER_TITLE) or leave the property undefined. */
export interface MasterStyleTable {
  readonly byType: ReadonlyMap<number, readonly MasterStyleLevel[]>;
}

/** Builds one MainMasterContainer's own MasterStyleTable from its direct-child TextMasterStyleAtoms, falling back to the document-wide default (the single OTHER-typed TextMasterStyleAtom [MS-PPT] states lives in the DocumentTextInfoContainer inside Environment) for any TextTypeEnum member the master itself carries no atom for. A real master this package's own writer produces always states TITLE/BODY/NOTES explicitly (master-write.ts's own comment), so the document default is realistically only ever consulted for OTHER-typed runs or a third-party master that omits one of the three -- but [MS-PPT] 2.9.35 makes it the genuine fallback of last resort for every type, not a special case for OTHER alone. */
export function buildMasterStyleTable(
  masterAtoms: readonly MasterTextStyleAtom[],
  documentDefault: MasterTextStyleAtom | undefined,
): MasterStyleTable {
  const byType = new Map<number, readonly MasterStyleLevel[]>();
  if (documentDefault !== undefined) {
    byType.set(documentDefault.textType, documentDefault.levels);
  }
  for (const atom of masterAtoms) {
    byType.set(atom.textType, atom.levels);
  }
  return { byType };
}

// The type-family fallback [MS-PPT] 2.9.35's own resolution algorithm applies when a run's own TextTypeEnum slot states nothing for a field: BODY-family variants retry as plain BODY, TITLE-family variants retry as plain TITLE, and NOTES/OTHER have no further fallback of their own.
function typeFamilyFallback(textType: number): number | undefined {
  switch (textType) {
    case TEXT_TYPE_CENTER_BODY:
    case TEXT_TYPE_HALF_BODY:
    case TEXT_TYPE_QUARTER_BODY:
      return TEXT_TYPE_BODY;
    case TEXT_TYPE_CENTER_TITLE:
      return TEXT_TYPE_TITLE;
    default:
      return undefined;
  }
}

// The levels a run of the given type/indentLevel consults, most specific first: its own type's own applicable level, then that same type's levels moving outward to level 0, then (when the type has a family fallback) the fallback type's levels in the same outward order. "Applicable level" clamps indentLevel to the atom's own cLevels, since a run can state a deeper indent than its master's own atom bothered to carry levels for.
function orderedMasterLevels(
  table: MasterStyleTable,
  textType: number,
  indentLevel: number,
): readonly MasterStyleLevel[] {
  const levelsFor = (type: number): readonly MasterStyleLevel[] => {
    const levels = table.byType.get(type);
    if (levels === undefined || levels.length === 0) {
      return [];
    }
    const clampedLevel = Math.min(indentLevel, levels.length - 1);
    return levels.slice(0, clampedLevel + 1).reverse();
  };
  const fallbackType = typeFamilyFallback(textType);
  return fallbackType === undefined
    ? levelsFor(textType)
    : [...levelsFor(textType), ...levelsFor(fallbackType)];
}

function firstDefined<T, F>(
  candidates: readonly (T | undefined)[],
  get: (candidate: T) => F | undefined,
): F | undefined {
  for (const candidate of candidates) {
    if (candidate === undefined) {
      continue;
    }
    const value = get(candidate);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

/** Resolves a run's own ParagraphProperties (possibly stating nothing at all, when the run's paragraph itself carries no TextPFException of its own) against the master cascade -- every field the run itself states wins outright; every field it doesn't falls through to the first master level that does. indentLevel is never itself resolved from the cascade: it is the run's own stated (or default-zero) outline depth, and is what selects which master levels apply in the first place. */
export function resolveParagraphProperties(
  run: ParagraphProperties | undefined,
  table: MasterStyleTable,
  textType: number,
  indentLevel: number,
): ParagraphProperties {
  const levels = orderedMasterLevels(table, textType, indentLevel);
  const candidates = [run, ...levels.map((level) => level.paragraph)];
  return {
    indentLevel,
    alignment: firstDefined(candidates, (c) => c.alignment),
    lineSpacing: firstDefined(candidates, (c) => c.lineSpacing),
    spaceBefore: firstDefined(candidates, (c) => c.spaceBefore),
    spaceAfter: firstDefined(candidates, (c) => c.spaceAfter),
    leftMargin: firstDefined(candidates, (c) => c.leftMargin),
    indent: firstDefined(candidates, (c) => c.indent),
  };
}

/** The character-property counterpart of resolveParagraphProperties -- see that function's own comment for the cascade this implements. `color` resolves to whichever RunColor (literal or still-unresolved scheme reference) the cascade finds first; converting a scheme reference to an actual RgbColor is document/color-scheme.ts's own concern, deliberately kept separate since it needs the slide's colour scheme rather than anything the text-formatting cascade itself touches. */
export function resolveCharacterProperties(
  run: CharacterProperties | undefined,
  table: MasterStyleTable,
  textType: number,
  indentLevel: number,
): CharacterProperties {
  const levels = orderedMasterLevels(table, textType, indentLevel);
  const candidates = [run, ...levels.map((level) => level.character)];
  return {
    bold: firstDefined(candidates, (c) => c.bold),
    italic: firstDefined(candidates, (c) => c.italic),
    underline: firstDefined(candidates, (c) => c.underline),
    shadow: firstDefined(candidates, (c) => c.shadow),
    emboss: firstDefined(candidates, (c) => c.emboss),
    fontRef: firstDefined(candidates, (c) => c.fontRef),
    sizePt: firstDefined(candidates, (c) => c.sizePt),
    color: firstDefined(candidates, (c) => c.color),
  };
}

export interface SlideAtomInfo {
  readonly masterIdRef: number;
  readonly notesIdRef: number;
}

// [MS-PPT] 2.5.2's 0x18-byte SlideAtom -- the read-side mirror of master-write.ts's own writeSlideAtom. Only the two persist-identifier fields this module needs are surfaced; geom/placeholderTypes/slideFlags are this package's own writer's concern; the read side's shapes come from the slide's own OfficeArtSpContainer tree regardless of what SlideAtom's own placeholder-type array claims.
export function readSlideAtom(record: PptRecord): SlideAtomInfo {
  if (record.header.recType !== RT_SlideAtom) {
    throw new PptFormatError(
      `expected RT_SlideAtom (0x${RT_SlideAtom.toString(16)}) at offset ${record.offset}, found record type 0x${record.header.recType.toString(16)}`,
    );
  }
  // geom(4) + placeholderTypes(8) + masterIdRef(4) + notesIdRef(4) = 20 bytes before slideFlags/unused, which this module never reads.
  const MASTER_ID_REF_OFFSET = 12;
  const NOTES_ID_REF_OFFSET = 16;
  if (record.data.length < NOTES_ID_REF_OFFSET + 4) {
    throw new PptFormatError(
      `SlideAtom at offset ${record.offset} carries ${record.data.length} bytes, too few for its masterIdRef/notesIdRef fields`,
    );
  }
  const { data } = record;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    masterIdRef: view.getUint32(MASTER_ID_REF_OFFSET, true),
    notesIdRef: view.getUint32(NOTES_ID_REF_OFFSET, true),
  };
}
