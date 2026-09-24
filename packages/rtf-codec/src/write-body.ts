// The document-body half of the writer: sections, block dispatch, block-scoped construct markers (bookmarks), paragraphs, runs and their <chrev>/character properties.
import {
  type ConstructDescriptor,
  type ContentBlock,
  type ContentParagraph,
  type ContentRun,
  type ContentSection,
  type ProvenanceDescriptor,
  clampHeadingLevel,
} from "document-schema.js";
import { dttmFromIso, isBookmarkAnchor } from "./constructs";
import { RtfDiagnosticCodes } from "./diagnostics";
import {
  DEFAULT_FONT_SIZE_HALF_POINTS,
  pointsToHalfPoints,
  pointsToTwips,
} from "./units";
import { colorIndexOf } from "./write-tables";
import { escapeText, bookmarkStartGroup } from "./write-text";
import {
  type BookmarkExtent,
  type ContentControlExtent,
  type FormFieldStackSink,
  CHREV_CONTROL_WORDS,
  describeConstructGap,
  describeFormFieldGap,
  formFieldOpenGroup,
  isBookmarkExtent,
  isContentControlExtent,
  revisionsCovering,
  selectNestableFormFields,
} from "./write-form-fields";
import {
  LIST_LEVEL_INDENT_TWIPS,
  LIST_MARKER_HANG_TWIPS,
} from "./write-header";
import { writeImageParagraph, writeEmbeddedObjectBlock } from "./write-image";
import { writeTable } from "./write-table";
import { line, raw, type Writer } from "./write-state";

// The inverse of the reader's own SECTION_BREAK_TYPES. `nextPage` is deliberately absent rather than mapped to \sbkpage: \sbkpage is RTF's own default, so restating it would emit a control word carrying no information — exactly the reason ContentSection.breakType spells that case as an absent key.
const SECTION_BREAK_CONTROL_WORDS: ReadonlyMap<string, string> = new Map([
  ["continuous", "\\sbknone"],
  ["evenPage", "\\sbkeven"],
  ["oddPage", "\\sbkodd"],
]);

const ALIGNMENT_CONTROL_WORDS: ReadonlyMap<string, string> = new Map([
  ["left", "\\ql"],
  ["center", "\\qc"],
  ["right", "\\qr"],
  ["justify", "\\qj"],
]);

export function writeSection(
  writer: Writer,
  section: ContentSection,
  isFirst: boolean,
): void {
  if (!isFirst) {
    // "\sect End of section and paragraph." The break kind belongs to the section it starts, so it is written after the \sect that opens it, alongside the rest of that section's <secfmt>.
    line(writer, "\\sect");
  }
  // An absent breakType never reaches the map lookup at all — it means the format's own default break (RTF's own "nextPage"), which is spelled by \sectd alone with no \sbk* suffix, the identical output "nextPage" itself produces below since RTF has no dedicated \sbk* word for it either.
  const breakWord =
    section.breakType === undefined
      ? ""
      : (SECTION_BREAK_CONTROL_WORDS.get(section.breakType) ?? "");
  line(
    writer,
    `\\sectd${breakWord}` +
      `\\pgwsxn${String(pointsToTwips(section.pageSize.widthPt))}` +
      `\\pghsxn${String(pointsToTwips(section.pageSize.heightPt))}` +
      `\\marglsxn${String(pointsToTwips(section.margins.leftPt))}` +
      `\\margrsxn${String(pointsToTwips(section.margins.rightPt))}` +
      `\\margtsxn${String(pointsToTwips(section.margins.topPt))}` +
      `\\margbsxn${String(pointsToTwips(section.margins.bottomPt))}`,
  );
  writeBlocks(writer, section.blocks);
}

function writeBlocks(writer: Writer, blocks: readonly ContentBlock[]): void {
  for (const block of blocks) {
    writeBlock(writer, block);
  }
}

