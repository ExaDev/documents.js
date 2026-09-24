// The reader's own state shapes: the per-destination/character/paragraph/section/picture/form-field/object/bookmark/group state RTF 1.9.1's "Conventions of an RTF Reader" describes riding the group stack, plus the small constant tables and pure helpers that build or interpret them. Shared by read-builder.ts (ContentBuilder, which accumulates this state into a ContentDocument), read-parse.ts (readRtfDetail, the token loop that mutates it) and read-control-words.ts (the per-control-word dispatch that also mutates it).
import {
  type Alignment,
  type AnchorDescriptor,
  type Color,
  type ConstructDescriptor,
  type ContentBlock,
  type ContentDocument,
  type ContentRun,
  type ContentSection,
  type ContentTableCell,
  type DocumentTree,
  type RunConstructExtent,
  type TextDirection,
} from "document-schema.js";
import { newPendingCell, type PendingCell } from "./cell-format";
import { NO_REVISION, type RevisionState } from "./constructs";
import {
  RtfDiagnosticCodes,
  type RtfDiagnostic,
  type RtfDiagnosticSink,
} from "./diagnostics";
import type { RtfToken } from "./tokenize";
import { DEFAULT_FONT_SIZE_HALF_POINTS } from "./units";

// Both this module's read.ts entry points return one of these two shapes, and read-parse.ts's own readRtfDetail produces the flat one directly, so both live here rather than in read.ts itself, avoiding a read.ts <-> read-parse.ts import cycle.
export interface ReadRtfResult {
  // `documentPackage` rather than the bare noun `package`, matching markdown-codec's own naming for the same reason: `package` is a reserved word in strict mode, so `const { package } = readRtf(bytes)`, the idiom every caller reaches for first, is a syntax error.
  readonly documentPackage: DocumentTree;
  readonly diagnostics: readonly RtfDiagnostic[];
}

export interface ReadRtfContentResult {
  readonly document: ContentDocument;
  readonly diagnostics: readonly RtfDiagnostic[];
}

export type DestinationKind =
  | "body" // runs and blocks: the document body, a field result, a \ud Unicode destination
  | "skip" // discarded whole: an unrecognised {\* group, a header table already read, a note or annotation this reader does not place
  | "picture" // hex or binary picture payload
  | "fieldInstruction" // a field's instruction text, parsed rather than shown
  | "listText" // the flat rendering of a list number, which a numbering-aware reader must ignore
  | "unicodeWrapper" // \upr, whose ANSI half is discarded and whose \ud half is read
  | "bookmarkStart" // {\*\bkmkstart ...}, whose text is the bookmark's own name
  | "bookmarkEnd" // {\*\bkmkend ...}, likewise
  | "formField" // {\*\formfield ...}, nested inside \fldinst: no #PCDATA of its own, carried entirely by its own control words and the two destinations below
  | "formFieldName" // {\*\ffname ...}, whose text is the form field's own bookmark-style name
  | "formFieldHelpText" // {\*\ffhelptext ...}, whose text is the form field's own human-readable help text — the closest RTF analogue to a contentControl's `alias`
  | "formFieldListItem" // {\*\ffl ...}, whose text is a dropdown's own list entry
  | "object" // \object itself: no text of its own (its content is the destinations below), just a non-skip wrapper so its children are actually read rather than jumped over whole
  | "objectData"; // {\*\objdata ...}, hex or binary payload exactly like "picture"'s — see buildEmbeddedObject

