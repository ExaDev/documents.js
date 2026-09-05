// The write side: a ContentDocument or DocumentTree to RTF bytes, deterministic and byte-stable for one input.
//
// The output targets the same <File> production the reader reads -- '{' <header> <document> '}' -- and states its header tables in the order the grammar requires (\rtf1, character set, \deffN, then \fonttbl, \colortbl, \stylesheet, the list tables), because "each of the various header tables should appear, if they exist, in this order" and "a property must be defined before being referenced" (RTF 1.9.1, "Header").
//
// THREE TABLES ARE MINTED, NOT COPIED. A ContentDocument carries fonts as free-text family names on runs, colours as sRGB triples, headings as a canonical level, and lists as an opaque numId -- none of them as the indices RTF's body actually references. So the writer walks the document once to collect every distinct font family, colour, heading level, and list, mints the four tables from what it found, and then walks it again to emit a body whose \fN, \cfN, \sN and \lsN indices point into them. Two passes, not one, because a table has to be complete before the body that references it is written.
//
// EVERY NON-ASCII CHARACTER LEAVES AS \uN. RTF's own advice is to emit "\uN followed by the best ANSI representation it can manage. Often a question mark is used if no reasonable ANSI character exists", and that is exactly what this writer does, with \uc1 declared once so the fallback is one character. It deliberately does NOT try to find a code page that could carry a given character as a \'hh byte: the output is then pure 7-bit ASCII whatever the input contained, which is the property that makes it safe to transmit and trivially diffable, and it costs nothing a reader can see -- a conforming reader takes \uN and discards the fallback. A character outside the Basic Multilingual Plane is emitted as its two UTF-16 code units, which is what "\uN ... represents the Unicode character value expressed as a decimal number" means for a format whose parameter is a signed 16-bit integer, and matches the spec's own instruction that "Unicode values greater than 32767 are expressed as negative numbers".

import {
  type ConstructDescriptor,
  type ContentBlock,
  type ContentControlDescriptor,
  type ContentControlType,
  type ContentDocument,
  type ContentImageBlock,
  type ContentParagraph,
  type ContentRun,
  type ContentSection,
  type ContentTable,
  type ContentTableCell,
  type Color,
  type DocumentTree,
  type ProvenanceChange,
  type ProvenanceDescriptor,
  type RunConstructExtent,
  clampHeadingLevel,
  colorToRgbHex,
  flattenTree,
} from "document-schema.js";
import { borderControlWords } from "./cell-format";
import {
  bookmarkResidueControlWords,
  dttmFromIso,
  isBookmarkAnchor,
} from "./constructs";
import { base64ToBytes, bytesToHex } from "./base64";
import {
  RtfDiagnosticCodes,
  RtfUnsupportedDocumentKindError,
  type RtfDiagnosticSink,
} from "./diagnostics";
import { parseRtfListNumId, type RtfListType } from "./list-id";
import type { WriteRtfOptions } from "./options";
import {
  DEFAULT_FONT_SIZE_HALF_POINTS,
  pointsToHalfPoints,
  pointsToTwips,
} from "./units";

// The \levelnfcN value for each marker type this writer emits: 23 is "Bullet (no number at all)", 0 is "Arabic (1, 2, 3)".
const LEVEL_NUMBER_FORMAT_BULLET = 23;
const LEVEL_NUMBER_FORMAT_ARABIC = 0;

// One level of list indentation, in twips. Word's own default for a list level, and the value its \liN/\fiN pair uses: half an inch of left indent with the marker hanging back by a quarter.
const LIST_LEVEL_INDENT_TWIPS = 720;
const LIST_MARKER_HANG_TWIPS = 360;

// The \leveltext/\levelnumbers payload for a bullet level: one character of level text, U+00B7 (the bullet Word writes for a Symbol-font level), and no number placeholders. Written as the spec's own #SDATA form, a length byte followed by the characters.
const BULLET_LEVEL_TEXT = "\\'01\\u183 ?";
// The same for an arabic level: two characters, the level-0 placeholder and a full stop, with \levelnumbers naming byte 1 as the placeholder position.
const ARABIC_LEVEL_TEXT = "\\'02\\'00.";

// The document code page the writer declares. cp1252 is what \ansi itself means in practice and what every consumer handles; nothing depends on it beyond the ASCII range, since the writer emits no byte above 0x7F.
const OUTPUT_CODEPAGE = 1252;

// The inverse of the reader's own SECTION_BREAK_TYPES. `nextPage` is deliberately absent rather than mapped to \sbkpage: \sbkpage is RTF's own default, so restating it would emit a control word carrying no information -- exactly the reason ContentSection.breakType spells that case as an absent key.
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

// The one arm of ContentDocument's discriminated union RTF can express -- named once rather than re-narrowed at each site, since writeRtfContent throws RtfUnsupportedDocumentKindError for every other kind before a writer is constructed at all.
type WordprocessingDocument = Extract<
  ContentDocument,
  { kind: "wordprocessing" }
>;

interface ListDefinition {
  readonly type: RtfListType;
  readonly start: number;
}

interface DocumentTables {
  // Font family name to its \fN index. Index 0 is always the default font, so a run naming no family needs no \fN at all.
  readonly fonts: Map<string, number>;
  // Lowercase 6-digit hex to its \cfN index. Index 0 is RTF's own "auto" colour, which the table's leading semicolon states and which nothing here mints.
  readonly colors: Map<string, number>;
  // Heading level to its \sN index. Levels are emitted as the built-in "heading N" styles a consumer already understands.
  readonly headingStyles: Map<number, number>;
  // Opaque numId to its \lsN index, alongside what the list actually is.
  readonly lists: Map<string, { index: number; definition: ListDefinition }>;
  // Revision author name to the index \revauthN and its siblings carry. Index 0 is reserved for the "Unknown" placeholder every real producer's table opens with, so a minted author is always non-zero -- which is also what makes the reader's own 0-based indexing land on a real name.
  readonly revisionAuthors: Map<string, number>;
}

const UNKNOWN_REVISION_AUTHOR = "Unknown";

const DEFAULT_FONT_NAME = "Times New Roman";