function writeBlock(writer: Writer, block: ContentBlock): void {
  switch (block.kind) {
    case "paragraph":
      writeParagraph(writer, block, false);
      return;
    case "table":
      writeTable(writer, block);
      return;
    case "image":
      writeImageParagraph(writer, block.base64, block);
      return;
    case "pageBreak":
      line(writer, "\\page\\pard");
      return;
    case "embeddedObject":
      writeEmbeddedObjectBlock(writer, block);
      return;
    case "constructStart":
      openConstruct(writer, block.descriptor);
      return;
    case "constructEnd":
      closeConstruct(writer);
      return;
  }
}

// A block-scoped construct's open marker. Only a bookmark anchor has an RTF spelling; every other descriptor kind degrades, but its extent is still tracked so the matching close knows there is nothing to write for it — a marker pair is balanced by position, and losing track of one half would strand the other.
export function openConstruct(
  writer: Writer,
  descriptor: ConstructDescriptor,
): void {
  if (!isBookmarkAnchor(descriptor)) {
    writer.sink({
      code: RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED,
      severity: "warning",
      message: `a ${descriptor.kind} construct is dropped: RTF has no ${describeConstructGap(descriptor)}`,
    });
    writer.openConstructs.push(undefined);
    return;
  }
  writer.openConstructs.push(descriptor.name);
  line(writer, bookmarkStartGroup(descriptor));
}

export function closeConstruct(writer: Writer): void {
  const name = writer.openConstructs.pop();
  if (name !== undefined) {
    line(writer, `{\\*\\bkmkend ${escapeText(name)}}`);
  }
}

// `inTable` adds the \intbl every paragraph inside a table row must carry or inherit.
export function writeParagraph(
  writer: Writer,
  paragraph: ContentParagraph,
  inTable: boolean,
): void {
  raw(writer, "\\pard\\plain");
  if (inTable) {
    raw(writer, "\\intbl");
  }
  raw(writer, paragraphProperties(writer, paragraph));
  raw(writer, " ");
  // A run-scoped construct is a boundary between runs, not a property of one, so its two halves are emitted at the run positions its half-open range names. Closes at a position run before opens, matching the block-marker rule: an extent ending where another begins must not enclose it.
  const bookmarks = (paragraph.constructs ?? []).filter(isBookmarkExtent);
  // Not pre-filtered to provenance extents here: revisionsCovering's own final type-guard filter already narrows to ProvenanceDescriptor, so filtering by kind twice would be a redundant, equivalent-mutant-prone AST node with no effect on the final result — the identical reasoning revisionsCovering's own comment already gives for not repeating its range filter's job.
  const constructs = paragraph.constructs ?? [];
  const formFields = selectNestableFormFields(
    (paragraph.constructs ?? []).filter(isContentControlExtent),
    writer.sink,
  );
  // The extents currently open with no close yet written, in actual open order (most-recently-opened last) — a real stack, not a Set, because writeFormFieldBoundaries below must always close the TOP of it and nothing else: see that method's own comment for why scanning for "any extent whose endRun matches" independently of open order mis-nests two extents that share a boundary.
  const openedFormFields: FormFieldStackSink = { opened: [] };
  for (const [index, run] of paragraph.runs.entries()) {
    writeRunBoundaries(writer, bookmarks, index);
    writeFormFieldBoundaries(writer, formFields, index, openedFormFields);
    writeRun(writer, run, revisionsCovering(constructs, index));
  }
  writeRunBoundaries(writer, bookmarks, paragraph.runs.length);
  writeFormFieldBoundaries(
    writer,
    formFields,
    paragraph.runs.length,
    openedFormFields,
  );
  // A structural backstop, not a normal-path event: writeFormFieldBoundaries above is only ever called for positions 0..paragraph.runs.length, so an extent whose own endRun falls outside that range (beyond the paragraph's last run, or before its own startRun — see that method's own comment) can leave its open half written with no position left to match it to a close. Draining here makes the writer structurally incapable of emitting an unmatched field group regardless of what ranges an extent is handed, rather than trusting every caller to hand it only well-formed ones.
  drainOpenedFormFields(writer, openedFormFields);
  if (!inTable) {
    line(writer, "\\par");
  }
}

