// Content-model construction and write/read round-trip helpers shared by every write*.test.ts file: writeDocContent's own output is verified by reading it back through readDocContent (this package's own reader), the standing round-trip convention this test family uses throughout.
//
// Test-support only: excluded from the published dist per the family convention (tsdown.config.ts drops src/test-support/**), and never imported by src/index.ts.

import type {
  ContentBlock,
  ContentDocument,
  ContentParagraph,
  ContentTable,
  ContentTableCell,
} from "document-schema.js";
import { expect } from "vitest";
import { slice } from "../bytes";
import { isDocBytes } from "../detect";
import { PropertyBinTable } from "../prop/fkp";
import { readGrpprl } from "../prop/sprm";
import { readDocContent, readDocStreams } from "../read";
import { readTextRange } from "../text/characters";
import { parseClx } from "../text/piece-table";
import { writeDocContent } from "../write";

export function document(blocks: readonly ContentBlock[]): ContentDocument {
  return {
    kind: "wordprocessing",
    metadata: {},
    sections: [
      {
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
        blocks: [...blocks],
      },
    ],
  };
}

export function paragraph(
  runs: ContentParagraph["runs"],
  attributes: Partial<ContentParagraph> = {},
): ContentParagraph {
  return { kind: "paragraph", runs, ...attributes };
}

export function roundTrip(input: ContentDocument): ContentDocument {
  const bytes = writeDocContent(input);
  expect(isDocBytes(bytes)).toBe(true);
  return readDocContent(bytes);
}

export function blocksOf(result: ContentDocument): ContentBlock[] {
  if (result.kind !== "wordprocessing") {
    throw new Error("a .doc always reads back as a wordprocessing document");
  }
  const section = result.sections[0];
  if (section === undefined) throw new Error("a section must be present");
  return [...section.blocks];
}

// Joins every paragraph's own text in a cell with a comma, so a multi-paragraph cell's assertion reads as one string rather than an array comparison per paragraph.
export function cellText(cell: ContentTableCell | undefined): string {
  if (cell === undefined) throw new Error("expected a cell");
  return cell.blocks
    .map((block) => {
      if (block.kind !== "paragraph") {
        throw new Error(`expected a paragraph block, got '${block.kind}'`);
      }
      return block.runs.map((run) => run.text).join("");
    })
    .join(",");
}

/** `count` block-less entries: the positions a merged region covers besides its anchor, in a dense row (ContentTableCell's grid rule). */
export function coveredCells(count: number): ContentTableCell[] {
  return Array.from({ length: count }, () => ({ blocks: [] }));
}

export function paragraphAt(
  result: ContentDocument,
  index: number,
): ContentParagraph {
  const block = blocksOf(result)[index];
  if (block === undefined) throw new Error(`no block at index ${index}`);
  if (block.kind !== "paragraph") {
    throw new Error(`block ${index} is a ${block.kind}, not a paragraph`);
  }
  return block;
}

export function tableAt(result: ContentDocument, index: number): ContentTable {
  const block = blocksOf(result)[index];
  if (block === undefined) throw new Error(`no block at index ${index}`);
  if (block.kind !== "table") {
    throw new Error(`block ${index} is a ${block.kind}, not a table`);
  }
  return block;
}

/** The one cell a single-cell, single-row table round-trips to — the shape most decoration assertions below want, since a border or fill is a per-cell fact and needs no other cell to state it. */
export function onlyCell(result: ContentDocument): ContentTableCell {
  const cell = tableAt(result, 0).rows[0]?.cells[0];
  if (cell === undefined) throw new Error("expected one cell");
  return cell;
}

/** The whole Main Document text stream, control characters included — the only way to observe which exact terminator character (a section mark vs. an ordinary paragraph mark) writeDocContent chose at a given position, since readDocContent's own section split relies on PlcfSed's cp boundaries rather than on this specific character value. */
export function rawText(bytes: Uint8Array<ArrayBuffer>): string {
  const { wordDocument, table, fib } = readDocStreams(bytes);
  const pieceTable = parseClx(slice(table, fib.fcClx, fib.lcbClx, "Clx"));
  return readTextRange(wordDocument, pieceTable, 0, fib.ccpText).text;
}

/** Whether any paragraph in a written document carries a Prl with this sprm opcode. Walked through this package's own grpprl primitives rather than scanned for the two opcode bytes anywhere in the stream, which would match the identical pair occurring inside some other sprm's operand and report an opcode that is not there. */
export function containsSprm(
  bytes: Uint8Array<ArrayBuffer>,
  opcode: number,
): boolean {
  const { wordDocument, table, fib } = readDocStreams(bytes);
  const pieceTable = parseClx(slice(table, fib.fcClx, fib.lcbClx, "Clx"));
  const range = readTextRange(wordDocument, pieceTable, 0, fib.ccpText);
  const papxTable = new PropertyBinTable(
    wordDocument,
    slice(table, fib.fcPlcfBtePapx, fib.lcbPlcfBtePapx, "PlcBtePapx"),
    "PlcBtePapx",
  );
  return range.fcs.some((fc) => {
    const papx = papxTable.papx(fc);
    if (papx === undefined) return false;
    return readGrpprl(papx.grpprl).some((prl) => prl.sprm.value === opcode);
  });
}
