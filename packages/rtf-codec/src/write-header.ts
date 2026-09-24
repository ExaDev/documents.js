// The header-table half of the writer: \fonttbl, \colortbl, \stylesheet, the list tables, the revision-author table, \info, and the document-level page geometry, in the order RTF 1.9.1's own "Header" section requires them.
import { escapeText } from "./write-text";
import { line, raw, type Writer } from "./write-state";
import type { WordprocessingDocument } from "./write-tables";
import { pointsToTwips } from "./units";

// The \levelnfcN value for each marker type this writer emits: 23 is "Bullet (no number at all)", 0 is "Arabic (1, 2, 3)".
const LEVEL_NUMBER_FORMAT_BULLET = 23;
const LEVEL_NUMBER_FORMAT_ARABIC = 0;

// One level of list indentation, in twips. Word's own default for a list level, and the value its \liN/\fiN pair uses: half an inch of left indent with the marker hanging back by a quarter. Exported: write-body.ts's own paragraphProperties needs the identical indent this table's own \listlevel entries use.
export const LIST_LEVEL_INDENT_TWIPS = 720;
export const LIST_MARKER_HANG_TWIPS = 360;

// The \leveltext/\levelnumbers payload for a bullet level: one character of level text, U+00B7 (the bullet Word writes for a Symbol-font level), and no number placeholders. Written as the spec's own #SDATA form, a length byte followed by the characters.
const BULLET_LEVEL_TEXT = "\\'01\\u183 ?";
// The same for an arabic level: two characters, the level-0 placeholder and a full stop, with \levelnumbers naming byte 1 as the placeholder position.
const ARABIC_LEVEL_TEXT = "\\'02\\'00.";

// The document code page the writer declares. cp1252 is what \ansi itself means in practice and what every consumer handles; nothing depends on it beyond the ASCII range, since the writer emits no byte above 0x7F.
const OUTPUT_CODEPAGE = 1252;

export function writeHeader(
  writer: Writer,
  document: WordprocessingDocument,
): void {
  raw(writer, `{\\rtf1\\ansi\\ansicpg${String(OUTPUT_CODEPAGE)}\\deff0\\uc1`);
  writeDocumentGeometry(writer, document);
  // The document-level bidirectional pair, among the document properties that "can occur before and between the header tables" alongside the geometry above. \ltrdoc is the spec's own default ("This document will have English-style pagination (the default)"), so it is written only for a stated `direction: "ltr"`, never as a restated default.
  if (document.metadata.direction === "rtl") {
    raw(writer, "\\rtldoc");
  } else if (document.metadata.direction === "ltr") {
    raw(writer, "\\ltrdoc");
  }
  writeFontTable(writer);
  writeColorTable(writer);
  writeStyleSheet(writer);
  writeListTables(writer);
  writeRevisionTable(writer);
  writeInfoGroup(writer, document);
  line(writer, "");
}

function writeFontTable(writer: Writer): void {
  raw(writer, "{\\fonttbl");
  // No sort needed: noteRun assigns each font's own index as fonts.size at first sight, so the Map's own insertion order (which a for-of always iterates in) already IS ascending-index order.
  for (const [name, index] of writer.tables.fonts) {
    raw(writer, `{\\f${String(index)}\\fnil\\fcharset0 ${escapeText(name)};}`);
  }
  raw(writer, "}");
}

function writeColorTable(writer: Writer): void {
  if (writer.tables.colors.size === 0) {
    return;
  }
  // The leading semicolon is the auto colour at index 0, exactly as the spec's own example writes it.
  raw(writer, "{\\colortbl;");
  // No sort needed: noteColor assigns each colour's own index as colors.size + 1 at first sight, so the Map's own insertion order already IS ascending-index order — see writeFontTable's identical reasoning.
  for (const [hex] of writer.tables.colors) {
    const red = Number.parseInt(hex.slice(0, 2), 16);
    const green = Number.parseInt(hex.slice(2, 4), 16);
    const blue = Number.parseInt(hex.slice(4, 6), 16);
    raw(
      writer,
      `\\red${String(red)}\\green${String(green)}\\blue${String(blue)};`,
    );
  }
  raw(writer, "}");
}

function writeStyleSheet(writer: Writer): void {
  if (writer.tables.headingStyles.size === 0) {
    return;
  }
  raw(writer, "{\\stylesheet{\\s0\\snext0 Normal;}");
  for (const [level, handle] of [...writer.tables.headingStyles].sort(
    (left, right) => left[0] - right[0],
  )) {
    // \outlinelevelN is 0-based, so a level-1 heading declares outline level 0 — the inverse of what the reader does with it.
    raw(
      writer,
      `{\\s${String(handle)}\\sbasedon0\\snext0\\outlinelevel${String(level - 1)} heading ${String(level)};}`,
    );
  }
  raw(writer, "}");
}

