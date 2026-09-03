import type {
  Alignment,
  Color,
  ContentBlock,
  ContentDocument,
  ContentParagraph,
  ContentRun,
  DocumentTree,
} from "document-schema.js";
import { assembleTree, PAGE_SIZE_LETTER } from "document-schema.js";
import { uint16At } from "./bytes/view";
import {
  openWpdDocument,
  type WpdDocumentContainer,
} from "./container/container";
import {
  PACKET_TYPE_DESIRED_FONT_DESCRIPTOR,
  packetByPrefixId,
  readTypefaceName,
} from "./container/prefix";
import {
  NOOP_WPD_DIAGNOSTIC_SINK,
  WpdDiagnosticCodes,
  type WpdDiagnosticSink,
} from "./diagnostics";
import {
  ATTRIBUTE_OFF,
  ATTRIBUTE_ON,
  decodeAttributeByte,
  runAttributesFrom,
  type WpdRunAttributes,
} from "./stream/attributes";
import {
  decodeSingleByteCharacter,
  decodeWpCharacter,
  UNMAPPED_CHARACTER,
} from "./stream/characters";
import {
  eolMappingForSubfunction,
  EOL_GROUP,
  isSingleByteEol,
  subfunctionForSingleByteEol,
  type WpdEolMapping,
} from "./stream/eol";
import { tokeniseDocumentArea, type WpdToken } from "./stream/tokenise";

// -- Document area to ContentDocument --
//
// The document area is a flat stream of characters and function codes, so building a document out of it is a fold: characters accumulate into the current run, an attribute or font change closes that run and opens another, and an end-of-line function closes the current paragraph. Nothing here is recursive and nothing looks ahead, which is what makes a hand-written reader tractable for this format at all.
//
// What each function code means comes from the specification's own tables, not from inference -- most importantly the "Conversion/Search mappings" column of the End-of-Line group (src/stream/eol.ts), which states outright which codes a converting application should turn into a space and which into a hard return.

// The single-byte functions this reader gives a meaning to, from WPFF "Single-Byte Functions". Everything else in 0x80-0xB3 is a formatting or bookkeeping code that contributes no characters and no structure -- a speller-clean marker, a joiner control, a math-column code -- and is passed over rather than listed.
const SOFT_SPACE = 0x80;
const HARD_SPACE = 0x81;
const SOFT_HYPHEN_IN_LINE = 0x82;
const SOFT_HYPHEN_AT_END_OF_LINE = 0x83;
const HARD_HYPHEN_IN_LINE = 0x84;
const AUTO_HYPHEN_AT_END_OF_LINE = 0x85;
const INVISIBLE_RETURN_IN_LINE = 0x86;
const DORMANT_HARD_RETURN = 0x87;
const SOFT_END_OF_CENTER_ALIGN = 0x88;
const HARD_END_OF_CENTER_ALIGN = 0x89;
const START_OF_TEXT_TO_SKIP = 0x8d;
const END_OF_TEXT_TO_SKIP = 0x8e;

// Variable-length groups and the subgroups this reader interprets.
const PARAGRAPH_GROUP = 0xd3;
const PARAGRAPH_SET_JUSTIFICATION = 0x05;
const CHARACTER_GROUP = 0xd4;
const CHARACTER_COLOR = 0x18;
const CHARACTER_FONT_FACE_CHANGE = 0x1a;
const CHARACTER_FONT_SIZE_CHANGE = 0x1b;

// Fixed-length function codes this reader interprets.
const EXTENDED_CHARACTER = 0xf0;

// "0 = left, 1 = full, 2 = center, 3 = right, 4 = full all lines (kinto waritsuke), 5 = reserved (decimal aligned in tables)", per WPFF D3 Paragraph, Set Justification Mode. Members 4 and 5 have no counterpart in the shared schema's four-member Alignment: full-all-lines is a justification variant the schema does not distinguish from `justify`, and decimal alignment is a table-cell concern rather than a paragraph one, so it maps to the same `left` a cell's text defaults to.
const JUSTIFICATION: readonly Alignment[] = [
  "left",
  "justify",
  "center",
  "right",
  "justify",
  "left",
];

