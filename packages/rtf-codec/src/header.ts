// The RTF header: the five mini-formats the specification puts before the document body, plus the document-level properties that "can occur before and between the header tables".
//
// <header> is \rtf1 \fbidis? <character set> <from>? <deffont> <deflang> <fonttbl>? <filetbl>? <colortbl>? <stylesheet>? <stylerestrictions>? <listtables>? <revtbl>? <rsidtable>? <mathprops>? <generator>? (RTF 1.9.1, "Header"). Each table is its own grammar rather than a variation on one, which is why this module is a parser per table rather than a single generic one.
//
// It is read in its own pass over the whole token stream, ahead of the body pass in src/read.ts, rather than inline with the body. The specification does require a property to "be defined before being referenced" -- "The font table must precede any reference to a font", "The style sheet must occur before any style usage" -- so an inline single pass would in principle work on conforming input. A separate pass is used anyway for two reasons: it makes the body reader's own state machine carry no header-table cases at all (the tables are already resolved by the time it starts), and it makes the reader correct on the real-world producer that emits a table late, which the specification's own "RTF readers should be robust enough to handle some minor variations" invites. The cost is one extra linear walk.
//
// What each table is read FOR is narrower than what each table CONTAINS, deliberately: this is a reader targeting ContentDocument, not a general RTF object model. The font table is read for face names and per-font code pages, because a run's bytes decode through its font's page; the colour table for RGB, because a run's colour is an index into it; the style sheet for style names and heading levels, because ContentParagraph carries styleId and headingLevel; the list tables for each list's own level number formats, because a paragraph's \lsN alone cannot say whether its list is bulleted or numbered. Everything else each table carries -- PANOSE data, embedded font payloads, theme colour references, key codes, level text templates -- is read past. Those omissions are listed in the package README rather than each being commented here.

import type { Color } from "document-schema.js";
import type { LayoutMetadata } from "document-schema.js";
import {
  codepageForFontCharset,
  DEFAULT_CODEPAGE,
  DOCUMENT_CHARSET_CODEPAGES,
  decodeCodepageBytes,
} from "./codepage";
import { appendBytes } from "./bytes";
import type { RtfDiagnosticSink } from "./diagnostics";
import { groupHead, matchingGroupEnd } from "./group";
import type { RtfToken } from "./tokenize";
import {
  DEFAULT_MARGIN_BOTTOM_TWIPS,
  DEFAULT_MARGIN_LEFT_TWIPS,
  DEFAULT_MARGIN_RIGHT_TWIPS,
  DEFAULT_MARGIN_TOP_TWIPS,
  DEFAULT_PAPER_HEIGHT_TWIPS,
  DEFAULT_PAPER_WIDTH_TWIPS,
} from "./units";

const RGB_MAX = 255;

// The \fontfamily production's own eight keywords, minus their \f prefix -- the value carried through to a font entry so a consumer can substitute sensibly when the exact face is unavailable, which is the whole reason the spec gives for the family existing ("RTF also supports font families so that applications can attempt to intelligently choose fonts if the exact font is not present on the reading system").
const FONT_FAMILIES: ReadonlySet<string> = new Set([
  "fnil",
  "froman",
  "fswiss",
  "fmodern",
  "fscript",
  "fdecor",
  "ftech",
  "fbidi",
]);

// A built-in heading style's own name, as Word writes it into the style sheet: "heading 1" through "heading 9". Matched case-insensitively and tolerating the hyphenated spelling some producers emit.
const HEADING_STYLE_NAME = /^heading[ -]?([1-9])$/i;

export interface RtfFontEntry {
  readonly name: string;
  // The family keyword with its leading 'f' stripped: 'roman', 'swiss', 'modern', and so on.
  readonly family: string | undefined;
  // The page this font's own bytes decode through, from \cpgN or, failing that, the page \fcharsetN implies. Absent means the document's own page applies.
  readonly codepage: number | undefined;
}

