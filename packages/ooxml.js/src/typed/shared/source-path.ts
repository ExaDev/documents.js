import type { ContentBlock } from 'document-schema.js';

// Assigns sourcePath ("sections[0].blocks[1].runs[0]", "slides[0].shapes[2].blocks[0].rows[1].cells[0].blocks[0]", etc.) to a finished ContentBlock[] and everything nested inside it, in document order. `prefix` names the array's own container -- "sections[0]" for a docx section's top-level blocks, "slides[0].shapes[2]" for a pptx shape's own blocks, or a table cell's own nested prefix one level deeper. Both readers already produce their blocks arrays fully flattened and in final document order (docx's mc:AlternateContent unwrapping and pptx's p:grpSp group flattening have already happened by the time this runs, and a docx construct's own extent is bracketed by markers in the same array rather than nested), so each block's position in the array IS its final path index -- this walks already-correct data rather than tracking indices during construction.
//
// The two construct-boundary markers are skipped rather than pathed: a marker is a boundary, not content, so document-schema.js gives it no sourcePath field at all (see ContentConstructStartSchema's own rationale). Their positions still count towards the indices of the blocks around them, since the path names a block's real position in the array it lives in.
export function assignSourcePaths(blocks: ContentBlock[], prefix: string): void {
  blocks.forEach((block, blockIndex) => {
    if (block.kind === 'constructStart' || block.kind === 'constructEnd') {
      return;
    }
    const blockPath = `${prefix}.blocks[${blockIndex}]`;
    block.sourcePath = blockPath;
    if (block.kind === 'paragraph') {
      block.runs.forEach((run, runIndex) => {
        run.sourcePath = `${blockPath}.runs[${runIndex}]`;
      });
    } else if (block.kind === 'table') {
      block.rows.forEach((row, rowIndex) => {
        row.cells.forEach((cell, cellIndex) => {
          assignSourcePaths(cell.blocks, `${blockPath}.rows[${rowIndex}].cells[${cellIndex}]`);
        });
      });
    }
  });
}
