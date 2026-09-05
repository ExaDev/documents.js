// The read side of this package's public surface, in both encodings document-schema.js states for one document: readRtf produces the tree-form DocumentTree (the primary entry point), readRtfContent produces the flat ContentDocument the state machine below actually builds.
//
// Why two, and why assembleTree rather than bare decompose, are both settled precedent in this family rather than decisions taken here -- see markdown-codec's own src/read.ts header for the full reasoning. In short: document-schema.js owns both encodings and calls assembleTree "the one helper a construction site calls"; a codec is a construction site; and the unsuffixed name is the one a caller should reach for, with the `Content` suffix naming the flat constituent underneath it (ooxml.js's readXlsx/readXlsxContent set that convention). There is no `pages` argument because RTF has no layout stage in this package at all.
//
// THE STATE MACHINE. RTF's reader model is stated directly by the specification ("Conventions of an RTF Reader") and is what this module implements literally: an opening brace stores the current state on a stack, a closing brace retrieves it, a backslash collects a control word or symbol and dispatches on it, and anything else is text written "to the current destination using the current formatting properties". Four kinds of state ride that stack, exactly as the spec enumerates them -- the destination, character-formatting properties, paragraph-formatting properties, and table-formatting properties -- with one addition of this reader's own, the \ucN skip count, which the spec separately requires be stacked ("values are scoped like character properties ... On exiting the group, the previous \ucN value is restored").
//
// WHAT THE DESTINATION DOES. A destination is not merely a label: it decides what happens to text. Body text becomes runs; a \pict destination's text is hex picture payload; an \objdata destination's text is the identical hex-or-binary payload for a whole embedded object; a \fldinst destination's text is a field instruction to be parsed rather than shown; a \listtext destination's text is the flat rendering of a list number that "should be ignored by any reader that understands Word 97 through Word 2007 numbering"; an unrecognised {\* destination's text is discarded whole. DESTINATION_KINDS below is that mapping, and it is the reason this reader can be a single pass with no lookahead beyond a group's own head.
//
// TABLES ARE PARAGRAPH PROPERTIES, NOT A GROUP. "There is no RTF table group; instead, tables are specified as paragraph properties." A row is a run of \intbl paragraphs terminated by \cell marks and closed by \row, with the row's own <tbldef> (\trowd ... \cellxN) sitting before it, after it, or -- for Word 2002 onward -- both. So the table builder here is driven by the \cell/\row marks in the text stream rather than by nesting, and a table closes when a non-table paragraph arrives or the section ends.
//
// UNICODE. \uN carries the character and is followed by an ANSI approximation that a Unicode-aware reader must skip: "the reader should ignore the next N' characters, where N' corresponds to the last \ucN' value encountered", where "any RTF control word or symbol is considered a single character" and a brace ends the skippable run early. skipUnicodeFallback below implements exactly that, including the partial consumption of a text run, which is why the main loop carries a byte offset alongside its token index.

import {
  assembleTree,
  type Alignment,
  type AnchorDescriptor,
  type Color,
  type ConstructDescriptor,
  type ContentBorder,
  type ContentBlock,
  type ContentCellBorders,
  type ContentDocument,
  type ContentEmbeddedObjectBlock,
  type ContentImageBlock,
  type ContentParagraph,
  type ContentRun,
  type ContentSection,
  type ContentTable,
  type ContentTableCell,
  type ContentTableRow,
  type DocumentTree,
  type LayoutMetadata,
  type Margins,
  type PageSize,
  type RunConstructExtent,
} from "document-schema.js";
import {
  applyCellDefinitionControlWord,
  newPendingCell,
  resolveBorder,
  type CellBorderSide,
  type PendingCell,
} from "./cell-format";
import {
  bookmarkAnchorDescriptor,
  coalesceRunConstructs,
  NO_REVISION,
  provenanceDescriptors,
  type RevisionState,
} from "./constructs";
import { bytesToBase64, hexToBytes } from "./base64";
import { readEmbeddedObjectData } from "./embedded-object";
import { appendBytes, asciiStringFromBytes, rtfBytesFromLatin1 } from "./bytes";
import { decodeCodepageBytes } from "./codepage";
import {
  RtfDiagnosticCodes,
  RtfInputTooLargeError,
  RtfNestingLimitExceededError,
  RtfNotAnRtfDocumentError,
  type RtfDiagnostic,
  type RtfDiagnosticSink,
} from "./diagnostics";
import { groupHead, matchingGroupEnd } from "./group";
import { HEADER_DESTINATIONS, readRtfHeader, type RtfHeader } from "./header";
import { LEVEL_NUMBER_FORMAT_BULLET, mintRtfListNumId } from "./list-id";
import {
  DEFAULT_MAX_GROUP_DEPTH,
  DEFAULT_MAX_INPUT_BYTES,
  type ReadRtfOptions,
} from "./options";
import { tokenizeRtf, type RtfToken } from "./tokenize";
import {
  DEFAULT_FONT_SIZE_HALF_POINTS,
  halfPointsToPoints,
  pixelsToPoints,
  twipsToPoints,
} from "./units";

export interface ReadRtfResult {
  // `documentPackage` rather than the bare noun `package`, matching markdown-codec's own naming for the same reason: `package` is a reserved word in strict mode, so `const { package } = readRtf(bytes)` -- the idiom every caller reaches for first -- is a syntax error.
  readonly documentPackage: DocumentTree;
  readonly diagnostics: readonly RtfDiagnostic[];
}

export interface ReadRtfContentResult {
  readonly document: ContentDocument;
  readonly diagnostics: readonly RtfDiagnostic[];
}

// What a destination does with the text inside it.
type DestinationKind =
  | "body" // runs and blocks: the document body, a field result, a \ud Unicode destination
  | "skip" // discarded whole: an unrecognised {\* group, a header table already read, a note or annotation this reader does not place
  | "picture" // hex or binary picture payload
  | "fieldInstruction" // a field's instruction text, parsed rather than shown
  | "listText" // the flat rendering of a list number, which a numbering-aware reader must ignore
  | "unicodeWrapper" // \upr, whose ANSI half is discarded and whose \ud half is read
  | "bookmarkStart" // {\*\bkmkstart ...}, whose text is the bookmark's own name
  | "bookmarkEnd" // {\*\bkmkend ...}, likewise
  | "object" // \object itself: no text of its own (its content is the destinations below), just a non-skip wrapper so its children are actually read rather than jumped over whole
  | "objectData"; // {\*\objdata ...}, hex or binary payload exactly like "picture"'s -- see buildEmbeddedObject

