// Per-control-word dispatch: one function per RTF state family (picture, form field, character, paragraph, section, structure), each mutating the state riding the group stack, plus applyControlWord itself, the single entry point read-parse.ts's own token loop calls for every backslash token it sees.
import {
  RtfDiagnosticCodes,
  RtfNotAnRtfDocumentError,
  type RtfDiagnosticSink,
} from "./diagnostics";
import type { RtfHeader } from "./header";
import { defaultSectionState } from "./read-build";
import { type ContentBuilder } from "./read-builder";
import type { RtfToken } from "./tokenize";
import { DEFAULT_FONT_SIZE_HALF_POINTS } from "./units";
import {
  ALIGNMENTS,
  PICTURE_FORMATS,
  SECTION_BREAK_TYPES,
  defaultCharacterState,
  defaultParagraphState,
  type FormFieldState,
  type GroupState,
  type PictureState,
  type SectionState,
  type SectionSink,
} from "./read-state";

export function toggleValue(param: number | undefined): boolean {
  return param !== 0;
}

// \ffownhelpN and \ffprotN are classified as "Value" control words, not "Toggle" words like \b/\i, in RTF 1.9.1's own Appendix B ("Index of RTF Control Words") — and Appendix B's own "Value"/"Toggle" definitions there are what settle which of the two defaults actually applies. "Value: This control word requires a parameter" states no default of its own for an omitted parameter. "Toggle: This control word distinguishes between the ON and OFF states for the given property. The control word with no parameter or a nonzero parameter is used to turn on the property, while the control word with a zero parameter is used to turn it off" — quoted here in full, since an earlier version of this comment elided exactly this clause — DOES state one: a bare Toggle word defaults ON, not off. \ffownhelp/\ffprot are Value words, not Toggle ones, so it is the Value entry's own silence that governs them, and that silence is exactly why the real 0-default has to come from a genuinely separate part of the spec: "Conventions of an RTF Reader"'s own "Change Formatting Property" entry, which states it in full: "If a parameter is needed and not specified, then a default value is used... If the control word does not specify a default, then RTF readers should assume a default of 0 except for the toggle control words (like \b), which have a default of 1." RTF's own Form Fields table states the identical 0-default fact for this specific pair without ever describing a bare-word meaning of its own: "\ffownhelpN: 1 if there is associated help text, 0 otherwise" and "\ffprotN: 1 if this field is protected, 0 otherwise" name only an explicit 0/1 parameter — unlike \b, whose own bare-word meaning IS stated right where its own table entry lives: \b's row ("\b* Bold.") sits in the "Font (Character) Formatting Properties" section, whose own immediately preceding preamble states the rule directly: "A control word preceding plain text turns on the specified attribute. Some control words (indicated in the following table by an asterisk following the description) can be turned off by appending 0 to the control word. For example, \b turns on bold, while \b0 turns off bold." (A near-identical sentence, "For example, \b turns on bold and \b0 turns off bold", also appears much earlier, in the "Control Word" section of the spec's Introduction — illustrating the general toggle-word convention there, not \b's own table-adjacent meaning; an earlier version of this comment misattributed that Introduction sentence to a preamble "two sections" before \b's own entry, when the actually on-point preamble sits immediately beside it, in the same section.) A bare \ffprot therefore reads as 0/false here, not true, via this function. \ffownhelp is classified identically by the spec but is deliberately NOT read via this function — see the comment on applyFormFieldControlWord's own "ffownhelp" case below for why a bare \ffownhelp reads as true in practice despite sharing this classification.
export function formFieldValueBit(param: number | undefined): boolean {
  return param !== undefined && param !== 0;
}