export interface RtfStyleEntry {
  readonly name: string;
  // 1-based, from the style's own \outlinelevelN (0-based, so +1) or from a built-in "heading N" name.
  readonly headingLevel: number | undefined;
}

export interface RtfListLevel {
  // \levelnfcN. 23 is the bullet; every other value in the spec's table is a numbering scheme.
  readonly numberFormat: number;
  readonly startAt: number;
}

export interface RtfListEntry {
  readonly levels: readonly RtfListLevel[];
}

export interface RtfPageGeometry {
  readonly paperWidthTwips: number;
  readonly paperHeightTwips: number;
  readonly marginLeftTwips: number;
  readonly marginRightTwips: number;
  readonly marginTopTwips: number;
  readonly marginBottomTwips: number;
}

export interface RtfHeader {
  readonly codepage: number;
  readonly defaultFontIndex: number | undefined;
  readonly fonts: ReadonlyMap<number, RtfFontEntry>;
  // Indexed by the \cfN/\cbN value. Index 0 is the "auto" colour the table's own leading semicolon states, which has no RGB and so is undefined rather than black.
  readonly colors: readonly (Color | undefined)[];
  readonly styles: ReadonlyMap<number, RtfStyleEntry>;
  // Keyed by \lsN -- the list override index a paragraph actually carries -- with the indirection through \listoverride's \listidN to the \list already resolved, so a body reader never sees the two tables separately.
  readonly lists: ReadonlyMap<number, RtfListEntry>;
  readonly page: RtfPageGeometry;
  readonly metadata: LayoutMetadata;
  // Where the body starts: the index just past the last header table, so src/read.ts can skip what has already been read here. Header tables are recognised by destination, not position, so this is the highest such index seen rather than an assumption about ordering.
  readonly bodyStartIndex: number;
}

// Destinations this module consumes; the body reader skips exactly these, so the two lists cannot drift.
export const HEADER_DESTINATIONS: ReadonlySet<string> = new Set([
  "fonttbl",
  "colortbl",
  "stylesheet",
  "listtable",
  "listoverridetable",
  "info",
  "filetbl",
  "revtbl",
  "rsidtbl",
  "generator",
  "pgptbl",
  "themedata",
  "colorschememapping",
  "latentstyles",
  "listtextoverride",
  "xmlnstbl",
  "wgrffmtfilter",
  "datastore",
  "protusertbl",
  "mmathPr",
  "stylerestrictions",
  "userprops",
]);

interface MutablePageGeometry {
  paperWidthTwips: number;
  paperHeightTwips: number;
  marginLeftTwips: number;
  marginRightTwips: number;
  marginTopTwips: number;
  marginBottomTwips: number;
}

// Collects a destination's own plain text -- the shape every leaf text production in the header shares (a font's <fontname>, a style's <stylename>, an \info field's value). Control words inside are skipped rather than interpreted, and a nested group is skipped whole: the {\*\falt ...} alternate-name subgroup inside a <fontinfo> is exactly why, since its text is a different font's name and folding it into the face name would corrupt every entry carrying one.
function collectPlainText(
  tokens: readonly RtfToken[],
  start: number,
  end: number,
  codepage: number,
  sink: RtfDiagnosticSink,
): string {
  const pending: number[] = [];
  let out = "";
  const flush = (): void => {
    if (pending.length === 0) return;
    out += decodeCodepageBytes(Uint8Array.from(pending), codepage, sink);
    pending.length = 0;
  };
  for (let index = start; index < end; index += 1) {
    const token = tokens[index];
    if (token === undefined) break;
    if (token.kind === "groupStart") {
      flush();
      index = matchingGroupEnd(tokens, index);
      continue;
    }
    if (token.kind === "text") {
      appendBytes(pending, token.bytes);
      continue;
    }
    if (token.kind === "hex") {
      pending.push(token.byte);
      continue;
    }
    if (token.kind === "controlWord" && token.name === "u") {
      flush();
      const code = token.param;
      if (code !== undefined) {
        out += String.fromCodePoint(code < 0 ? code + 0x1_00_00 : code);
      }
    }
  }
  flush();
  // A table entry's text is terminated by a semicolon in every production that has one; the semicolon is the delimiter, not part of the value.
  return out.replace(/;\s*$/, "").trim();
}