export const DESTINATION_KINDS: ReadonlyMap<string, DestinationKind> = new Map([
  // Transparent wrappers whose content is ordinary body flow.
  ["fldrslt", "body"],
  ["ud", "body"],
  ["shppict", "body"],
  ["field", "body"],
  // The payload destinations.
  ["pict", "picture"],
  ["fldinst", "fieldInstruction"],
  ["listtext", "listText"],
  ["pntext", "listText"],
  ["upr", "unicodeWrapper"],
  ["formfield", "formField"],
  ["ffname", "formFieldName"],
  ["ffhelptext", "formFieldHelpText"],
  ["ffl", "formFieldListItem"],
  // FFData.xstzTextDef, a plainText field's own default/reset text — deliberately not captured: constructs.ts's own formFieldContentControl never promotes it onto a contentControl (a field's genuinely CURRENT text already rides the wrapped \fldrslt runs this destination sits alongside, and the default is a different fact — see that function's own top comment), so there is no raw-data consumer left for a captured value to serve. Recognised and silently skipped rather than left unmapped, so a real producer's \ffdeftext reads as a known, deliberately-unused destination rather than an "unrecognised destination" diagnostic.
  ["ffdeftext", "skip"],
  // The remaining four <formstrings> destination strings RTF's own Form Fields table names alongside \ffname/\ffdeftext/\ffhelptext/\ffl (write.ts's own top-of-file comment on formFieldPayload quotes the full <formstrings> production): \ffformat (a text field's own input-format mask), \ffstattext (status-line text, gated by \ffownstat exactly as \ffhelptext is gated by \ffownhelp), \ffentrymcr and \ffexitmcr (entry/exit macro names). RtfFormFieldData (below) has no member for any of the four — document-schema.js's ContentControlDescriptor has no format-mask, status-text, or macro-name field for a form field construct to carry them in — so, like \ffdeftext, each is recognised and silently skipped rather than left unmapped.
  ["ffformat", "skip"],
  ["ffstattext", "skip"],
  ["ffentrymcr", "skip"],
  ["ffexitmcr", "skip"],
  // Content this reader deliberately does not place. ContentDocument has no page furniture, note, or annotation position for any of these to land in: a header/footer is page furniture with no ContentSection field to carry it, and a footnote body's real home is document-schema.js's tree-only definitions table, which the flat form this reader produces cannot reach. Each is skipped with a diagnostic rather than silently, and each is listed in the README's own gap table.
  ["footnote", "skip"],
  ["header", "skip"],
  ["headerl", "skip"],
  ["headerr", "skip"],
  ["headerf", "skip"],
  ["footer", "skip"],
  ["footerl", "skip"],
  ["footerr", "skip"],
  ["footerf", "skip"],
  ["ftnsep", "skip"],
  ["ftnsepc", "skip"],
  ["ftncn", "skip"],
  ["aftnsep", "skip"],
  ["aftnsepc", "skip"],
  ["aftncn", "skip"],
  ["annotation", "skip"],
  ["atnid", "skip"],
  ["atnauthor", "skip"],
  ["atnref", "skip"],
  ["atndate", "skip"],
  ["atnparent", "skip"],
  ["atnicn", "skip"],
  // The bookmark halves, whose #PCDATA is the name the two are matched by (RTF 1.9.1, "Bookmarks").
  ["bkmkstart", "bookmarkStart"],
  ["bkmkend", "bookmarkEnd"],
  // \object is not "skip" — unlike a genuinely unhandled destination, a "skip" kind jumps straight to the group's own matching close (matchingGroupEnd) without ever looking at its children, which would drop the nested {\*\objdata ...} this reader now decodes along with everything else. "object" is a plain non-skip wrapper with no text of its own; the real handling is objdata's.
  ["object", "object"],
  ["objdata", "objectData"],
  ["objclass", "skip"],
  ["objname", "skip"],
  // \oleclsid ("<objclsid> = '{\*' \oleclsid #PCDATA '}'") is \object's own optional CLSID sub-group, listed in RTF 1.9.1's <obj> grammar right alongside <objalias>/<objsect>/<objtime> below — informational, with no position in ContentEmbeddedObjectBlock, but spec-legal \object content nonetheless, so it belongs here rather than left to trip UNKNOWN_DESTINATION_SKIPPED as if it were unrecognised.
  ["oleclsid", "skip"],
  // \objalias and \objsect are the two optional sub-groups \objdata's own grammar allows before its <data> ("<objdata> = '{\*' \objdata (<objalias>? & <objsect>?) <data> '}'"); \objtime is \object's own linked-object update timestamp. All three are informational sub-parts this reader has no position for, exactly like \objclass/\objname above — listing them here (rather than leaving them as unrecognised ignorable destinations) keeps ordinary, spec-legal \object content from tripping UNKNOWN_DESTINATION_SKIPPED.
  ["objalias", "skip"],
  ["objsect", "skip"],
  ["objtime", "skip"],
  // \result is \object's own fallback rendering for a reader that cannot decode \object at all — this reader always attempts \objdata first and prefers it, exactly as Word itself does, so this table's own "skip" is only the default: the group-start handler below overrides it to "body" (rendered into an isolated scratch accumulator — see ContentBuilder's own beginResultScratch), and \object's own group-end handling either splices that scratch content in or discards it once \objdata's own fate is finally known.
  ["result", "skip"],
  ["do", "skip"],
  ["shp", "skip"],
  ["shptxt", "skip"],
  ["shpinst", "skip"],
  ["nonshppict", "skip"],
  ["xe", "skip"],
  ["tc", "skip"],
  ["tcn", "skip"],
  ["pn", "skip"],
  ["pnseclvl", "skip"],
  ["template", "skip"],
  ["comment", "skip"],
  ["falt", "skip"],
  ["panose", "skip"],
  ["fname", "skip"],
]);

// Destinations whose content is deliberately skipped WITHOUT a diagnostic, because nothing a caller could act on is actually lost by skipping them: each either duplicates information this reader already took from somewhere else, or is a sub-part of a destination that reports on its own behalf. Warning about these would bury the drops that do matter under noise a real Word document generates on every paragraph.
//
//  - \pn/\pnseclvl are Word 6/95 paragraph numbering, superseded by the \lsN/\ilvlN this reader does read.
//  - \nonshppict is by definition the copy Word itself will not read ("Specifies that Word 97 through Word 2002 has written a {\pict destination that it will not read on input"), sitting beside the \*\shppict this reader does take.
//  - \falt, \panose and \fname are <fontinfo> sub-productions the header parser already consumed.
//  - \atn*, \objclass/\objname/\oleclsid/\objalias/\objsect/\objtime/\result and \shpinst/\shptxt are sub-parts of \annotation, \object and \shp, each of which reports once for the whole construct (\objdata is no longer here — it is real payload now, handled and reported on its own terms by buildEmbeddedObject; \result is silent here too even on the degrade path where it is read as body content, since \object's own group-end handling reports the object once, either via buildEmbeddedObject's own diagnostic on a decode failure or its own "no \objdata"/"no \objdata and no \result" diagnostic otherwise).
//  - The footnote and endnote separators are page furniture with no content of their own, and \xe/\tc/\tcn are index and table-of-contents entry markers whose text is derivable from the document they mark.
//  - \ffdeftext is a plainText form field's own default/reset text (FFData.xstzTextDef), never promoted onto the field's contentControl by design — its genuinely current text already rides the wrapped \fldrslt runs alongside it (see constructs.ts's own formFieldContentControl top comment).
//  - \ffformat/\ffstattext/\ffentrymcr/\ffexitmcr are the remaining <formstrings> destination strings alongside \ffdeftext: RtfFormFieldData carries no member for any of them, since ContentControlDescriptor has no field a form field's input-format mask, status text, or entry/exit macro name could land in.
export const SILENT_SKIP_DESTINATIONS: ReadonlySet<string> = new Set([
  "ffdeftext",
  "ffformat",
  "ffstattext",
  "ffentrymcr",
  "ffexitmcr",
  "pn",
  "pnseclvl",
  "nonshppict",
  "falt",
  "panose",
  "fname",
  "atnid",
  "atnauthor",
  "atnref",
  "atndate",
  "atnparent",
  "atnicn",
  "objclass",
  "objname",
  "oleclsid",
  "objalias",
  "objsect",
  "objtime",
  "result",
  "shpinst",
  "shptxt",
  "ftnsep",
  "ftnsepc",
  "ftncn",
  "aftnsep",
  "aftnsepc",
  "aftncn",
  "template",
  "comment",
  "xe",
  "tc",
  "tcn",
]);