// \ffresN/\ffdefresN are classified identically to \ffownhelpN/\ffprotN in RTF 1.9.1's own Appendix B — generic "Value" control words — so the same "Change Formatting Property" 0-default formFieldValueBit's own comment quotes in full applies to them too: a bare \ffres/\ffdefres means \ffresN0/\ffdefres0, not "no result recorded". [MS-DOC] 2.9.79 FFDataBits.iRes/iDef are integers rather than the single bit \ffprot carries, so the bare-defaults-to-0 rule is expressed as a number here rather than formFieldValueBit's own boolean, but it is the identical rule. Confusing a bare occurrence with the word's total absence would bypass FORM_FIELD_RESULT_UNDEFINED's own sentinel-then-\ffdefres fallback in constructs.ts: that fallback treats `undefined` as "this word never appeared, keep looking for a recorded value", so storing `undefined` for a bare \ffres/\ffdefres would misreport a producer's real, explicit 0 as if the field recorded no result at all — letting a checkbox's bare \ffres fall through to an unrelated \ffdefres instead of reading as the unchecked state the bare word actually spells.
export function formFieldValueNumber(param: number | undefined): number {
  return param ?? 0;
}

export function assertRtfHeaderPresent(tokens: readonly RtfToken[]): void {
  const first = tokens[0];
  const second = tokens[1];
  if (
    first?.kind !== "groupStart" ||
    second?.kind !== "controlWord" ||
    second.name !== "rtf"
  ) {
    throw new RtfNotAnRtfDocumentError();
  }
}

// The control-word dispatch, split by which piece of group state each word writes to rather than kept as one flat table. The split is by state, not by an arbitrary size budget: a picture control word can only mean anything inside a \pict destination, a character word writes the character state the spec scopes to the group, a paragraph word writes the paragraph state applied at the next \par, and a structural word drives the block/table builder. Each helper says whether it recognised the word, so applyControlWord below reads as the priority order the specification itself implies — destination first, then formatting, then structure — and an unrecognised word falls through to being ignored, which is what the spec requires of any control word a reader does not know.

export function applyPictureControlWord(
  name: string,
  param: number | undefined,
  picture: PictureState,
): void {
  const format = PICTURE_FORMATS.get(name);
  if (format !== undefined) {
    picture.format = format;
    return;
  }
  switch (name) {
    case "emfblip":
    case "macpict":
    case "wmetafile":
    case "pmmetafile":
    case "dibitmap":
    case "wbitmap":
      picture.unsupportedFormat = `\\${name}`;
      return;
    case "picwgoal":
      picture.widthGoalTwips = param;
      return;
    case "pichgoal":
      picture.heightGoalTwips = param;
      return;
    case "picw":
      picture.widthPixels = param;
      return;
    case "pich":
      picture.heightPixels = param;
      return;
    case "picscalex":
      if (param !== undefined) picture.scaleXPercent = param;
      return;
    case "picscaley":
      if (param !== undefined) picture.scaleYPercent = param;
      return;
    // No `default: break;` clause: an unmatched name already falls out of the switch with no default present, landing in the identical place — this function's own end — that an explicit break in a default clause with no other statement would. Equivalent either way, so the redundant clause is omitted rather than left for a mutation tester to flag as unkillable.
  }
}

