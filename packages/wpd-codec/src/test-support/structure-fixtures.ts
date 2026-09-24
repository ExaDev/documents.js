import type {
  ContentDocument,
  ContentParagraph,
  ContentSection,
  ContentTable,
  ContentTableCell,
} from "document-schema.js";
import type { WpdDiagnostic } from "../diagnostics";
import { readWpdContent } from "../read";
import { buildWpdFile, variableFunction, word } from "./build-wpd";

// — The structure a WordPerfect document states about itself: its page, its tables, its styles, its outline numbering, and its own summary --
//
// Every byte sequence below is assembled from the specification's own field tables rather than captured from a file, which is what makes each expectation checkable against the SDK page it cites. See the README's "What is not yet proven" for exactly what that is and is not evidence of.

export const HARD_EOL = 0xcc;
export const PAGE_GROUP = 0xd1;
export const COLUMN_GROUP = 0xd2;
export const CHARACTER_GROUP = 0xd4;
export const STYLE_GROUP = 0xdd;
export const DISPLAY_NUMBER_GROUP = 0xda;
export const TAB_GROUP = 0xe0;

// The End-of-Line subfunctions that bound a table's content: "10 (0x0A) Table Cell", "11 (0x0B) Table Row and Cell", "17 (0x11) Table Off".
export const EOL_TABLE_CELL = 10;
export const EOL_TABLE_ROW = 11;
export const EOL_TABLE_OFF = 17;

// The embedded subfunctions a cell's own attributes ride in.
export const ROW_INFORMATION = 0x80;
export const CELL_INFORMATION = 0x84;
export const CELL_SPANNING = 0x85;
export const CELL_FILL_COLORS = 0x86;

export function readDocumentArea(
  documentArea: readonly number[],
  packets: Parameters<typeof buildWpdFile>[1] = [],
): ContentDocument {
  return readWpdContent(buildWpdFile(documentArea, packets));
}

export function readWithDiagnostics(documentArea: readonly number[]): {
  readonly document: ContentDocument;
  readonly diagnostics: WpdDiagnostic[];
} {
  const diagnostics: WpdDiagnostic[] = [];
  const document = readWpdContent(buildWpdFile(documentArea), {
    sink: (diagnostic) => {
      diagnostics.push(diagnostic);
    },
  });
  return { document, diagnostics };
}

export function wordprocessingOf(document: ContentDocument): ContentSection[] {
  if (document.kind !== "wordprocessing") {
    throw new Error("expected a wordprocessing document");
  }
  return document.sections;
}

export function sectionOf(document: ContentDocument): ContentSection {
  const section = wordprocessingOf(document)[0];
  if (section === undefined) {
    throw new Error("expected a section");
  }
  return section;
}

export function paragraphsOf(document: ContentDocument): ContentParagraph[] {
  return wordprocessingOf(document)
    .flatMap((section) => section.blocks)
    .filter((block): block is ContentParagraph => block.kind === "paragraph");
}

export function tablesOf(document: ContentDocument): ContentTable[] {
  return wordprocessingOf(document)
    .flatMap((section) => section.blocks)
    .filter((block): block is ContentTable => block.kind === "table");
}

export function cellText(cell: ContentTableCell): string {
  return cell.blocks
    .filter((block): block is ContentParagraph => block.kind === "paragraph")
    .flatMap((paragraph) => paragraph.runs.map((run) => run.text))
    .join("");
}

export function paragraphAlignment(cell: ContentTableCell): string | undefined {
  const block = cell.blocks[0];
  return block?.kind === "paragraph" ? block.alignment : undefined;
}

// The Form function's eighty-two-byte non-deletable region, per WPFF D1 Page: the desired length at offset 3, the desired width at offset 5, and the orientation at offset 8.
export function pageForm(options: {
  readonly lengthWpu: number;
  readonly widthWpu: number;
  readonly orientation?: number;
}): number[] {
  const nonDeletable = new Array<number>(82).fill(0);
  nonDeletable.splice(3, 2, ...word(options.lengthWpu));
  nonDeletable.splice(5, 2, ...word(options.widthWpu));
  nonDeletable[8] = options.orientation ?? 0;
  return variableFunction({ group: PAGE_GROUP, subgroup: 0x11, nonDeletable });
}

export function marginFunction(
  group: number,
  subgroup: number,
  wpu: number,
): number[] {
  return variableFunction({ group, subgroup, nonDeletable: word(wpu) });
}

// A Table Column function: "[size of non-deletable information = 17]", with the width as the word at offset 1.
export function tableColumn(widthWpu: number): number[] {
  const nonDeletable = new Array<number>(17).fill(0);
  nonDeletable.splice(1, 2, ...word(widthWpu));
  return variableFunction({
    group: CHARACTER_GROUP,
    subgroup: 0x2c,
    nonDeletable,
  });
}

// Table Definition (Table On), one Table Column per column, and Define Table End — the grid's own shape, stated before any of its content.
export function tableDefinition(columnWidthsWpu: readonly number[]): number[] {
  return [
    ...variableFunction({ group: CHARACTER_GROUP, subgroup: 0x2a }),
    ...columnWidthsWpu.flatMap((width) => tableColumn(width)),
    ...variableFunction({ group: CHARACTER_GROUP, subgroup: 0x2b }),
  ];
}

// A Global On / Global Off pair, the encased spelling of a style region: "[hash of this Global On]" then "<system style number>".
export function styleScope(
  systemStyleNumber: number,
  body: readonly number[],
): number[] {
  return [
    ...variableFunction({
      group: STYLE_GROUP,
      subgroup: 0x0a,
      nonDeletable: [0x00, 0x00, systemStyleNumber],
    }),
    ...body,
    ...variableFunction({ group: STYLE_GROUP, subgroup: 0x0b }),
  ];
}