function drainOpenedFormFields(writer: Writer, sink: FormFieldStackSink): void {
  // Only the count matters here — every remaining entry closes identically ("}}"), so there is nothing to read off any individual extent.
  for (let remaining = sink.opened.length; remaining > 0; remaining -= 1) {
    raw(writer, "}}");
  }
  sink.opened.length = 0;
}

function writeRunBoundaries(
  writer: Writer,
  extents: readonly BookmarkExtent[],
  position: number,
): void {
  for (const extent of extents) {
    if (extent.endRun === position && extent.startRun !== position) {
      raw(writer, `{\\*\\bkmkend ${escapeText(extent.descriptor.name)}}`);
    }
  }
  for (const extent of extents) {
    if (extent.startRun === position) {
      raw(writer, bookmarkStartGroup(extent.descriptor));
      // A point anchor — startRun === endRun — opens and closes at the same boundary, so its end is written here rather than waiting for a later position that never differs.
      if (extent.endRun === position) {
        raw(writer, `{\\*\\bkmkend ${escapeText(extent.descriptor.name)}}`);
      }
    }
  }
}

// A form field's own two halves, matching writeRunBoundaries above but wrapping rather than flagging: the open is `{\field...}{\fldrslt ` left unclosed, so every run the extent covers lands inside \fldrslt's own destination, and the close is the matching `}}`. A controlType FORM_FIELD_SPEC does not cover degrades through describeFormFieldGap instead of minting nothing silently — and, critically, mints NO open braces for that extent, so the close loop must only ever emit "}}" for an extent whose open half was actually written (tracked in `opened`). Emitting the close unconditionally would leave every degraded extent's would-be open half missing while its close half still lands, corrupting the document's brace balance for everything written afterwards.
//
// `opened` is a real stack (most-recently-opened last), not a Set keyed by identity: the close loop below pops from its END and closes ONLY that entry, rather than scanning `extents` for "any extent whose endRun matches this position" independently of open order. That distinction matters the moment two extents share a boundary — properly nested (one fully inside the other) or simply tied (identical range) — because the physically innermost still-open `{\field...}{\fldrslt ` pair is always whichever one was opened LAST, and only its own `}}` can legitimately close next; closing by array order instead can close the wrong extent's braces while leaving the true innermost one's open forever (selectNestableFormFields above is what keeps `extents` itself free of the one shape — crossing extents — no open-order stack discipline could ever nest correctly to begin with). Popping only when the current top's own endRun matches is what lets writeParagraph's own drainOpenedFormFields (after the final call for a paragraph) tell a genuinely still-open extent apart from one already closed. This also matters for two shapes of malformed-looking input this writer must still round-trip to balanced output rather than crash or corrupt: an extent whose endRun exceeds paragraph.runs.length (this method is only ever called for positions 0..runs.length, so such a close position never arrives), and an extent with startRun > endRun (the close loop for its endRun runs before the open loop ever reaches its startRun, so it is not yet on the stack there and the close is correctly skipped as "not yet opened" — but nothing then revisits that endRun once the open finally happens at the later startRun position, so the close never fires from this method alone).
function writeFormFieldBoundaries(
  writer: Writer,
  extents: readonly ContentControlExtent[],
  position: number,
  sink: FormFieldStackSink,
): void {
  let top = sink.opened[sink.opened.length - 1];
  while (top?.endRun === position) {
    sink.opened.pop();
    raw(writer, "}}");
    top = sink.opened[sink.opened.length - 1];
  }
  for (const extent of extents) {
    if (extent.startRun !== position) {
      continue;
    }
    const open = formFieldOpenGroup(extent.descriptor, writer.sink);
    if (open === undefined) {
      writer.sink({
        code: RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED,
        severity: "warning",
        message: `a contentControl construct is dropped: RTF has no ${describeFormFieldGap(extent.descriptor)}`,
      });
      continue;
    }
    raw(writer, open);
    sink.opened.push(extent);
    if (extent.endRun === position) {
      sink.opened.pop();
      raw(writer, "}}");
    }
  }
}

