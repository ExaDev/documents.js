// The write side: a ContentDocument or DocumentTree to RTF bytes, deterministic and byte-stable for one input.
//
// The output targets the same <File> production the reader reads -- '{' <header> <document> '}' -- and states its header tables in the order the grammar requires (\rtf1, character set, \deffN, then \fonttbl, \colortbl, \stylesheet, the list tables), because "each of the various header tables should appear, if they exist, in this order" and "a property must be defined before being referenced" (RTF 1.9.1, "Header").
//
// THREE TABLES ARE MINTED, NOT COPIED. A ContentDocument carries fonts as free-text family names on runs, colours as sRGB triples, headings as a canonical level, and lists as an opaque numId -- none of them as the indices RTF's body actually references. So the writer walks the document once to collect every distinct font family, colour, heading level, and list, mints the four tables from what it found, and then walks it again to emit a body whose \fN, \cfN, \sN and \lsN indices point into them. Two passes, not one, because a table has to be complete before the body that references it is written.
//
// EVERY NON-ASCII CHARACTER LEAVES AS \uN. RTF's own advice is to emit "\uN followed by the best ANSI representation it can manage. Often a question mark is used if no reasonable ANSI character exists", and that is exactly what this writer does, with \uc1 declared once so the fallback is one character. It deliberately does NOT try to find a code page that could carry a given character as a \'hh byte: the output is then pure 7-bit ASCII whatever the input contained, which is the property that makes it safe to transmit and trivially diffable, and it costs nothing a reader can see -- a conforming reader takes \uN and discards the fallback. A character outside the Basic Multilingual Plane is emitted as its two UTF-16 code units, which is what "\uN ... represents the Unicode character value expressed as a decimal number" means for a format whose parameter is a signed 16-bit integer, and matches the spec's own instruction that "Unicode values greater than 32767 are expressed as negative numbers".

import {
  type ContentBlock,
  type ContentDocument,
  type ContentParagraph,
  type ContentRun,
  type ContentSection,
  type ContentTable,
  type Color,
  type DocumentTree,
  clampHeadingLevel,
  colorToRgbHex,
  flattenTree,
} from "document-schema.js";
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

const ALIGNMENT_CONTROL_WORDS: ReadonlyMap<string, string> = new Map([
  ["left", "\\ql"],
  ["center", "\\qc"],
  ["right", "\\qr"],
  ["justify", "\\qj"],
]);

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
}

const DEFAULT_FONT_NAME = "Times New Roman";

function collectTables(document: ContentDocument): DocumentTables {
  const fonts = new Map<string, number>([[DEFAULT_FONT_NAME, 0]]);
  const colors = new Map<string, number>();
  const headingStyles = new Map<number, number>();
  const lists = new Map<
    string,
    { index: number; definition: ListDefinition }
  >();

  const noteRun = (run: ContentRun): void => {
    if (run.fontFamily !== undefined && !fonts.has(run.fontFamily)) {
      fonts.set(run.fontFamily, fonts.size);
    }
    if (run.color !== undefined) {
      const hex = colorToRgbHex(run.color);
      if (!colors.has(hex)) {
        // +1 because index 0 is the auto colour the table's own leading semicolon reserves.
        colors.set(hex, colors.size + 1);
      }
    }
  };

  const noteBlock = (block: ContentBlock): void => {
    if (block.kind === "paragraph") {
      for (const run of block.runs) {
        noteRun(run);
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
  return { fonts, colors, headingStyles, lists };
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

class RtfWriter {
  private out = "";

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

  writeHeader(document: ContentDocument): void {
    this.raw(`{\\rtf1\\ansi\\ansicpg${String(OUTPUT_CODEPAGE)}\\deff0\\uc1`);
    this.writeFontTable();
    this.writeColorTable();
    this.writeStyleSheet();
    this.writeListTables();
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

  private writeInfoGroup(document: ContentDocument): void {
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

  writeSection(section: ContentSection, isFirst: boolean): void {
    if (!isFirst) {
      this.line("\\sect");
    }
    this.line(
      `\\sectd\\paperw${String(pointsToTwips(section.pageSize.widthPt))}` +
        `\\paperh${String(pointsToTwips(section.pageSize.heightPt))}` +
        `\\margl${String(pointsToTwips(section.margins.leftPt))}` +
        `\\margr${String(pointsToTwips(section.margins.rightPt))}` +
        `\\margt${String(pointsToTwips(section.margins.topPt))}` +
        `\\margb${String(pointsToTwips(section.margins.bottomPt))}`,
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
      case "constructEnd":
        this.sink({
          code: RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED,
          severity: "warning",
          message: `a ${block.kind} boundary marker is dropped; this writer emits no RTF construct for the fidelity-construct vocabulary`,
        });
        return;
      default:
        return;
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
    for (const run of paragraph.runs) {
      this.writeRun(run);
    }
    if (!inTable) {
      this.line("\\par");
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

  private writeRun(run: ContentRun): void {
    const properties = this.runProperties(run);
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
    for (const row of table.rows) {
      // "\cellxN Defines the right boundary of a cell", cumulative from the row's own left edge, so the boundaries are a running total of the column widths.
      let right = 0;
      const boundaries: number[] = [];
      for (let column = 0; column < row.cells.length; column += 1) {
        right += pointsToTwips(table.columnWidthsPt[column] ?? 0);
        boundaries.push(right);
      }
      const rowDefinition = `\\trowd\\trgaph108\\trleft0${boundaries
        .map((boundary) => `\\cellx${String(boundary)}`)
        .join("")}`;
      // Word 2002 onward writes the row properties both before and after the row, which the spec explicitly calls out as the shape a reader should not assume otherwise; emitting both makes the output readable by either kind of reader.
      this.line(rowDefinition);
      for (const cell of row.cells) {
        if (cell.borders !== undefined || cell.background !== undefined) {
          this.sink({
            code: RtfDiagnosticCodes.CELL_BORDER_DROPPED,
            severity: "info",
            message:
              "a table cell's borders or background are dropped; this writer emits cell boundaries only",
          });
        }
        this.writeCellBlocks(cell.blocks);
        this.raw("\\cell");
      }
      this.line(`${rowDefinition}\\row`);
    }
    this.line("\\pard");
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
    image: {
      readonly format: "png" | "jpeg";
      readonly widthPt: number;
      readonly heightPt: number;
    },
  ): void {
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