function collectTables(document: ContentDocument): DocumentTables {
  const fonts = new Map<string, number>([[DEFAULT_FONT_NAME, 0]]);
  const colors = new Map<string, number>();
  const headingStyles = new Map<number, number>();
  const lists = new Map<
    string,
    { index: number; definition: ListDefinition }
  >();
  const revisionAuthors = new Map<string, number>([
    [UNKNOWN_REVISION_AUTHOR, 0],
  ]);

  const noteDescriptor = (descriptor: ConstructDescriptor): void => {
    if (descriptor.kind !== "provenance") {
      return;
    }
    const author = descriptor.author;
    if (author !== undefined && !revisionAuthors.has(author)) {
      revisionAuthors.set(author, revisionAuthors.size);
    }
  };

  const noteColor = (color: Color | undefined): void => {
    if (color === undefined) {
      return;
    }
    const hex = colorToRgbHex(color);
    if (!colors.has(hex)) {
      // +1 because index 0 is the auto colour the table's own leading semicolon reserves.
      colors.set(hex, colors.size + 1);
    }
  };

  const noteRun = (run: ContentRun): void => {
    if (run.fontFamily !== undefined && !fonts.has(run.fontFamily)) {
      fonts.set(run.fontFamily, fonts.size);
    }
    noteColor(run.color);
  };

  const noteBlock = (block: ContentBlock): void => {
    if (block.kind === "constructStart") {
      noteDescriptor(block.descriptor);
      return;
    }
    if (block.kind === "paragraph") {
      for (const run of block.runs) {
        noteRun(run);
      }
      for (const extent of block.constructs ?? []) {
        noteDescriptor(extent.descriptor);
      }
      if (block.headingLevel !== undefined) {
        const level = clampHeadingLevel(block.headingLevel);
        if (!headingStyles.has(level)) {
          // Style handle N for heading level N, matching the built-in numbering a consumer expects; handle 0 stays free for Normal.
          headingStyles.set(level, level);
        }
      }
      const numId = block.list?.numId;
      if (numId !== undefined && !lists.has(numId)) {
        const parsed = parseRtfListNumId(numId);
        lists.set(numId, {
          index: lists.size + 1,
          definition: {
            type: parsed?.type ?? "bullet",
            start: parsed?.start ?? 1,
          },
        });
      }
      return;
    }
    if (block.kind === "table") {
      for (const row of block.rows) {
        for (const cell of row.cells) {
          // A cell's own colours reference the same \colortbl the runs do, so they must be minted here or a \clcbpatN/\brdrcfN would name an index the table never defines.
          noteColor(cell.background);
          for (const side of CELL_BORDER_ORDER) {
            noteColor(cell.borders?.[side]?.color);
          }
          for (const inner of cell.blocks) {
            noteBlock(inner);
          }
        }
      }
    }
  };

  if (document.kind === "wordprocessing") {
    for (const section of document.sections) {
      for (const block of section.blocks) {
        noteBlock(block);
      }
    }
  }
  return { fonts, colors, headingStyles, lists, revisionAuthors };
}

// RTF's own three reserved characters, plus the two line breaks a writer must not emit raw inside text (a bare CR/LF is ignored by a reader, but a backslash-CR is a \par, so escaping the pair keeps text meaning text). Everything else printable-ASCII passes through; everything else at all becomes a \uN escape with a '?' fallback.
function escapeText(text: string): string {
  let out = "";
  for (const character of text) {
    switch (character) {
      case "\\":
        out += "\\\\";
        continue;
      case "{":
        out += "\\{";
        continue;
      case "}":
        out += "\\}";
        continue;
      case "\t":
        out += "\\tab ";
        continue;
      case "\n":
      case "\r":
        out += "\\line ";
        continue;
      default:
        break;
    }
    const code = character.codePointAt(0) ?? 0;
    if (code >= 0x20 && code < 0x7f) {
      out += character;
      continue;
    }
    // Each UTF-16 code unit becomes its own \uN, expressed as a signed 16-bit value: "Unicode values greater than 32767 are expressed as negative numbers".
    for (let unit = 0; unit < character.length; unit += 1) {
      const value = character.charCodeAt(unit);
      const signed = value > 0x7f_ff ? value - 0x1_00_00 : value;
      out += `\\u${String(signed)} ?`;
    }
  }
  return out;
}

// The <bookstart> group: `'{\*' \bkmkstart (\bkmkcolfN? & \bkmkcollN?) #PCDATA '}'`, with the column controls "used within the \*\bkmkstart destination following the \bkmkstart control" -- which is exactly where a restored rtf residue value's own control words go, and why they precede the space that delimits the name.
function bookmarkStartGroup(descriptor: ConstructDescriptor): string {
  if (!isBookmarkAnchor(descriptor)) {
    return "";
  }
  const residue = bookmarkResidueControlWords(descriptor);
  return `{\\*\\bkmkstart${residue} ${escapeText(descriptor.name)}}`;
}

// The field instruction keyword and \fftype number for each controlType RTF's own form-field vocabulary actually covers -- the mirror of constructs.ts's own formFieldControlType, so the reader's instruction-to-controlType mapping and this controlType-to-instruction one are the two ends of a single round trip rather than independently maintained. \fftype's own three values are RTF 1.5's own Form Fields table: "Form field type: 0 Text 1 Check box 2 List". Every other ContentControlType (richText, comboBox, date, picture, repeatingSection, button, index, group) has no member here and falls through to describeConstructGap below -- RTF's own \*\formfield vocabulary genuinely only spells these three.
const FORM_FIELD_SPEC: ReadonlyMap<
  ContentControlType,
  { readonly instruction: string; readonly fftype: number }
> = new Map([
  ["plainText", { instruction: "FORMTEXT", fftype: 0 }],
  ["checkbox", { instruction: "FORMCHECKBOX", fftype: 1 }],
  ["dropDown", { instruction: "FORMDROPDOWN", fftype: 2 }],
]);

// [MS-DOC] 2.9.78 FFData.hsttbDropList, verbatim: "An optional STTB that specifies the entries in the dropdown list box. This MUST exist if and only if bits.iType is iTypeDrop (2). The entries are Unicode strings and do not have extra data. This MUST NOT exceed 25 elements." Not an arbitrary round number: FFDataBits' own iRes field reserves index 25 as its "undefined selection" sentinel (see FORM_FIELD_RESULT_UNDEFINED in constructs.ts), so a 26th real entry would sit exactly where a real Word/DOC consumer expects "no selection" instead of an actual option.
const MAX_DROPDOWN_OPTIONS = 25;