// "Font point sizes are given in 3600ths of an inch", per WPFF Document Structure's units glossary. A point is 1/72 inch, so 3600ths divide by 50 to give points.
const THREE_THOUSAND_SIX_HUNDREDTHS_PER_POINT = 50;

// The colour byte range the SDK states for RGB: "Each color takes one byte with a range from 0 to 255 (0xFF) where 255 is 100%." The shared schema's Color is 0..1, so each component divides by 255.
const COLOR_COMPONENT_MAX = 255;

// WordPerfect's own default page for a US-English installation, and the margins the SDK's generic prefix leaves a document with: US Letter, one inch on every side. Used because this reader does not yet interpret the Page group (0xD1), where a document that overrides either states it -- see the README's Remaining scope. A default stated once and named is honest; a page size invented per document would not be.
const DEFAULT_MARGIN_PT = 72;

export interface ReadWpdOptions {
  readonly sink?: WpdDiagnosticSink;
}

interface ReaderState {
  readonly blocks: ContentBlock[];
  readonly runs: ContentRun[];
  text: string;
  readonly activeAttributes: Set<number>;
  attributes: WpdRunAttributes;
  fontFamily: string | undefined;
  sizePt: number | undefined;
  color: Color | undefined;
  alignment: Alignment | undefined;
  // "The surrounded text is passed over by the formatter and is not displayed", per the Start/End of Text to Skip pair. Nested pairs are possible, so this is a depth rather than a flag.
  skipDepth: number;
  tableReported: boolean;
}

function sameAttributes(a: WpdRunAttributes, b: WpdRunAttributes): boolean {
  return (
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.strike === b.strike
  );
}

function buildRun(state: ReaderState): ContentRun {
  const run: ContentRun = { text: state.text };
  return {
    ...run,
    ...(state.attributes.bold ? { bold: true } : {}),
    ...(state.attributes.italic ? { italic: true } : {}),
    ...(state.attributes.underline ? { underline: true } : {}),
    ...(state.attributes.strike ? { strike: true } : {}),
    ...(state.fontFamily === undefined ? {} : { fontFamily: state.fontFamily }),
    ...(state.sizePt === undefined ? {} : { sizePt: state.sizePt }),
    ...(state.color === undefined ? {} : { color: state.color }),
  };
}

// Closes the run currently accumulating, if it has any text. A formatting change with no text between it and the previous one produces no run at all rather than an empty one.
function flushRun(state: ReaderState): void {
  if (state.text.length === 0) {
    return;
  }
  state.runs.push(buildRun(state));
  state.text = "";
}

// Closes the current paragraph. Called for every hard return, so a document with two consecutive hard returns genuinely produces an empty paragraph between them -- that blank line is content the author typed, not an artefact.
function flushParagraph(state: ReaderState): void {
  flushRun(state);
  const paragraph: ContentParagraph = {
    kind: "paragraph",
    runs: state.runs.splice(0, state.runs.length),
    ...(state.alignment === undefined ? {} : { alignment: state.alignment }),
  };
  state.blocks.push(paragraph);
}

function appendText(state: ReaderState, text: string): void {
  if (state.skipDepth > 0) {
    return;
  }
  state.text += text;
}

