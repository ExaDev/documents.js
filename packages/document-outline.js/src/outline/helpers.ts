import type { ContentBlock, ContentRun } from 'document-schema.js';
import { isOutlineNode } from './node';
import type { OutlineChild, OutlineLeaf } from './node';
import { stableContentHash } from './hash';

// Flattens an outline to its leaves in document order: a left-to-right depth-first walk that skips group nodes (their text already lives in the node, not in a leaf) and emits every leaf payload in the position it occupies. This is the chunking-for-retrieval view -- the ordered list of retrievable content units. Accepts exactly what buildOutline returns (the root scope's children, groups and pre-grouping leaves alike).
export function flattenOutline(children: readonly OutlineChild[]): OutlineLeaf[] {
  const leaves: OutlineLeaf[] = [];
  const walk = (subtree: readonly OutlineChild[]): void => {
    for (const child of subtree) {
      if (isOutlineNode(child)) walk(child.children);
      else leaves.push(child);
    }
  };
  walk(children);
  return leaves;
}

// A leaf's OWN text -- the textual content it directly carries, as opposed to anything addressable through it. Per leaf class: a paragraph is its runs' text concatenated with no separator; a table is the text of the paragraphs in its cells (nested tables included, recursively), paragraphs joined ' ' within the walk, rows joined '\n' so row boundaries survive the flattening; an image (block-flow or sheet-anchored) is its altText, empty when absent; a formula is its LaTeX linearisation, empty when absent. The textless leaves -- page breaks, embedded objects (their embedded document is reachable through the leaf itself; summarising it here would duplicate what a consumer reads directly), vectors (textless by construction) -- return the empty string.
export function outlineLeafText(leaf: OutlineLeaf): string {
  if ('runs' in leaf) return leaf.runs.map((run: ContentRun) => run.text).join('');
  if ('rows' in leaf) return leaf.rows.map((row) => row.cells.map((cell) => blockTexts(cell.blocks).join(' ')).join(' ')).join('\n');
  if ('base64' in leaf) return leaf.altText ?? '';
  if ('mathml' in leaf) return leaf.presentation?.latex ?? '';
  return '';
}

function blockTexts(blocks: readonly ContentBlock[]): string[] {
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.kind === 'paragraph') parts.push(block.runs.map((run) => run.text).join(''));
    // Only paragraphs and tables carry text inside a block list; images, page breaks, and embedded objects contribute nothing here (an image's altText belongs to the image leaf itself, and this walk never encounters one as a cell block).
    if (block.kind === 'table') parts.push(...block.rows.flatMap((row) => row.cells.map((cell) => blockTexts(cell.blocks).join(' '))));
  }
  return parts;
}

// A stable content hash for one leaf, identical across processes and platforms and equal exactly when the leaf's content is equal: independently constructed leaves that differ only in field-construction order hash the same, and any content difference hashes differently (up to SHA-256 collision resistance). The exact recipe -- key-order canonicalisation, JSON serialisation, UTF-8, hand-rolled SHA-256, lowercase hex -- is documented step by step in hash.ts and is part of this package's published contract.
export function leafContentHash(leaf: OutlineLeaf): string {
  return stableContentHash(leaf);
}