// RTF 1.5's own Form Fields table states \ffresN/\ffdefresN only in list-field terms ("Result field for a form field. Values from 0 to N-1, where N is the number of \ffl entries" / "Default entry for list field"), but \ffres/\ffdefres are RTF's own serialisation of the binary FFDataBits structure [MS-DOC] 2.9.79 defines, and that structure spells out a checkbox's own iRes meaning explicitly: 0 (unchecked), 1 (checked), or the reserved sentinel 25 (undefined, treated as unchecked). Both control words are captured here via formFieldValueNumber's own bare-defaults-to-0 Value-word rule, regardless of the field's iType; formFieldContentControl in constructs.ts is where the checkbox-specific sentinel handling and the dropdown's own zero-based-index reading of the identical \ffres are actually decided. \ffprot ("1 if this field is protected, 0 otherwise" — RTF 1.9.1's own Form Fields table, mirroring [MS-DOC] 2.9.79 FFDataBits.fProt) is read via formFieldValueBit above, matching its own Value-word classification's literal 0-default for a bare occurrence — see formFieldValueBit's own comment for the exact citations. \ffownhelp is deliberately NOT read the same way, despite carrying the identical Value-word classification: LibreOffice's own RTF exporter (sw/source/filter/ww8/rtfattributeoutput.cxx, confirmed against its published source) emits the BARE control word, with no numeric parameter, whenever the control model exposes a HelpText property at all — every one of its three FFOWNHELP emission sites gates on `xPropSetInfo->hasPropertyByName("HelpText")`, a property-existence check, not a literal unconditional emission — immediately before a `{\*\ffhelptext ...}` destination that actually carries the control's real HelpText property — so treating a bare occurrence as the Value-word literal default of false, the way \ffprot's bare form correctly does, silently discards genuine author-set help text from this real producer on every read, with the reader's own downstream `helpText.trim().length > 0` check in constructs.ts already filtering out the empty/absent case the spec's 0-default exists to describe. \ffownhelp is read via toggleValue instead, exactly like a bare `\b`/`\i`: this is a considered divergence from its own literal Value-word default, not an oversight, made for the identical real-world-producer reason FORM_FIELD_RESULT_UNDEFINED's own \ffres25-to-\ffdefres fallback exists above — do not "simplify" this back to formFieldValueBit, that would re-break the LibreOffice case this divergence exists for. An explicit \ffownhelp0 still reads as false (a producer that spells out the zero is making an explicit claim the reader still honours), and a field that never mentions \ffownhelp at all still defaults to false via FormFieldState's own initial value; only the bare, unparameterised form's own default changes.
// Every recognised word is a no-op default outcome from the caller's own point of view: the sole call site (applyControlWord below) unconditionally treats destination "formField" as fully handled regardless of which word matched or whether any did, via its own unconditional formField-family guard right after — so this function's result was never actually observable, and returning it at all was a boolean the caller could never branch on differently. Void rather than boolean for that reason, with an unmatched word simply falling out of the switch as a real no-op.
export function applyFormFieldControlWord(
  name: string,
  param: number | undefined,
  formField: FormFieldState,
): void {
  switch (name) {
    case "ffres":
      formField.resultIndex = formFieldValueNumber(param);
      break;
    case "ffdefres":
      formField.defaultResultIndex = formFieldValueNumber(param);
      break;
    case "ffprot":
      formField.protectedField = formFieldValueBit(param);
      break;
    case "ffownhelp":
      formField.ownHelp = toggleValue(param);
      break;
    // No `default: break;` clause: an unmatched name already falls out of the switch with no default present, landing in the identical place — this function's own end — that an explicit break in a default clause with no other statement would.
  }
}