// Applies whatever the End-of-Line group's conversion table says this code means. The table is shared by the single-byte spelling (0xB4-0xCF) and the multi-byte one (group 0xD0), because the specification states the two are interchangeable.
function applyEolMapping(
  state: ReaderState,
  mapping: WpdEolMapping,
  sink: WpdDiagnosticSink,
): void {
  switch (mapping) {
    case "ignore":
      return;
    case "space":
      appendText(state, " ");
      return;
    case "hardReturn":
      flushParagraph(state);
      return;
    case "hardEndOfColumn":
      // The shared content schema has no column-break block: ContentSection.breakType describes how a section begins, not a break inside one. Ending the paragraph keeps the text on either side apart, which is the part that matters for content, and the diagnostic records what was lost.
      sink({
        code: WpdDiagnosticCodes.ColumnBreakFlattened,
        message: "A column break became a paragraph break.",
      });
      flushParagraph(state);
      return;
    case "hardEndOfPage":
      flushParagraph(state);
      state.blocks.push({ kind: "pageBreak" });
      return;
    case "tableCell":
    case "tableRow":
    case "hardTableRow":
    case "tableOff":
      // Tables are out of this reader's scope (see the README). Every cell and row boundary still ends a paragraph, so a table's text survives in reading order rather than running together into one string; only the grid is lost. Reported once per document rather than once per cell.
      if (!state.tableReported) {
        state.tableReported = true;
        sink({
          code: WpdDiagnosticCodes.TableFlattened,
          message:
            "This document contains a table; its cells and rows became paragraphs, and the table structure was not reconstructed.",
        });
      }
      flushParagraph(state);
      return;
  }
}

function applySingleByteFunction(
  state: ReaderState,
  code: number,
  sink: WpdDiagnosticSink,
): void {
  if (isSingleByteEol(code)) {
    const mapping = eolMappingForSubfunction(subfunctionForSingleByteEol(code));
    if (mapping !== undefined) {
      applyEolMapping(state, mapping, sink);
    }
    return;
  }
  switch (code) {
    case SOFT_SPACE:
      appendText(state, " ");
      return;
    case HARD_SPACE:
      // "A hard space holds two words together on one line (names, dates, etc)" -- exactly what U+00A0 is for, so the distinction from a soft space survives into the shared schema rather than being flattened away. Written as an escape rather than the literal character, which is indistinguishable from a plain space in source.
      appendText(state, "\u00A0");
      return;
    case SOFT_HYPHEN_IN_LINE:
    case INVISIBLE_RETURN_IN_LINE:
      // Both mark a permitted break point that is not currently taken, and neither shows a character: "the soft hyphen code remains in the document, but has no effect", and the invisible return "indicates that a word can be broken at this point, but a hyphen won't be visible".
      return;
    case SOFT_HYPHEN_AT_END_OF_LINE:
    case HARD_HYPHEN_IN_LINE:
    case AUTO_HYPHEN_AT_END_OF_LINE:
      appendText(state, "-");
      return;
    case DORMANT_HARD_RETURN:
      // "Whenever a [HRt] code appears alone at the top of a page that starts with a soft page break, the formatter changes the Hard Return code into a Dormant Hard Return code." It is a hard return whose blank line the formatter suppresses at a page top; the paragraph boundary the author typed is still there, so it is kept.
      flushParagraph(state);
      return;
    case SOFT_END_OF_CENTER_ALIGN:
      // "The formatter inserts a soft End of Line, which causes centering to end, but not the paragraph" -- a wrap, so the same space every other soft end of line converts to.
      appendText(state, " ");
      return;
    case HARD_END_OF_CENTER_ALIGN:
      // "The Enter key is pressed, ending the line, the centering, and the paragraph."
      flushParagraph(state);
      return;
    case START_OF_TEXT_TO_SKIP:
      state.skipDepth += 1;
      return;
    case END_OF_TEXT_TO_SKIP:
      state.skipDepth = Math.max(0, state.skipDepth - 1);
      return;
    default:
      // Every remaining single-byte function is a formatting or bookkeeping marker that contributes neither characters nor structure.
      return;
  }
}