// The `<formparams><formstrings>` content of a `\*\formfield` group: \fftypeN naming the field's own real type (never left to the implicit text-field default), a checkbox's own `\ffres`/`\ffdefres` pair, a dropdown's own `\ffhaslistbox` plus its selected-entry `\ffres`/`\ffdefres` pair and its list of `{\*\ffl ...}` entries, a plainText field's own `{\*\ffdeftext ...}` default text, and -- for any of the three types -- a `\ffprot1` bit for a 'content'/'both' lock, the control's human-readable label as `\ffownhelp1{\*\ffhelptext ...}`, and its bookmark-style name as `{\*\ffname ...}`.
function formFieldPayload(
  descriptor: ContentControlDescriptor,
  fftype: number,
  sink: RtfDiagnosticSink,
): string {
  let out = `\\fftype${String(fftype)}`;
  if (descriptor.controlType === "checkbox") {
    // \ffres is what a reader (this package's own included, per FORM_FIELD_RESULT_UNDEFINED in constructs.ts) actually reads back as the checkbox's current state -- omitting it, as this writer once did, opens the box unchecked in Word regardless of `checked`, since an absent \ffres reads as 0. \ffdefres mirrors the same value: ContentControlDescriptor carries one `checked` boolean, not a separate reset default, so the field's default is the value it was minted with.
    const value = descriptor.checked === true ? "1" : "0";
    out += `\\ffres${value}\\ffdefres${value}`;
    if (descriptor.value !== undefined) {
      // A real, reachable case, from the identical reachability path as the plainText \ffdeftext handling above: documents.js's own PDF AcroForm-to-contentControl reconstruction spreads a checkbox widget's `/V` export-value name (e.g. 'Yes', a custom on-state string, distinct from AcroForm's own boolean derived-from-/V `checked`) onto `value` alongside `checked` (see pdf-codec's own valueFields -- `checked: value !== 'Off', ...(value !== 'Off' ? { value } : {})`). RTF's own \ffres/\ffdefres are a bare 0/1/25 state with no room for a named export value at all, so a checkbox's `value` has no RTF spelling whatsoever, unlike a dropDown's `value` (which at least sometimes matches a real \ffl entry) -- this is unconditional data loss whenever `value` is present, reported through the same sink every other unrepresentable construct in this writer uses rather than silently dropped the way an earlier version of this writer dropped it.
      sink({
        code: RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED,
        severity: "warning",
        message: `a checkbox contentControl's value '${descriptor.value}' (its on-state export name) is dropped: RTF's \\ffres/\\ffdefres can only carry the field's boolean checked state, with no spelling for a named export value at all`,
      });
    }
    if (descriptor.options !== undefined) {
      // Nothing about a checkbox has a list to hold this -- `options` is the dropDown/comboBox choice list, and a producer handing this writer a checkbox descriptor that also carries one (a mis-typed reconstruction, or a shape shared with a sibling controlType upstream) has recorded data this control type cannot carry regardless of format, not merely one RTF can't spell -- reported the same way as the value case above, rather than the writer quietly reading past a field it has no use for.
      sink({
        code: RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED,
        severity: "warning",
        message: `a checkbox contentControl's options list (${String(descriptor.options.length)} entries) is dropped: a checkbox has no choice list at all, in RTF or in the harmonised contentControl vocabulary itself`,
      });
    }
  } else if (descriptor.controlType === "dropDown") {
    // \ffhaslistbox is minted unconditionally for a dropDown, independent of whether it carries any options at all: [MS-DOC] 2.9.79 FFDataBits.fHasListBox "specifies that the form field has a list box. This value MUST be 1 if iType is iTypeDrop (2)." A dropdown with no options is still a dropdown -- there is no degenerate case in which that bit stops being true, so it cannot be gated behind `options !== undefined` the way an earlier version of this writer gated it (which then also left \ffdefres unminted for exactly that shape, a real, common one: a docx `w:dropDownList`/`w:comboBox` with no `w:listItem` children, or an ODF `form:listbox`, both currently read back by this ecosystem with no options recorded at all -- tracked as ExaDev/documents.js#1016).
    out += "\\ffhaslistbox";
    const allOptions = descriptor.options;
    let options = allOptions;
    if (allOptions !== undefined && allOptions.length > MAX_DROPDOWN_OPTIONS) {
      sink({
        code: RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED,
        severity: "warning",
        message: `a dropDown contentControl's ${String(allOptions.length)} options exceed [MS-DOC] 2.9.78 FFData.hsttbDropList's own ${String(MAX_DROPDOWN_OPTIONS)}-entry limit; only the first ${String(MAX_DROPDOWN_OPTIONS)} are written`,
      });
      options = allOptions.slice(0, MAX_DROPDOWN_OPTIONS);
    }
    const selectedIndex =
      options === undefined || descriptor.value === undefined
        ? undefined
        : options.indexOf(descriptor.value);
    if (selectedIndex !== undefined && selectedIndex !== -1) {
      // `value` genuinely names one of `options`: \ffres records the real current selection and \ffdefres mirrors it, exactly as the checkbox branch above mirrors its own single `checked` boolean into both \ffres and \ffdefres.
      out += `\\ffres${String(selectedIndex)}\\ffdefres${String(selectedIndex)}`;
    } else if (descriptor.value !== undefined) {
      // `value` was recorded but names none of `options` (or there are no options at all to name) -- real, signalable data loss, distinct from "no value was ever set" below. Substituting the nearest available index (e.g. 0) would silently write a DIFFERENT, wrong selection with no signal that the recorded value was never actually represented, so this writer mints neither \ffres nor \ffdefres and reports the drop through the same sink every other unrepresentable construct in this writer uses (see the "mints neither \ffres nor \ffdefres for a dropDown whose value names none of its own options" test).
      sink({
        code: RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED,
        severity: "warning",
        message: `a dropDown contentControl's selected value '${descriptor.value}' is dropped: it does not match any of the field's own options, and \\ffres/\\ffdefres can only name a real index into that list`,
      });
    }
    // The remaining case -- no value was ever recorded at all -- mints neither \ffres nor \ffdefres, exactly like the unmatched-value case above, but for a different reason. A real producer spells "no current selection" as \ffres25 (FFDataBits' own undefined-selection sentinel) plus a genuine \ffdefres0, not by omitting both -- but this writer cannot emit that exact form without reintroducing the ambiguity an earlier round of it removed: formFieldContentControl in constructs.ts deliberately falls a sentinel \ffres25 through to \ffdefres, precisely so a real PHPRtfLite-produced checkbox's sentinel-plus-meaningful-default pair round-trips as that meaningful default rather than as "unchecked", and that same fallback would read a written \ffdefres0 back as "option 0 is selected" rather than "nothing is selected" for a dropdown with no real selection at all. Omitting both fields instead sidesteps that: read.test.ts's own "leaves a FORMDROPDOWN's value unset when neither \ffres nor \ffdefres is present at all" fixture is a hand-edited variant of a real PHPRtfLite fixture (with its \ffres25\ffdefres0 pair deleted), which proves only that THIS reader tolerates the omission cleanly -- not that a real producer would ever write it that way -- but that is exactly the property this writer needs: a form its own reader decodes back to value:undefined with no ambiguity, at the cost of not matching what a real producer would have written for the identical "nothing selected" case. [MS-DOC] 2.9.78 FFData.wDef "MUST exist if and only if bits.iType is iTypeChck (1) or iTypeDrop (2)" is a real MS-DOC production rule this omission does not satisfy: a producer omitting wDef is spec-noncompliant but demonstrably tolerated in practice, since this reader (built to survive real-world RTF, not just conformant RTF) decodes the omission cleanly. Converging both no-match branches onto the identical "omit both fields" output also makes the round-trip a genuine fixed point: an unmatched-or-unset value always reads back as value:undefined, and writing that again reproduces byte-identical output, with no second-pass drift onto a fabricated default.
    if (options !== undefined) {
      for (const option of options) {
        out += `{\\*\\ffl ${escapeText(option)}}`;
      }
    }
    if (descriptor.checked !== undefined) {
      // The identical sibling-gap shape as the checkbox branch's own dropped `options` above and the plainText branch's own dropped `checked` below: `checked` is the checkbox/radio boolean, and a dropDown descriptor carrying one has recorded a fact this control type has no concept of at all -- reported rather than silently ignored, matching this function's own treatment of every other recorded-but-unrepresentable field on every OTHER controlType branch.
      sink({
        code: RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED,
        severity: "warning",
        message: `a dropDown contentControl's checked state (${String(descriptor.checked)}) is dropped: a dropdown has no boolean checked state at all, in RTF or in the harmonised contentControl vocabulary itself`,
      });
    }
  } else if (descriptor.controlType === "plainText") {
    // [MS-DOC] 2.9.78 FFData.xstzTextDef, verbatim: "An optional Xstz that specifies the default text of this textbox. This structure MUST exist if and only if bits.iType is iTypeTxt (0)." RTF 1.9.1's own `\ffdeftext` ("Default text for text field. This is a destination control word.") is its serialisation. This is real, reachable data: documents.js's own PDF AcroForm-to-contentControl reconstruction hands a plainText control exactly `{controlType:'plainText', value, ...}` for a real `/V` string, so a plainText descriptor's `value` is not hypothetical input -- note that this is a WRITE-only use of `value`: the read side deliberately does not restore `\ffdeftext` back onto `value` (see constructs.ts's own formFieldContentControl), since a field's default/reset text is not its current value, so a document built from a descriptor carrying this `value` does not read back with that same `value` on a round trip. Minted only when the descriptor actually carries one -- omitted, like the dropdown branch's own "nothing to name" cases above, when no value was ever recorded, rather than mint an empty `{\*\ffdeftext}` FFData.wDef's own presence rule would technically require: this writer already diverges from that binary-structure requirement for the identical round-trip-determinism reason the dropdown branch's own wDef note above explains.
    if (descriptor.value !== undefined) {
      out += `{\\*\\ffdeftext ${escapeText(descriptor.value)}}`;
    }
    if (descriptor.checked !== undefined) {
      // The identical sibling-gap shape as the checkbox branch's own dropped `options` above, mirrored: `checked` is the checkbox/radio boolean, and a plainText descriptor carrying one has recorded a fact this control type has no concept of at all -- reported rather than silently ignored, matching this function's own treatment of every other recorded-but-unrepresentable field.
      sink({
        code: RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED,
        severity: "warning",
        message: `a plainText contentControl's checked state (${String(descriptor.checked)}) is dropped: a text field has no boolean checked state at all, in RTF or in the harmonised contentControl vocabulary itself`,
      });
    }
    if (descriptor.options !== undefined) {
      // Same shape again: `options` is the dropDown/comboBox choice list, and a plainText field has no list to hold it.
      sink({
        code: RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED,
        severity: "warning",
        message: `a plainText contentControl's options list (${String(descriptor.options.length)} entries) is dropped: a text field has no choice list at all, in RTF or in the harmonised contentControl vocabulary itself`,
      });
    }
  }
  // [MS-DOC] 2.9.79 FFDataBits.fProt, verbatim: "A bit that specifies whether the form field is protected and its value cannot be changed" -- RTF 1.9.1's own Form Fields table states the identical fact, "\ffprotN: 1 if this field is protected, 0 otherwise." It is a single content-protection bit, so it captures the 'content' and 'both' halves of ContentControlLock exactly (both lock the field's own value); 'container' locks only the control's own removal, a fact RTF's form-field vocabulary has no bit for at all -- a legacy form field is ordinary document text with no separate "delete the control" operation to protect in the first place -- so a 'container' lock is reported through the diagnostic sink below rather than silently folded into "unprotected". Written as the explicit `\ffprot1` form rather than a bare `\ffprot`: `\ffhaslistbox` above is a genuine bare-when-true bit with no N-parameter spelling at all, but `\ffprot` is an N-parameterised bit like `\ffres`/`\ffdefres`. No real producer-derived fixture in this package's own read.test.ts settles which spelling a genuine producer actually writes for this bit family -- its one bare-`\ffprot` case ("reads a bare \ffprot (no explicit parameter) as protected") is a hand-written synthetic input proving this reader's own toggle-convention tolerance, not evidence of what any real producer emits, and every fixture that IS derived from a real producer (PHPRtfLite) happens to write the explicit N form for the sibling `\ffres`/`\ffdefres` bits but says nothing about `\ffprot` specifically, since none of those fixtures sets it at all. So writing `\ffprot1` here costs one character and sidesteps outright whether an absent parameter on a bit of this family defaults to on (as it does for `\b`/`\i`) or to off (as RTF's own general reader-convention default for an unspecified numeric argument states), rather than resting the writer's own correctness on which reading is right.
  if (descriptor.lock === "content" || descriptor.lock === "both") {
    out += "\\ffprot1";
  }
  if (descriptor.lock === "container" || descriptor.lock === "both") {
    const message =
      descriptor.lock === "both"
        ? `a contentControl's 'both' lock also protects the control from removal, which RTF's \\ffprot ([MS-DOC] 2.9.79 FFDataBits.fProt) cannot express -- \\ffprot1 above already carries the content-protection half of 'both', so only the container-removal half is dropped here`
        : `a contentControl's 'container' lock protects the control from removal, which RTF's \\ffprot ([MS-DOC] 2.9.79 FFDataBits.fProt) cannot express at all -- it names only whether the field's own value can be changed, and a 'container' lock leaves that value editable, so nothing is written for it and the whole lock is dropped, not merely half of it`;
    sink({
      code: RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED,
      severity: "warning",
      message,
    });
  }
  // [MS-DOC] 2.9.78 FFData.xstzHelpText, gated by FFDataBits.fOwnHelp ("A bit that specifies whether the form field has custom help text in FFData.xstzHelpText. If fOwnHelp is 0, FFData.xstzHelpText contains an empty or auto-generated string."): RTF 1.9.1's own \ffhelptext ("Help text (string). This is a destination control word.") is this vocabulary's one human-readable descriptive-text slot for a form field, and the closest analogue RTF has to docx `w:alias`/PDF AcroForm's `/TU` alternate description -- both are a label shown to whoever is looking at the control, distinct from the control's own machine-readable name that \ffname/`w:tag`/AcroForm's `/T` already carry. \ffownhelp1 is minted alongside it, mirroring what a real producer does whenever xstzHelpText genuinely carries author-set text rather than an "empty or auto-generated string".
  if (descriptor.alias !== undefined && descriptor.alias.length > 0) {
    out += `\\ffownhelp1{\\*\\ffhelptext ${escapeText(descriptor.alias)}}`;
  }
  if (descriptor.tag !== undefined && descriptor.tag.length > 0) {
    out += `{\\*\\ffname ${escapeText(descriptor.tag)}}`;
  }
  return out;
}