function parseFontTable(
  tokens: readonly RtfToken[],
  contentStart: number,
  end: number,
  documentCodepage: number,
  fonts: Map<number, RtfFontEntry>,
  sink: RtfDiagnosticSink,
): void {
  // The grammar admits a <fontinfo> either braced or bare: '{' \fonttbl (<fontinfo> | ('{' <fontinfo> '}'))+ '}'. Both are handled by treating each brace-delimited child as one entry and, when there is no brace at all, the remaining span as a single entry.
  let index = contentStart;
  let sawBracedEntry = false;
  while (index < end) {
    const token = tokens[index];
    if (token?.kind !== "groupStart") {
      index += 1;
      continue;
    }
    sawBracedEntry = true;
    const entryEnd = Math.min(matchingGroupEnd(tokens, index), end);
    readFontInfo(tokens, index + 1, entryEnd, documentCodepage, fonts, sink);
    index = entryEnd + 1;
  }
  if (!sawBracedEntry) {
    readFontInfo(tokens, contentStart, end, documentCodepage, fonts, sink);
  }
}

function readFontInfo(
  tokens: readonly RtfToken[],
  start: number,
  end: number,
  documentCodepage: number,
  fonts: Map<number, RtfFontEntry>,
  sink: RtfDiagnosticSink,
): void {
  let number: number | undefined;
  let family: string | undefined;
  let charsetPage: number | undefined;
  let explicitPage: number | undefined;
  let nameStart = start;
  for (let index = start; index < end; index += 1) {
    const token = tokens[index];
    if (token === undefined) break;
    if (token.kind !== "controlWord") {
      continue;
    }
    if (token.name === "f" && token.param !== undefined) {
      number = token.param;
      nameStart = index + 1;
      continue;
    }
    if (FONT_FAMILIES.has(token.name)) {
      family = token.name.slice(1);
      nameStart = index + 1;
      continue;
    }
    if (token.name === "fcharset" && token.param !== undefined) {
      charsetPage = codepageForFontCharset(token.param);
      nameStart = index + 1;
      continue;
    }
    if (token.name === "cpg" && token.param !== undefined) {
      explicitPage = token.param;
      nameStart = index + 1;
      continue;
    }
    if (token.name === "fprq" || token.name === "fbias") {
      nameStart = index + 1;
    }
  }
  if (number === undefined) {
    return;
  }
  const name = collectPlainText(
    tokens,
    nameStart,
    end,
    explicitPage ?? charsetPage ?? documentCodepage,
    sink,
  );
  // "\cpgN ... if it appears, supersedes the codepage given by \fcharsetN".
  fonts.set(number, { name, family, codepage: explicitPage ?? charsetPage });
}

function parseColorTable(
  tokens: readonly RtfToken[],
  contentStart: number,
  end: number,
  colors: (Color | undefined)[],
): void {
  // <colordef> is '\redN? & \greenN? & \blueN? ";"' -- the semicolon is the entry terminator, and an entry with no components at all (the table's own leading ";") is the auto colour.
  let red: number | undefined;
  let green: number | undefined;
  let blue: number | undefined;
  const finishEntry = (): void => {
    colors.push(
      red === undefined && green === undefined && blue === undefined
        ? undefined
        : {
            r: (red ?? 0) / RGB_MAX,
            g: (green ?? 0) / RGB_MAX,
            b: (blue ?? 0) / RGB_MAX,
          },
    );
    red = undefined;
    green = undefined;
    blue = undefined;
  };
  for (let index = contentStart; index < end; index += 1) {
    const token = tokens[index];
    if (token === undefined) break;
    if (token.kind === "controlWord") {
      if (token.name === "red") red = token.param ?? 0;
      else if (token.name === "green") green = token.param ?? 0;
      else if (token.name === "blue") blue = token.param ?? 0;
      continue;
    }
    if (token.kind === "text") {
      for (const byte of token.bytes) {
        if (byte === 0x3b) {
          finishEntry();
        }
      }
    }
  }
}