function applyFontFaceChange(
  state: ReaderState,
  prefixIds: readonly number[],
  container: WpdDocumentContainer,
  sink: WpdDiagnosticSink,
): void {
  const prefixId = prefixIds[0];
  if (prefixId === undefined) {
    return;
  }
  const packet = packetByPrefixId(container.packets, prefixId);
  if (packet === undefined) {
    sink({
      code: WpdDiagnosticCodes.MissingPrefixPacket,
      message: `A font face change names prefix ID ${prefixId}, which this document's index does not carry.`,
    });
    return;
  }
  if (packet.packetType !== PACKET_TYPE_DESIRED_FONT_DESCRIPTOR) {
    return;
  }
  const typeface = readTypefaceName(packet.bytes);
  if (typeface === undefined) {
    return;
  }
  flushRun(state);
  state.fontFamily = typeface;
}

function applyVariableFunction(
  state: ReaderState,
  token: Extract<WpdToken, { kind: "variableFunction" }>,
  container: WpdDocumentContainer,
  sink: WpdDiagnosticSink,
): void {
  if (token.group === EOL_GROUP) {
    const mapping = eolMappingForSubfunction(token.subgroup);
    if (mapping !== undefined) {
      applyEolMapping(state, mapping, sink);
    }
    return;
  }
  if (
    token.group === PARAGRAPH_GROUP &&
    token.subgroup === PARAGRAPH_SET_JUSTIFICATION
  ) {
    const mode = token.nonDeletable[0];
    if (mode !== undefined) {
      // A justification change applies from here on, so it lands on the paragraph currently being built and every later one until the next change.
      state.alignment = JUSTIFICATION[mode];
    }
    return;
  }
  if (token.group !== CHARACTER_GROUP) {
    return;
  }
  switch (token.subgroup) {
    case CHARACTER_FONT_FACE_CHANGE:
      applyFontFaceChange(state, token.prefixIds, container, sink);
      return;
    case CHARACTER_FONT_SIZE_CHANGE: {
      // "[desired point size (3600ths)]" is the first field of this function's non-deletable data. Its prefix ID names the OLD typeface descriptor, so it says nothing about the face and is deliberately not read here.
      if (token.nonDeletable.length < 2) {
        return;
      }
      const sizePt =
        uint16At(token.nonDeletable, 0) /
        THREE_THOUSAND_SIX_HUNDREDTHS_PER_POINT;
      if (sizePt <= 0) {
        return;
      }
      flushRun(state);
      state.sizePt = sizePt;
      return;
    }
    case CHARACTER_COLOR: {
      const [r, g, b] = token.nonDeletable;
      if (r === undefined || g === undefined || b === undefined) {
        return;
      }
      flushRun(state);
      state.color = {
        r: r / COLOR_COMPONENT_MAX,
        g: g / COLOR_COMPONENT_MAX,
        b: b / COLOR_COMPONENT_MAX,
      };
      return;
    }
    default:
      return;
  }
}

function applyFixedFunction(
  state: ReaderState,
  token: Extract<WpdToken, { kind: "fixedFunction" }>,
  sink: WpdDiagnosticSink,
): void {
  if (token.code === EXTENDED_CHARACTER) {
    // "[WP character] = (<character> <WP character set number>)" -- a short whose low byte is the character number and whose high byte is the set.
    const characterNumber = token.data[0];
    const characterSet = token.data[1];
    if (characterNumber === undefined || characterSet === undefined) {
      return;
    }
    const decoded = decodeWpCharacter(characterSet, characterNumber);
    if (decoded === undefined) {
      sink({
        code: WpdDiagnosticCodes.UnmappedCharacter,
        message: `Character ${characterNumber} of WordPerfect character set ${characterSet} has no mapping in this package and was rendered as U+FFFD.`,
      });
      appendText(state, UNMAPPED_CHARACTER);
      return;
    }
    appendText(state, decoded);
    return;
  }
  if (token.code !== ATTRIBUTE_ON && token.code !== ATTRIBUTE_OFF) {
    return;
  }
  const payload = token.data[0];
  if (payload === undefined) {
    return;
  }
  const { attribute, ignore } = decodeAttributeByte(payload);
  if (ignore) {
    return;
  }
  if (token.code === ATTRIBUTE_ON) {
    state.activeAttributes.add(attribute);
  } else {
    state.activeAttributes.delete(attribute);
  }
  const next = runAttributesFrom(state.activeAttributes);
  if (sameAttributes(next, state.attributes)) {
    // An attribute the shared schema cannot express -- shadow, small caps, redline -- changed state. Nothing about the runs being built changes, so the current run keeps accumulating rather than being split at a boundary no reader could see.
    return;
  }
  flushRun(state);
  state.attributes = next;
}