// The whole field's own open: `{\field{\*\fldinst KEYWORD {\*\formfield PAYLOAD}}{\fldrslt `, left unclosed so the runs the extent wraps land inside \fldrslt's own destination -- the matching `}}` (closing \fldrslt, then \field) is written wherever the extent's endRun falls. Returns undefined for a controlType FORM_FIELD_SPEC does not cover, so the caller can fall back to the ordinary construct-gap diagnostic instead of minting nothing silently.
function formFieldOpenGroup(
  descriptor: ContentControlDescriptor,
  sink: RtfDiagnosticSink,
): string | undefined {
  const spec = FORM_FIELD_SPEC.get(descriptor.controlType);
  if (spec === undefined) {
    return undefined;
  }
  return `{\\field{\\*\\fldinst ${spec.instruction} {\\*\\formfield{${formFieldPayload(descriptor, spec.fftype, sink)}}}}{\\fldrslt `;
}

// Each ProvenanceChange's own <chrev> spelling. formatChange is the one with no flag of its own -- "\crauthN ... Note This keyword is used to indicate formatting revisions, such as bold, italic" -- so its author control word is what states that the run carries one at all.
const CHREV_CONTROL_WORDS: Readonly<
  Record<ProvenanceChange, { flag: string; author: string; date: string }>
> = {
  insertion: { flag: "\\revised", author: "revauth", date: "revdttm" },
  deletion: { flag: "\\deleted", author: "revauthdel", date: "revdttmdel" },
  moveFrom: { flag: "\\mvf", author: "mvauth", date: "mvdate" },
  moveTo: { flag: "\\mvt", author: "mvauth", date: "mvdate" },
  formatChange: { flag: "", author: "crauth", date: "crdate" },
};

// The provenance descriptors whose half-open range covers this run index. A point extent (startRun === endRun) covers no run, so it names a boundary rather than any text and contributes no character property.
function revisionsCovering(
  extents: readonly RunConstructExtent[],
  index: number,
): ProvenanceDescriptor[] {
  return extents
    .filter(
      (extent) =>
        extent.descriptor.kind === "provenance" &&
        extent.startRun <= index &&
        index < extent.endRun,
    )
    .map((extent) => extent.descriptor)
    .filter(
      (descriptor): descriptor is ProvenanceDescriptor =>
        descriptor.kind === "provenance",
    );
}

