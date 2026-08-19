// GFM tables (github.github.com/gfm, "Tables (extension)"): row splitting and delimiter-row recognition.
//
// A table is not opened by a line of its own -- it is a PROMOTION of an already-open paragraph, triggered by the line that follows it. That is why this module exports predicates and splitters rather than a block start: the decision "is the open paragraph's last line a table header?" belongs to src/block/block.ts's paragraph-promotion hook, which owns the precedence between this and a setext heading underline.
//
// Two rules here are stricter than the GFM specification's prose, deliberately, and both exist to keep an ordinary paragraph from silently becoming a table:
//
//  - A DELIMITER ROW MUST CONTAIN AT LEAST ONE PIPE. The spec defines a row as "cells... separated by pipes", which leaves a one-cell row needing no pipe at all -- and under that reading `foo` followed by `:-:` would be a single-column, centre-aligned table. Requiring the pipe means a line of dashes and colons only promotes a paragraph when it is unambiguously tabular. It also settles the three-way ambiguity of a bare `---` line before precedence is even consulted: with no pipe, `---` can never be a delimiter row, so it is only ever a setext underline or a thematic break.
//  - The header row and the delimiter row must have the SAME number of cells, per the spec's own "The header row must match the delimiter row in the number of cells. If not, a table will not be recognized."
//
// Cell splitting is backslash-escape aware and nothing else: `\|` is not a separator, so `| f\|oo |` is one cell whose content is `f\|oo`, which the inline phase then resolves to `f|oo` through ordinary backslash-escape handling. It is deliberately NOT code-span aware -- GFM's own example of a pipe inside a code span (`` | b `\|` az | ``) escapes that pipe too, so recognising code spans here would be a second, competing answer to a question the escape already answers.

import type { MarkdownTableAlignment } from '../ast/ast';

// A delimiter cell is a run of hyphens with an optional leading and/or trailing colon, and nothing else.
const DELIMITER_CELL_PATTERN = /^:?-+:?$/;

// Splits one row's source line into its cells, dropping one optional leading and one optional trailing pipe and trimming each cell, per the spec's "A leading and trailing pipe is also recommended" and "Spaces between pipes and cell content are trimmed".
export function splitTableRow(line: string): string[] {
  let text = line.trim();
  if (text.startsWith('|')) {
    text = text.slice(1);
  }
  if (endsWithUnescapedPipe(text)) {
    text = text.slice(0, -1);
  }

  const cells: string[] = [];
  let current = '';
  let index = 0;
  while (index < text.length) {
    const char = text.charAt(index);
    if (char === '\\' && index + 1 < text.length) {
      // An escaped pipe is resolved HERE rather than left for the inline phase's own backslash handling, because a cell's content may put it somewhere that handling never reaches: GFM's own example escapes a pipe inside a code span (`` | b `\|` az | ``), and a code span's literal is never backslash-processed. Every other escape is passed through untouched for the inline phase to resolve as usual.
      const escaped = text.charAt(index + 1);
      current += escaped === '|' ? escaped : char + escaped;
      index += 2;
      continue;
    }
    if (char === '|') {
      cells.push(current.trim());
      current = '';
      index += 1;
      continue;
    }
    current += char;
    index += 1;
  }
  cells.push(current.trim());
  return cells;
}

function endsWithUnescapedPipe(text: string): boolean {
  if (!text.endsWith('|')) {
    return false;
  }
  let backslashes = 0;
  while (backslashes + 1 < text.length && text.charAt(text.length - 2 - backslashes) === '\\') {
    backslashes += 1;
  }
  return backslashes % 2 === 0;
}

function alignmentOf(cell: string): MarkdownTableAlignment {
  const left = cell.startsWith(':');
  const right = cell.endsWith(':');
  if (left && right) {
    return 'center';
  }
  if (left) {
    return 'left';
  }
  if (right) {
    return 'right';
  }
  return 'none';
}

// The column alignments a delimiter row declares, or undefined when `line` is not a delimiter row at all. See this module's own top-of-file note for why a pipe is required.
export function parseTableDelimiterRow(line: string): MarkdownTableAlignment[] | undefined {
  if (!line.includes('|')) {
    return undefined;
  }
  const cells = splitTableRow(line);
  if (cells.length === 0) {
    return undefined;
  }
  const alignments: MarkdownTableAlignment[] = [];
  for (const cell of cells) {
    if (!DELIMITER_CELL_PATTERN.test(cell)) {
      return undefined;
    }
    alignments.push(alignmentOf(cell));
  }
  return alignments;
}

// Pads a body row out to the header's own column count, or truncates it, per the spec: "If there are a number of cells fewer than the number of cells in the header row, empty cells are inserted. If there are greater, the excess is ignored."
export function fitRowToColumns(cells: readonly string[], columnCount: number): string[] {
  const fitted = cells.slice(0, columnCount);
  while (fitted.length < columnCount) {
    fitted.push('');
  }
  return fitted;
}