function foldTokens(
  tokens: readonly WpdToken[],
  container: WpdDocumentContainer,
  sink: WpdDiagnosticSink,
): ContentBlock[] {
  const state: ReaderState = {
    blocks: [],
    runs: [],
    text: "",
    activeAttributes: new Set<number>(),
    attributes: runAttributesFrom(new Set<number>()),
    fontFamily: undefined,
    sizePt: undefined,
    color: undefined,
    alignment: undefined,
    skipDepth: 0,
    tableReported: false,
  };

  for (const token of tokens) {
    switch (token.kind) {
      case "character": {
        const character = decodeSingleByteCharacter(token.byte);
        if (character === undefined) {
          sink({
            code: WpdDiagnosticCodes.UnmappedCharacter,
            message: `Byte ${token.byte} in the document area has no character mapping and was rendered as U+FFFD.`,
          });
          appendText(state, UNMAPPED_CHARACTER);
          break;
        }
        appendText(state, character);
        break;
      }
      case "singleByteFunction":
        applySingleByteFunction(state, token.code, sink);
        break;
      case "variableFunction":
        applyVariableFunction(state, token, container, sink);
        break;
      case "fixedFunction":
        applyFixedFunction(state, token, sink);
        break;
    }
  }

  // Whatever is still accumulating when the stream ends is a final paragraph only if it actually holds text. A document ending in a hard return has already had its last paragraph closed, and fabricating an empty one after it would invent a blank line the author never typed.
  flushRun(state);
  if (state.runs.length > 0) {
    flushParagraph(state);
  }
  return state.blocks;
}

// Reads a WordPerfect 6.x-X6 document into the shared flat ContentDocument. Accepts both containers: a bare WordPerfect file and one wrapped in an OLE compound file's PerfectOffice_MAIN stream.
export function readWpdContent(
  bytes: Uint8Array,
  options: ReadWpdOptions = {},
): ContentDocument {
  const sink = options.sink ?? NOOP_WPD_DIAGNOSTIC_SINK;
  const container = openWpdDocument(bytes);
  const tokens = tokeniseDocumentArea(
    container.bytes,
    container.documentAreaOffset,
    container.documentAreaEnd,
  );
  const blocks = foldTokens(tokens, container, sink);
  return {
    kind: "wordprocessing",
    // Document metadata lives in prefix packets this reader does not yet interpret (see the README's Remaining scope), so an empty envelope is the honest answer rather than fields invented from the file's structure.
    metadata: {},
    sections: [
      {
        pageSize: PAGE_SIZE_LETTER,
        margins: {
          topPt: DEFAULT_MARGIN_PT,
          rightPt: DEFAULT_MARGIN_PT,
          bottomPt: DEFAULT_MARGIN_PT,
          leftPt: DEFAULT_MARGIN_PT,
        },
        blocks,
      },
    ],
  };
}

// The same read, one level up: the tree-form DocumentTree every other codec in the family also offers, assembled from the flat document by document-schema.js's own transform.
export function readWpd(
  bytes: Uint8Array,
  options: ReadWpdOptions = {},
): DocumentTree {
  return assembleTree(readWpdContent(bytes, options));
}