function paragraphProperties(
  writer: Writer,
  paragraph: ContentParagraph,
): string {
  let out = "";
  const level =
    paragraph.headingLevel === undefined
      ? undefined
      : clampHeadingLevel(paragraph.headingLevel);
  // Not gated on writer.tables.headingStyles.get(level) !== undefined too: collectTables' own noteBlock walk sets headingStyles.set(level, level) — handle N reserved for level N — for every paragraph that carries a headingLevel at all, over the exact same document this method is called against, so a defined level is already guaranteed to have a matching entry (in fact the identical value, level itself) by the time any paragraph is written. Checking the Map here a second time would be a redundant, equivalent-mutant-prone AST node with no reachable case where it disagrees with `level !== undefined` alone.
  if (level !== undefined) {
    out += `\\s${String(level)}\\outlinelevel${String(level - 1)}`;
  }
  const alignment =
    paragraph.alignment === undefined
      ? undefined
      : ALIGNMENT_CONTROL_WORDS.get(paragraph.alignment);
  if (alignment !== undefined) {
    out += alignment;
  }
  // The paragraph-level bidirectional pair, stated only when the field states one: \ltrpar is the spec's own default ("Text in this paragraph will display with left-to-right precedence (the default)"), and this writer omits defaults rather than restate them as control words — the identical choice SECTION_BREAK_CONTROL_WORDS makes for \sbkpage — while still writing \ltrpar for an explicit `direction: "ltr"`, since that is a stated fact the field records rather than a default being restated.
  if (paragraph.direction === "rtl") out += "\\rtlpar";
  else if (paragraph.direction === "ltr") out += "\\ltrpar";
  const list = paragraph.list;
  if (list !== undefined) {
    const numId = list.numId;
    const entry =
      numId === undefined ? undefined : writer.tables.lists.get(numId);
    if (entry === undefined) {
      writer.sink({
        code: RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED,
        severity: "info",
        message:
          "a list membership carries no numId this writer minted a list for; the paragraph keeps its indentation but no list marker",
      });
    } else {
      const indent = LIST_LEVEL_INDENT_TWIPS * (list.level + 1);
      out +=
        `\\ls${String(entry.index)}\\ilvl${String(list.level)}` +
        `\\fi-${String(LIST_MARKER_HANG_TWIPS)}\\li${String(indent)}`;
    }
  }
  if (paragraph.indentLeftPt !== undefined) {
    out += `\\li${String(pointsToTwips(paragraph.indentLeftPt))}`;
  }
  if (paragraph.indentFirstLinePt !== undefined) {
    out += `\\fi${String(pointsToTwips(paragraph.indentFirstLinePt))}`;
  }
  if (paragraph.spacingBeforePt !== undefined) {
    out += `\\sb${String(pointsToTwips(paragraph.spacingBeforePt))}`;
  }
  if (paragraph.spacingAfterPt !== undefined) {
    out += `\\sa${String(pointsToTwips(paragraph.spacingAfterPt))}`;
  }
  if (paragraph.lineSpacing !== undefined) {
    // RTF states a line-spacing multiple in 240ths of a line, paired with \slmult1 — the inverse of the reader's own conversion.
    out += `\\sl${String(Math.round(paragraph.lineSpacing * 240))}\\slmult1`;
  }
  if (paragraph.pageBreakBefore === true) {
    out += "\\pagebb";
  }
  return out;
}