// The order <celldef> states its four sides in.
const CELL_BORDER_ORDER = ["top", "left", "bottom", "right"] as const;

// Which [row][cell] positions a rowSpan above them covers, so each can be written with \clvmrg. A covered cell is still a cell in its row -- that is the shape every reader in this family produces and consumes -- so this marks positions rather than removing them.
function verticalMergeCoverage(table: ContentTable): boolean[][] {
  const covered = table.rows.map((row) => row.cells.map(() => false));
  for (const [rowIndex, row] of table.rows.entries()) {
    for (const [cellIndex, cell] of row.cells.entries()) {
      const rowSpan = cell.rowSpan ?? 1;
      for (let next = 1; next < rowSpan; next += 1) {
        const target = covered[rowIndex + next];
        if (target !== undefined && cellIndex < target.length) {
          target[cellIndex] = true;
        }
      }
    }
  }
  return covered;
}

function nameOf(descriptor: ConstructDescriptor): string {
  return isBookmarkAnchor(descriptor) ? descriptor.name : "";
}

function isContentControlExtent(
  extent: RunConstructExtent,
): extent is RunConstructExtent & { descriptor: ContentControlDescriptor } {
  return extent.descriptor.kind === "contentControl";
}

// Why a given descriptor kind has no RTF spelling, stated per kind rather than as one generic sentence, because the reasons genuinely differ: two of them are format gaps this package could close and two are gaps in RTF itself.
function describeConstructGap(descriptor: ConstructDescriptor): string {
  switch (descriptor.kind) {
    case "contentControl":
      return "block-scoped structured-document-tag equivalent -- a run-scoped plainText/checkbox/dropDown form field mints its own \\*\\formfield instead; any other controlType (richText, comboBox, date, and the rest) has no \\*\\formfield spelling at all";
    case "provenance":
      return "block-scoped revision mark: its <chrev> production is a character property, so a tracked change reaches RTF only as a run-level extent";
    case "anchor":
      return `spelling for a '${descriptor.anchorType}' anchor, whose body would need the note or annotation destination this reader does not place`;
    case "field":
      return "block-scoped field: a field is a character-stream construct, written from a run's own hyperlink rather than from a block marker";
    case "link":
      return "block-scoped link; an external target rides ContentRun.hyperlink instead";
    default:
      return "equivalent construct";
  }
}

class RtfWriter {
  private out = "";
  // One entry per open block-scoped construct, holding the bookmark name whose {\*\bkmkend ...} the matching close must write, or undefined for a construct with no RTF spelling. Tracked even for the undefined case so the two halves of a marker pair stay in step.
  private readonly openConstructs: (string | undefined)[] = [];

  constructor(
    private readonly tables: DocumentTables,
    private readonly sink: RtfDiagnosticSink,
    private readonly lineEnding: string,
  ) {}

  raw(text: string): void {
    this.out += text;
  }

  line(text: string): void {
    this.out += text + this.lineEnding;
  }

  get text(): string {
    return this.out;
  }

  writeHeader(document: WordprocessingDocument): void {
    this.raw(`{\\rtf1\\ansi\\ansicpg${String(OUTPUT_CODEPAGE)}\\deff0\\uc1`);
    this.writeDocumentGeometry(document);
    this.writeFontTable();
    this.writeColorTable();
    this.writeStyleSheet();
    this.writeListTables();
    this.writeRevisionTable();
    this.writeInfoGroup(document);
    this.line("");
  }

  private writeFontTable(): void {
    this.raw("{\\fonttbl");
    for (const [name, index] of [...this.tables.fonts].sort(
      (left, right) => left[1] - right[1],
    )) {
      this.raw(`{\\f${String(index)}\\fnil\\fcharset0 ${escapeText(name)};}`);
    }
    this.raw("}");
  }

  private writeColorTable(): void {
    if (this.tables.colors.size === 0) {
      return;
    }
    // The leading semicolon is the auto colour at index 0, exactly as the spec's own example writes it.
    this.raw("{\\colortbl;");
    for (const [hex] of [...this.tables.colors].sort(
      (left, right) => left[1] - right[1],
    )) {
      const red = Number.parseInt(hex.slice(0, 2), 16);
      const green = Number.parseInt(hex.slice(2, 4), 16);
      const blue = Number.parseInt(hex.slice(4, 6), 16);
      this.raw(
        `\\red${String(red)}\\green${String(green)}\\blue${String(blue)};`,
      );
    }
    this.raw("}");
  }

  private writeStyleSheet(): void {
    if (this.tables.headingStyles.size === 0) {
      return;
    }
    this.raw("{\\stylesheet{\\s0\\snext0 Normal;}");
    for (const [level, handle] of [...this.tables.headingStyles].sort(
      (left, right) => left[0] - right[0],
    )) {
      // \outlinelevelN is 0-based, so a level-1 heading declares outline level 0 -- the inverse of what the reader does with it.
      this.raw(
        `{\\s${String(handle)}\\sbasedon0\\snext0\\outlinelevel${String(level - 1)} heading ${String(level)};}`,
      );
    }
    this.raw("}");
  }

  private writeListTables(): void {
    if (this.tables.lists.size === 0) {
      return;
    }
    const entries = [...this.tables.lists.values()].sort(
      (left, right) => left.index - right.index,
    );
    this.raw("{\\*\\listtable");
    for (const entry of entries) {
      const bullet = entry.definition.type === "bullet";
      const numberFormat = bullet
        ? LEVEL_NUMBER_FORMAT_BULLET
        : LEVEL_NUMBER_FORMAT_ARABIC;
      const levelText = bullet ? BULLET_LEVEL_TEXT : ARABIC_LEVEL_TEXT;
      const levelNumbers = bullet ? "" : "\\'01";
      this.raw(`{\\list\\listtemplateid${String(entry.index)}\\listhybrid`);
      // Nine levels, as \listhybrid requires ("Present if the list has 9 levels"), each indented one step further than the last so a consumer's own rendering of a nested item matches the \ilvlN this writer emits for it.
      for (let level = 0; level < 9; level += 1) {
        const indent = LIST_LEVEL_INDENT_TWIPS * (level + 1);
        this.raw(
          `{\\listlevel\\levelnfc${String(numberFormat)}\\levelnfcn${String(numberFormat)}` +
            `\\leveljc0\\leveljcn0\\levelfollow0\\levelstartat${String(entry.definition.start)}` +
            `\\levelspace0\\levelindent0{\\leveltext${levelText};}{\\levelnumbers${levelNumbers};}` +
            `\\fi-${String(LIST_MARKER_HANG_TWIPS)}\\li${String(indent)}\\lin${String(indent)}}`,
        );
      }
      this.raw(`\\listid${String(1000 + entry.index)}}`);
    }
    this.raw("}{\\*\\listoverridetable");
    for (const entry of entries) {
      this.raw(
        `{\\listoverride\\listid${String(1000 + entry.index)}\\listoverridecount0\\ls${String(entry.index)}}`,
      );
    }
    this.raw("}");
  }