// The <spec> production's own characters — "Special Characters" in the specification — as the text each one contributes. A control word not in this table and not otherwise handled is ignored, which is what the spec requires of any unrecognised control word.
export const SPECIAL_CHARACTER_TEXT: ReadonlyMap<string, string> = new Map([
  ["tab", "\t"],
  ["line", "\n"],
  ["softline", "\n"],
  ["emdash", "—"],
  ["endash", "–"],
  ["bullet", "•"],
  ["lquote", "‘"],
  ["rquote", "’"],
  ["ldblquote", "“"],
  ["rdblquote", "”"],
  ["emspace", " "],
  ["enspace", " "],
  ["qmspace", " "],
  ["zwj", "‍"],
  ["zwnj", "‌"],
  ["ltrmark", "‎"],
  ["rtlmark", "‏"],
]);

// The control symbols that stand for a character rather than an escape or a marker: "\~ Non-breaking space", "\- Optional hyphen", "\_ Non-breaking hyphen", and the three literals \\, \{ and \} the spec names for "using these characters as text".
export const SPECIAL_SYMBOL_TEXT: ReadonlyMap<string, string> = new Map([
  ["~", " "],
  ["-", "­"],
  ["_", "‑"],
  ["\\", "\\"],
  ["{", "{"],
  ["}", "}"],
]);

export const ALIGNMENTS: ReadonlyMap<string, Alignment> = new Map([
  ["ql", "left"],
  ["qc", "center"],
  ["qr", "right"],
  ["qj", "justify"],
]);

export const PICTURE_FORMATS: ReadonlyMap<string, "png" | "jpeg"> = new Map([
  ["pngblip", "png"],
  ["jpegblip", "jpeg"],
]);

export interface CharacterState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  hidden: boolean;
  fontIndex: number | undefined;
  sizeHalfPoints: number;
  colorIndex: number | undefined;
  // Vertical text position, from the two on-spellings and two offset-spellings RTF states it at (\super/\sub and \upN/\dnN — RTF 1.9.1, "Font (Character) Formatting Properties"), narrowed onto ContentRun.verticalAlign's two members. Absent means baseline, the same absence the schema field itself carries.
  verticalAlign: "superscript" | "subscript" | undefined;
  // The run-level scope of the four RTF states text direction at: "\rtlch Character data following this control word is treated as a right-to-left run" / "\ltrch ... treated as a left-to-right run (the default)" (RTF 1.9.1, "Font (Character) Formatting Properties"). Like every other member here it is a character property scoped to the group, and the LAST-stated of the pair wins for the text that follows — which is exactly how a real producer pairs them, since RTF's own <ltrrun> and <rtlrun> productions spell an LTR run as "\rtlch \afN & <aprops>* \ltrch <ptext>" and an RTL one with the two swapped, the run's real direction always last, and LibreOffice's own filter writes the pair in exactly that order (\ltrch\rtlch before right-to-left text; \rtlch\af6...\ltrch inside an LTR paragraph's own property blob). Absent means unstated, the schema field's own absence.
  direction: TextDirection | undefined;
  // The <chrev> production, which is a character property like every field above it and so is scoped to the group the same way.
  revision: RevisionState;
}

export interface ParagraphState {
  alignment: Alignment | undefined;
  // The paragraph-level scope of the four RTF states text direction at: "\rtlpar Text in this paragraph will display with right-to-left precedence" / "\ltrpar ... left-to-right precedence (the default)" (RTF 1.9.1, "Paragraph Formatting Properties"). Absent means unstated, matching ContentParagraph.direction's own absence — a producer that spells the default side explicitly (LibreOffice writes \ltrpar on every paragraph) is stating a fact this field records rather than noise to filter.
  direction: TextDirection | undefined;
  indentLeftTwips: number;
  indentFirstLineTwips: number;
  spaceBeforeTwips: number;
  spaceAfterTwips: number;
  lineSpacingTwips: number | undefined;
  lineSpacingIsMultiple: boolean;
  styleIndex: number | undefined;
  outlineLevel: number | undefined;
  listOverrideIndex: number | undefined;
  listLevel: number;
  inTable: boolean;
  pageBreakBefore: boolean;
}

// The section-level properties in force, in twips, plus the break kind. Deliberately NOT part of GroupState: "Conventions of an RTF Reader" enumerates exactly four kinds of property the brace stack scopes — destination, character, paragraph and table — and section formatting is not among them, so a section property set inside a group stays set after the group closes.
//
// A section's own <secfmt> precedes its paragraphs and \sect ends it (RTF 1.9.1, "Section Text": <section> is `<secfmt>* <hdrftr>? <para>+ (\sect <section>)?`), so the values held here when a \sect arrives are the ones belonging to the section that just closed. Only \sectd resets them; \sect alone carries them into the next section, which is why this is one mutable record rather than a value rebuilt per section.
export interface SectionState {
  paperWidthTwips: number;
  paperHeightTwips: number;
  marginLeftTwips: number;
  marginRightTwips: number;
  marginTopTwips: number;
  marginBottomTwips: number;
  breakType: SectionBreakType | undefined;
}

// Threaded by reference, rather than SectionState passed as a bare object parameter, into the two dispatchers (applyControlWord, applySectionControlWord) that route mutation into it: SectionState is deliberately one persistent mutable record (see its own doc comment above), and every one of its own fields is a primitive, which is exactly what makes a bare SectionState parameter 'flat' under exadev/prefer-readonly-object-param. Wrapping it in a one-field sink whose own section property is not itself a primitive or callback keeps that rule out of scope for it, the same way appendBytes's own ByteSink in bytes.ts does for its unrelated array case. Every other consumer of SectionState (sectionGeometry and the rest) only ever reads it and keeps the plain Readonly<SectionState> parameter type instead.
export interface SectionSink {
  readonly section: SectionState;
}

export type SectionBreakType = NonNullable<ContentSection["breakType"]>;

// "\sbknone No section break", "\sbkcol Section break starts a new column", "\sbkpage Section break starts a new page", "\sbkeven Section break starts at an even page", "\sbkodd Section break starts at an odd page" (RTF 1.9.1, "Section Formatting Properties"). \sbkpage is RTF's own default and ContentSection's too ("absent means the format's own default break — nextPage in WordprocessingML"), so it maps to `undefined` rather than restating the default as data. \sbkcol is absent from this table on purpose: a column break has no ContentSection.breakType member, so it degrades with a diagnostic rather than being silently rounded to a neighbouring member.
export const SECTION_BREAK_TYPES: ReadonlyMap<
  string,
  SectionBreakType | undefined
