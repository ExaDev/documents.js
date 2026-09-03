// The read side of this package's public surface, in both encodings document-schema.js states for one document: readRtf produces the tree-form DocumentTree (the primary entry point), readRtfContent produces the flat ContentDocument the state machine below actually builds.
//
// Why two, and why assembleTree rather than bare decompose, are both settled precedent in this family rather than decisions taken here -- see markdown-codec's own src/read.ts header for the full reasoning. In short: document-schema.js owns both encodings and calls assembleTree "the one helper a construction site calls"; a codec is a construction site; and the unsuffixed name is the one a caller should reach for, with the `Content` suffix naming the flat constituent underneath it (ooxml.js's readXlsx/readXlsxContent set that convention). There is no `pages` argument because RTF has no layout stage in this package at all.
//
// THE STATE MACHINE. RTF's reader model is stated directly by the specification ("Conventions of an RTF Reader") and is what this module implements literally: an opening brace stores the current state on a stack, a closing brace retrieves it, a backslash collects a control word or symbol and dispatches on it, and anything else is text written "to the current destination using the current formatting properties". Four kinds of state ride that stack, exactly as the spec enumerates them -- the destination, character-formatting properties, paragraph-formatting properties, and table-formatting properties -- with one addition of this reader's own, the \ucN skip count, which the spec separately requires be stacked ("values are scoped like character properties ... On exiting the group, the previous \ucN value is restored").
//
// WHAT THE DESTINATION DOES. A destination is not merely a label: it decides what happens to text. Body text becomes runs; a \pict destination's text is hex picture payload; a \fldinst destination's text is a field instruction to be parsed rather than shown; a \listtext destination's text is the flat rendering of a list number that "should be ignored by any reader that understands Word 97 through Word 2007 numbering"; an unrecognised {\* destination's text is discarded whole. DESTINATION_KINDS below is that mapping, and it is the reason this reader can be a single pass with no lookahead beyond a group's own head.
//
// TABLES ARE PARAGRAPH PROPERTIES, NOT A GROUP. "There is no RTF table group; instead, tables are specified as paragraph properties." A row is a run of \intbl paragraphs terminated by \cell marks and closed by \row, with the row's own <tbldef> (\trowd ... \cellxN) sitting before it, after it, or -- for Word 2002 onward -- both. So the table builder here is driven by the \cell/\row marks in the text stream rather than by nesting, and a table closes when a non-table paragraph arrives or the section ends.
//
// UNICODE. \uN carries the character and is followed by an ANSI approximation that a Unicode-aware reader must skip: "the reader should ignore the next N' characters, where N' corresponds to the last \ucN' value encountered", where "any RTF control word or symbol is considered a single character" and a brace ends the skippable run early. skipUnicodeFallback below implements exactly that, including the partial consumption of a text run, which is why the main loop carries a byte offset alongside its token index.

import {
  assembleTree,
  type Alignment,
  type Color,
  type ContentBlock,
  type ContentDocument,
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
} from "document-schema.js";
import { bytesToBase64, hexToBytes } from "./base64";
import { rtfBytesFromLatin1 } from "./bytes";
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
  | "unicodeWrapper"; // \upr, whose ANSI half is discarded and whose \ud half is read

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
  ["bkmkstart", "skip"],
  ["bkmkend", "skip"],
  ["object", "skip"],
  ["objdata", "skip"],
  ["objclass", "skip"],
  ["objname", "skip"],
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

interface GroupState {
  destination: DestinationKind;
  uc: number;
  char: CharacterState;
  para: ParagraphState;
  field: FieldState | undefined;
  picture: PictureState | undefined;
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

class ContentBuilder {
  private readonly sections: ContentSection[] = [];
  private blocks: ContentBlock[] = [];
  private runs: ContentRun[] = [];
  private pendingRunKey: string | undefined;
  private pendingRunText = "";
  private pendingRunFields: Omit<ContentRun, "text"> = {};
  private tableRows: ContentTableRow[] = [];
  private tableColumnRights: number[] = [];
  private rowCells: ContentTableCell[] = [];
  private cellBlocks: ContentBlock[] = [];
  private pendingCellRights: number[] = [];
  private rowLeftTwips = 0;
  private paragraphSeen = false;