function parseStyleSheet(
  tokens: readonly RtfToken[],
  contentStart: number,
  end: number,
  documentCodepage: number,
  styles: Map<number, RtfStyleEntry>,
  sink: RtfDiagnosticSink,
): void {
  for (let index = contentStart; index < end; index += 1) {
    const token = tokens[index];
    if (token?.kind !== "groupStart") {
      continue;
    }
    const entryEnd = Math.min(matchingGroupEnd(tokens, index), end);
    readStyle(tokens, index, entryEnd, documentCodepage, styles, sink);
    index = entryEnd;
  }
}

function readStyle(
  tokens: readonly RtfToken[],
  start: number,
  end: number,
  documentCodepage: number,
  styles: Map<number, RtfStyleEntry>,
  sink: RtfDiagnosticSink,
): void {
  const head = groupHead(tokens, start);
  // <styledef> is \sN | \*\csN | \*\dsN | \*\tsN. Only the paragraph style is read: ContentParagraph.styleId is a paragraph-level field, and a character or table style has no node to land on.
  if (head.ignorable) {
    return;
  }
  // "For <style>, both <styledef> and <stylename> are optional; the default is paragraph style 0."
  let handle = 0;
  let outlineLevel: number | undefined;
  let nameStart = head.contentStart;
  for (let index = start + 1; index < end; index += 1) {
    const token = tokens[index];
    if (token === undefined) break;
    if (token.kind === "groupStart") {
      index = Math.min(matchingGroupEnd(tokens, index), end);
      nameStart = index + 1;
      continue;
    }
    if (token.kind !== "controlWord") {
      continue;
    }
    if (token.name === "s" && token.param !== undefined) {
      handle = token.param;
    } else if (token.name === "outlinelevel" && token.param !== undefined) {
      outlineLevel = token.param;
    }
    nameStart = index + 1;
  }
  const name = collectPlainText(tokens, nameStart, end, documentCodepage, sink);
  const byName = HEADING_STYLE_NAME.exec(name);
  const fromName = byName?.[1];
  const headingLevel =
    outlineLevel === undefined
      ? fromName === undefined
        ? undefined
        : Number(fromName)
      : outlineLevel + 1;
  styles.set(handle, { name, headingLevel });
}

// The \list entries, keyed by their own \listidN. Resolved onto \lsN by the override table below.
function parseListTable(
  tokens: readonly RtfToken[],
  contentStart: number,
  end: number,
  listsById: Map<number, RtfListEntry>,
): void {
  for (let index = contentStart; index < end; index += 1) {
    const token = tokens[index];
    if (token?.kind !== "groupStart") {
      continue;
    }
    const entryEnd = Math.min(matchingGroupEnd(tokens, index), end);
    const head = groupHead(tokens, index);
    // A \list with no \listidN of its own is skipped by readListDefinition rather than keyed under a fabricated id: an override reaches a list only by naming its \listidN, so a list without one is unreachable by construction.
    if (head.destination === "list") {
      readListDefinition(tokens, index, entryEnd, listsById);
    }
    index = entryEnd;
  }
}

function readListDefinition(
  tokens: readonly RtfToken[],
  start: number,
  end: number,
  listsById: Map<number, RtfListEntry>,
): number | undefined {
  const levels: RtfListLevel[] = [];
  let listId: number | undefined;
  for (let index = start + 1; index < end; index += 1) {
    const token = tokens[index];
    if (token === undefined) break;
    if (token.kind === "groupStart") {
      const inner = Math.min(matchingGroupEnd(tokens, index), end);
      if (groupHead(tokens, index).destination === "listlevel") {
        levels.push(readListLevel(tokens, index, inner));
      }
      index = inner;
      continue;
    }
    if (
      token.kind === "controlWord" &&
      token.name === "listid" &&
      token.param !== undefined
    ) {
      listId = token.param;
    }
  }
  if (listId === undefined) {
    return undefined;
  }
  listsById.set(listId, { levels });
  return listId;
}