function writeListTables(writer: Writer): void {
  if (writer.tables.lists.size === 0) {
    return;
  }
  // No sort needed: noteBlock assigns each list's own index as lists.size + 1 at first sight, so the Map's own insertion order already IS ascending-index order — see writeFontTable's identical reasoning.
  const entries = [...writer.tables.lists.values()];
  raw(writer, "{\\*\\listtable");
  for (const entry of entries) {
    const bullet = entry.definition.type === "bullet";
    const numberFormat = bullet
      ? LEVEL_NUMBER_FORMAT_BULLET
      : LEVEL_NUMBER_FORMAT_ARABIC;
    const levelText = bullet ? BULLET_LEVEL_TEXT : ARABIC_LEVEL_TEXT;
    const levelNumbers = bullet ? "" : "\\'01";
    raw(writer, `{\\list\\listtemplateid${String(entry.index)}\\listhybrid`);
    // Nine levels, as \listhybrid requires ("Present if the list has 9 levels"), each indented one step further than the last so a consumer's own rendering of a nested item matches the \ilvlN this writer emits for it.
    for (let level = 0; level < 9; level += 1) {
      const indent = LIST_LEVEL_INDENT_TWIPS * (level + 1);
      raw(
        writer,
        `{\\listlevel\\levelnfc${String(numberFormat)}\\levelnfcn${String(numberFormat)}` +
          `\\leveljc0\\leveljcn0\\levelfollow0\\levelstartat${String(entry.definition.start)}` +
          `\\levelspace0\\levelindent0{\\leveltext${levelText};}{\\levelnumbers${levelNumbers};}` +
          `\\fi-${String(LIST_MARKER_HANG_TWIPS)}\\li${String(indent)}\\lin${String(indent)}}`,
      );
    }
    raw(writer, `\\listid${String(1000 + entry.index)}}`);
  }
  raw(writer, "}{\\*\\listoverridetable");
  for (const entry of entries) {
    raw(
      writer,
      `{\\listoverride\\listid${String(1000 + entry.index)}\\listoverridecount0\\ls${String(entry.index)}}`,
    );
  }
  raw(writer, "}");
}

function writeRevisionTable(writer: Writer): void {
  if (writer.tables.revisionAuthors.size <= 1) {
    return;
  }
  raw(writer, "{\\*\\revtbl");
  // No sort needed: noteDescriptor assigns each author's own index as revisionAuthors.size at first sight (with "Unknown" pre-seeded at 0), so the Map's own insertion order already IS ascending-index order — see writeFontTable's identical reasoning.
  for (const [author] of writer.tables.revisionAuthors) {
    raw(writer, `{${escapeText(author)};}`);
  }
  raw(writer, "}");
}

function writeInfoGroup(
  writer: Writer,
  document: WordprocessingDocument,
): void {
  const { title, author, subject, keywords } = document.metadata;
  const fields: string[] = [];
  if (title !== undefined) fields.push(`{\\title ${escapeText(title)}}`);
  if (author !== undefined) fields.push(`{\\author ${escapeText(author)}}`);
  if (subject !== undefined) fields.push(`{\\subject ${escapeText(subject)}}`);
  if (keywords !== undefined && keywords.length > 0) {
    fields.push(`{\\keywords ${escapeText(keywords.join("; "))}}`);
  }
  if (fields.length > 0) {
    raw(writer, `{\\info${fields.join("")}}`);
  }
}

// The document-level page geometry, stated once in the header from the first section's own. RTF states geometry twice — \paperwN/\marglN for the document, \pgwsxnN/\marglsxnN per section (RTF 1.9.1, "Document Formatting Properties" and "Section Formatting Properties") — and a reader that understands neither the section family nor multiple sections still lays the document out on the right paper this way.
function writeDocumentGeometry(
  writer: Writer,
  document: WordprocessingDocument,
): void {
  const first = document.sections[0];
  if (first === undefined) {
    return;
  }
  raw(
    writer,
    `\\paperw${String(pointsToTwips(first.pageSize.widthPt))}` +
      `\\paperh${String(pointsToTwips(first.pageSize.heightPt))}` +
      `\\margl${String(pointsToTwips(first.margins.leftPt))}` +
      `\\margr${String(pointsToTwips(first.margins.rightPt))}` +
      `\\margt${String(pointsToTwips(first.margins.topPt))}` +
      `\\margb${String(pointsToTwips(first.margins.bottomPt))}`,
  );
}
