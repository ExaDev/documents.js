// The table half of the writer: one \trowd/<celldef>+/\row per grid row, and a table cell's own \intbl block flow.
import {
  type ContentBlock,
  type ContentTable,
  type TableGridPosition,
  findTableGridFault,
  walkTableGrid,
} from "document-schema.js";
import { borderControlWords, cellFillControlWords } from "./cell-format";
import { RtfDiagnosticCodes, RtfTableGridFaultError } from "./diagnostics";
import { pointsToTwips } from "./units";
import { CELL_BORDER_ORDER, colorIndexOf } from "./write-tables";
import { closeConstruct, openConstruct, writeParagraph } from "./write-body";
import { mergeControlWords } from "./write-form-fields";
import {
  decodeImageOrWarn,
  writeEmbeddedObjectBlock,
  writeImagePict,
} from "./write-image";
import { line, raw, type Writer } from "./write-state";

// The block kinds writeCellBlocks can splice into a table cell's own \intbl flow — a plain paragraph, or a \pict/\object group wrapped in the identical \pard\plain\intbl shell writeParagraph itself uses. Every other kind (table, pageBreak) has no such shell to borrow and is dropped with a diagnostic instead.
const CELL_BLOCK_KINDS: ReadonlySet<ContentBlock["kind"]> = new Set([
  "paragraph",
  "image",
  "embeddedObject",
]);

export function writeTable(writer: Writer, table: ContentTable): void {
  const fault = findTableGridFault(table);
  if (fault !== undefined) {
    throw new RtfTableGridFaultError(fault);
  }
  // RTF has no header-column concept at all: unlike a row's own \trhdr, no control word scoped to a single \cellxN column states that it repeats at the left of each printed page (ExaDev/documents.js#1381). Reported once per table rather than once per flagged column, matching PACKAGE_TABLE_DROPPED's own once-per-table shape immediately below.
  if (table.columns.some((column) => column.isHeader === true)) {
    writer.sink({
      code: RtfDiagnosticCodes.TABLE_HEADER_COLUMN_DROPPED,
      severity: "info",
      message:
        "this table states one or more header columns, and RTF has no control word for a column repeating at the left of each printed page, so the flag is dropped and will not read back",
    });
  }
  // ContentTable's rows are dense (one entry per grid column) and RTF's are too (one \cellxN and one \cell per grid column), so each grid position maps to exactly one RTF cell slot. The walk classifies each as an anchor or as covered by a merged region.
  for (const [rowIndex, positions] of walkTableGrid(table).entries()) {
    // "\cellxN Defines the right boundary of a cell", cumulative from the row's own left edge, so the boundaries are a running total of the column widths.
    let right = 0;
    const definitions: string[] = [];
    for (const position of positions) {
      right += pointsToTwips(table.columns[position.columnIndex]?.widthPt ?? 0);
      definitions.push(cellDefinition(writer, position, right));
    }
    // The row's own <rowwrite> member inside its <tbldef>, where the spec's production places it — after \trowd's own leading members and before the <celldef>+ run each \cellxN closes. \ltrrow is the default the spec states ("Cells in this table row will have left-to-right precedence (the default)"), so it is written only for a stated `direction: "ltr"`, never as a restated default.
    const direction = table.rows[rowIndex]?.direction;
    const rowWrite =
      direction === "rtl" ? "\\rtlrow" : direction === "ltr" ? "\\ltrrow" : "";
    // "\trhdr Table row header. This row should appear at the top of every page on which the current table appears" (RTF 1.9.1, "Table Definitions"): a row-level property of the same <tbldef>, written alongside the <rowwrite> member and before the <celldef> run. It has no off-word of its own, so an ordinary row writes nothing and the reader's own \trowd reset is what keeps the previous row's flag from carrying over.
    const rowHeader = table.rows[rowIndex]?.isHeader === true ? "\\trhdr" : "";
    const rowDefinition = `\\trowd\\trgaph108\\trleft0${rowHeader}${rowWrite}${definitions.join("")}`;
    // Word 2002 onward writes the row properties both before and after the row, which the spec explicitly calls out as the shape a reader should not assume otherwise; emitting both makes the output readable by either kind of reader.
    line(writer, rowDefinition);
    for (const position of positions) {
      // A covered position holds no blocks, its content belonging to its region's anchor, which writes it exactly once; the grid-rule check above has already refused a table where one does.
      writeCellBlocks(writer, position.cell.blocks);
      raw(writer, "\\cell");
    }
    line(writer, `${rowDefinition}\\row`);
  }
  line(writer, "\\pard");
}

// One <celldef>: the position's merge flags, borders and shading, closed by its own \cellxN. Written in the grammar's own order so a reader walking it left to right sees each border's side before the <brdr> describing it. A covered position states its own borders and shading like any other, since ContentTable lets it carry them.
function cellDefinition(
  writer: Writer,
  position: TableGridPosition,
  rightTwips: number,
): string {
  const { cell } = position;
  let out = mergeControlWords(position);
  // The <cellalign> member, in the production's own place among the <celldef>'s members (before the <celltop>/<cellleft>/... border sides). Only the two non-default members are written: \clvertalt is the spec's own stated default ("Text is top-aligned in cell (the default)") and ContentTableCell.verticalAlign's absence already means top, so neither a 'top' value nor an absent one restates it — the identical choice the reader makes for the word on the way in.
  if (cell.verticalAlign === "center") out += "\\clvertalc";
  else if (cell.verticalAlign === "bottom") out += "\\clvertalb";
  const borders = cell.borders;
  if (borders !== undefined) {
    for (const side of CELL_BORDER_ORDER) {
      const border = borders[side];
      if (border !== undefined) {
        out += borderControlWords(
          side,
          border,
          colorIndexOf(border.color, writer.tables.colors),
        );
      }
    }
  }
  if (cell.background !== undefined) {
    out += cellFillControlWords(cell.background, (color) =>
      colorIndexOf(color, writer.tables.colors),
    );
  }
  return `${out}\\cellx${String(rightTwips)}`;
}