function readListLevel(
  tokens: readonly RtfToken[],
  start: number,
  end: number,
): RtfListLevel {
  let numberFormat = 0;
  let startAt = 1;
  for (let index = start + 1; index < end; index += 1) {
    const token = tokens[index];
    if (token === undefined) break;
    if (token.kind === "groupStart") {
      index = Math.min(matchingGroupEnd(tokens, index), end);
      continue;
    }
    if (token.kind !== "controlWord") {
      continue;
    }
    if (token.name === "levelnfc" && token.param !== undefined) {
      numberFormat = token.param;
    } else if (token.name === "levelstartat" && token.param !== undefined) {
      startAt = token.param;
    }
  }
  return { numberFormat, startAt };
}

// "Each list override contains the \listidN of one of the lists in the List table" and its own \lsN, "a 1-based index into this table" that paragraphs actually carry. Resolving the indirection here means the body reader deals in \lsN alone.
function parseListOverrideTable(
  tokens: readonly RtfToken[],
  contentStart: number,
  end: number,
  overrides: Map<number, number>,
): void {
  for (let index = contentStart; index < end; index += 1) {
    const token = tokens[index];
    if (token?.kind !== "groupStart") {
      continue;
    }
    const entryEnd = Math.min(matchingGroupEnd(tokens, index), end);
    let listId: number | undefined;
    let overrideIndex: number | undefined;
    for (let inner = index + 1; inner < entryEnd; inner += 1) {
      const child = tokens[inner];
      if (child?.kind === "groupStart") {
        inner = Math.min(matchingGroupEnd(tokens, inner), entryEnd);
        continue;
      }
      if (child?.kind !== "controlWord" || child.param === undefined) {
        continue;
      }
      if (child.name === "listid") listId = child.param;
      else if (child.name === "ls") overrideIndex = child.param;
    }
    if (listId !== undefined && overrideIndex !== undefined) {
      overrides.set(overrideIndex, listId);
    }
    index = entryEnd;
  }
}

function parseInfoGroup(
  tokens: readonly RtfToken[],
  contentStart: number,
  end: number,
  codepage: number,
  sink: RtfDiagnosticSink,
): LayoutMetadata {
  const metadata: {
    title?: string;
    author?: string;
    subject?: string;
    keywords?: string[];
    creator?: string;
  } = {};
  for (let index = contentStart; index < end; index += 1) {
    const token = tokens[index];
    if (token?.kind !== "groupStart") {
      continue;
    }
    const fieldEnd = Math.min(matchingGroupEnd(tokens, index), end);
    const head = groupHead(tokens, index);
    const value = collectPlainText(
      tokens,
      head.contentStart,
      fieldEnd,
      codepage,
      sink,
    );
    if (value.length > 0) {
      if (head.destination === "title") metadata.title = value;
      else if (head.destination === "author") metadata.author = value;
      else if (head.destination === "subject") metadata.subject = value;
      else if (head.destination === "keywords")
        metadata.keywords = value.split(/[;,]\s*/).filter((k) => k.length > 0);
      else if (head.destination === "operator") metadata.creator = value;
    }
    index = fieldEnd;
  }
  return metadata;
}