// Void, like applyStructureControlWord: applyControlWord's own dispatch chain calls every one of these five word-appliers unconditionally now (see its own comment on why that is safe), so none of them needs to report back whether a name was its own — only to apply it when it was, and do nothing otherwise, which every one of them already does on its own account.
export function applyCharacterControlWord(
  name: string,
  param: number | undefined,
  state: GroupState,
  header: RtfHeader,
): void {
  switch (name) {
    case "plain":
      state.char = defaultCharacterState();
      break;
    case "b":
      state.char.bold = toggleValue(param);
      break;
    case "i":
      state.char.italic = toggleValue(param);
      break;
    case "strike":
      state.char.strike = toggleValue(param);
      break;
    case "v":
      state.char.hidden = toggleValue(param);
      break;
    case "ulnone":
      state.char.underline = false;
      break;
    case "f":
      state.char.fontIndex = param ?? header.defaultFontIndex;
      break;
    case "fs":
      state.char.sizeHalfPoints = param ?? DEFAULT_FONT_SIZE_HALF_POINTS;
      break;
    case "cf":
      state.char.colorIndex = param;
      break;
    case "uc":
      if (param !== undefined && param >= 0) state.uc = param;
      break;
    // RTF 1.9.1, "Font (Character) Formatting Properties": "\super Superscripts text and shrinks point size according to font information." / "\sub Subscripts text ...". Both are bare on-words — neither carries the asterisk that section's own preamble gives the words that "can be turned off by appending 0" (\b*, \ul*, ...), so a parameter is not consulted here: the off-spelling the spec itself names is \nosupersub below, and a group's closing brace or \plain turns the property off the same way every other character property here does.
    case "super":
      state.char.verticalAlign = "superscript";
      break;
    case "sub":
      state.char.verticalAlign = "subscript";
      break;
    // "\upN Move up N half-points (default is 6)." / "\dnN Move down N half-points (default is 6)." — the offset spellings, where the sign decides the family and zero restores the baseline (a move of no half-points is no move at all, so \up0/\dn0 state baseline as explicitly as their absence does). A negative \upN genuinely moves text down and a negative \dnN up, so each crosses onto the other's member rather than being clamped to its own; the "default is 6" makes a bare occurrence a real raise/lower, matching the way applyFormFieldControlWord's own Value-word defaults work.
    case "up":
      state.char.verticalAlign =
        param === undefined || param > 0
          ? "superscript"
          : param < 0
            ? "subscript"
            : undefined;
      break;
    case "dn":
      state.char.verticalAlign =
        param === undefined || param > 0
          ? "subscript"
          : param < 0
            ? "superscript"
            : undefined;
      break;
    // "\nosupersub Turns off superscripting or subscripting." — the one off-spelling the spec names for the property, spanning both the \super/\sub and \upN/\dnN families.
    case "nosupersub":
      state.char.verticalAlign = undefined;
      break;
    // The run-level bidirectional pair (RTF 1.9.1, "Font (Character) Formatting Properties"): "\rtlch Character data following this control word is treated as a right-to-left run" / "\ltrch ... treated as a left-to-right run (the default)". Bare on-words with no off-spelling of their own — the state they leave is simply whichever of the two was stated last, so a later word replaces an earlier one rather than toggling against it, and a group's close or \plain restores the enclosing state like every other character property here.
    case "rtlch":
      state.char.direction = "rtl";
      break;
    case "ltrch":
      state.char.direction = "ltr";
      break;
    // The <chrev> production. Each writes the revision half of the character state, which rides the group stack with the rest of it.
    case "revised":
      state.char.revision = {
        ...state.char.revision,
        revised: toggleValue(param),
      };
      break;
    case "revauth":
      state.char.revision = { ...state.char.revision, revisedAuthor: param };
      break;
    case "revdttm":
      state.char.revision = { ...state.char.revision, revisedDateTime: param };
      break;
    case "deleted":
      state.char.revision = {
        ...state.char.revision,
        deleted: toggleValue(param),
      };
      break;
    case "revauthdel":
      state.char.revision = { ...state.char.revision, deletedAuthor: param };
      break;
    case "revdttmdel":
      state.char.revision = { ...state.char.revision, deletedDateTime: param };
      break;
    case "mvf":
      state.char.revision = {
        ...state.char.revision,
        moved: toggleValue(param) ? "moveFrom" : undefined,
      };
      break;
    case "mvt":
      state.char.revision = {
        ...state.char.revision,
        moved: toggleValue(param) ? "moveTo" : undefined,
      };
      break;
    case "mvauth":
      state.char.revision = { ...state.char.revision, movedAuthor: param };
      break;
    case "mvdate":
      state.char.revision = { ...state.char.revision, movedDateTime: param };
      break;
    case "crauth":
      state.char.revision = { ...state.char.revision, formatAuthor: param };
      break;
    case "crdate":
      state.char.revision = { ...state.char.revision, formatDateTime: param };
      break;
    default:
      // Underline is a family of control words rather than one: "\ul* Continuous underline. \ul0 turns off all underlining" plus a dozen styled variants (\uld, \uldash, \ulth, \ulwave, ...), all of which ContentRun expresses as the one boolean it carries. \ulc (underline colour) is deliberately not one of them.
      if (!name.startsWith("ul") || name === "ulc") {
        return;
      }
      state.char.underline = toggleValue(param);
  }
}