const DESTINATION_KINDS: ReadonlyMap<string, DestinationKind> = new Map([
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
  // \object is not "skip" -- unlike a genuinely unhandled destination, a "skip" kind jumps straight to the group's own matching close (matchingGroupEnd) without ever looking at its children, which would drop the nested {\*\objdata ...} this reader now decodes along with everything else. "object" is a plain non-skip wrapper with no text of its own; the real handling is objdata's.
  ["object", "object"],
  ["objdata", "objectData"],
  ["objclass", "skip"],
  ["objname", "skip"],
  // \objalias and \objsect are the two optional sub-groups \objdata's own grammar allows before its <data> ("<objdata> = '{\*' \objdata (<objalias>? & <objsect>?) <data> '}'"); \objtime is \object's own linked-object update timestamp. All three are informational sub-parts this reader has no position for, exactly like \objclass/\objname above -- listing them here (rather than leaving them as unrecognised ignorable destinations) keeps ordinary, spec-legal \object content from tripping UNKNOWN_DESTINATION_SKIPPED.
  ["objalias", "skip"],
  ["objsect", "skip"],
  ["objtime", "skip"],
  // \result is \object's own fallback rendering for a reader that cannot decode \object at all -- this reader always attempts \objdata first and prefers it, exactly as Word itself does, so this table's own "skip" is only the default: the group-start handler below overrides it to "body" unconditionally, rendering \result's content provisionally every time its group is seen (see ObjectState's own comment for why), and \object's own group-end handling retracts it again if \objdata does decode.
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
//  - \atn*, \objclass/\objname/\objalias/\objsect/\objtime/\result and \shpinst/\shptxt are sub-parts of \annotation, \object and \shp, each of which reports once for the whole construct (\objdata is no longer here -- it is real payload now, handled and reported on its own terms by buildEmbeddedObject; \result is silent here too even on the degrade path where it is read as body content, since \object's own group-end handling reports the object once, either via buildEmbeddedObject's own diagnostic on a decode failure or its own "no \objdata"/"no \objdata and no \result" diagnostic otherwise).
//  - The footnote and endnote separators are page furniture with no content of their own, and \xe/\tc/\tcn are index and table-of-contents entry markers whose text is derivable from the document they mark.
const SILENT_SKIP_DESTINATIONS: ReadonlySet<string> = new Set([
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

// The <spec> production's own characters -- "Special Characters" in the specification -- as the text each one contributes. A control word not in this table and not otherwise handled is ignored, which is what the spec requires of any unrecognised control word.
const SPECIAL_CHARACTER_TEXT: ReadonlyMap<string, string> = new Map([
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
const SPECIAL_SYMBOL_TEXT: ReadonlyMap<string, string> = new Map([
  ["~", " "],
  ["-", "­"],
  ["_", "‑"],
  ["\\", "\\"],
  ["{", "{"],
  ["}", "}"],
]);

const ALIGNMENTS: ReadonlyMap<string, Alignment> = new Map([
  ["ql", "left"],
  ["qc", "center"],
  ["qr", "right"],
  ["qj", "justify"],
]);

const PICTURE_FORMATS: ReadonlyMap<string, "png" | "jpeg"> = new Map([
  ["pngblip", "png"],
  ["jpegblip", "jpeg"],
]);

interface CharacterState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  hidden: boolean;
  fontIndex: number | undefined;
  sizeHalfPoints: number;
  colorIndex: number | undefined;
  // The <chrev> production, which is a character property like every field above it and so is scoped to the group the same way.
  revision: RevisionState;
}

interface ParagraphState {
  alignment: Alignment | undefined;
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

// The section-level properties in force, in twips, plus the break kind. Deliberately NOT part of GroupState: "Conventions of an RTF Reader" enumerates exactly four kinds of property the brace stack scopes -- destination, character, paragraph and table -- and section formatting is not among them, so a section property set inside a group stays set after the group closes.
//
// A section's own <secfmt> precedes its paragraphs and \sect ends it (RTF 1.9.1, "Section Text": <section> is `<secfmt>* <hdrftr>? <para>+ (\sect <section>)?`), so the values held here when a \sect arrives are the ones belonging to the section that just closed. Only \sectd resets them; \sect alone carries them into the next section, which is why this is one mutable record rather than a value rebuilt per section.
interface SectionState {
  paperWidthTwips: number;
  paperHeightTwips: number;
  marginLeftTwips: number;
  marginRightTwips: number;
  marginTopTwips: number;
  marginBottomTwips: number;
  breakType: SectionBreakType | undefined;
}

type SectionBreakType = NonNullable<ContentSection["breakType"]>;

// "\sbknone No section break", "\sbkcol Section break starts a new column", "\sbkpage Section break starts a new page", "\sbkeven Section break starts at an even page", "\sbkodd Section break starts at an odd page" (RTF 1.9.1, "Section Formatting Properties"). \sbkpage is RTF's own default and ContentSection's too ("absent means the format's own default break -- nextPage in WordprocessingML"), so it maps to `undefined` rather than restating the default as data. \sbkcol is absent from this table on purpose: a column break has no ContentSection.breakType member, so it degrades with a diagnostic rather than being silently rounded to a neighbouring member.
const SECTION_BREAK_TYPES: ReadonlyMap<string, SectionBreakType | undefined> =
  new Map([
    ["sbknone", "continuous"],
    ["sbkpage", undefined],
    ["sbkeven", "evenPage"],
    ["sbkodd", "oddPage"],
  ]);

interface PictureState {
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

// Shared by reference across a field group and its children, so a \fldrslt group reads the instruction its sibling \fldinst already collected without either needing to know the other's stack depth.
interface FieldState {
  instruction: string;
}

// {\*\objdata ...}'s own hex-or-binary payload, captured exactly like PictureState's own hex/binary pair above (the two destinations share the identical (\binN #BDATA) | #SDATA grammar production). Unlike PictureState this carries no dimension/format fields: \object's own \objwN/\objhN are purely informational sizing for a reader that cannot decode \objdata (RTF 1.9.1, "Objects") -- captured instead on the enclosing \object's own ObjectState below -- and this reader's actual reconstruction gets objectKind/frame/document straight from the decoded payload itself -- see buildEmbeddedObject.
interface ObjectDataState {
  hex: string;
  binary: number[];
}

// One \object destination's own state, shared by reference across the whole {\object ...} group and every child destination nested inside it (\objdata, \result, and the informational \*\objclass/\*\objname sub-groups) -- the same "shared by reference" pattern FieldState already establishes for \fldinst/\fldrslt, so \result's own group can see whether its sibling \objdata already decoded without either needing to know the other's stack depth.
//
// RTF 1.9.1's own <obj> grammar orders <objdata> before <result> but does not require it, so which sibling a producer wrote first cannot be known when \result's own group is seen -- an earlier version of this reader resolved that with a lookahead, re-walking \objdata's own token range ahead of time to predict `decoded` before either sibling was actually read. That lookahead had to re-derive, on its own, every rule the real single-pass read below already applies -- and did so wrongly for a spec-legal \objdata carrying a nested {\*\objalias ...} or {\*\objsect ...} sub-group (RTF 1.9.1: `<objdata> = '{\*' \objdata (<objalias>? & <objsect>?) <data> '}'`), folding those sub-groups' own bytes into the payload it scanned while the real read correctly skips them -- so the two disagreed about whether \objdata would decode, and \result's fate was decided by whichever of them ran. Predicting the outcome in advance is not the only way to avoid double-rendering: `decoded` here is instead resolved by the SAME live read that will decide it anyway, and \result's own content is rendered provisionally the moment its group is seen (see the group-start handling below) rather than gated on a prediction, then retracted after the fact -- at \object's own group end, once every child has actually been read and `decoded` is thus final -- if \objdata went on to decode successfully, wherever in the token stream that turned out to be. This closes the whole category of lookahead-vs-real-parse disagreement rather than keeping a second implementation of the same decode in sync with the first.
//
// widthTwips/heightTwips capture \objwN/\objhN (the size hint RTF 1.9.1 says a producer supplies "to maintain backward compatibility" for a reader that cannot decode \objdata at all): this reader's own reconstruction never needs them when \objdata decodes, but the degrade path folds them into its diagnostic message instead of discarding them silently.
interface ObjectState {
  decoded: boolean;
  // Whether an {\*\objdata ...} child has actually been read (not merely predicted) anywhere in this \object's own group, regardless of whether it goes on to decode -- distinct from `decoded`, since an \object whose \objdata genuinely fails to decode already reports that failure on its own terms (buildEmbeddedObject's own EMBEDDED_OBJECT_UNREADABLE), while an \object with no \objdata child at all is a different, otherwise-silent construct substitution that \object's own group-end handling below reports separately. Set the moment an \objdata child's group is actually entered, which is also what lets a second \objdata sibling (RTF's own grammar allows only one, but a malformed producer can still write two) be recognised as a duplicate and skipped rather than decoded twice into two identical blocks.
  objectDataSeen: boolean;
  // Whether an {\result ...} child has actually been read anywhere in this \object's own group -- distinct from whether its content was ultimately kept or retracted, since \object's own group-end diagnostic (below) needs to say which of \objdata/\result, if either, this \object actually had.
  resultSeen: boolean;
  // Recorded once \result's own group closes: exactly which blocks its provisionally-rendered fallback content contributed, and to which list (the open table cell's own, or the section's) -- resolved at \object's own group end, once `decoded` is finally known either way, by retracting this range if \objdata did go on to decode. Undefined until \result's group has actually closed, and left undefined forever if this \object has no \result child at all.
  resultRange:
    | {
        readonly inTable: boolean;
        readonly start: number;
        readonly end: number;
      }
    | undefined;
  widthTwips: number | undefined;
  heightTwips: number | undefined;
}

// One {\*\bkmkstart ...} or {\*\bkmkend ...} group under construction: its #PCDATA name, plus the start half's optional table-column range.
interface BookmarkState {
  name: string;
  columnFirst: number | undefined;
  columnLast: number | undefined;
}

interface GroupState {
  destination: DestinationKind;
  uc: number;
  char: CharacterState;
  para: ParagraphState;
  field: FieldState | undefined;
  picture: PictureState | undefined;
  objectData: ObjectDataState | undefined;
  object: ObjectState | undefined;
  // Set only on the one GroupState created directly for a \result destination's own group -- the enclosing \object's shared state to report the rendered range back to when this group closes, and where (which list, and how many blocks it already held) rendering began. Deliberately NOT carried forward by cloneGroupState the way `object` is: a plain nested group inside \result's own content (every test fixture's `{\result{\pard\plain ...\par}}` has one) must not re-trigger this group's own finalisation a second time when IT closes, so only the direct child gets this field and every descendant clones it back to undefined.
  resultOf: ObjectState | undefined;
  resultOpenAt:
    { readonly inTable: boolean; readonly start: number } | undefined;
  bookmark: BookmarkState | undefined;
  // Whether this group is a \upr wrapper's own child that must be discarded (the ANSI half). Set on the wrapper; consulted when a child group opens.
  inUnicodeWrapper: boolean;
}

function defaultCharacterState(): CharacterState {
  return {
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    hidden: false,
    fontIndex: undefined,
    sizeHalfPoints: DEFAULT_FONT_SIZE_HALF_POINTS,
    colorIndex: undefined,
    revision: NO_REVISION,
  };
}

function defaultParagraphState(): ParagraphState {
  return {
    alignment: undefined,
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

function cloneGroupState(state: GroupState): GroupState {
  return {
    destination: state.destination,
    uc: state.uc,
    char: { ...state.char },
    para: { ...state.para },
    field: state.field,
    picture: state.picture,
    objectData: state.objectData,
    object: state.object,
    resultOf: undefined,
    resultOpenAt: undefined,
    bookmark: state.bookmark,
    inUnicodeWrapper: state.inUnicodeWrapper,
  };
}

// A run's identity for the purpose of merging adjacent text: two stretches of text with the same answer here belong to one ContentRun.
function runKey(
  char: CharacterState,
  fontName: string | undefined,
  color: Color | undefined,
  hyperlink: string | undefined,
): string {
  return [
    char.bold ? "b" : "",
    char.italic ? "i" : "",
    char.underline ? "u" : "",
    char.strike ? "s" : "",
    fontName ?? "",
    String(char.sizeHalfPoints),
    color === undefined
      ? ""
      : `${String(color.r)},${String(color.g)},${String(color.b)}`,
    hyperlink ?? "",
    // A revision boundary is a run boundary: two stretches of text differing only in who inserted them are two runs, because the extent that names the insertion has to start and end somewhere.
    JSON.stringify(char.revision),
  ].join("|");
}

// "HYPERLINK "target"" is the <links> field type this reader maps onto ContentRun.hyperlink; the optional \\l switch names an in-document anchor rather than an external URI, which ContentRun states the only way it can -- as a fragment.
const HYPERLINK_TARGET = /HYPERLINK\s+"([^"]*)"/i;
// The unquoted spelling some producers emit. The first character may not be a backslash: a field instruction's switches are written that way ("HYPERLINK \l "anchor""), and matching one as the target would make every switch-only hyperlink point at its own switch.
const HYPERLINK_BARE_TARGET = /HYPERLINK\s+([^\s"\\]\S*)/i;
const HYPERLINK_ANCHOR = /\\l\s+"([^"]*)"/i;

function hyperlinkFromInstruction(instruction: string): string | undefined {
  const quoted = HYPERLINK_TARGET.exec(instruction);
  const anchor = HYPERLINK_ANCHOR.exec(instruction);
  const target = quoted?.[1] ?? HYPERLINK_BARE_TARGET.exec(instruction)?.[1];
  if (target === undefined) {
    return anchor?.[1] === undefined ? undefined : `#${anchor[1]}`;
  }
  return anchor?.[1] === undefined ? target : `${target}#${anchor[1]}`;
}

interface SkipPosition {
  readonly index: number;
  readonly textOffset: number;
}

// The \uN fallback skip, implementing the spec's own rules verbatim: `count` characters are skipped, "any RTF control word or symbol is considered a single character", "a \binN keyword, its argument, and the binary data that follows are considered one character", and "if an RTF scope delimiter character ... is encountered while scanning skippable data, the skippable data is considered to end before the delimiter". A text run is consumed byte by byte, which is why the caller carries a byte offset alongside its token index.
function skipUnicodeFallback(
  tokens: readonly RtfToken[],
  from: SkipPosition,
  count: number,
): SkipPosition {
  let { index, textOffset } = from;
  let remaining = count;
  while (remaining > 0 && index < tokens.length) {
    const token = tokens[index];
    if (token === undefined) break;
    if (token.kind === "groupStart" || token.kind === "groupEnd") {
      break;
    }
    if (token.kind === "text") {
      const available = token.bytes.length - textOffset;
      const consumed = Math.min(available, remaining);
      remaining -= consumed;
      textOffset += consumed;
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

// A bookmark start held open until its end arrives, at which point the pair's own scope decides its encoding. `blockIndex` is filled in when the paragraph the start sits in takes its place in a block list, and stays undefined for a pair that opens and closes inside one paragraph.
interface OpenBookmark {
  readonly descriptor: AnchorDescriptor;
  readonly paragraphSerial: number;
  readonly runIndex: number;
  readonly inTable: boolean;
  blockIndex: number | undefined;
}

// A construct spanning whole blocks of one list, before its marker pair is spliced in. Half-open, matching RunConstructExtent's own convention: blocks startIndex..endIndex-1 are the extent.
interface BlockConstructExtent {
  readonly descriptor: ConstructDescriptor;
  readonly startIndex: number;
  readonly endIndex: number;
}

// Splices each extent's constructStart/constructEnd pair into one block list, the flat form's own encoding of a block-scoped construct. Outermost first at a shared boundary -- longer extents open earlier and close later -- so bracket matching re-derives the same nesting document-schema.js's decompose() will promote back into groups.
function insertConstructMarkers(
  blocks: readonly ContentBlock[],
  extents: readonly BlockConstructExtent[],
): ContentBlock[] {
  if (extents.length === 0) {
    return [...blocks];
  }
  const ordered = [...extents].sort(
    (left, right) =>
      left.startIndex - right.startIndex || right.endIndex - left.endIndex,
  );
  const closing = [...ordered].reverse();
  const out: ContentBlock[] = [];
  for (let index = 0; index <= blocks.length; index += 1) {
    // Closes first, then opens, so an extent ending where another begins does not enclose it -- and closes run innermost-first (the reverse of the outermost-first open order), which is the only sequence that leaves the brackets balanced.
    for (const extent of closing) {
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
interface RawTableRow {
  readonly cells: ContentTableCell[];
  readonly definitions: readonly PendingCell[];
}

// How many grid columns the cell at `index` occupies: one, plus each immediately following cell flagged \clmrg. "\clmgf The first cell in a range of table cells to be merged" / "\clmrg Contents of the table cell are merged with those of the preceding cell", so the count is the length of the continuation run rather than a stored number.
function horizontalSpanAt(
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

class ContentBuilder {
  private readonly sections: ContentSection[] = [];
  private blocks: ContentBlock[] = [];
  private runs: ContentRun[] = [];
  private pendingRunKey: string | undefined;
  private pendingRunText = "";
  private pendingRunFields: Omit<ContentRun, "text"> = {};
  // The provenance descriptors each pushed run carries, positionally parallel to `runs` -- coalesced into the fewest run extents that say the same thing when the paragraph closes, so a revision spanning several formatting runs is one extent rather than one per run.
  private runProvenance: ConstructDescriptor[][] = [];
  private pendingRunProvenance: ConstructDescriptor[] = [];
  // Rows as read, each keeping its own <celldef> run beside its cells so the spans can be derived once the whole table is known.
  private tableRows: RawTableRow[] = [];
  private tableColumnRights: number[] = [];
  private rowCells: ContentTableCell[] = [];
  private cellBlocks: ContentBlock[] = [];
  private pendingCellRights: number[] = [];
  private pendingCellDefinitions: PendingCell[] = [];
  private pendingCell: PendingCell = newPendingCell();
  private rowLeftTwips = 0;
  // Bookmark bookkeeping. A bookmark's two halves are matched by name and may bracket a sub-sequence of one paragraph's runs or a run of whole paragraphs, and document-schema.js gives those two scopes two different encodings -- a RunConstructExtent on the paragraph, or a constructStart/constructEnd marker pair in the block list. Which one applies is not knowable when the start is seen, only when its end arrives, so a start is held open here and resolved then.
  private paragraphSerial = 0;
  private readonly openBookmarks = new Map<string, OpenBookmark>();
  // Extents whose two halves landed in different paragraphs of the same block list, waiting for that list to be finalised. Two lists, because a table cell's blocks and a section's blocks are separate bracket scopes and a pair may not straddle them.
  private sectionBlockExtents: BlockConstructExtent[] = [];
  private cellBlockExtents: BlockConstructExtent[] = [];
  private pendingRunConstructs: RunConstructExtent[] = [];
  // Bookmarks whose end half arrived in the paragraph currently accumulating, having started in an earlier one -- resolvable only once that paragraph's own block index is known.
  private closingBookmarks: OpenBookmark[] = [];

  constructor(
    private readonly header: RtfHeader,
    private readonly sink: RtfDiagnosticSink,
  ) {}

  // "{\*\bkmkstart ...}" -- flushing first so the bookmark's boundary is a run boundary, which is what makes the extent expressible at all.
  startBookmark(bookmark: BookmarkState, para: ParagraphState): void {
    this.flushRun();
    const name = bookmark.name;
    if (name.length === 0) {
      return;
    }
    this.openBookmarks.set(name, {
      descriptor: bookmarkAnchorDescriptor(
        name,
        bookmark.columnFirst === undefined && bookmark.columnLast === undefined
          ? undefined
          : { first: bookmark.columnFirst, last: bookmark.columnLast },
      ),
      paragraphSerial: this.paragraphSerial,
      runIndex: this.runs.length,
      inTable: para.inTable,
      blockIndex: undefined,
    });
  }

  // "{\*\bkmkend ...}". "Each bookmark start should have a matching bookmark end; however, the bookmark start and the bookmark end may be in any order" -- an end naming a bookmark no start opened is therefore reported rather than treated as an error, since the pairing is by name and not by nesting.
  endBookmark(name: string): void {
    this.flushRun();
    const open = this.openBookmarks.get(name);
    if (open === undefined) {
      this.sink({
        code: RtfDiagnosticCodes.BOOKMARK_UNPAIRED,
        severity: "warning",
        message: `a \\bkmkend named '${name}' has no matching \\bkmkstart, so no anchor construct is produced for it`,
      });
      return;
    }
    this.openBookmarks.delete(name);
    if (open.paragraphSerial === this.paragraphSerial) {
      this.pendingRunConstructs.push({
        descriptor: open.descriptor,
        startRun: open.runIndex,
        endRun: this.runs.length,
      });
      return;
    }
    this.closingBookmarks.push(open);
  }

  appendText(
    text: string,
    char: CharacterState,
    hyperlink: string | undefined,
  ): void {
    if (text.length === 0 || char.hidden) {
      return;
    }
    const fontName =
      char.fontIndex === undefined
        ? undefined
        : this.header.fonts.get(char.fontIndex)?.name;
    const color =
      char.colorIndex === undefined
        ? undefined
        : this.header.colors[char.colorIndex];
    const key = runKey(char, fontName, color, hyperlink);
    if (this.pendingRunKey !== key) {
      this.flushRun();
      this.pendingRunKey = key;
      this.pendingRunFields = buildRunFields(char, fontName, color, hyperlink);
      this.pendingRunProvenance = provenanceDescriptors(
        char.revision,
        this.header.revisionAuthors,
      );
    }
    this.pendingRunText += text;
  }

  private flushRun(): void {
    if (this.pendingRunText.length > 0) {
      this.runs.push({ ...this.pendingRunFields, text: this.pendingRunText });
      this.runProvenance.push(this.pendingRunProvenance);
    }
    this.pendingRunText = "";
    this.pendingRunKey = undefined;
    this.pendingRunFields = {};
    this.pendingRunProvenance = [];
  }

  // Closes the paragraph currently accumulating. `force` distinguishes an explicit \par (which always produces a paragraph, empty ones included -- an empty paragraph is real content in a wordprocessing document) from an implicit boundary such as a \cell or the end of the document, which produces nothing when nothing has accumulated.
  endParagraph(para: ParagraphState, force: boolean): void {
    this.flushRun();
    if (!force && this.runs.length === 0) {
      return;
    }
    const target = para.inTable ? this.cellBlocks : this.blocks;
    if (!para.inTable) {
      this.closeTable();
    }
    const blockIndex = target.length;
    target.push(this.buildParagraph(para));
    this.runs = [];
    this.runProvenance = [];
    this.resolveBookmarkPositions(para, blockIndex);
    this.paragraphSerial += 1;
  }

  // Once a paragraph has taken its place in a block list, every bookmark that opened inside it learns that index (so a pair closing later knows where to bracket from), and every pair whose end landed in it becomes a block extent. Both are deferred to here rather than recorded at the marker, because closeTable() above can push a table between the marker and the paragraph and shift the index the marker would have guessed.
  private resolveBookmarkPositions(
    para: ParagraphState,
    blockIndex: number,
  ): void {
    for (const open of this.openBookmarks.values()) {
      if (
        open.blockIndex === undefined &&
        open.paragraphSerial === this.paragraphSerial
      ) {
        open.blockIndex = blockIndex;
      }
    }
    this.flushClosingBookmarks(para.inTable, blockIndex + 1);
  }

  // Turns every bookmark whose end half has arrived into a block extent ending at `endIndex`. Called once per closed paragraph, and again when a block list is finalised -- a bookmark whose {\*\bkmkend ...} follows the list's last \par has no later paragraph to be resolved against, so without the second call it would silently vanish.
  private flushClosingBookmarks(inTable: boolean, endIndex: number): void {
    if (this.closingBookmarks.length === 0) {
      return;
    }
    const target = inTable ? this.cellBlockExtents : this.sectionBlockExtents;
    for (const closing of this.closingBookmarks) {
      if (closing.inTable !== inTable) {
        // The pair straddles a table cell's wall, which document-schema.js states as a ratified drop rather than a shape to repair: "each block list is its own bracket scope and cross-list pairing is ids again".
        this.sink({
          code: RtfDiagnosticCodes.BOOKMARK_UNPAIRED,
          severity: "warning",
          message: `the bookmark '${closing.descriptor.name}' spans a table cell boundary; a construct extent cannot straddle two block lists, so no anchor construct is produced for it`,
        });
        continue;
      }
      target.push({
        descriptor: closing.descriptor,
        // A start with no block index of its own opened after the last paragraph of its own scope closed, so the extent covers only the block the end sits in.
        startIndex: closing.blockIndex ?? Math.max(0, endIndex - 1),
        endIndex,
      });
    }
    this.closingBookmarks = [];
  }

  // The run-scoped extents this paragraph carries, in document order by where each starts, dropping any whose range does not name runs this paragraph actually has -- the well-formedness bound document-schema.js's own findRunConstructFault states (0 <= startRun <= endRun <= runs.length) and deliberately does not enforce in the schema.
  private takeRunConstructs(): RunConstructExtent[] {
    const extents = [
      ...this.pendingRunConstructs,
      ...coalesceRunConstructs(this.runProvenance),
    ].filter((extent) => extent.endRun <= this.runs.length);
    this.pendingRunConstructs = [];
    this.runProvenance = [];
    return extents.sort(
      (left, right) =>
        left.startRun - right.startRun || left.endRun - right.endRun,
    );
  }

  private buildParagraph(para: ParagraphState): ContentParagraph {
    const style =
      para.styleIndex === undefined
        ? undefined
        : this.header.styles.get(para.styleIndex);
    const headingLevel =
      para.outlineLevel === undefined
        ? style?.headingLevel
        : para.outlineLevel + 1;
    const constructs = this.takeRunConstructs();
    const paragraph: ContentParagraph = {
      kind: "paragraph",
      runs: this.runs,
      ...(constructs.length === 0 ? {} : { constructs }),
    };
    const withStyle =
      style?.name === undefined || style.name.length === 0
        ? paragraph
        : { ...paragraph, styleId: style.name };
    const withHeading =
      headingLevel === undefined ? withStyle : { ...withStyle, headingLevel };
    return {
      ...withHeading,
      ...(para.alignment === undefined ? {} : { alignment: para.alignment }),
      ...(para.indentLeftTwips === 0
        ? {}
        : { indentLeftPt: twipsToPoints(para.indentLeftTwips) }),
      ...(para.indentFirstLineTwips === 0
        ? {}
        : { indentFirstLinePt: twipsToPoints(para.indentFirstLineTwips) }),
      ...(para.spaceBeforeTwips === 0
        ? {}
        : { spacingBeforePt: twipsToPoints(para.spaceBeforeTwips) }),
      ...(para.spaceAfterTwips === 0
        ? {}
        : { spacingAfterPt: twipsToPoints(para.spaceAfterTwips) }),
      ...this.lineSpacingFields(para),
      ...(para.pageBreakBefore ? { pageBreakBefore: true } : {}),
      ...this.listFields(para),
    };
  }

  // "\slN Space between lines ... If N is a positive value, this size is used only if it is taller than the tallest character ... if N is a negative value, the absolute value of N is used" and "\slmultN Line spacing multiple ... 1 Multiple line spacing, relative to 'Single'". ContentParagraph.lineSpacing is a multiple of single line height, so only the \slmult1 form converts exactly: RTF states its multiple in 240ths of a line, Word's own unit for it. An \sl0 or absent value means automatic spacing and produces no field at all.
  private lineSpacingFields(para: ParagraphState): { lineSpacing?: number } {
    const value = para.lineSpacingTwips;
    if (value === undefined || value === 0 || !para.lineSpacingIsMultiple) {
      return {};
    }
    const multiple = Math.abs(value) / 240;
    return multiple > 0 ? { lineSpacing: multiple } : {};
  }

  private listFields(para: ParagraphState): {
    list?: { numId: string; level: number };
  } {
    const overrideIndex = para.listOverrideIndex;
    if (overrideIndex === undefined || overrideIndex === 0) {
      return {};
    }
    const list = this.header.lists.get(overrideIndex);
    const level = list?.levels[para.listLevel] ?? list?.levels[0];
    const type =
      level?.numberFormat === LEVEL_NUMBER_FORMAT_BULLET ? "bullet" : "ordered";
    return {
      list: {
        numId: mintRtfListNumId({
          listOverrideIndex: overrideIndex,
          type,
          ...(level?.startAt === undefined ? {} : { start: level.startAt }),
        }),
        level: para.listLevel,
      },
    };
  }

  startRowDefinition(): void {
    this.pendingCellRights = [];
    this.pendingCellDefinitions = [];
    this.pendingCell = newPendingCell();
    this.rowLeftTwips = 0;
  }

  setRowLeft(twips: number): void {
    this.rowLeftTwips = twips;
  }

  // Every control word of the <celldef> currently accumulating. Returns whether it was one, so the caller falls through for everything else.
  applyCellDefinition(name: string, param: number | undefined): boolean {
    return applyCellDefinitionControlWord(name, param, this.pendingCell);
  }

  // "\cellxN Defines the right boundary of a cell" -- and, being the last member of <celldef>, closes the definition that preceded it.
  addCellBoundary(rightTwips: number): void {
    this.pendingCellRights.push(rightTwips);
    this.pendingCellDefinitions.push(this.pendingCell);
    this.pendingCell = newPendingCell();
  }

  endCell(para: ParagraphState): void {
    this.endParagraph(para, false);
    this.flushClosingBookmarks(true, this.cellBlocks.length);
    this.rowCells.push({
      blocks: insertConstructMarkers(this.cellBlocks, this.cellBlockExtents),
    });
    this.cellBlocks = [];
    this.cellBlockExtents = [];
  }

  endRow(para: ParagraphState): void {
    if (this.cellBlocks.length > 0 || this.pendingRunText.length > 0) {
      this.endCell(para);
    }
    if (this.rowCells.length === 0) {
      this.sink({
        code: RtfDiagnosticCodes.TABLE_ROW_WITHOUT_DEFINITION,
        severity: "warning",
        message: "a \\row closed a table row that contained no \\cell marks",
      });
      return;
    }
    this.tableRows.push({
      cells: this.rowCells,
      definitions: this.pendingCellDefinitions,
    });
    if (this.tableColumnRights.length === 0) {
      this.tableColumnRights = [...this.pendingCellRights];
    }
    this.rowCells = [];
  }

  closeTable(): void {
    if (this.tableRows.length === 0) {
      return;
    }
    const rows = this.resolveRows();
    // Grid columns, not cells: a horizontally merged anchor stands for several columns, so counting cells would lose one width per merge. The row definition's own \cellxN boundaries are the other lower bound, since a row can end before the definition's last boundary.
    const columnCount = Math.max(
      this.tableColumnRights.length,
      ...rows.map((row) =>
        row.cells.reduce((total, cell) => total + (cell.colSpan ?? 1), 0),
      ),
    );
    this.blocks.push({
      kind: "table",
      rows,
      columnWidthsPt: this.columnWidths(columnCount),
    } satisfies ContentTable);
    this.tableRows = [];
    this.tableColumnRights = [];
  }

  // Folds each row's own <celldef> run onto its cells, resolving the two merge families the way every other codec in this family states them: the anchor carries the span and each covered cell stays in the row with no blocks of its own.
  //
  // Neither span count is stored by RTF -- \clvmgf/\clvmrg and \clmgf/\clmrg are flags, not counts -- so both are derived by scanning forward for the continuation flags, exactly as ooxml.js derives rowSpan from w:vMerge.
  private resolveRows(): ContentTableRow[] {
    const rows = this.tableRows;
    // A cell's column position accounts for the horizontal spans before it, so a vertical merge below lines up with the column its anchor actually occupies rather than with an ordinal that shifts.
    const columnIndices = rows.map((row) => {
      const indices: number[] = [];
      let column = 0;
      for (const [index] of row.cells.entries()) {
        indices.push(column);
        column += horizontalSpanAt(row.definitions, index);
      }
      return indices;
    });
    return rows.map((row, rowIndex) => ({
      // A horizontally merged continuation has no cell of its own in the content model -- the anchor's colSpan already accounts for the columns it swallows, exactly as one w:tc with a gridSpan does. A vertical continuation is the opposite case and keeps its slot, since its row genuinely has a cell there.
      cells: row.cells
        .map((cell, cellIndex) => ({ cell, cellIndex }))
        .filter(
          ({ cellIndex }) =>
            row.definitions[cellIndex]?.horizontalMergeContinuation !== true,
        )
        .map(({ cell, cellIndex }): ContentTableCell => {
          const definition = row.definitions[cellIndex];
          if (definition?.verticalMergeContinuation === true) {
            return { blocks: [] };
          }
          const colSpan = horizontalSpanAt(row.definitions, cellIndex);
          const column = columnIndices[rowIndex]?.[cellIndex];
          let rowSpan = 1;
          if (definition?.verticalMergeFirst === true && column !== undefined) {
            for (let next = rowIndex + 1; next < rows.length; next += 1) {
              const matchIndex = columnIndices[next]?.indexOf(column) ?? -1;
              const match =
                matchIndex === -1
                  ? undefined
                  : rows[next]?.definitions[matchIndex];
              if (match?.verticalMergeContinuation !== true) {
                break;
              }
              rowSpan += 1;
            }
          }
          const borders = this.resolveBorders(definition);
          const background =
            definition?.backgroundIndex === undefined
              ? undefined
              : this.header.colors[definition.backgroundIndex];
          return {
            blocks: cell.blocks,
            ...(colSpan > 1 ? { colSpan } : {}),
            ...(rowSpan > 1 ? { rowSpan } : {}),
            ...(background === undefined ? {} : { background }),
            ...(borders === undefined ? {} : { borders }),
          };
        }),
    }));
  }

  private resolveBorders(
    definition: PendingCell | undefined,
  ): ContentCellBorders | undefined {
    if (definition === undefined) {
      return undefined;
    }
    const colorAt = (index: number): Color | undefined =>
      this.header.colors[index];
    const sides: [CellBorderSide, ContentBorder | undefined][] = (
      ["top", "left", "bottom", "right"] as const
    ).map((side) => {
      const pending = definition.borders[side];
      return [
        side,
        pending === undefined ? undefined : resolveBorder(pending, colorAt),
      ];
    });
    const present = sides.filter(
      (entry): entry is [CellBorderSide, ContentBorder] =>
        entry[1] !== undefined,
    );
    return present.length === 0
      ? undefined
      : Object.fromEntries(present as [string, ContentBorder][]);
  }

  // \cellxN states "the right boundary of a cell, including its half of the space between cells" as a cumulative offset, so a column's width is the difference between consecutive boundaries, with the row's own \trleftN as the first left edge. A boundary sequence that is not increasing is malformed -- it would produce a zero or negative width, which ContentTable's own schema refuses -- so the whole derivation is replaced by an even split of the section's text width, reported rather than silently substituted.
  private columnWidths(columnCount: number): number[] {
    const rights = this.tableColumnRights;
    const widths: number[] = [];
    let previous = this.rowLeftTwips;
    for (const right of rights.slice(0, columnCount)) {
      widths.push(twipsToPoints(right - previous));
      previous = right;
    }
    const usable = twipsToPoints(
      this.header.page.paperWidthTwips -
        this.header.page.marginLeftTwips -
        this.header.page.marginRightTwips,
    );
    if (widths.length !== columnCount || widths.some((width) => width <= 0)) {
      this.sink({
        code: RtfDiagnosticCodes.TABLE_COLUMN_WIDTH_INVALID,
        severity: "warning",
        message:
          "the row's \\cellxN boundaries do not describe increasing column widths for every column; falling back to an even split of the page's text width",
      });
      return Array.from({ length: columnCount }, () => usable / columnCount);
    }
    return widths;
  }

  addBlock(block: ContentBlock): void {
    this.flushRun();
    this.blocks.push(block);
  }

  // How many blocks the relevant list (the open table cell's own, or the section's) currently holds -- used only to mark where \result's own provisionally-rendered fallback paragraphs begin and end, so \object's own group end can retract them if \objdata goes on to decode. Never call this expecting it to reflect a paragraph still accumulating in `runs`/`pendingRunText`: only a closed paragraph (via endParagraph) actually lands in the list this counts.
  blockCount(inTable: boolean): number {
    return inTable ? this.cellBlocks.length : this.blocks.length;
  }

  // Discards exactly the blocks \result provisionally rendered, once \objdata's own real decode has gone on to succeed elsewhere in the same \object group -- the retraction half of the deferred-resolution design described on ObjectState. Bookmark extents recorded against absolute indices while \result's content was still standing (a bookmark straddling the removed range, or opening inside it and closing after) are not renumbered here: \result's own fallback preview is not expected to carry a real document's bookmarks, so this is accepted as a known gap rather than solved, matching the same "not defended against" posture the rest of this reader takes toward inputs it does not expect to see in practice.
  removeBlockRange(inTable: boolean, start: number, end: number): void {
    const target = inTable ? this.cellBlocks : this.blocks;
    target.splice(start, end - start);
  }

  endSection(section: SectionState, para: ParagraphState): void {
    this.endParagraph(para, false);
    this.closeTable();
    this.flushClosingBookmarks(false, this.blocks.length);
    this.reportUnclosedBookmarks();
    const blocks = insertConstructMarkers(
      this.blocks,
      this.sectionBlockExtents,
    );
    this.sectionBlockExtents = [];
    if (blocks.length === 0 && this.sections.length > 0) {
      this.blocks = [];
      return;
    }
    this.sections.push({
      ...sectionGeometry(section),
      ...(section.breakType === undefined
        ? {}
        : { breakType: section.breakType }),
      blocks,
    });
    this.blocks = [];
  }

  // A section's block list is the outermost bracket scope this reader builds, so a bookmark still open when one ends never closes at all. The spec requires that "each bookmark start should have a matching bookmark end"; one that has none names an extent with no end, which neither encoding can state, so it is reported and dropped rather than silently extended to the end of the document.
  private reportUnclosedBookmarks(): void {
    for (const open of this.openBookmarks.values()) {
      this.sink({
        code: RtfDiagnosticCodes.BOOKMARK_UNPAIRED,
        severity: "warning",
        message: `the bookmark '${open.descriptor.name}' has no matching \\bkmkend within its own block flow, so no anchor construct is produced for it`,
      });
    }
    this.openBookmarks.clear();
  }

  finish(
    metadata: LayoutMetadata,
    section: SectionState,
    para: ParagraphState,
  ): ContentDocument {
    this.endSection(section, para);
    if (this.sections.length === 0) {
      this.sections.push({ ...sectionGeometry(section), blocks: [] });
    }
    return { kind: "wordprocessing", metadata, sections: this.sections };
  }
}

function sectionGeometry(section: SectionState): {
  pageSize: PageSize;
  margins: Margins;
} {
  return {
    pageSize: {
      widthPt: twipsToPoints(section.paperWidthTwips),
      heightPt: twipsToPoints(section.paperHeightTwips),
    },
    margins: {
      topPt: twipsToPoints(section.marginTopTwips),
      rightPt: twipsToPoints(section.marginRightTwips),
      bottomPt: twipsToPoints(section.marginBottomTwips),
      leftPt: twipsToPoints(section.marginLeftTwips),
    },
  };
}

// The document-level page geometry, which is also every section's starting point and what \sectd restores. "\sectd Resets to default section properties" (RTF 1.9.1, "Section Formatting Properties") -- the document's own \paperwN/\marglN and their siblings, not a fresh set of paper defaults, since a document declaring A4 does not have its second section silently revert to Letter.
function defaultSectionState(header: RtfHeader): SectionState {
  return {
    paperWidthTwips: header.page.paperWidthTwips,
    paperHeightTwips: header.page.paperHeightTwips,
    marginLeftTwips: header.page.marginLeftTwips,
    marginRightTwips: header.page.marginRightTwips,
    marginTopTwips: header.page.marginTopTwips,
    marginBottomTwips: header.page.marginBottomTwips,
    breakType: undefined,
  };
}

function buildRunFields(
  char: CharacterState,
  fontName: string | undefined,
  color: Color | undefined,
  hyperlink: string | undefined,
): Omit<ContentRun, "text"> {
  return {
    ...(char.bold ? { bold: true } : {}),
    ...(char.italic ? { italic: true } : {}),
    ...(char.underline ? { underline: true } : {}),
    ...(char.strike ? { strike: true } : {}),
    ...(fontName === undefined || fontName.length === 0
      ? {}
      : { fontFamily: fontName }),
    ...{ sizePt: halfPointsToPoints(char.sizeHalfPoints) },
    ...(color === undefined ? {} : { color }),
    ...(hyperlink === undefined ? {} : { hyperlink }),
  };
}

function buildPicture(
  picture: PictureState,
  sink: RtfDiagnosticSink,
): ContentImageBlock | undefined {
  if (picture.format === undefined) {
    sink({
      code: RtfDiagnosticCodes.UNSUPPORTED_PICTURE_FORMAT,
      severity: "warning",
      message: `a \\pict destination declared ${picture.unsupportedFormat ?? "no"} picture format; this reader recognises only \\pngblip and \\jpegblip, so this picture is dropped`,
    });
    return undefined;
  }
  const bytes =
    picture.binary.length > 0
      ? Uint8Array.from(picture.binary)
      : hexToBytes(picture.hex);
  if (bytes.length === 0) {
    sink({
      code: RtfDiagnosticCodes.UNSUPPORTED_PICTURE_FORMAT,
      severity: "warning",
      message: "a \\pict destination carried no picture payload",
    });
    return undefined;
  }
  const scaleX = picture.scaleXPercent / 100;
  const scaleY = picture.scaleYPercent / 100;
  const widthPt =
    picture.widthGoalTwips === undefined
      ? picture.widthPixels === undefined
        ? undefined
        : pixelsToPoints(picture.widthPixels)
      : twipsToPoints(picture.widthGoalTwips);
  const heightPt =
    picture.heightGoalTwips === undefined
      ? picture.heightPixels === undefined
        ? undefined
        : pixelsToPoints(picture.heightPixels)
      : twipsToPoints(picture.heightGoalTwips);
  if (widthPt === undefined || heightPt === undefined) {
    sink({
      code: RtfDiagnosticCodes.PICTURE_SIZE_UNSTATED,
      severity: "warning",
      message:
        "a \\pict destination stated neither \\picwgoalN/\\pichgoalN nor \\picwN/\\pichN, so its rendered size is unknown and the picture is dropped; decoding the payload's own intrinsic size would need an image decoder this package deliberately does not carry",
    });
    return undefined;
  }
  const scaledWidth = widthPt * scaleX;
  const scaledHeight = heightPt * scaleY;
  if (scaledWidth <= 0 || scaledHeight <= 0) {
    sink({
      code: RtfDiagnosticCodes.PICTURE_SIZE_UNSTATED,
      severity: "warning",
      message:
        "a \\pict destination's stated size scaled to zero or less, which ContentImageBlock cannot express",
    });
    return undefined;
  }
  return {
    kind: "image",
    format: picture.format,
    base64: bytesToBase64(bytes),
    widthPt: scaledWidth,
    heightPt: scaledHeight,
  };
}

function defaultPictureState(): PictureState {
  return {
    format: undefined,
    unsupportedFormat: undefined,
    widthGoalTwips: undefined,
    heightGoalTwips: undefined,
    widthPixels: undefined,
    heightPixels: undefined,
    scaleXPercent: 100,
    scaleYPercent: 100,
    hex: "",
    binary: [],
  };
}

// Formats \objwN/\objhN (captured on the enclosing \object's own ObjectState) as a diagnostic clause, reporting whichever of the two is actually present rather than requiring both -- the degrade path's own way of not discarding a size hint the producer genuinely stated, even a partial one, even though nothing in the ContentDocument has a position left to carry it once the real object cannot be decoded.
function objectSizeHintClause(object: ObjectState | undefined): string {
  const widthTwips = object?.widthTwips;
  const heightTwips = object?.heightTwips;
  if (widthTwips !== undefined && heightTwips !== undefined) {
    const widthPt = twipsToPoints(widthTwips).toFixed(2);
    const heightPt = twipsToPoints(heightTwips).toFixed(2);
    return ` (the object's own \\objw/\\objh declared a ${widthPt}pt x ${heightPt}pt size)`;
  }
  if (widthTwips !== undefined) {
    return ` (the object's own \\objw declared a ${twipsToPoints(widthTwips).toFixed(2)}pt width)`;
  }
  if (heightTwips !== undefined) {
    return ` (the object's own \\objh declared a ${twipsToPoints(heightTwips).toFixed(2)}pt height)`;
  }
  return "";
}

// The hex-or-binary payload an ObjectDataState carries, as real bytes.
function objectDataBytes(objectData: ObjectDataState): Uint8Array<ArrayBuffer> {
  return objectData.binary.length > 0
    ? Uint8Array.from(objectData.binary)
    : hexToBytes(objectData.hex);
}

// Turns {\*\objdata ...}'s collected payload back into a ContentEmbeddedObjectBlock, or reports why it cannot and returns undefined -- the object-destination counterpart of buildPicture above. "no payload" and "not this package's own payload" are the two distinct failure shapes (matching buildPicture's own "no format" vs "no size" split): the first never reaches readEmbeddedObjectData at all, and the second is every way a real, foreign OLE object (or simply malformed \objdata) legitimately fails to parse as one. `object` is the enclosing \object's own state, consulted only for its \objw/\objh size hint on the degrade path -- readEmbeddedObjectData never needs it, since a decoded payload carries its own frame.
function buildEmbeddedObject(
  objectData: ObjectDataState,
  object: ObjectState | undefined,
  sink: RtfDiagnosticSink,
): ContentEmbeddedObjectBlock | undefined {
  const bytes = objectDataBytes(objectData);
  if (bytes.length === 0) {
    sink({
      code: RtfDiagnosticCodes.EMBEDDED_OBJECT_UNREADABLE,
      severity: "warning",
      message: `an \\object destination's \\objdata carried no payload${objectSizeHintClause(object)}`,
    });
    return undefined;
  }
  const embedded = readEmbeddedObjectData(bytes);
  if (embedded === undefined) {
    sink({
      code: RtfDiagnosticCodes.EMBEDDED_OBJECT_UNREADABLE,
      severity: "warning",
      message:
        "an \\object destination's \\objdata is not a payload this reader produced (a real OLE object's OLESaveToStream data has no decoder here), so the object is dropped" +
        `${objectSizeHintClause(object)}; its \\result fallback content, if any, is read in its place`,
    });
    return undefined;
  }
  return { kind: "embeddedObject", ...embedded };
}

// A toggle control word is on when it carries no parameter or a non-zero one, and off at exactly 0 -- "\b turns on bold and \b0 turns off bold" (RTF 1.9.1, "Control Word").
function toggleValue(param: number | undefined): boolean {
  return param === undefined || param !== 0;
}

function readRtfDetail(
  input: Uint8Array,
  options: ReadRtfOptions,
): ReadRtfContentResult {
  options.signal?.throwIfAborted();

  const maxInputBytes = options.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES;
  if (input.length > maxInputBytes) {
    throw new RtfInputTooLargeError(input.length, maxInputBytes);
  }
  const maxGroupDepth = options.maxGroupDepth ?? DEFAULT_MAX_GROUP_DEPTH;

  const diagnostics: RtfDiagnostic[] = [];
  const callerSink = options.sink;
  const sink: RtfDiagnosticSink = (diagnostic) => {
    diagnostics.push(diagnostic);
    callerSink?.(diagnostic);
  };

  const tokens = tokenizeRtf(input);
  assertRtfHeaderPresent(tokens);
  const header = readRtfHeader(tokens, sink);
  const builder = new ContentBuilder(header, sink);
  const section = defaultSectionState(header);

  const root: GroupState = {
    destination: "body",
    uc: 1, // "A default of 1 should be assumed if no \ucN keyword has been seen in the current or outer scopes."
    char: defaultCharacterState(),
    para: defaultParagraphState(),
    field: undefined,
    picture: undefined,
    objectData: undefined,
    object: undefined,
    resultOf: undefined,
    resultOpenAt: undefined,
    bookmark: undefined,
    inUnicodeWrapper: false,
  };
  const stack: GroupState[] = [root];
  let state = root;

  // Consecutive ANSI bytes are buffered and decoded as one run, because \ansicpg65001 is UTF-8 and a stateful encoding cannot be decoded a byte at a time. The buffer is flushed at the first event that is not another byte.
  let pendingBytes: number[] = [];
  const activeCodepage = (): number => {
    const fontPage =
      state.char.fontIndex === undefined
        ? undefined
        : header.fonts.get(state.char.fontIndex)?.codepage;
    return fontPage ?? header.codepage;
  };
  const flushBytes = (): void => {
    if (pendingBytes.length === 0) {
      return;
    }
    const text = decodeCodepageBytes(
      Uint8Array.from(pendingBytes),
      activeCodepage(),
      sink,
    );
    pendingBytes = [];
    emitText(text);
  };
  const emitText = (text: string): void => {
    if (state.destination === "body") {
      const hyperlink =
        state.field === undefined
          ? undefined
          : hyperlinkFromInstruction(state.field.instruction);
      builder.appendText(text, state.char, hyperlink);
      return;
    }
    if (state.destination === "fieldInstruction" && state.field !== undefined) {
      state.field.instruction += text;
      return;
    }
    if (
      (state.destination === "bookmarkStart" ||
        state.destination === "bookmarkEnd") &&
      state.bookmark !== undefined
    ) {
      // The bookmark's own #PCDATA is its name, and the two halves are "matched with the bookmark tag".
      state.bookmark.name += text;
      return;
    }
    // "picture" text is handled directly at the token site (it is hex, not characters); "skip", "listText" and "unicodeWrapper" discard.
  };

  let index = 0;
  let textOffset = 0;
  while (index < tokens.length) {
    const token = tokens[index];
    if (token === undefined) {
      break;
    }

    if (token.kind === "groupStart") {
      flushBytes();
      const head = groupHead(tokens, index);
      const known =
        head.destination === undefined
          ? undefined
          : DESTINATION_KINDS.get(head.destination);
      const isHeaderTable =
        head.destination !== undefined &&
        HEADER_DESTINATIONS.has(head.destination);
      const wrapperChild = state.inUnicodeWrapper;
      // \result is \object's own fallback rendering for a reader that cannot decode \objdata at all -- this reader always prefers \objdata, so \result's content is retracted (see \object's own group-end handling further down) whenever \objdata does decode. objectState is the enclosing \object's own shared-by-reference state; see ObjectState's own comment for why \result is rendered provisionally here rather than gated on a lookahead's prediction.
      const objectState = state.object;
      const isResultDestination =
        head.destination === "result" && objectState !== undefined;
      if (objectState !== undefined && isResultDestination) {
        // Recorded regardless of whether this \result is ultimately kept or retracted: \object's own group-end diagnostic (below) needs to know whether a \result existed at all, distinctly from whether \objdata did.
        objectState.resultSeen = true;
      }
      // RTF's own <obj> grammar allows only one \objdata child, but a malformed producer can still write two -- recognised here (rather than left to decode twice into two identical embeddedObject blocks) by objectDataSeen already being true from the first one.
      const isObjectDataDestination =
        head.destination === "objdata" && known === "objectData";
      const isDuplicateObjectData =
        isObjectDataDestination && objectState?.objectDataSeen === true;
      if (isDuplicateObjectData) {
        sink({
          code: RtfDiagnosticCodes.EMBEDDED_OBJECT_UNREADABLE,
          severity: "warning",
          message:
            "an \\object destination has more than one \\objdata child, which RTF's own grammar does not allow; only the first is decoded and this one is discarded",
        });
      } else if (isObjectDataDestination && objectState !== undefined) {
        objectState.objectDataSeen = true;
      }
      // The ANSI half of a {\upr {ansi} {\*\ud unicode}} pair is discarded and the \ud half read, which is exactly what the spec says a Unicode-aware reader must do: the \upr destination "does not use the \* keyword; this forces the old RTF readers to pick up the ANSI representation and discard the Unicode one".
      const kind: DestinationKind =
        isHeaderTable || (wrapperChild && head.destination !== "ud")
          ? "skip"
          : isDuplicateObjectData
            ? "skip"
            : isResultDestination
              ? "body"
              : (known ?? (head.ignorable ? "skip" : state.destination));
      if (head.destination !== undefined && !isHeaderTable) {
        if (head.ignorable && known === undefined) {
          sink({
            code: RtfDiagnosticCodes.UNKNOWN_DESTINATION_SKIPPED,
            severity: "info",
            message: `the ignorable destination \\${head.destination} is not recognised and its content is discarded, as the specification requires`,
          });
        } else if (
          known === "skip" &&
          !SILENT_SKIP_DESTINATIONS.has(head.destination)
        ) {
          // A destination this reader recognises and still discards: a note, an annotation, page furniture, an embedded object. Reported rather than dropped silently, because a reader that says nothing about a construct it decided not to place is indistinguishable from one that never saw it -- and in a format whose readers are REQUIRED to ignore what they do not recognise, that distinction is the only thing a caller has.
          sink({
            code: RtfDiagnosticCodes.CONTENT_DESTINATION_SKIPPED,
            severity: "warning",
            message: `the \\${head.destination} destination's content is discarded: no ContentDocument position carries it`,
          });
        }
      }
      if (kind === "skip") {
        index = matchingGroupEnd(tokens, index) + 1;
        textOffset = 0;
        continue;
      }
      if (stack.length >= maxGroupDepth) {
        throw new RtfNestingLimitExceededError(maxGroupDepth);
      }
      const child = cloneGroupState(state);
      child.inUnicodeWrapper = kind === "unicodeWrapper";
      if (known !== undefined) {
        child.destination = kind;
        if (head.destination === "field") {
          child.field = { instruction: "" };
        }
        if (kind === "picture") {
          child.picture = defaultPictureState();
        }
        if (kind === "objectData") {
          child.objectData = { hex: "", binary: [] };
        }
        if (kind === "object") {
          // Freshly resolved here as the group is actually entered, not predicted ahead of time -- \objdata and \result (below) each report into this same shared state as they are actually read, and \object's own group-end handling (further down) reads it back once every child has been.
          child.object = {
            decoded: false,
            objectDataSeen: false,
            resultSeen: false,
            resultRange: undefined,
            widthTwips: undefined,
            heightTwips: undefined,
          };
        }
        if (kind === "bookmarkStart" || kind === "bookmarkEnd") {
          child.bookmark = {
            name: "",
            columnFirst: undefined,
            columnLast: undefined,
          };
        }
        index = head.contentStart;
      } else {
        index += 1;
      }
      if (objectState !== undefined && isResultDestination) {
        // \result's content is always rendered provisionally as ordinary body paragraphs -- see ObjectState's own comment -- landing wherever the paragraph state active here already resolves to (the open table cell's own blocks, or the section's). Retracted at \object's own group end if \objdata's real decode succeeds, wherever in the token stream that turns out to happen; left standing otherwise. `object` is cleared on this child (rather than inherited, as cloneGroupState would otherwise carry it forward by reference) so that a malformed \objdata nested inside \result's own fallback content -- not itself wrapped in its own \object, which real RTF never does but a hostile or corrupt file could -- decodes or fails entirely on its own terms, without marking THIS \object decoded and so without retracting real content that happened to render alongside it.
        child.resultOf = objectState;
        child.resultOpenAt = {
          inTable: state.para.inTable,
          start: builder.blockCount(state.para.inTable),
        };
        child.object = undefined;
      }
      stack.push(child);
      state = child;
      textOffset = 0;
      continue;
    }

    if (token.kind === "groupEnd") {
      flushBytes();
      if (state.destination === "picture" && state.picture !== undefined) {
        const image = buildPicture(state.picture, sink);
        if (image !== undefined) {
          builder.addBlock(image);
        }
      }
      if (
        state.destination === "objectData" &&
        state.objectData !== undefined
      ) {
        const embedded = buildEmbeddedObject(
          state.objectData,
          state.object,
          sink,
        );
        if (embedded !== undefined) {
          builder.addBlock(embedded);
          // Marks the enclosing \object's shared state so \object's own group-end handling below retracts \result's fallback content instead of leaving it standing alongside the real decoded object -- this reader always prefers the real object over \object's own cached appearance, exactly as Word itself does.
          if (state.object !== undefined) {
            state.object.decoded = true;
          }
        }
      }
      if (state.resultOf !== undefined && state.resultOpenAt !== undefined) {
        // \result's own group has fully rendered its provisional fallback paragraphs by now (every \par it contained has already closed a real paragraph into whichever list state.para.inTable pointed at). Recorded, not yet acted on: \object's own group-end handling further up the stack retracts this range if \objdata's real decode went on to succeed, and this \result's own group-end cannot know that outcome when \result comes first in the source -- \objdata may not even have been read yet.
        state.resultOf.resultRange = {
          inTable: state.resultOpenAt.inTable,
          start: state.resultOpenAt.start,
          end: builder.blockCount(state.resultOpenAt.inTable),
        };
      }
      if (state.destination === "object" && state.object !== undefined) {
        // Every child \objdata/\result this \object's own group can legally contain has, by construction, already closed by the time \object's own closing brace is reached -- so `decoded`, `objectDataSeen` and `resultRange` are all final here, regardless of which sibling the source actually listed first.
        const objectState = state.object;
        if (objectState.decoded && objectState.resultRange !== undefined) {
          builder.removeBlockRange(
            objectState.resultRange.inTable,
            objectState.resultRange.start,
            objectState.resultRange.end,
          );
        }
        // An \object whose \objdata genuinely exists but fails to decode already reports that failure on its own terms (buildEmbeddedObject's own EMBEDDED_OBJECT_UNREADABLE, above) -- this diagnostic is only for the two cases where NOTHING already said so: no \objdata at all, with \result's content used in its place, or no \objdata AND no \result, where the whole construct is silently dropped.
        if (!objectState.objectDataSeen) {
          sink({
            code: RtfDiagnosticCodes.EMBEDDED_OBJECT_UNREADABLE,
            severity: "warning",
            message: objectState.resultSeen
              ? "an \\object destination has no \\objdata payload at all; its \\result fallback content is used in its place"
              : "an \\object destination has neither \\objdata nor \\result content; the whole construct is dropped",
          });
        }
      }
      if (state.bookmark !== undefined) {
        // The name is complete only now: it is the destination's own text, so the closing brace is the first point at which the whole of it has been read.
        const bookmark = {
          ...state.bookmark,
          name: state.bookmark.name.trim(),
        };
        if (state.destination === "bookmarkStart") {
          builder.startBookmark(bookmark, state.para);
        } else if (state.destination === "bookmarkEnd") {
          builder.endBookmark(bookmark.name);
        }
      }
      if (stack.length > 1) {
        stack.pop();
        const parent = stack[stack.length - 1];
        if (parent !== undefined) {
          state = parent;
        }
      } else {
        sink({
          code: RtfDiagnosticCodes.UNBALANCED_GROUP,
          severity: "warning",
          message:
            "a closing brace appeared with no group open; the extra brace is ignored",
          tokenIndex: index,
        });
      }
      index += 1;
      textOffset = 0;
      continue;
    }

    if (token.kind === "text") {
      const slice =
        textOffset === 0 ? token.bytes : token.bytes.subarray(textOffset);
      if (state.destination === "picture" && state.picture !== undefined) {
        state.picture.hex += asciiStringFromBytes(slice);
      } else if (
        state.destination === "objectData" &&
        state.objectData !== undefined
      ) {
        state.objectData.hex += asciiStringFromBytes(slice);
      } else {
        appendBytes(pendingBytes, slice);
      }
      index += 1;
      textOffset = 0;
      continue;
    }

    if (token.kind === "binary") {
      if (state.destination === "picture" && state.picture !== undefined) {
        appendBytes(state.picture.binary, token.bytes);
      } else if (
        state.destination === "objectData" &&
        state.objectData !== undefined
      ) {
        appendBytes(state.objectData.binary, token.bytes);
      }
      index += 1;
      continue;
    }

    if (token.kind === "hex") {
      if (state.destination === "picture" && state.picture !== undefined) {
        // A \'hh inside a picture destination is payload, not text: the hex digits themselves were already consumed by the tokenizer, so the byte goes straight into the binary buffer.
        state.picture.binary.push(token.byte);
      } else if (
        state.destination === "objectData" &&
        state.objectData !== undefined
      ) {
        state.objectData.binary.push(token.byte);
      } else {
        pendingBytes.push(token.byte);
      }
      index += 1;
      continue;
    }

    if (token.kind === "controlSymbol") {
      const text = SPECIAL_SYMBOL_TEXT.get(token.symbol);
      if (text !== undefined) {
        flushBytes();
        emitText(text);
      }
      index += 1;
      continue;
    }

    // Control word.
    if (token.name === "u") {
      flushBytes();
      const code = token.param;
      if (code !== undefined) {
        // "Unicode values greater than 32767 are expressed as negative numbers ... convert F020 to decimal (61472) and subtract 65536." A lone surrogate is emitted with fromCharCode so a surrogate pair written as two \uN keywords composes into one astral character.
        emitText(String.fromCharCode(code < 0 ? code + 0x1_00_00 : code));
      }
      const skipped = skipUnicodeFallback(
        tokens,
        { index: index + 1, textOffset: 0 },
        state.uc,
      );
      index = skipped.index;
      textOffset = skipped.textOffset;
      continue;
    }

    const special = SPECIAL_CHARACTER_TEXT.get(token.name);
    if (special !== undefined) {
      flushBytes();
      emitText(special);
      index += 1;
      continue;
    }

    flushBytes();
    applyControlWord(
      token.name,
      token.param,
      state,
      builder,
      header,
      section,
      sink,
    );
    index += 1;
  }

  flushBytes();
  if (stack.length > 1) {
    sink({
      code: RtfDiagnosticCodes.UNBALANCED_GROUP,
      severity: "warning",
      message: `${String(stack.length - 1)} group(s) were still open at the end of the input; each is treated as closing there`,
    });
  }

  const document = builder.finish(header.metadata, section, root.para);
  return { document, diagnostics };
}

function assertRtfHeaderPresent(tokens: readonly RtfToken[]): void {
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

// The control-word dispatch, split by which piece of group state each word writes to rather than kept as one flat table. The split is by state, not by an arbitrary size budget: a picture control word can only mean anything inside a \pict destination, a character word writes the character state the spec scopes to the group, a paragraph word writes the paragraph state applied at the next \par, and a structural word drives the block/table builder. Each helper says whether it recognised the word, so applyControlWord below reads as the priority order the specification itself implies -- destination first, then formatting, then structure -- and an unrecognised word falls through to being ignored, which is what the spec requires of any control word a reader does not know.

function applyPictureControlWord(
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
    default:
      return;
  }
}

function applyCharacterControlWord(
  name: string,
  param: number | undefined,
  state: GroupState,
  header: RtfHeader,
): boolean {
  switch (name) {
    case "plain":
      state.char = defaultCharacterState();
      return true;
    case "b":
      state.char.bold = toggleValue(param);
      return true;
    case "i":
      state.char.italic = toggleValue(param);
      return true;
    case "strike":
      state.char.strike = toggleValue(param);
      return true;
    case "v":
      state.char.hidden = toggleValue(param);
      return true;
    case "ulnone":
      state.char.underline = false;
      return true;
    case "f":
      state.char.fontIndex = param ?? header.defaultFontIndex;
      return true;
    case "fs":
      state.char.sizeHalfPoints = param ?? DEFAULT_FONT_SIZE_HALF_POINTS;
      return true;
    case "cf":
      state.char.colorIndex = param;
      return true;
    case "uc":
      if (param !== undefined && param >= 0) state.uc = param;
      return true;
    // The <chrev> production. Each writes the revision half of the character state, which rides the group stack with the rest of it.
    case "revised":
      state.char.revision = {
        ...state.char.revision,
        revised: toggleValue(param),
      };
      return true;
    case "revauth":
      state.char.revision = { ...state.char.revision, revisedAuthor: param };
      return true;
    case "revdttm":
      state.char.revision = { ...state.char.revision, revisedDateTime: param };
      return true;
    case "deleted":
      state.char.revision = {
        ...state.char.revision,
        deleted: toggleValue(param),
      };
      return true;
    case "revauthdel":
      state.char.revision = { ...state.char.revision, deletedAuthor: param };
      return true;
    case "revdttmdel":
      state.char.revision = { ...state.char.revision, deletedDateTime: param };
      return true;
    case "mvf":
      state.char.revision = {
        ...state.char.revision,
        moved: toggleValue(param) ? "moveFrom" : undefined,
      };
      return true;
    case "mvt":
      state.char.revision = {
        ...state.char.revision,
        moved: toggleValue(param) ? "moveTo" : undefined,
      };
      return true;
    case "mvauth":
      state.char.revision = { ...state.char.revision, movedAuthor: param };
      return true;
    case "mvdate":
      state.char.revision = { ...state.char.revision, movedDateTime: param };
      return true;
    case "crauth":
      state.char.revision = { ...state.char.revision, formatAuthor: param };
      return true;
    case "crdate":
      state.char.revision = { ...state.char.revision, formatDateTime: param };
      return true;
    default:
      // Underline is a family of control words rather than one: "\ul* Continuous underline. \ul0 turns off all underlining" plus a dozen styled variants (\uld, \uldash, \ulth, \ulwave, ...), all of which ContentRun expresses as the one boolean it carries. \ulc (underline colour) is deliberately not one of them.
      if (name.startsWith("ul") && name !== "ulc") {
        state.char.underline = toggleValue(param);
        return true;
      }
      return false;
  }
}

function applyParagraphControlWord(
  name: string,
  param: number | undefined,
  state: GroupState,
): boolean {
  const alignment = ALIGNMENTS.get(name);
  if (alignment !== undefined) {
    state.para.alignment = alignment;
    return true;
  }
  switch (name) {
    case "pard":
      state.para = defaultParagraphState();
      return true;
    case "s":
      state.para.styleIndex = param;
      return true;
    case "outlinelevel":
      // "\outlinelevelN ... a value from 0 to 8 ... In the default case, no outline level is specified (same as body text)." A value above 8 is a producer's own spelling of body text, so it clears the level rather than becoming a tenth heading depth.
      state.para.outlineLevel =
        param === undefined || param > 8 ? undefined : param;
      return true;
    case "li":
    case "lin":
      state.para.indentLeftTwips = param ?? 0;
      return true;
    case "fi":
      state.para.indentFirstLineTwips = param ?? 0;
      return true;
    case "sb":
      state.para.spaceBeforeTwips = param ?? 0;
      return true;
    case "sa":
      state.para.spaceAfterTwips = param ?? 0;
      return true;
    case "sl":
      state.para.lineSpacingTwips = param;
      return true;
    case "slmult":
      state.para.lineSpacingIsMultiple = toggleValue(param);
      return true;
    case "pagebb":
      state.para.pageBreakBefore = true;
      return true;
    case "ls":
      state.para.listOverrideIndex = param;
      return true;
    case "ilvl":
      state.para.listLevel = param ?? 0;
      return true;
    case "intbl":
      state.para.inTable = true;
      return true;
    default:
      return false;
  }
}

// The <secfmt> production's own properties (RTF 1.9.1, "Section Formatting Properties"). Every one of them is a section-scoped twin of a document-level control word the header parser already reads -- \pgwsxnN beside \paperwN, \marglsxnN beside \marglN -- because RTF states page geometry twice: once for the document and once per section that departs from it.
function applySectionControlWord(
  name: string,
  param: number | undefined,
  section: SectionState,
  header: RtfHeader,
  sink: RtfDiagnosticSink,
): boolean {
  if (name === "sectd") {
    Object.assign(section, defaultSectionState(header));
    return true;
  }
  if (name === "sbkcol") {
    sink({
      code: RtfDiagnosticCodes.SECTION_BREAK_UNREPRESENTED,
      severity: "info",
      message:
        "\\sbkcol starts the section at a new column; ContentSection.breakType names page-level breaks only, so the break kind is dropped and the section itself is kept",
    });
    section.breakType = undefined;
    return true;
  }
  if (SECTION_BREAK_TYPES.has(name)) {
    section.breakType = SECTION_BREAK_TYPES.get(name);
    return true;
  }
  if (param === undefined) {
    return false;
  }
  switch (name) {
    case "pgwsxn":
      section.paperWidthTwips = param;
      return true;
    case "pghsxn":
      section.paperHeightTwips = param;
      return true;
    case "marglsxn":
      section.marginLeftTwips = param;
      return true;
    case "margrsxn":
      section.marginRightTwips = param;
      return true;
    case "margtsxn":
      section.marginTopTwips = param;
      return true;
    case "margbsxn":
      section.marginBottomTwips = param;
      return true;
    default:
      return false;
  }
}

function applyStructureControlWord(
  name: string,
  param: number | undefined,
  state: GroupState,
  builder: ContentBuilder,
  section: SectionState,
  sink: RtfDiagnosticSink,
): boolean {
  switch (name) {
    case "par":
      builder.endParagraph(state.para, true);
      return true;
    case "trowd":
      state.para.inTable = true;
      builder.startRowDefinition();
      return true;
    case "trleft":
      builder.setRowLeft(param ?? 0);
      return true;
    case "cellx":
      if (param !== undefined) builder.addCellBoundary(param);
      return true;
    case "cell":
      builder.endCell(state.para);
      return true;
    case "row":
      builder.endRow(state.para);
      state.para.inTable = false;
      return true;
    case "nestcell":
    case "nestrow":
      // A nested table is read as ordinary cell content rather than a table inside a cell: \nestcell/\nestrow describe the inner row through a {\*\nesttableprops ...} group whose own <tbldef> this reader does not track separately, so promoting it would need a second row builder keyed by \itapN nesting depth.
      sink({
        code: RtfDiagnosticCodes.NESTED_TABLE_FLATTENED,
        severity: "warning",
        message:
          "a nested table's cell/row marks are read as ordinary cell content; the inner table's own structure is not reconstructed",
      });
      return true;
    case "page":
      builder.endParagraph(state.para, false);
      builder.addBlock({ kind: "pageBreak" });
      return true;
    case "sect":
      // "\sect End of section and paragraph" -- both, in that order: the paragraph closes into the section that is ending, not into the one about to begin.
      builder.endParagraph(state.para, true);
      builder.endSection(section, state.para);
      return true;
    default:
      return false;
  }
}

function applyControlWord(
  name: string,
  param: number | undefined,
  state: GroupState,
  builder: ContentBuilder,
  header: RtfHeader,
  section: SectionState,
  sink: RtfDiagnosticSink,
): void {
  const picture = state.picture;
  if (state.destination === "picture" && picture !== undefined) {
    applyPictureControlWord(name, param, picture);
    return;
  }
  const object = state.object;
  if (state.destination === "object" && object !== undefined) {
    // \objwN/\objhN (RTF 1.9.1, "Objects": <objsize> = \objw \objh), the size hint captured here for objectSizeHintClause's own use on the degrade path -- every other word \object's own scope can carry (\objemb, \objautlink, \objlock, \objupdate, \objsub, ...) is a bare marker this reader does not otherwise act on, since a decoded \objdata carries its own frame and an undecodable one falls back to \result instead.
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
  if (applyCharacterControlWord(name, param, state, header)) {
    return;
  }
  // The <celldef> run comes before the paragraph dispatch: several of its members share a prefix with paragraph border words, and a cell definition's own side is the narrower reading whenever one is open.
  if (builder.applyCellDefinition(name, param)) {
    return;
  }
  if (applyParagraphControlWord(name, param, state)) {
    return;
  }
  if (applySectionControlWord(name, param, section, header, sink)) {
    return;
  }
  applyStructureControlWord(name, param, state, builder, section, sink);
}

export function readRtfContent(
  input: Uint8Array | string,
  options: ReadRtfOptions = {},
): ReadRtfContentResult {
  return readRtfDetail(
    typeof input === "string" ? rtfBytesFromLatin1(input) : input,
    options,
  );
}

export function readRtf(
  input: Uint8Array | string,
  options: ReadRtfOptions = {},
): ReadRtfResult {
  const { document, diagnostics } = readRtfContent(input, options);
  return { documentPackage: assembleTree(document), diagnostics };
}