export function readRtfHeader(
  tokens: readonly RtfToken[],
  sink: RtfDiagnosticSink,
): RtfHeader {
  const fonts = new Map<number, RtfFontEntry>();
  const colors: (Color | undefined)[] = [];
  const styles = new Map<number, RtfStyleEntry>();
  const listsById = new Map<number, RtfListEntry>();
  const overrides = new Map<number, number>();
  const page: MutablePageGeometry = {
    paperWidthTwips: DEFAULT_PAPER_WIDTH_TWIPS,
    paperHeightTwips: DEFAULT_PAPER_HEIGHT_TWIPS,
    marginLeftTwips: DEFAULT_MARGIN_LEFT_TWIPS,
    marginRightTwips: DEFAULT_MARGIN_RIGHT_TWIPS,
    marginTopTwips: DEFAULT_MARGIN_TOP_TWIPS,
    marginBottomTwips: DEFAULT_MARGIN_BOTTOM_TWIPS,
  };
  let metadata: LayoutMetadata = {};
  let codepage = DEFAULT_CODEPAGE;
  let defaultFontIndex: number | undefined;
  let bodyStartIndex = 0;

  // Document properties first, in their own sweep of the file group's top level: the character set keyword and \ansicpgN both precede the tables, and the font table's own entries decode through whichever page they name. The tables are then read in a second sweep, so a header that violates the stated ordering still reads.
  const fileGroupEnd = matchingGroupEnd(tokens, 0);
  for (let index = 0; index < fileGroupEnd; index += 1) {
    const token = tokens[index];
    if (token?.kind === "groupStart" && index > 0) {
      index = Math.min(matchingGroupEnd(tokens, index), fileGroupEnd);
      continue;
    }
    if (token?.kind !== "controlWord") {
      continue;
    }
    const charsetPage = DOCUMENT_CHARSET_CODEPAGES.get(token.name);
    if (charsetPage !== undefined) {
      codepage = charsetPage;
      continue;
    }
    if (token.param === undefined) {
      continue;
    }
    switch (token.name) {
      case "ansicpg":
        codepage = token.param;
        break;
      case "deff":
        defaultFontIndex = token.param;
        break;
      case "paperw":
        page.paperWidthTwips = token.param;
        break;
      case "paperh":
        page.paperHeightTwips = token.param;
        break;
      case "margl":
        page.marginLeftTwips = token.param;
        break;
      case "margr":
        page.marginRightTwips = token.param;
        break;
      case "margt":
        page.marginTopTwips = token.param;
        break;
      case "margb":
        page.marginBottomTwips = token.param;
        break;
      default:
        break;
    }
  }

  for (let index = 1; index < fileGroupEnd; index += 1) {
    const token = tokens[index];
    if (token?.kind !== "groupStart") {
      continue;
    }
    const groupEnd = Math.min(matchingGroupEnd(tokens, index), fileGroupEnd);
    const head = groupHead(tokens, index);
    switch (head.destination) {
      case "fonttbl":
        parseFontTable(
          tokens,
          head.contentStart,
          groupEnd,
          codepage,
          fonts,
          sink,
        );
        break;
      case "colortbl":
        parseColorTable(tokens, head.contentStart, groupEnd, colors);
        break;
      case "stylesheet":
        parseStyleSheet(
          tokens,
          head.contentStart,
          groupEnd,
          codepage,
          styles,
          sink,
        );
        break;
      case "listtable":
        parseListTable(tokens, head.contentStart, groupEnd, listsById);
        break;
      case "listoverridetable":
        parseListOverrideTable(tokens, head.contentStart, groupEnd, overrides);
        break;
      case "info":
        metadata = parseInfoGroup(
          tokens,
          head.contentStart,
          groupEnd,
          codepage,
          sink,
        );
        break;
      default:
        break;
    }
    if (
      head.destination !== undefined &&
      HEADER_DESTINATIONS.has(head.destination)
    ) {
      bodyStartIndex = Math.max(bodyStartIndex, groupEnd + 1);
    }
    index = groupEnd;
  }

  const lists = new Map<number, RtfListEntry>();
  for (const [overrideIndex, listId] of overrides) {
    const list = listsById.get(listId);
    if (list !== undefined) {
      lists.set(overrideIndex, list);
    }
  }

  return {
    codepage,
    defaultFontIndex,
    fonts,
    colors,
    styles,
    lists,
    page,
    metadata,
    bodyStartIndex,
  };
}