  // "\*\revtbl -- This group consists of subgroups that each identify the author of a revision in the document, as in {Author1;}". Written only when a revision actually names an author, since the table with nothing but its own "Unknown" placeholder states nothing.
  private writeRevisionTable(): void {
    if (this.tables.revisionAuthors.size <= 1) {
      return;
    }
    this.raw("{\\*\\revtbl");
    for (const [author] of [...this.tables.revisionAuthors].sort(
      (left, right) => left[1] - right[1],
    )) {
      this.raw(`{${escapeText(author)};}`);
    }
    this.raw("}");
  }

  private writeInfoGroup(document: WordprocessingDocument): void {
    const { title, author, subject, keywords } = document.metadata;
    const fields: string[] = [];
    if (title !== undefined) fields.push(`{\\title ${escapeText(title)}}`);
    if (author !== undefined) fields.push(`{\\author ${escapeText(author)}}`);
    if (subject !== undefined)
      fields.push(`{\\subject ${escapeText(subject)}}`);
    if (keywords !== undefined && keywords.length > 0) {
      fields.push(`{\\keywords ${escapeText(keywords.join("; "))}}`);
    }
    if (fields.length > 0) {
      this.raw(`{\\info${fields.join("")}}`);
    }
  }

  // The document-level page geometry, stated once in the header from the first section's own. RTF states geometry twice -- \paperwN/\marglN for the document, \pgwsxnN/\marglsxnN per section (RTF 1.9.1, "Document Formatting Properties" and "Section Formatting Properties") -- and a reader that understands neither the section family nor multiple sections still lays the document out on the right paper this way.
  writeDocumentGeometry(document: WordprocessingDocument): void {
    const first = document.sections[0];
    if (first === undefined) {
      return;
    }
    this.raw(
      `\\paperw${String(pointsToTwips(first.pageSize.widthPt))}` +
        `\\paperh${String(pointsToTwips(first.pageSize.heightPt))}` +
        `\\margl${String(pointsToTwips(first.margins.leftPt))}` +
        `\\margr${String(pointsToTwips(first.margins.rightPt))}` +
        `\\margt${String(pointsToTwips(first.margins.topPt))}` +
        `\\margb${String(pointsToTwips(first.margins.bottomPt))}`,
    );
  }

  writeSection(section: ContentSection, isFirst: boolean): void {
    if (!isFirst) {
      // "\sect End of section and paragraph." The break kind belongs to the section it starts, so it is written after the \sect that opens it, alongside the rest of that section's <secfmt>.
      this.line("\\sect");
    }
    this.line(
      `\\sectd${SECTION_BREAK_CONTROL_WORDS.get(section.breakType ?? "") ?? ""}` +
        `\\pgwsxn${String(pointsToTwips(section.pageSize.widthPt))}` +
        `\\pghsxn${String(pointsToTwips(section.pageSize.heightPt))}` +
        `\\marglsxn${String(pointsToTwips(section.margins.leftPt))}` +
        `\\margrsxn${String(pointsToTwips(section.margins.rightPt))}` +
        `\\margtsxn${String(pointsToTwips(section.margins.topPt))}` +
        `\\margbsxn${String(pointsToTwips(section.margins.bottomPt))}`,
    );
    this.writeBlocks(section.blocks);
  }

  writeBlocks(blocks: readonly ContentBlock[]): void {
    for (const block of blocks) {
      this.writeBlock(block);
    }
  }

  private writeBlock(block: ContentBlock): void {
    switch (block.kind) {
      case "paragraph":
        this.writeParagraph(block, false);
        return;
      case "table":
        this.writeTable(block);
        return;
      case "image":
        this.writeImageParagraph(block.base64, block);
        return;
      case "pageBreak":
        this.line("\\page\\pard");
        return;
      case "embeddedObject":
        this.sink({
          code: RtfDiagnosticCodes.EMBEDDED_OBJECT_DROPPED,
          severity: "warning",
          message: `an embedded ${block.objectKind} object is dropped: writing it as an RTF \\object would need the OLE container this package does not build`,
        });
        return;
      case "constructStart":
        this.openConstruct(block.descriptor);
        return;
      case "constructEnd":
        this.closeConstruct();
        return;
      default:
        return;
    }
  }

  // A block-scoped construct's open marker. Only a bookmark anchor has an RTF spelling; every other descriptor kind degrades, but its extent is still tracked so the matching close knows there is nothing to write for it -- a marker pair is balanced by position, and losing track of one half would strand the other.
  private openConstruct(descriptor: ConstructDescriptor): void {
    if (!isBookmarkAnchor(descriptor)) {
      this.sink({
        code: RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED,
        severity: "warning",
        message: `a ${descriptor.kind} construct is dropped: RTF has no ${describeConstructGap(descriptor)}`,
      });
      this.openConstructs.push(undefined);
      return;
    }
    this.openConstructs.push(descriptor.name);
    this.line(bookmarkStartGroup(descriptor));
  }

  private closeConstruct(): void {
    const name = this.openConstructs.pop();
    if (name !== undefined) {
      this.line(`{\\*\\bkmkend ${escapeText(name)}}`);
    }
  }

  // `inTable` adds the \intbl every paragraph inside a table row must carry or inherit.
  private writeParagraph(paragraph: ContentParagraph, inTable: boolean): void {
    this.raw("\\pard\\plain");
    if (inTable) {
      this.raw("\\intbl");
    }
    this.raw(this.paragraphProperties(paragraph));
    this.raw(" ");
    // A run-scoped construct is a boundary between runs, not a property of one, so its two halves are emitted at the run positions its half-open range names. Closes at a position run before opens, matching the block-marker rule: an extent ending where another begins must not enclose it.
    const bookmarks = (paragraph.constructs ?? []).filter((extent) =>
      isBookmarkAnchor(extent.descriptor),
    );
    const revisions = (paragraph.constructs ?? []).filter(
      (extent) => extent.descriptor.kind === "provenance",
    );
    const formFields = (paragraph.constructs ?? []).filter(
      isContentControlExtent,
    );
    // Which of formFields actually had their open half written -- see writeFormFieldBoundaries below for why the close loop must consult this rather than assume every extent that reaches its endRun was opened.
    const openedFormFields = new Set<RunConstructExtent>();
    for (const [index, run] of paragraph.runs.entries()) {
      this.writeRunBoundaries(bookmarks, index);
      this.writeFormFieldBoundaries(formFields, index, openedFormFields);
      this.writeRun(run, revisionsCovering(revisions, index));
    }
    this.writeRunBoundaries(bookmarks, paragraph.runs.length);
    this.writeFormFieldBoundaries(
      formFields,
      paragraph.runs.length,
      openedFormFields,
    );
    // A structural backstop, not a normal-path event: writeFormFieldBoundaries above is only ever called for positions 0..paragraph.runs.length, so an extent whose own endRun falls outside that range (beyond the paragraph's last run, or before its own startRun -- see that method's own comment) can leave its open half written with no position left to match it to a close. Draining here makes the writer structurally incapable of emitting an unmatched field group regardless of what ranges an extent is handed, rather than trusting every caller to hand it only well-formed ones.
    this.drainOpenedFormFields(openedFormFields);
    if (!inTable) {
      this.line("\\par");
    }
  }

  private drainOpenedFormFields(opened: Set<RunConstructExtent>): void {
    // Only the count matters here -- every remaining entry closes identically ("}}"), so there is nothing to read off any individual extent.
    for (let remaining = opened.size; remaining > 0; remaining -= 1) {
      this.raw("}}");
    }
    opened.clear();
  }