> = new Map([
  ["sbknone", "continuous"],
  ["sbkpage", undefined],
  ["sbkeven", "evenPage"],
  ["sbkodd", "oddPage"],
]);

export interface PictureState {
  format: "png" | "jpeg" | undefined;
  unsupportedFormat: string | undefined;
  widthGoalTwips: number | undefined;
  heightGoalTwips: number | undefined;
  widthPixels: number | undefined;
  heightPixels: number | undefined;
  scaleXPercent: number;
  scaleYPercent: number;
  hex: string;
  binary: number[];
}

// One \*\formfield group's own accumulating data (RtfFormFieldData's mutable twin), built up as its nested \*\ffname/\*\ffhelptext/\*\ffl destinations close and its \ffres/\ffdefres/\ffprot/\ffownhelp control words apply. \*\ffdeftext and its four <formstrings> siblings (\*\ffformat/\*\ffstattext/\*\ffentrymcr/\*\ffexitmcr) are deliberately not one of these: each one's content is skipped whole (SILENT_SKIP_DESTINATIONS above), since nothing here consumes any of them.
export interface FormFieldState {
  name: string;
  helpText: string;
  ownHelp: boolean;
  listItems: string[];
  resultIndex: number | undefined;
  defaultResultIndex: number | undefined;
  protectedField: boolean;
}

// Shared by reference across a field group and its children, so a \fldrslt group reads the instruction its sibling \fldinst already collected without either needing to know the other's stack depth. `formField` is `undefined` until a nested \*\formfield destination opens — a legacy field with no \*\formfield group at all still has an instruction, just no further form-field data.
export interface FieldState {
  instruction: string;
  formField: FormFieldState | undefined;
  // Guards startFormField below against firing twice for the one field: a real Word-authored \field wraps its own \*\fldinst instruction text in an anonymous nested group (e.g. `{\*\fldinst {FORMTEXT }...}`), and that nested group inherits the enclosing "fieldInstruction" destination just like the \*\fldinst group itself does — so both the nested group's own close and \*\fldinst's own close see formFieldControlType return a real controlType and would otherwise each open their own extent for what is really one field. Set true the first time startFormField is actually called for this field, since FieldState is the one object shared by reference across the whole \field group's subtree.
  formFieldStarted: boolean;
}

// {\*\objdata ...}'s own (\binN #BDATA) | #SDATA payload, decoded into one ordered byte sequence as the token stream is actually read — a \'hh escape is a generic RTF character escape valid anywhere in a destination's text (not only in a #SDATA-shaped one), so a real payload can legitimately interleave plain #SDATA hex-digit text with scattered \'hh escapes, and keeping two separate buffers (one for each source) would silently discard whichever one a naive "prefer binary if any, else hex" choice didn't pick. `pendingHexNibble` carries a #SDATA hex digit's value, seen without its pairing digit yet, across token boundaries, so a pair split between two "text" tokens still decodes. Unlike PictureState this carries no dimension/format fields: \object's own \objwN/\objhN are purely informational sizing for a reader that cannot decode \objdata (RTF 1.9.1, "Objects") — captured instead on the enclosing \object's own ObjectState below — and this reader's actual reconstruction gets objectKind/frame/document straight from the decoded payload itself — see buildEmbeddedObject.
export interface ObjectDataState {
  bytes: number[];
  pendingHexNibble: number | undefined;
}

export const OBJECT_DATA_HEX_DIGITS = "0123456789abcdef";

// Decodes a run of #SDATA hex-digit text directly into `objectData.bytes`, in place, preserving its actual position relative to any \binN/\'hh bytes already appended or still to come — the streaming counterpart of base64.ts's own hexToBytes, which only ever sees one destination's payload as a single already-concatenated string. Behaves identically to hexToBytes otherwise: a non-hex character (RTF's own recommended line-wrapping whitespace) is skipped rather than rejected, and a digit left unpaired at the very end of the whole destination is simply dropped, half a byte not being a byte.
export function appendObjectDataHexText(
  objectData: ObjectDataState,
  text: string,
): void {
  let high = objectData.pendingHexNibble;
  for (const character of text) {
    const value = OBJECT_DATA_HEX_DIGITS.indexOf(character.toLowerCase());
    if (value === -1) {
      continue;
    }
    if (high === undefined) {
      high = value;
      continue;
    }
    objectData.bytes.push(high * 16 + value);
    high = undefined;
  }
  objectData.pendingHexNibble = high;
}