// Void for the same reason applyCharacterControlWord above is.
export function applyParagraphControlWord(
  name: string,
  param: number | undefined,
  state: GroupState,
): void {
  const alignment = ALIGNMENTS.get(name);
  if (alignment !== undefined) {
    state.para.alignment = alignment;
    return;
  }
  switch (name) {
    case "pard":
      state.para = defaultParagraphState();
      break;
    case "s":
      state.para.styleIndex = param;
      break;
    // The paragraph-level bidirectional pair (RTF 1.9.1, "Bidirectional Controls" under "Paragraph Formatting Properties"): "\rtlpar Text in this paragraph will display with right-to-left precedence" / "\ltrpar ... left-to-right precedence (the default)". Bare on-words like \rtlch/\ltrch above — last stated wins, \pard restores the default.
    case "rtlpar":
      state.para.direction = "rtl";
      break;
    case "ltrpar":
      state.para.direction = "ltr";
      break;
    case "outlinelevel":
      // "\outlinelevelN ... a value from 0 to 8 ... In the default case, no outline level is specified (same as body text)." A value above 8 is a producer's own spelling of body text, so it clears the level rather than becoming a tenth heading depth.
      state.para.outlineLevel =
        param === undefined || param > 8 ? undefined : param;
      break;
    case "li":
    case "lin":
      state.para.indentLeftTwips = param ?? 0;
      break;
    case "fi":
      state.para.indentFirstLineTwips = param ?? 0;
      break;
    case "sb":
      state.para.spaceBeforeTwips = param ?? 0;
      break;
    case "sa":
      state.para.spaceAfterTwips = param ?? 0;
      break;
    case "sl":
      state.para.lineSpacingTwips = param;
      break;
    case "slmult":
      state.para.lineSpacingIsMultiple = toggleValue(param);
      break;
    case "pagebb":
      state.para.pageBreakBefore = true;
      break;
    case "ls":
      state.para.listOverrideIndex = param;
      break;
    case "ilvl":
      state.para.listLevel = param ?? 0;
      break;
    case "intbl":
      state.para.inTable = true;
      break;
  }
}

// The <secfmt> production's own properties (RTF 1.9.1, "Section Formatting Properties"). Every one of them is a section-scoped twin of a document-level control word the header parser already reads — \pgwsxnN beside \paperwN, \marglsxnN beside \marglN — because RTF states page geometry twice: once for the document and once per section that departs from it. Void for the same reason applyCharacterControlWord above is. This is the one function whose entire job is to mutate SectionState in response to each <secfmt> control word, which is exactly why it takes the SectionSink wrapper rather than a bare SectionState (see SectionSink's own note).
export function applySectionControlWord(
  name: string,
  param: number | undefined,
  sectionSink: SectionSink,
  header: RtfHeader,
  sink: RtfDiagnosticSink,
): void {
  const section = sectionSink.section;
  if (name === "sectd") {
    // \sectd resets every section property to the document default, which is a whole-state replacement rather than a patch, so each field of SectionState is assigned by name: a spread through Object.assign would not check that the source still matches the target's declared types if either shape changes.
    const defaults = defaultSectionState(header);
    section.paperWidthTwips = defaults.paperWidthTwips;
    section.paperHeightTwips = defaults.paperHeightTwips;
    section.marginLeftTwips = defaults.marginLeftTwips;
    section.marginRightTwips = defaults.marginRightTwips;
    section.marginTopTwips = defaults.marginTopTwips;
    section.marginBottomTwips = defaults.marginBottomTwips;
    section.breakType = defaults.breakType;
    return;
  }
  if (name === "sbkcol") {
    sink({
      code: RtfDiagnosticCodes.SECTION_BREAK_UNREPRESENTED,
      severity: "info",
      message:
        "\\sbkcol starts the section at a new column; ContentSection.breakType names page-level breaks only, so the break kind is dropped and the section itself is kept",
    });
    section.breakType = undefined;
    return;
  }
  if (SECTION_BREAK_TYPES.has(name)) {
    section.breakType = SECTION_BREAK_TYPES.get(name);
    return;
  }
  // Every remaining recognised name here takes a twips parameter — unlike the three checks above, none of which do — so a bare occurrence (no parameter) genuinely has nothing to apply, rather than a default this reader would otherwise assign.
  if (param === undefined) {
    return;
  }
  switch (name) {
    case "pgwsxn":
      section.paperWidthTwips = param;
      break;
    case "pghsxn":
      section.paperHeightTwips = param;
      break;
    case "marglsxn":
      section.marginLeftTwips = param;
      break;
    case "margrsxn":
      section.marginRightTwips = param;
      break;
    case "margtsxn":
      section.marginTopTwips = param;
      break;
    case "margbsxn":
      section.marginBottomTwips = param;
      break;
  }
}