// A cell's own content is a run of \intbl <pict>/<obj>/paragraph groups — read.ts's own reader already proves a \pict or \object group living inside an ordinary \intbl paragraph reads back as a real image/embeddedObject block positioned within the cell's own block list, so writeImagePict and writeEmbeddedObjectBlock are given the identical \intbl variant writeParagraph(paragraph, inTable) already takes. A table or pageBreak block placed directly in a cell has no such shape to borrow — a nested table needs its own \itapN row grammar this writer does not build, and a mid-row \page would \pard-reset the row's own \intbl state — so those two kinds are dropped, but reported rather than silently filtered out: see writeBlock's own top-level handling of the identical block kinds for what this cannot yet do here. constructStart/constructEnd are a different case entirely, not a nested destination at all: they are the same zero-width bracket markers openConstruct/closeConstruct already splice inline into the top-level block flow (a bookmark's `{\*\bkmkstart ...}`/`{\*\bkmkend ...}` group, or nothing for a descriptor kind RTF has no spelling for), and read.ts's own cellBlockExtents/insertConstructMarkers already reconstructs exactly this pair back out of a table cell's own block list — so a bookmark bracketing whole paragraphs inside a cell is a real, already-round-trippable shape, handled here the same way writeBlock handles it at the top level rather than reported as unrepresented.
//
// `blockPending` tracks something narrower than "something was written": whether the OUTPUT currently ends mid-paragraph, with real run text sitting in the reader's own pending-run buffer that only an explicit \par (read.ts's own endParagraph, called with force=true) turns into a committed ContentParagraph block. A written paragraph leaves exactly that behind, since writeParagraph(paragraph, true) never emits its own trailing \par. An image or embeddedObject leaves nothing behind: read.ts's own addBlocks (fired when the \pict/\object destination's group closes) flushes any pending run first but pushes the image/object block directly, with no endParagraph call of its own — so it neither needs a \par to close it out, nor would emitting one after it do anything but force-commit an empty paragraph from the (by-then-empty) pending-run buffer, splicing a spurious blank paragraph in behind it. A leading \par is still owed before an image/embeddedObject exactly as before a paragraph, though: without it, a real pending paragraph's text would sit uncommitted in the pending-run buffer through addBlocks's own flush and surface, out of order, as a stray paragraph appended AFTER whatever comes next instead of before it — confirmed directly: an earlier version of this method set blockPending after an image too, and a "before" paragraph immediately followed by an image and an "after" paragraph round-tripped as paragraph/image/paragraph/paragraph, the fourth an empty paragraph the trailing \par manufactured out of nothing.
function writeCellBlocks(
  writer: Writer,
  blocks: readonly ContentBlock[],
): void {
  let wroteBlock = false;
  let blockPending = false;
  for (const [index, block] of blocks.entries()) {
    if (block.kind === "constructStart" || block.kind === "constructEnd") {
      // A marker sitting between two cell blocks belongs between them, not folded into the block before it — so the \par a pending paragraph owes is flushed here, before the marker, whenever a later block still needs that paragraph properly closed first (a later paragraph would otherwise merge into it; a later image/embeddedObject would otherwise commit it out of order via its own addBlocks flush — see the note above). A trailing marker with no block left after it flushes nothing, so it adds no empty paragraph of its own.
      if (
        blockPending &&
        blocks
          .slice(index + 1)
          .some((later) => CELL_BLOCK_KINDS.has(later.kind))
      ) {
        raw(writer, "\\par");
        blockPending = false;
      }
      if (block.kind === "constructStart") {
        openConstruct(writer, block.descriptor);
      } else {
        closeConstruct(writer);
      }
      continue;
    }
    if (!CELL_BLOCK_KINDS.has(block.kind)) {
      writer.sink({
        code: RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED,
        severity: "warning",
        message: `a ${block.kind} block inside a table cell is dropped: this writer cannot yet splice a ${block.kind}'s own destination grammar into a table row's own \\intbl flow`,
      });
      continue;
    }
    // An image's payload is decoded before the pending separator is flushed, not after: a \pict that turns out unwritable (an unsupported format, an undecodable payload) writes nothing at all, and flushing \par first would leave that separator stranded with no content of its own following it.
    if (block.kind === "image") {
      const decoded = decodeImageOrWarn(writer, block);
      if (decoded === undefined) {
        continue;
      }
      if (blockPending) {
        raw(writer, "\\par");
      }
      writeImagePict(writer, decoded, block, true);
      wroteBlock = true;
      blockPending = false;
      continue;
    }
    if (blockPending) {
      raw(writer, "\\par");
    }
    if (block.kind === "paragraph") {
      writeParagraph(writer, block, true);
      blockPending = true;
    } else if (block.kind === "embeddedObject") {
      writeEmbeddedObjectBlock(writer, block, true);
      blockPending = false;
    }
    wroteBlock = true;
  }
  if (!wroteBlock) {
    raw(writer, "\\pard\\plain\\intbl ");
  }
}
