// The three-pass table-minting side of the writer: ContentDocument carries fonts, colours, heading levels and lists as free-standing data rather than the indices RTF's own body actually references, so collectTables walks the document once and mints the four tables write.ts's own writeRtfContent then hands to every write-*.ts helper module.
import {
  type Color,
  type ConstructDescriptor,
  type ContentBlock,
  type ContentDocument,
  type ContentRun,
  clampHeadingLevel,
  colorToRgbHex,
} from "document-schema.js";
import { parseRtfListNumId, type RtfListType } from "./list-id";

export type WordprocessingDocument = Extract<
  ContentDocument,
  { kind: "wordprocessing" }
>;

interface ListDefinition {
  readonly type: RtfListType;
  readonly start: number;
}

export interface DocumentTables {
  // Font family name to its \fN index. Index 0 is always the default font, so a run naming no family needs no \fN at all.
  readonly fonts: Map<string, number>;
  // Lowercase 6-digit hex to its \cfN index. Index 0 is RTF's own "auto" colour, which the table's leading semicolon states and which nothing here mints.
  readonly colors: Map<string, number>;
  // Heading level to its \sN index. Levels are emitted as the built-in "heading N" styles a consumer already understands.
  readonly headingStyles: Map<number, number>;
  // Opaque numId to its \lsN index, alongside what the list actually is.
  readonly lists: Map<string, { index: number; definition: ListDefinition }>;
  // Revision author name to the index \revauthN and its siblings carry. Index 0 is reserved for the "Unknown" placeholder every real producer's table opens with, so a minted author is always non-zero — which is also what makes the reader's own 0-based indexing land on a real name.
  readonly revisionAuthors: Map<string, number>;
}

const UNKNOWN_REVISION_AUTHOR = "Unknown";

const DEFAULT_FONT_NAME = "Times New Roman";

// The order <celldef> states its four sides in.
export const CELL_BORDER_ORDER = ["top", "left", "bottom", "right"] as const;

export function collectTables(document: ContentDocument): DocumentTables {
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
        // Style handle N for heading level N, matching the built-in numbering a consumer expects; handle 0 stays free for Normal. No has() guard: the key and the value are the same level, so re-setting an already-recorded one is a genuine no-op, not a duplicate entry — a guard here would be an equivalent-mutant magnet with no consumer that can tell the difference.
        headingStyles.set(level, level);
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
          // A cell's own colours reference the same \colortbl the runs do, so they must be minted here or a \clcbpatN/\clcfpatN/\brdrcfN would name an index the table never defines. A 'pattern' fill (ExaDev/documents.js#1024) mints both its foreground and background colours — \clcbpatN/\clcfpatN are two independent colour-table references, not one representative colour standing in for the whole fill.
          if (cell.background?.kind === "solid") {
            noteColor(cell.background.color);
          } else if (cell.background?.kind === "pattern") {
            noteColor(cell.background.foregroundColor);
            noteColor(cell.background.backgroundColor);
          }
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

export function colorIndexOf(
  color: Color | undefined,
  colors: ReadonlyMap<string, number>,
): number | undefined {
  return color === undefined ? undefined : colors.get(colorToRgbHex(color));
}