// One \object destination's own state, shared by reference across the whole {\object ...} group and every child destination nested inside it (\objdata, \result, and the informational \*\objclass/\*\objname sub-groups) — the same "shared by reference" pattern FieldState already establishes for \fldinst/\fldrslt, so \result's own group can see whether its sibling \objdata already decoded without either needing to know the other's stack depth.
//
// RTF 1.9.1's own <obj> grammar does require <objdata> before <result>: its own Formal Syntax legend gives plain juxtaposition ("AB") as "Item A followed by item B", distinct from '&' ("A&B"), which it reserves for "Item A or item B, in any order" — and the <obj> production itself writes `<objclsid>? <objdata> <result>` as plain juxtaposition, with no '&' between the last two. A real producer's ordering cannot be assumed to honour that, though: the same spec states its own robustness clause ("RTF readers should be robust enough to handle some minor variations"), and a producer that swaps two required siblings is exactly the kind of minor variation it has in mind — so which sibling a producer actually wrote first cannot be known when \result's own group is seen. An earlier version of this reader resolved that with a lookahead, re-walking \objdata's own token range ahead of time to predict `decoded` before either sibling was actually read. That lookahead had to re-derive, on its own, every rule the real single-pass read below already applies — and did so wrongly for a spec-legal \objdata carrying a nested {\*\objalias ...} or {\*\objsect ...} sub-group (RTF 1.9.1: `<objdata> = '{\*' \objdata (<objalias>? & <objsect>?) <data> '}'`), folding those sub-groups' own bytes into the payload it scanned while the real read correctly skips them — so the two disagreed about whether \objdata would decode, and \result's fate was decided by whichever of them ran. `decoded` here is instead resolved by the SAME live read that will decide it anyway: \result's own content is rendered into a completely isolated scratch accumulator the moment its group is seen (see ContentBuilder's own beginResultScratch/endResultScratch), and only spliced into the real document — at \object's own group end, once every child has actually been read and `decoded` is thus final — if \objdata never went on to decode. This closes the whole category of lookahead-vs-real-parse disagreement rather than keeping a second implementation of the same decode in sync with the first, and it closes a second category besides: \result's scratch content shares no paragraph, block list, or table state with whatever was already accumulating around \object, so rendering it can neither destroy nor be destroyed by the surrounding document, regardless of where \object sits in a still-open paragraph or table cell.
//
// widthTwips/heightTwips capture \objwN/\objhN (the size hint RTF 1.9.1 says a producer supplies "to maintain backward compatibility" for a reader that cannot decode \objdata at all): this reader's own reconstruction never needs them when \objdata decodes, but the degrade path folds them into its diagnostic message instead of discarding them silently.
export interface ObjectState {
  decoded: boolean;
  // Whether an {\*\objdata ...} child has actually been read (not merely predicted) anywhere in this \object's own group, regardless of whether it goes on to decode — distinct from `decoded`, since an \object whose \objdata genuinely fails to decode already reports that failure on its own terms (buildEmbeddedObject's own EMBEDDED_OBJECT_UNREADABLE), while an \object with no \objdata child at all is a different, otherwise-silent construct substitution that \object's own group-end handling below reports separately. Set the moment an \objdata child's group is actually entered, which is also what lets a second \objdata sibling (RTF's own grammar allows only one, but a malformed producer can still write two) be recognised as a duplicate and skipped rather than decoded twice into two identical blocks.
  objectDataSeen: boolean;
  // Whether an {\result ...} child has actually been read anywhere in this \object's own group — distinct from whether its content was ultimately kept or discarded, since \object's own group-end diagnostic (below) needs to say which of \objdata/\result, if either, this \object actually had, and it is also how a second \result sibling (RTF's own grammar allows only one, but a malformed producer can still write two) is recognised as a duplicate and skipped, exactly like `objectDataSeen` does for \objdata.
  resultSeen: boolean;
  // The finished blocks \result's own scratch rendering produced, recorded once its group closes — spliced into the real document at \object's own group end if `decoded` is still false then, discarded otherwise. Undefined until \result's group has actually closed, and left undefined forever if this \object has no \result child at all.
  resultBlocks: ContentBlock[] | undefined;
  widthTwips: number | undefined;
  heightTwips: number | undefined;
}

// One {\*\bkmkstart ...} or {\*\bkmkend ...} group under construction: its #PCDATA name, plus the start half's optional table-column range.
export interface BookmarkState {
  name: string;
  columnFirst: number | undefined;
  columnLast: number | undefined;
}

export interface GroupState {
  destination: DestinationKind;
  uc: number;
  char: CharacterState;
  para: ParagraphState;
  field: FieldState | undefined;
  picture: PictureState | undefined;
  // The same ownership marker as objectDataOwner/objectOwner below, for {\pict ...} itself: `picture` is carried forward by reference so a \'hh/binary byte or a \picwN/\pichN control word inside a nested group still reaches the same PictureState, but the group-end handler that calls buildPicture must fire only once, when \pict's own group actually closes — not on every plain sibling group nested directly inside it (a malformed producer can write one; RTF's own <pict> grammar has no legitimate use for one). Optional, not a plain `boolean`, so the root group below can simply omit it (leaving it genuinely absent) rather than state a `false` literal every reader of it already reads as paired with `picture` being undefined too — see root's own comment.
  pictureOwner?: boolean;
  objectData: ObjectDataState | undefined;
  object: ObjectState | undefined;
  // True only on the one GroupState created directly for an {\*\objdata ...} destination's own group — objectData itself is still carried forward BY REFERENCE across every descendant group (a stray \binN/\'hh byte inside a nested group must still land in the same accumulator the real \objdata group started), so the group-end handler that calls buildEmbeddedObject needs its own, non-inherited marker to fire exactly once per \objdata construct rather than once per descendant group that happens to close underneath it. Mirrors resultOf's own "set on the direct child, cleared by cloneGroupState" shape below, for the identical reason: a plain nested group inside \objdata's content (or a malformed one a hostile producer wrote) must not re-trigger this group's own finalisation when IT closes too. Optional for the same reason pictureOwner above is.
  objectDataOwner?: boolean;
  // The same ownership marker for {\object ...} itself: `object` is carried forward by reference so \objw/\objh control words and \objdata/\result's own group-open checks can reach the shared ObjectState from any depth inside \object's own group, but the group-end handler that splices \result's fallback in (or reports EMBEDDED_OBJECT_UNREADABLE) must fire only once, when \object's own group actually closes — not on every plain sibling group nested directly inside it (RTF's own <obj> grammar allows only <objdata> and <result> there, but a malformed producer can write anything). Optional for the same reason pictureOwner above is.
  objectOwner?: boolean;
  // Set only on the one GroupState created directly for a \result destination's own group — the enclosing \object's shared state to report the finished scratch blocks back to when this group closes. Deliberately NOT carried forward by cloneGroupState the way `object` is: a plain nested group inside \result's own content (every test fixture's `{\result{\pard\plain ...\par}}` has one) must not re-trigger this group's own finalisation a second time when IT closes, so only the direct child gets this field and every descendant clones it back to undefined.
  resultOf: ObjectState | undefined;
  bookmark: BookmarkState | undefined;
  // Whether this group is a \upr wrapper's own child that must be discarded (the ANSI half). Set on the wrapper; consulted when a child group opens.
  inUnicodeWrapper: boolean;
  // Whether this group's own head is \field itself, set explicitly on every group open (never inherited) exactly like inUnicodeWrapper above — state.field is shared by reference down through \field's own descendants, so this is the one flag that tells the group-close handler "this closing brace is the field's own, not one of its children's". Optional for the same reason pictureOwner above is: the root group below omits it rather than stating a `false` literal every reader already reads as paired with `state.field` being undefined too.
  isFieldGroup?: boolean;
}