  private writeRunBoundaries(
    extents: readonly RunConstructExtent[],
    position: number,
  ): void {
    for (const extent of extents) {
      if (extent.endRun === position && extent.startRun !== position) {
        this.raw(`{\\*\\bkmkend ${escapeText(nameOf(extent.descriptor))}}`);
      }
    }
    for (const extent of extents) {
      if (extent.startRun === position) {
        this.raw(bookmarkStartGroup(extent.descriptor));
        // A point anchor -- startRun === endRun -- opens and closes at the same boundary, so its end is written here rather than waiting for a later position that never differs.
        if (extent.endRun === position) {
          this.raw(`{\\*\\bkmkend ${escapeText(nameOf(extent.descriptor))}}`);
        }
      }
    }
  }

  // A form field's own two halves, matching writeRunBoundaries above but wrapping rather than flagging: the open is `{\field...}{\fldrslt ` left unclosed, so every run the extent covers lands inside \fldrslt's own destination, and the close is the matching `}}`. A controlType FORM_FIELD_SPEC does not cover degrades through describeConstructGap instead of minting nothing silently -- and, critically, mints NO open braces for that extent, so the close loop must only ever emit "}}" for an extent whose open half was actually written (tracked in `opened`). Emitting the close unconditionally would leave every degraded extent's would-be open half missing while its close half still lands, corrupting the document's brace balance for everything written afterwards.
  //
  // `opened` holds exactly the extents currently open with no close yet written -- an entry is removed the moment its close is emitted, by either branch below -- which is what lets writeParagraph's own drainOpenedFormFields (after the final call for a paragraph) tell a genuinely still-open extent apart from one already closed. This matters for two shapes of malformed-looking input this writer must still round-trip to balanced output rather than crash or corrupt: an extent whose endRun exceeds paragraph.runs.length (this method is only ever called for positions 0..runs.length, so such a close position never arrives), and an extent with startRun > endRun (the close loop for its endRun runs before the open loop ever reaches its startRun, so `opened.has(extent)` is false there and the close is correctly skipped as "not yet opened" -- but nothing then revisits that endRun once the open finally happens at the later startRun position, so the close never fires from this method alone).
  private writeFormFieldBoundaries(
    extents: readonly (RunConstructExtent & {
      descriptor: ContentControlDescriptor;
    })[],
    position: number,
    opened: Set<RunConstructExtent>,
  ): void {
    for (const extent of extents) {
      if (
        extent.endRun === position &&
        extent.startRun !== position &&
        opened.has(extent)
      ) {
        this.raw("}}");
        opened.delete(extent);
      }
    }
    for (const extent of extents) {
      if (extent.startRun !== position) {
        continue;
      }
      const open = formFieldOpenGroup(extent.descriptor, this.sink);
      if (open === undefined) {
        this.sink({
          code: RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED,
          severity: "warning",
          message: `a contentControl construct is dropped: RTF has no ${describeConstructGap(extent.descriptor)}`,
        });
        continue;
      }
      this.raw(open);
      opened.add(extent);
      if (extent.endRun === position) {
        this.raw("}}");
        opened.delete(extent);
      }
    }
  }

