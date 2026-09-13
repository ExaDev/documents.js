import { describe, expect, it } from "vitest";
import type { ContentBlock } from "document-schema.js";
import { decodeSprm, type Prl } from "../prop/sprm";
import type { ParagraphEntry } from "../text/paragraphs";
import { CELL_MARK, PARAGRAPH_MARK, SECTION_MARK } from "../text/special";
import {
  assembleBlocks,
  cellMergeEntryMissingMessage,
  COLUMN_BOUNDARY_ARRAY_TOO_SHORT_MESSAGE,
  gridBoundaryNotFoundMessage,
  rowDefinitionMissingMessage,
} from "./read";

function le16(value: number): number[] {
  return [value & 0xff, (value >> 8) & 0xff];
}

/** A minimal sprmTDefTable Prl: `boundaries.length - 1` columns, each with an all-zero 20-byte TC80 (no merge, no border). */
function defTablePrl(boundaries: readonly number[]): Prl {
  const numberOfColumns = boundaries.length - 1;
  const tc80s = Array.from({ length: numberOfColumns }, () =>
    new Array<number>(20).fill(0),
  ).flat();
  const operand = [
    0,
    0, // cb, never read by this reader.
    numberOfColumns,
    ...boundaries.flatMap(le16),
    ...tc80s,
  ];
  return { sprm: decodeSprm(0xd608), operand: Uint8Array.from(operand) };
}

// assembleBlocks is exported and takes a plain ParagraphEntry[], so every scenario here is built directly rather than through a real .doc byte stream -- table/read.test.ts's own hand-assembled-bytes tests exercise the identical machinery from real grpprl bytes; these instead isolate walkBlocksAtDepth/tryAssembleTable's own internal boundary logic with full control over each entry's properties.

function entry(overrides: Partial<ParagraphEntry> = {}): ParagraphEntry {
  return {
    blocks: [],
    properties: {},
    grpprl: [],
    terminator: PARAGRAPH_MARK,
    endCp: 0,
    ...overrides,
  };
}

const marker = (text: string): ContentBlock => ({
  kind: "paragraph",
  runs: [{ text }],
});

describe("assembleBlocks", () => {
  it("treats a stream not stated to end as continuing when documentStreamEnds is omitted, degrading a dangling in-table run instead of throwing", () => {
    const dangling = entry({ properties: { inTable: true } });
    expect(() => assembleBlocks([dangling])).not.toThrow();
    expect(assembleBlocks([dangling])).toEqual([]);
  });

  it("throws the identical dangling run when told the document stream truly ends there", () => {
    const dangling = entry({ properties: { inTable: true } });
    expect(() => assembleBlocks([dangling], true)).toThrow(
      /paragraphs end without a row-ending mark/,
    );
  });

  it("requires both the paragraph mark and innerTableCellMark to close a nested cell, not either alone", () => {
    // Nested cell 1's own three entries: a paragraph mark with no innerTableCellMark of its own (should NOT close the cell), innerTableCellMark stated on the wrong terminator -- SECTION_MARK, never a real nested-cell spelling, chosen specifically because CELL_MARK would itself be misread as the OUTER table's own depth-1 cell mark (should NOT close it either), and finally the genuine paragraph-mark-plus-flag combination that does. If any of the first two wrongly closed the cell, the nested row's own two-column TAP definition would disagree with the physical cell count it actually finds, and the whole nested run would degrade to flat paragraphs instead of a real table.
    const nestedDef = entry({
      properties: { tableDepth: 2, innerTtpMark: true },
      terminator: PARAGRAPH_MARK,
      grpprl: [defTablePrl([0, 1000, 2000])],
    });
    const entries: ParagraphEntry[] = [
      entry({
        blocks: [marker("no-flag")],
        properties: { tableDepth: 2 },
        terminator: PARAGRAPH_MARK,
      }),
      entry({
        blocks: [marker("wrong-terminator")],
        properties: { tableDepth: 2, innerTableCellMark: true },
        terminator: SECTION_MARK,
      }),
      entry({
        blocks: [marker("real-close")],
        properties: { tableDepth: 2, innerTableCellMark: true },
        terminator: PARAGRAPH_MARK,
      }),
      entry({
        blocks: [marker("cell-2")],
        properties: { tableDepth: 2, innerTableCellMark: true },
        terminator: PARAGRAPH_MARK,
      }),
      nestedDef,
      entry({ properties: { tableDepth: 1 }, terminator: CELL_MARK }),
      entry({
        properties: { tableDepth: 1, tableRowEnd: true },
        terminator: CELL_MARK,
        grpprl: [defTablePrl([0, 3000])],
      }),
    ];
    const blocks = assembleBlocks(entries);
    const outerTable = blocks[0];
    if (outerTable?.kind !== "table") {
      throw new Error(`expected an outer table, got '${outerTable?.kind}'`);
    }
    const outerCell = outerTable.rows[0]?.cells[0];
    if (outerCell === undefined) throw new Error("expected the outer cell");
    const nested = outerCell.blocks[0];
    if (nested?.kind !== "table") {
      throw new Error(`expected a nested table, got '${nested?.kind}'`);
    }
    expect(nested.rows[0]?.cells).toHaveLength(2);
  });
});

describe("read.ts's own internal-defect messages", () => {
  // Every message named here is an invariant this module already maintains elsewhere in the same function, never one a caller's own input could violate -- see each message function's own comment. Tested against a hardcoded duplicate of the exact text, the same discipline prop/fkp-write.ts's own internal-defect messages follow.
  it("carries cellMergeEntryMissingMessage's own exact text", () => {
    expect(cellMergeEntryMissingMessage(3)).toBe(
      "internal defect: table row cell 3 has no TAP merge entry despite the length check above",
    );
  });

  it("carries rowDefinitionMissingMessage's own exact text", () => {
    expect(rowDefinitionMissingMessage(2)).toBe(
      "internal defect: table row 2 has no TAP definition despite the earlier length check",
    );
  });

  it("carries gridBoundaryNotFoundMessage's own exact text", () => {
    expect(gridBoundaryNotFoundMessage(1500)).toBe(
      "internal defect: a table row's column boundary 1500 matches no boundary on the table's own reconstructed grid, which was built from that boundary among others",
    );
  });

  it("carries COLUMN_BOUNDARY_ARRAY_TOO_SHORT_MESSAGE's own exact text", () => {
    expect(COLUMN_BOUNDARY_ARRAY_TOO_SHORT_MESSAGE).toBe(
      "a table row's own column-boundary array has fewer entries than its physical cell count requires",
    );
  });
});