export function defaultCharacterState(): CharacterState {
  return {
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    hidden: false,
    fontIndex: undefined,
    sizeHalfPoints: DEFAULT_FONT_SIZE_HALF_POINTS,
    colorIndex: undefined,
    verticalAlign: undefined,
    direction: undefined,
    revision: NO_REVISION,
  };
}

export function defaultParagraphState(): ParagraphState {
  return {
    alignment: undefined,
    direction: undefined,
    indentLeftTwips: 0,
    indentFirstLineTwips: 0,
    spaceBeforeTwips: 0,
    spaceAfterTwips: 0,
    lineSpacingTwips: undefined,
    lineSpacingIsMultiple: false,
    styleIndex: undefined,
    outlineLevel: undefined,
    listOverrideIndex: undefined,
    listLevel: 0,
    inTable: false,
    pageBreakBefore: false,
  };
}

export function cloneGroupState(state: GroupState): GroupState {
  return {
    destination: state.destination,
    uc: state.uc,
    char: { ...state.char },
    para: { ...state.para },
    field: state.field,
    picture: state.picture,
    pictureOwner: false,
    objectData: state.objectData,
    object: state.object,
    objectDataOwner: false,
    objectOwner: false,
    resultOf: undefined,
    bookmark: state.bookmark,
    inUnicodeWrapper: state.inUnicodeWrapper,
    isFieldGroup: state.isFieldGroup,
  };
}

// A run's identity for the purpose of merging adjacent text: two stretches of text with the same answer here belong to one ContentRun. JSON.stringify of the whole tuple, rather than building each field into an "on"/"" flag string and joining with a separator, is deliberate: every field rides its own real value (or `undefined`, which JSON encodes as `null`) instead of a collapsed two-value ternary, so two genuinely different states can never produce the same key by accident — unlike a hand-built delimited string, where an empty default for one field is indistinguishable from a real value that happens to also be empty, and removing the delimiter (or renaming a default) is invisible to every caller since nothing outside this function ever reads the key's own shape.
export function runKey(
  char: CharacterState,
  fontName: string | undefined,
  color: Color | undefined,
  hyperlink: string | undefined,
): string {
  return JSON.stringify([
    char.bold,
    char.italic,
    char.underline,
    char.strike,
    fontName,
    char.sizeHalfPoints,
    color === undefined
      ? undefined
      : `${String(color.r)},${String(color.g)},${String(color.b)}`,
    hyperlink,
    char.verticalAlign,
    char.direction,
    // A revision boundary is a run boundary: two stretches of text differing only in who inserted them are two runs, because the extent that names the insertion has to start and end somewhere.
    char.revision,
  ]);
}

// "HYPERLINK "target"" is the <links> field type this reader maps onto ContentRun.hyperlink; the optional \\l switch names an in-document anchor rather than an external URI, which ContentRun states the only way it can — as a fragment.
export const HYPERLINK_TARGET = /HYPERLINK\s+"([^"]*)"/i;
// The unquoted spelling some producers emit. The first character may not be a backslash: a field instruction's switches are written that way ("HYPERLINK \l "anchor""), and matching one as the target would make every switch-only hyperlink point at its own switch.
export const HYPERLINK_BARE_TARGET = /HYPERLINK\s+([^\s"\\]\S*)/i;
export const HYPERLINK_ANCHOR = /\\l\s+"([^"]*)"/i;

export function hyperlinkFromInstruction(
  instruction: string,
): string | undefined {
  const quoted = HYPERLINK_TARGET.exec(instruction);
  const anchor = HYPERLINK_ANCHOR.exec(instruction);
  const target = quoted?.[1] ?? HYPERLINK_BARE_TARGET.exec(instruction)?.[1];
  if (target === undefined) {
    return anchor?.[1] === undefined ? undefined : `#${anchor[1]}`;
  }
  return anchor?.[1] === undefined ? target : `${target}#${anchor[1]}`;
}

export interface SkipPosition {
  readonly index: number;
  readonly textOffset: number;
}

// The \uN fallback skip, implementing the spec's own rules verbatim: `count` characters are skipped, "any RTF control word or symbol is considered a single character", "a \binN keyword, its argument, and the binary data that follows are considered one character", and "if an RTF scope delimiter character ... is encountered while scanning skippable data, the skippable data is considered to end before the delimiter". A text run is consumed byte by byte, which is why the returned position carries a byte offset alongside its token index — but the STARTING position never needs one: this reader's one call site always begins a fresh skip right after the \uN token that triggered it, never mid-token, so the parameter is a bare token index rather than a full SkipPosition. Every text token this loop touches is therefore entered at its own offset 0 (either the initial one, or a later one just reset by the full-consumption branch below), which is what lets `available` below be the token's own plain length rather than a length-minus-an-offset that is always zero in practice.
export function skipUnicodeFallback(
  tokens: readonly RtfToken[],
  fromIndex: number,
  count: number,
): SkipPosition {
  let index = fromIndex;
  let textOffset = 0;
  let remaining = count;
  while (remaining > 0) {
    const token = tokens[index];
    if (token === undefined) break;
    if (token.kind === "groupStart" || token.kind === "groupEnd") {
      break;
    }
    if (token.kind === "text") {
      const consumed = Math.min(token.bytes.length, remaining);
      remaining -= consumed;
      textOffset = consumed;
      if (textOffset >= token.bytes.length) {
        index += 1;
        textOffset = 0;
      }
      continue;
    }
    remaining -= 1;
    index += 1;
    textOffset = 0;
  }
  return { index, textOffset };
}