function writeRun(
  writer: Writer,
  run: ContentRun,
  revisions: readonly ProvenanceDescriptor[] = [],
): void {
  const properties =
    runProperties(writer, run) + revisionProperties(writer, revisions);
  const body = `${properties}${properties.length > 0 ? " " : ""}${escapeText(run.text)}`;
  if (run.hyperlink === undefined) {
    raw(writer, `{${body}}`);
    return;
  }
  // The <links> field production: an instruction destination naming HYPERLINK and a result destination holding what is shown. A reader that does not understand fields still shows the result, which is why the text lives there rather than in the instruction.
  raw(
    writer,
    `{\\field{\\*\\fldinst{HYPERLINK "${escapeText(run.hyperlink)}"}}{\\fldrslt{${body}}}}`,
  );
}

// The <chrev> control words for every revision covering this run. Each run is already written inside its own group, so the properties turn themselves off at the closing brace exactly as \b and \i do — there is no "off" spelling to emit.
function revisionProperties(
  writer: Writer,
  revisions: readonly ProvenanceDescriptor[],
): string {
  let out = "";
  for (const descriptor of revisions) {
    const author = descriptor.author;
    const authorIndex =
      author === undefined
        ? undefined
        : writer.tables.revisionAuthors.get(author);
    const dttm =
      descriptor.dateIso === undefined
        ? undefined
        : dttmFromIso(descriptor.dateIso);
    const words = CHREV_CONTROL_WORDS[descriptor.change];
    out += words.flag;
    if (authorIndex !== undefined) {
      out += `\\${words.author}${String(authorIndex)}`;
    }
    // A dateIso this writer cannot pack produces no control word at all: a zero DTTM is itself the claim "no time recorded", which is not the same as a date that failed to parse.
    if (dttm !== undefined) {
      out += `\\${words.date}${String(dttm)}`;
    }
  }
  return out;
}

function runProperties(writer: Writer, run: ContentRun): string {
  let out = "";
  const fontIndex =
    run.fontFamily === undefined
      ? undefined
      : writer.tables.fonts.get(run.fontFamily);
  if (fontIndex !== undefined && fontIndex !== 0) {
    out += `\\f${String(fontIndex)}`;
  }
  const halfPoints =
    run.sizePt === undefined
      ? DEFAULT_FONT_SIZE_HALF_POINTS
      : pointsToHalfPoints(run.sizePt);
  if (halfPoints !== DEFAULT_FONT_SIZE_HALF_POINTS) {
    out += `\\fs${String(halfPoints)}`;
  }
  if (run.bold === true) out += "\\b";
  if (run.italic === true) out += "\\i";
  if (run.underline === true) out += "\\ul";
  if (run.strike === true) out += "\\strike";
  // The bare on-spellings, not \upN/\dnN: "\super Superscripts text and shrinks point size according to font information" is a rendering instruction exactly matching what ContentRun.verticalAlign's two members state, while "\upN Move up N half-points" asserts a specific half-point offset this content model never carried and would have to invent a number for. The corpus producer confirms the split: LibreOffice's own filter writes \super/\sub for the standard positions and reaches for \upN/\dnN (beside its own {\*\updnpropN} group) only for a custom percentage the field has no room to state.
  if (run.verticalAlign === "superscript") out += "\\super";
  else if (run.verticalAlign === "subscript") out += "\\sub";
  // The run-level bidirectional pair, written as the one word the field states rather than the pair a full complex-script producer emits (\rtlch \afN & <aprops>* \ltrch): the pair's first half is the property-association grammar's own machinery for carrying a SEPARATE complex-script font/size alongside the Latin one, and this content model has no such second property set to state, so the single trailing word each production ends with is the exact spelling of what ContentRun.direction carries.
  if (run.direction === "rtl") out += "\\rtlch";
  else if (run.direction === "ltr") out += "\\ltrch";
  const colorIndex = colorIndexOf(run.color, writer.tables.colors);
  if (colorIndex !== undefined) {
    out += `\\cf${String(colorIndex)}`;
  }
  return out;
}