  private paragraphProperties(paragraph: ContentParagraph): string {
    let out = "";
    const level =
      paragraph.headingLevel === undefined
        ? undefined
        : clampHeadingLevel(paragraph.headingLevel);
    const styleHandle =
      level === undefined ? undefined : this.tables.headingStyles.get(level);
    if (styleHandle !== undefined && level !== undefined) {
      out += `\\s${String(styleHandle)}\\outlinelevel${String(level - 1)}`;
    }
    const alignment =
      paragraph.alignment === undefined
        ? undefined
        : ALIGNMENT_CONTROL_WORDS.get(paragraph.alignment);
    if (alignment !== undefined) {
      out += alignment;
    }
    const list = paragraph.list;
    if (list !== undefined) {
      const numId = list.numId;
      const entry =
        numId === undefined ? undefined : this.tables.lists.get(numId);
      if (entry === undefined) {
        this.sink({
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
      // RTF states a line-spacing multiple in 240ths of a line, paired with \slmult1 -- the inverse of the reader's own conversion.
      out += `\\sl${String(Math.round(paragraph.lineSpacing * 240))}\\slmult1`;
    }
    if (paragraph.pageBreakBefore === true) {
      out += "\\pagebb";
    }
    return out;
  }

  private writeRun(
    run: ContentRun,
    revisions: readonly ProvenanceDescriptor[] = [],
  ): void {
    const properties =
      this.runProperties(run) + this.revisionProperties(revisions);
    const body = `${properties}${properties.length > 0 ? " " : ""}${escapeText(run.text)}`;
    if (run.hyperlink === undefined) {
      this.raw(`{${body}}`);
      return;
    }
    // The <links> field production: an instruction destination naming HYPERLINK and a result destination holding what is shown. A reader that does not understand fields still shows the result, which is why the text lives there rather than in the instruction.
    this.raw(
      `{\\field{\\*\\fldinst{HYPERLINK "${escapeText(run.hyperlink)}"}}{\\fldrslt{${body}}}}`,
    );
  }

  // The <chrev> control words for every revision covering this run. Each run is already written inside its own group, so the properties turn themselves off at the closing brace exactly as \b and \i do -- there is no "off" spelling to emit.
  private revisionProperties(
    revisions: readonly ProvenanceDescriptor[],
  ): string {
    let out = "";
    for (const descriptor of revisions) {
      const author = descriptor.author;
      const authorIndex =
        author === undefined
          ? undefined
          : this.tables.revisionAuthors.get(author);
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

  private runProperties(run: ContentRun): string {
    let out = "";
    const fontIndex =
      run.fontFamily === undefined
        ? undefined
        : this.tables.fonts.get(run.fontFamily);
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
    const colorIndex = colorIndexOf(run.color, this.tables.colors);
    if (colorIndex !== undefined) {
      out += `\\cf${String(colorIndex)}`;
    }
    return out;
  }

  private writeTable(table: ContentTable): void {
    // Which cells a vertical merge covers, derived once for the whole table: RTF states a continuation with \clvmrg on the covered cell itself, while ContentTableCell states the span on its anchor, so the covered positions have to be computed before any row is written.
    const covered = verticalMergeCoverage(table);
    for (const [rowIndex, row] of table.rows.entries()) {
      // "\cellxN Defines the right boundary of a cell", cumulative from the row's own left edge, so the boundaries are a running total of the column widths.
      //
      // A horizontally merged cell occupies one slot in the content model but several grid columns in RTF, and each column needs its own \cellxN and its own \cell mark -- the anchor carrying \clmgf and each continuation \clmrg. So one cell here can produce several of both.
      let right = 0;
      let column = 0;
      const definitions: string[] = [];
      const marks: { cell: ContentTableCell; empty: boolean }[] = [];
      for (const [cellIndex, cell] of row.cells.entries()) {
        const colSpan = cell.colSpan ?? 1;
        for (let offset = 0; offset < colSpan; offset += 1) {
          right += pointsToTwips(table.columnWidthsPt[column] ?? 0);
          column += 1;
          definitions.push(
            this.cellDefinition(
              cell,
              covered[rowIndex]?.[cellIndex] === true,
              colSpan > 1
                ? offset === 0
                  ? "mergeFirst"
                  : "mergeContinuation"
                : "single",
              right,
            ),
          );
          marks.push({ cell, empty: offset > 0 });
        }
      }
      const rowDefinition = `\\trowd\\trgaph108\\trleft0${definitions.join("")}`;
      // Word 2002 onward writes the row properties both before and after the row, which the spec explicitly calls out as the shape a reader should not assume otherwise; emitting both makes the output readable by either kind of reader.
      this.line(rowDefinition);
      for (const mark of marks) {
        this.writeCellBlocks(mark.empty ? [] : mark.cell.blocks);
        this.raw("\\cell");
      }
      this.line(`${rowDefinition}\\row`);
    }
    this.line("\\pard");
  }

  // One <celldef>: the cell's merge flags, borders and shading, closed by its own \cellxN. Written in the grammar's own order so a reader walking it left to right sees each border's side before the <brdr> describing it.
  private cellDefinition(
    cell: ContentTableCell,
    isVerticalContinuation: boolean,
    horizontal: "single" | "mergeFirst" | "mergeContinuation",
    rightTwips: number,
  ): string {
    let out = "";
    if (isVerticalContinuation) {
      out += "\\clvmrg";
    } else if ((cell.rowSpan ?? 1) > 1) {
      out += "\\clvmgf";
    }
    if (horizontal === "mergeFirst") {
      out += "\\clmgf";
    } else if (horizontal === "mergeContinuation") {
      // A continuation column states only that it is merged into the one before it; the borders and shading belong to the anchor, and restating them here would double-draw the merged cell's own edges.
      return `${out}\\clmrg\\cellx${String(rightTwips)}`;
    }
    const borders = cell.borders;
    if (borders !== undefined) {
      for (const side of CELL_BORDER_ORDER) {
        const border = borders[side];
        if (border !== undefined) {
          out += borderControlWords(
            side,
            border,
            colorIndexOf(border.color, this.tables.colors),
          );
        }
      }
    }
    if (cell.background !== undefined) {
      const index = colorIndexOf(cell.background, this.tables.colors);
      if (index !== undefined) {
        out += `\\clcbpat${String(index)}`;
      }
    }
    return `${out}\\cellx${String(rightTwips)}`;
  }

  private writeCellBlocks(blocks: readonly ContentBlock[]): void {
    const paragraphs = blocks.filter(
      (block): block is ContentParagraph => block.kind === "paragraph",
    );
    if (paragraphs.length === 0) {
      this.raw("\\pard\\plain\\intbl ");
      return;
    }
    for (const [index, paragraph] of paragraphs.entries()) {
      this.writeParagraph(paragraph, true);
      if (index < paragraphs.length - 1) {
        this.raw("\\par");
      }
    }
  }

  private writeImageParagraph(
    base64: string,
    image: Pick<ContentImageBlock, "format" | "widthPt" | "heightPt">,
  ): void {
    // RTF's \pict destination has no picture-type keyword for either format: it predates SVG entirely, and GIF is not among the classic \emfblip/\pngblip/\jpegblip/\macpict/\pmmetafile/\wmetafile/\dibitmap/\wbitmap set. Writing one as \jpegblip (as this writer once silently did for anything that was not exactly "png") would mislabel the payload's own encoding to any reader that takes the keyword at its word.
    if (image.format === "svg" || image.format === "gif") {
      this.sink({
        code: RtfDiagnosticCodes.UNSUPPORTED_PICTURE_FORMAT,
        severity: "warning",
        message: `an image block in ${image.format} format cannot be written: RTF's \\pict destination has no picture-type keyword for it, so the image is dropped rather than mislabelled as a format it is not`,
      });
      return;
    }
    const bytes = base64ToBytes(base64);
    if (bytes === undefined || bytes.length === 0) {
      this.sink({
        code: RtfDiagnosticCodes.UNSUPPORTED_PICTURE_FORMAT,
        severity: "warning",
        message:
          "an image block's base64 payload could not be decoded, so no \\pict destination is written for it",
      });
      return;
    }
    const widthTwips = pointsToTwips(image.widthPt);
    const heightTwips = pointsToTwips(image.heightPt);
    this.line(
      `\\pard\\plain {\\*\\shppict{\\pict\\${image.format === "png" ? "pngblip" : "jpegblip"}` +
        `\\picwgoal${String(widthTwips)}\\pichgoal${String(heightTwips)}${this.lineEnding}` +
        `${wrapHex(bytesToHex(bytes), this.lineEnding)}}}\\par`,
    );
  }
}

function colorIndexOf(
  color: Color | undefined,
  colors: ReadonlyMap<string, number>,
): number | undefined {
  return color === undefined ? undefined : colors.get(colorToRgbHex(color));
}

// The spec's own transmission advice -- "you may also want to insert a carriage-return/line feed pair without backslashes at least every 255 characters" -- applied to the one payload long enough to matter. A reader ignores the breaks entirely.
const HEX_LINE_LENGTH = 128;

function wrapHex(hex: string, lineEnding: string): string {
  const lines: string[] = [];
  for (let index = 0; index < hex.length; index += HEX_LINE_LENGTH) {
    lines.push(hex.slice(index, index + HEX_LINE_LENGTH));
  }
  return lines.join(lineEnding);
}

// The return type is the narrower Uint8Array<ArrayBuffer>, not the default Uint8Array<ArrayBufferLike>, matching document-schema.js's own ProvidedFont.bytes and documents.js's package codecs: a SharedArrayBuffer-backed view is not something this writer can produce, and z.instanceof(Uint8Array)'s own inferred output type is the narrow one, so widening here would make the z.codec() pair in src/codec.ts fail to typecheck.
function encodeAscii(text: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) {
    out[index] = text.charCodeAt(index) & 0x7f;
  }
  return out;
}

export function writeRtfContent(
  document: ContentDocument,
  options: WriteRtfOptions = {},
): Uint8Array<ArrayBuffer> {
  options.signal?.throwIfAborted();
  if (document.kind !== "wordprocessing") {
    throw new RtfUnsupportedDocumentKindError(document.kind);
  }
  const sink: RtfDiagnosticSink =
    options.sink ??
    (() => {
      /* discards every diagnostic */
    });
  const tables = collectTables(document);
  const writer = new RtfWriter(tables, sink, options.lineEnding ?? "\n");
  writer.writeHeader(document);
  for (const [index, section] of document.sections.entries()) {
    writer.writeSection(section, index === 0);
  }
  writer.raw("}");
  // The output is 7-bit ASCII by construction: every reserved character is escaped and every non-ASCII character left as a \uN, so encoding it one byte per code unit is exact rather than lossy.
  return encodeAscii(writer.text);
}

export function writeRtf(
  documentPackage: DocumentTree,
  options: WriteRtfOptions = {},
): Uint8Array<ArrayBuffer> {
  const sink = options.sink;
  if (sink !== undefined && hasPackageTables(documentPackage)) {
    sink({
      code: RtfDiagnosticCodes.PACKAGE_TABLE_DROPPED,
      severity: "info",
      message:
        "the package's definitions/layers/attachments/destinations tables are dropped: flattening resolves style refs, and RTF has no destination for the remaining tenants",
    });
  }
  return writeRtfContent(flattenTree(documentPackage), options);
}

function hasPackageTables(documentPackage: DocumentTree): boolean {
  return (
    documentPackage.definitions !== undefined ||
    documentPackage.layers !== undefined ||
    documentPackage.attachments !== undefined ||
    documentPackage.destinations !== undefined
  );
}