// A \field group's own run range, open from its head brace to its closing one. paragraphSerial guards against a \par or \cell landing inside \fldrslt: RTF 1.9.1's own <fieldrslt> production ('{' \fldrslt <para>+ '}') is grammatical for a multi-paragraph result even though real producers keep form fields inline in practice, and without this check a stale runIndex captured before the paragraph reset could produce an inverted startRun/endRun pair. When it fires, endFormField below drops the contentControl and reports why through the sink, rather than mis-attaching it to whichever paragraph happens to be open once the field closes. A fresh `symbol` per paragraph rather than a counter: every reader of this field (endBookmark, resolveBookmarkPositions, endFormField) only ever tests it for identity against a value captured earlier from this identical field, never for ordering, so there is no "count" for a numeric serial to actually carry — a symbol states that directly instead of leaving an unused ordering property for a mutation test to notice is never read.
export interface OpenFormField {
  readonly paragraphSerial: symbol;
  readonly runIndex: number;
}

// A bookmark start held open until its end arrives, at which point the pair's own scope decides its encoding. `blockIndex` is filled in when the paragraph the start sits in takes its place in a block list, and stays undefined for a pair that opens and closes inside one paragraph.
export interface OpenBookmark {
  readonly descriptor: AnchorDescriptor;
  readonly paragraphSerial: symbol;
  readonly runIndex: number;
  readonly inTable: boolean;
  blockIndex: number | undefined;
}

// A construct spanning whole blocks of one list, before its marker pair is spliced in. Half-open, matching RunConstructExtent's own convention: blocks startIndex..endIndex-1 are the extent.
export interface BlockConstructExtent {
  readonly descriptor: ConstructDescriptor;
  readonly startIndex: number;
  readonly endIndex: number;
}

// A constructStart/constructEnd marker pair can only ever express proper nesting or disjointness — document-schema.js's own construct.ts states plainly that two block-scoped extents whose ranges genuinely cross have "no encoding in either form", since the tree side would need two subtrees crossing (which no tree holds) and the flat side's bracket matching re-pairs a crossing couple into a nesting the source never had. Two block-scoped bookmarks whose real ranges are adjacent-but-disjoint in the source can still produce crossing block extents here, because a paragraph is this reader's finest addressable unit: when one bookmark's \bkmkend and a later bookmark's own \bkmkstart both land inside the SAME paragraph, that paragraph's own block index is claimed by both extents even though neither bookmark's real text ever overlapped the other's (ExaDev/documents.js#1040). Detects exactly that shape — extent B starts strictly before extent A ends, but ends strictly after A does, so B neither nests inside A nor sits disjoint from it — and drops the later-starting extent of the crossing pair, keeping the earlier (outer) one intact and self-consistent; the dropped one is reported through the sink rather than silently vanishing, since it degrades real content exactly like every other unrepresentable construct this reader names.
export function dropCrossingExtents(
  ordered: readonly BlockConstructExtent[],
  sink: RtfDiagnosticSink,
): readonly BlockConstructExtent[] {
  const kept: BlockConstructExtent[] = [];
  for (const candidate of ordered) {
    const crossesKept = kept.some(
      (extent) =>
        candidate.startIndex < extent.endIndex &&
        candidate.endIndex > extent.endIndex,
    );
    if (crossesKept) {
      sink({
        code: RtfDiagnosticCodes.BLOCK_CONSTRUCT_EXTENTS_CROSSED,
        severity: "warning",
        message: `a '${candidate.descriptor.kind}' construct's own block extent crosses an already-open one instead of nesting inside or sitting disjoint from it — both bookmarks likely closed and opened within the same paragraph, which this reader cannot express as two separate extents, so this one is dropped`,
      });
      continue;
    }
    kept.push(candidate);
  }
  return kept;
}

// Splices each extent's constructStart/constructEnd pair into one block list, the flat form's own encoding of a block-scoped construct. Outermost first at a shared boundary — longer extents open earlier and close later — so bracket matching re-derives the same nesting document-schema.js's decompose() will promote back into groups.
export function insertConstructMarkers(
  blocks: readonly ContentBlock[],
  extents: readonly BlockConstructExtent[],
  sink: RtfDiagnosticSink,
): ContentBlock[] {
  // No early return for an empty `extents`: the loop below already produces exactly `[...blocks]` when there is nothing to splice (both marker loops are no-ops against an empty `ordered`), so a dedicated fast path here would be a pure equivalent-mutant-prone optimisation with no observable difference.
  const sorted = [...extents].sort(
    (left, right) =>
      left.startIndex - right.startIndex || right.endIndex - left.endIndex,
  );
  const ordered = dropCrossingExtents(sorted, sink);
  const out: ContentBlock[] = [];
  for (let index = 0; index <= blocks.length; index += 1) {
    // Closes first, then opens, so an extent ending where another begins does not enclose it. Each extent's own constructEnd marker is anonymous (it carries no descriptor to distinguish it from any other extent's), so the order this loop visits `ordered` in when several extents close at the same index is not itself observable in the output — what makes the brackets balance is that every closing marker for a given index is pushed before that index's own opening ones, not which of several simultaneous closes came first.
    for (const extent of ordered) {
      if (extent.endIndex === index) {
        out.push({ kind: "constructEnd" });
      }
    }
    for (const extent of ordered) {
      if (extent.startIndex === index) {
        out.push({ kind: "constructStart", descriptor: extent.descriptor });
      }
    }
    const block = blocks[index];
    if (block !== undefined) {
      out.push(block);
    }
  }
  return out;
}

// One row as read: its cells alongside the <celldef> run that preceded each \cellxN, kept together because a span is only derivable once every row of the table is known.
export interface RawTableRow {
  readonly cells: ContentTableCell[];
  readonly definitions: readonly PendingCell[];
  // The row-level scope of the four RTF states text direction at: "\rtlrow Cells in this table row will have right-to-left precedence" / "\ltrrow ... left-to-right precedence (the default)" (RTF 1.9.1, "Table Row Formatting"), a <rowwrite> member of the row's own <tbldef>.
  readonly direction: TextDirection | undefined;
  // "\trhdr Table row header. This row should appear at the top of every page on which the current table appears" (RTF 1.9.1, "Table Definitions"), a row-level property of the row's own <tbldef>: ContentTableRow.isHeader, in RTF's own spelling. A bare on-word with no off-word of its own, so an unstated row is simply not a header and \trowd's own reset is what ends a previous row's flag.
  readonly isHeader: boolean;
}