export function applyStructureControlWord(
  name: string,
  param: number | undefined,
  state: GroupState,
  builder: ContentBuilder,
  section: Readonly<SectionState>,
  sink: RtfDiagnosticSink,
): void {
  // Void, not boolean: this is the last dispatcher in applyControlWord's own chain, called unconditionally with its result never inspected — an unrecognised word simply falls out of the switch as a real no-op, exactly as the spec requires of any control word a reader does not know.
  switch (name) {
    case "par":
      builder.endParagraph(state.para, true);
      break;
    case "trowd":
      state.para.inTable = true;
      builder.startRowDefinition();
      break;
    case "trleft":
      builder.setRowLeft(param ?? 0);
      break;
    // The row-level bidirectional pair, a <rowwrite> member of the <tbldef> this row's own definition builds (RTF 1.9.1, "Table Row Formatting"): "\rtlrow Cells in this table row will have right-to-left precedence" / "\ltrrow ... left-to-right precedence (the default)". Bare on-words; last stated wins, and \trowd's own startRowDefinition resets the pending row's direction with the rest of its state.
    case "rtlrow":
      builder.setRowDirection("rtl");
      break;
    case "ltrrow":
      builder.setRowDirection("ltr");
      break;
    // "\trhdr Table row header. This row should appear at the top of every page on which the current table appears" (RTF 1.9.1, "Table Definitions"): a bare on-word with no off-word, reset along with the rest of the pending row definition by \trowd.
    case "trhdr":
      builder.setRowHeader();
      break;
    case "cellx":
      if (param !== undefined) builder.addCellBoundary(param);
      break;
    case "cell":
      builder.endCell(state.para);
      break;
    case "row":
      builder.endRow(state.para);
      state.para.inTable = false;
      break;
    case "nestcell":
    case "nestrow":
      // A nested table is read as ordinary cell content rather than a table inside a cell: \nestcell/\nestrow describe the inner row through a {\*\nesttableprops ...} group whose own <tbldef> this reader does not track separately, so promoting it would need a second row builder keyed by \itapN nesting depth.
      sink({
        code: RtfDiagnosticCodes.NESTED_TABLE_FLATTENED,
        severity: "warning",
        message:
          "a nested table's cell/row marks are read as ordinary cell content; the inner table's own structure is not reconstructed",
      });
      break;
    case "page":
      builder.endParagraph(state.para, false);
      builder.addBlocks([{ kind: "pageBreak" }], state.para.inTable);
      break;
    case "sect":
      // "\sect End of section and paragraph" — both, in that order: the paragraph closes into the section that is ending, not into the one about to begin.
      builder.endParagraph(state.para, true);
      builder.endSection(section, state.para);
      break;
    // No `default: break;` clause: an unmatched name already falls out of the switch with no default present, landing in the identical place — this function's own end — that an explicit break in a default clause with no other statement would.
  }
}