  constructor(
    private readonly header: RtfHeader,
    private readonly sink: RtfDiagnosticSink,
  ) {}

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
    }
    this.pendingRunText += text;
  }

  private flushRun(): void {
    if (this.pendingRunText.length > 0) {
      this.runs.push({ ...this.pendingRunFields, text: this.pendingRunText });
    }
    this.pendingRunText = "";
    this.pendingRunKey = undefined;
    this.pendingRunFields = {};
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
    target.push(this.buildParagraph(para));
    this.runs = [];
    this.paragraphSeen = true;
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
    const paragraph: ContentParagraph = { kind: "paragraph", runs: this.runs };
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
    this.rowLeftTwips = 0;
  }

  setRowLeft(twips: number): void {
    this.rowLeftTwips = twips;
  }

  addCellBoundary(rightTwips: number): void {
    this.pendingCellRights.push(rightTwips);
  }

  endCell(para: ParagraphState): void {
    this.endParagraph(para, false);
    this.rowCells.push({ blocks: this.cellBlocks });
    this.cellBlocks = [];
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
    this.tableRows.push({ cells: this.rowCells });
    if (this.tableColumnRights.length === 0) {
      this.tableColumnRights = [...this.pendingCellRights];
    }
    this.rowCells = [];
  }

  closeTable(): void {
    if (this.tableRows.length === 0) {
      return;
    }
    const columnCount = Math.max(
      ...this.tableRows.map((row) => row.cells.length),
    );
    this.blocks.push({
      kind: "table",
      rows: this.tableRows,
      columnWidthsPt: this.columnWidths(columnCount),
    } satisfies ContentTable);
    this.tableRows = [];
    this.tableColumnRights = [];
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

  endSection(pageSize: PageSize, margins: Margins, para: ParagraphState): void {
    this.endParagraph(para, false);
    this.closeTable();
    if (this.blocks.length === 0 && this.sections.length > 0) {
      return;
    }
    this.sections.push({ pageSize, margins, blocks: this.blocks });
    this.blocks = [];
  }

  finish(
    metadata: LayoutMetadata,
    pageSize: PageSize,
    margins: Margins,
    para: ParagraphState,
  ): ContentDocument {
    this.endSection(pageSize, margins, para);
    if (this.sections.length === 0) {
      this.sections.push({ pageSize, margins, blocks: [] });
    }
    return { kind: "wordprocessing", metadata, sections: this.sections };
  }

  get hasParagraph(): boolean {
    return this.paragraphSeen;
  }
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
      message: `a \\pict destination declared ${picture.unsupportedFormat ?? "no"} picture format; ContentImageBlock carries PNG and JPEG only, so this picture is dropped`,
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

  const pageSize: PageSize = {
    widthPt: twipsToPoints(header.page.paperWidthTwips),
    heightPt: twipsToPoints(header.page.paperHeightTwips),
  };
  const margins: Margins = {
    topPt: twipsToPoints(header.page.marginTopTwips),
    rightPt: twipsToPoints(header.page.marginRightTwips),
    bottomPt: twipsToPoints(header.page.marginBottomTwips),
    leftPt: twipsToPoints(header.page.marginLeftTwips),
  };

  const root: GroupState = {
    destination: "body",
    uc: 1, // "A default of 1 should be assumed if no \ucN keyword has been seen in the current or outer scopes."
    char: defaultCharacterState(),
    para: defaultParagraphState(),
    field: undefined,
    picture: undefined,
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
      // The ANSI half of a {\upr {ansi} {\*\ud unicode}} pair is discarded and the \ud half read, which is exactly what the spec says a Unicode-aware reader must do: the \upr destination "does not use the \* keyword; this forces the old RTF readers to pick up the ANSI representation and discard the Unicode one".
      const kind: DestinationKind =
        isHeaderTable || (wrapperChild && head.destination !== "ud")
          ? "skip"
          : (known ?? (head.ignorable ? "skip" : state.destination));
      if (
        head.ignorable &&
        known === undefined &&
        !isHeaderTable &&
        head.destination !== undefined
      ) {
        sink({
          code: RtfDiagnosticCodes.UNKNOWN_DESTINATION_SKIPPED,
          severity: "info",
          message: `the ignorable destination \\${head.destination} is not recognised and its content is discarded, as the specification requires`,
        });
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
        index = head.contentStart;
      } else {
        index += 1;
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
          offset: index,
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
        state.picture.hex += String.fromCharCode(...slice);
      } else {
        pendingBytes.push(...slice);
      }
      index += 1;
      textOffset = 0;
      continue;
    }

    if (token.kind === "binary") {
      if (state.destination === "picture" && state.picture !== undefined) {
        state.picture.binary.push(...token.bytes);
      }
      index += 1;
      continue;
    }

    if (token.kind === "hex") {
      if (state.destination === "picture" && state.picture !== undefined) {
        // A \'hh inside a picture destination is payload, not text: the hex digits themselves were already consumed by the tokenizer, so the byte goes straight into the binary buffer.
        state.picture.binary.push(token.byte);
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
    applyControlWord(token.name, token.param, state, builder, header, sink);
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

  const document = builder.finish(
    header.metadata,
    pageSize,
    margins,
    root.para,
  );
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

function applyStructureControlWord(
  name: string,
  param: number | undefined,
  state: GroupState,
  builder: ContentBuilder,
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
      builder.endParagraph(state.para, true);
      return true;
    case "sectd":
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
  sink: RtfDiagnosticSink,
): void {
  const picture = state.picture;
  if (state.destination === "picture" && picture !== undefined) {
    applyPictureControlWord(name, param, picture);
    return;
  }
  if (applyCharacterControlWord(name, param, state, header)) {
    return;
  }
  if (applyParagraphControlWord(name, param, state)) {
    return;
  }
  applyStructureControlWord(name, param, state, builder, sink);
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