// How many grid columns the cell at `index` occupies: one, plus each immediately following cell flagged \clmrg. "\clmgf The first cell in a range of table cells to be merged" / "\clmrg Contents of the table cell are merged with those of the preceding cell", so the count is the length of the continuation run rather than a stored number.
export function horizontalSpanAt(
  definitions: readonly PendingCell[],
  index: number,
): number {
  if (definitions[index]?.horizontalMergeFirst !== true) {
    return 1;
  }
  let span = 1;
  while (definitions[index + span]?.horizontalMergeContinuation === true) {
    span += 1;
  }
  return span;
}

// The rowSpan a \clvmgf anchor at grid column `column` reaches: one, plus each consecutive row of `rowsBelow` (the rows after the anchor's own, in order) whose definition at that same column is a \clvmrg continuation. A row's cell definitions are one per grid column, because a merged region's covered positions each keep their own definition and \cell mark, so `column` indexes every row's `definitions` directly. A standalone exported function taking the rows as a plain parameter rather than reading ContentBuilder's own private fields, so it can be exercised directly.
export function verticalMergeRowSpan(
  rowsBelow: readonly RawTableRow[],
  column: number,
): number {
  let rowSpan = 1;
  for (const below of rowsBelow) {
    if (below.definitions[column]?.verticalMergeContinuation !== true) {
      break;
    }
    rowSpan += 1;
  }
  return rowSpan;
}

// Every piece of mutable state a ContentBuilder holds while it accumulates one document's worth of content — deliberately excluding `sections` (already-finished sections, never touched mid-accumulation) and the constructor-injected `header`/`sink` (read-only for the whole read). Bundled here so beginResultScratch/endResultScratch can swap the whole thing out for a fresh instance and back, rather than special-casing each field: see those two methods for why \result's own fallback content needs this.
export interface BuilderAccumulatorState {
  blocks: ContentBlock[];
  runs: ContentRun[];
  pendingRunKey: string | undefined;
  pendingRunText: string;
  pendingRunFields: Omit<ContentRun, "text">;
  runProvenance: ConstructDescriptor[][];
  pendingRunProvenance: ConstructDescriptor[];
  tableRows: RawTableRow[];
  tableColumnRights: number[];
  rowCells: ContentTableCell[];
  cellBlocks: ContentBlock[];
  pendingCellRights: number[];
  pendingCellDefinitions: PendingCell[];
  pendingCell: PendingCell;
  rowLeftTwips: number;
  rowDirection: TextDirection | undefined;
  rowIsHeader: boolean;
  paragraphSerial: symbol;
  openBookmarks: Map<string, OpenBookmark>;
  sectionBlockExtents: BlockConstructExtent[];
  cellBlockExtents: BlockConstructExtent[];
  pendingRunConstructs: RunConstructExtent[];
  closingBookmarks: OpenBookmark[];
}

export function freshAccumulatorState(): BuilderAccumulatorState {
  return {
    blocks: [],
    runs: [],
    pendingRunKey: undefined,
    pendingRunText: "",
    pendingRunFields: {},
    runProvenance: [],
    pendingRunProvenance: [],
    tableRows: [],
    tableColumnRights: [],
    rowCells: [],
    cellBlocks: [],
    pendingCellRights: [],
    pendingCellDefinitions: [],
    pendingCell: newPendingCell(),
    rowLeftTwips: 0,
    rowDirection: undefined,
    rowIsHeader: false,
    paragraphSerial: Symbol("paragraph"),
    openBookmarks: new Map(),
    sectionBlockExtents: [],
    cellBlockExtents: [],
    pendingRunConstructs: [],
    closingBookmarks: [],
  };
}

// The block extent one already-resolved closing bookmark produces, ending at `endIndex`. A standalone function rather than inlined in ContentBuilder's own flushClosingBookmarks, so a still-unresolved `blockIndex` — an invariant flushClosingBookmarks' own real caller can never actually violate, per the comment on its call site — can still be exercised directly by a unit test constructing one, without reaching into ContentBuilder's own private state to do it.
//
// Provably unreachable in practice: reaching flushClosingBookmarks at all requires paragraphSerial to have changed away from a bookmark's own opening serial (endBookmark only pushes to closingBookmarks on a serial mismatch), and the only way paragraphSerial ever changes is a resolveBookmarkPositions call that runs first — the very call that resolves blockIndex for every bookmark whose serial matches at that moment, this one included. blockIndex is therefore always already resolved by the time a real bookmark reaches this call, and this throws loudly rather than silently guessing a position for the invariant-violating case a hostile caller (or this function's own direct unit test) could still construct.
export function closingBookmarkExtent(
  closing: OpenBookmark,
  endIndex: number,
): BlockConstructExtent {
  if (closing.blockIndex === undefined) {
    throw new Error(
      "internal invariant violated: a closing bookmark reached flushClosingBookmarks with no resolved blockIndex",
    );
  }
  return {
    descriptor: closing.descriptor,
    startIndex: closing.blockIndex,
    endIndex,
  };
}

// Threaded by reference rather than passed as a bare array parameter: items is the caller's own list-item accumulator, its last entry rewritten in place, not foreign data this function has no business mutating. Wrapping it in a one-field sink keeps exadev/prefer-readonly-array-param out of scope for it, the same way appendBytes's own ByteSink in bytes.ts does.
export interface ListItemSink {
  readonly items: string[];
}

// Appends `text` to `sink.items`' own last entry, in place. A standalone function rather than inlined at emitText's own formFieldListItem branch, so the invariant that entry always already exists (a fresh entry is pushed in the identical group-open branch that sets this destination, so by the time text can arrive there is always at least one) can be exercised directly by a unit test constructing a case that violates it, rather than needing a non-null assertion to state the same invariant with no test able to reach it.
export function appendToLastListItem(sink: ListItemSink, text: string): void {
  const last = sink.items.length - 1;
  const current = sink.items[last];
  if (current === undefined) {
    throw new Error(
      "internal invariant violated: a form field list item's text arrived with no list item entry to append to",
    );
  }
  sink.items[last] = current + text;
}