export function applyControlWord(
  name: string,
  param: number | undefined,
  state: GroupState,
  builder: ContentBuilder,
  header: RtfHeader,
  // Wrapped for the same reason applySectionControlWord's own SectionSink parameter is: this function dispatches to it, which genuinely mutates the section it holds. sectionSink.section, a plain mutable SectionState, is still trivially assignable everywhere else this same reference is passed on to a Readonly<SectionState>-typed parameter (applyStructureControlWord below), so nothing downstream loses its own read-only guarantee.
  sectionSink: SectionSink,
  sink: RtfDiagnosticSink,
): void {
  const picture = state.picture;
  if (state.destination === "picture" && picture !== undefined) {
    applyPictureControlWord(name, param, picture);
    return;
  }
  const object = state.object;
  if (state.destination === "object" && object !== undefined) {
    // \objwN/\objhN (RTF 1.9.1, "Objects": <objhw> = \objhN & \objwN, one member of the larger <objsize> production), the size hint captured here for objectSizeHintClause's own use on the degrade path — every other word \object's own scope can carry (\objemb, \objautlink, \objlock, \objupdate, \objsub, ...) is a bare marker this reader does not otherwise act on, since a decoded \objdata carries its own frame and an undecodable one falls back to \result instead.
    if (name === "objw") {
      object.widthTwips = param;
    } else if (name === "objh") {
      object.heightTwips = param;
    }
    return;
  }
  const bookmark = state.bookmark;
  if (bookmark !== undefined && state.destination === "bookmarkStart") {
    // "\bkmkcolfN is used to denote the first column of a table covered by a bookmark ... \bkmkcollN is used to denote the last column. ... These controls are used within the \*\bkmkstart destination following the \bkmkstart control." Nothing else inside a bookmark destination means anything to this reader: its content is a name, not formatted text, so a stray character or paragraph word there is ignored rather than applied to the surrounding run.
    if (name === "bkmkcolf") bookmark.columnFirst = param;
    else if (name === "bkmkcoll") bookmark.columnLast = param;
    return;
  }
  if (state.destination === "bookmarkEnd") {
    return;
  }
  const formField = state.field?.formField;
  // Applying a genuine \ffres/\ffdefres/\ffprot/\ffownhelp word and discarding an unrecognised one are handled by the SAME unconditional return just below: nothing here branches on which of the two happened, so applyFormFieldControlWord's own effect (if any) is folded into that one guard rather than gated by a second, redundant destination check of its own.
  if (state.destination === "formField" && formField !== undefined) {
    applyFormFieldControlWord(name, param, formField);
  }
  if (
    state.destination === "formField" ||
    state.destination === "formFieldName" ||
    state.destination === "formFieldHelpText" ||
    state.destination === "formFieldListItem"
  ) {
    // Mirrors the bookmarkStart/bookmarkEnd guard above: \*\formfield carries no #PCDATA of its own (its content is entirely its own \ffres/\ffdefres/\ffprot/\ffownhelp control words, already handled above), and \*\ffname/\*\ffhelptext/\*\ffl's content is a name or help string, not formatted text — so a stray character, paragraph, or structure control word inside any of the four (\par, \page, \sect, \b, ...) is ignored here rather than applied to the paragraph/section/document surrounding the field.
    return;
  }
  // Every one of these five word-appliers is now called unconditionally, none gated on whether an earlier one already matched: applyCharacterControlWord's own recognised names (b/cf/crauth/crdate/deleted/dn/f/fs/i/ltrch/mvauth/mvdate/mvf/mvt/nosupersub/plain/revauth/revauthdel/revdttm/revdttmdel/revised/rtlch/strike/sub/super/uc/ulnone/up/v), applyCellDefinition's own (CELL_BORDER_SIDES' cl-prefixed side names, clvmgf/clvmrg/clmgf/clmrg/clcbpat/clcfpat/clshdng/clvertalc/clvertalb/clvertalt, every no-border/border-style keyword, brdrw/brdrcf, and anything else starting "brdr"/"brsp"), applyParagraphControlWord's own (ALIGNMENTS' ql/qc/qr/qj plus pard/s/rtlpar/ltrpar/outlinelevel/li/lin/fi/sb/sa/sl/slmult/pagebb/ls/ilvl/intbl), applySectionControlWord's own (sectd/sbkcol/SECTION_BREAK_TYPES' sbknone/sbkpage/sbkeven/sbkodd plus pgwsxn/pghsxn/marglsxn/margrsxn/margtsxn/margbsxn), and applyStructureControlWord's own (par/trowd/trleft/rtlrow/ltrrow/cellx/cell/row/nestcell/nestrow/page/sect) share not one single control-word name across all five sets — so a name any one of them recognises can never also be one a sibling would act on, making a sequential gate-and-return chain unnecessary: each function already applies its own effect only for the names it recognises and is a genuine no-op for every other name, so calling all five in a fixed order (cell definition before paragraph, since several \cl-prefixed words share a bare-word prefix with a paragraph border word RTF's own \brdr* production never actually reaches — see the cell-definition comment below) produces the identical result a return-gated chain would, with no ordering-dependent short-circuit to get wrong. (The cell-definition comment immediately below is about a different, RTF-spec-level ambiguity — a paragraph-level \brdr* border this reader does not implement at all, not an actual collision between the two functions' own recognised name sets, which remain disjoint either way.)
  applyCharacterControlWord(name, param, state, header);
  // The <celldef> run comes before the paragraph dispatch: several of its members share a prefix with paragraph border words, and a cell definition's own side is the narrower reading whenever one is open.
  builder.applyCellDefinition(name, param);
  applyParagraphControlWord(name, param, state);
  applySectionControlWord(name, param, sectionSink, header, sink);
  applyStructureControlWord(
    name,
    param,
    state,
    builder,
    sectionSink.section,
    sink,
  );
}
