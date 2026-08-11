import type { ContentBlock, ContentImageBlock, ContentParagraph, ContentRun, ContentTable } from 'documents.js';
import type { ReactNode } from 'react';

import { image as imageStyle, inlineCode, table as tableStyle, tableCell as tableCellStyle } from './contentBlocks.css';

// router.ts normalizes both markdown-codec's and docx/odt's real heading styleIds into this one lowercase-hyphenated convention, so a single client-side regex works for every wordprocessing-kind source.
export const HEADING_STYLE_PATTERN = /^heading-([1-6])$/;
export const HEADING_TAGS: Record<number, 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'> = { 1: 'h1', 2: 'h2', 3: 'h3', 4: 'h4', 5: 'h5', 6: 'h6' };

export interface RenderRunsOptions {
  // markdown-codec lowers `inline code` to a run carrying an explicit fontFamily -- the only markdown construct that sets one -- so for markdown-sourced content, any run with fontFamily is inline code. docx/odt runs commonly carry fontFamily as ordinary font specification, so this MUST be false for wordprocessing-sourced content unless every run in a non-default font would be falsely styled as inline code.
  treatFontFamilyAsInlineCode?: boolean;
}

export function renderRuns(runs: readonly ContentRun[], options?: RenderRunsOptions): ReactNode {
  return runs.map((run, index) => {
    let node: ReactNode = run.text;
    if (run.bold === true) node = <strong>{node}</strong>;
    if (run.italic === true) node = <em>{node}</em>;
    if (run.underline === true) node = <u>{node}</u>;
    if (run.strike === true) node = <s>{node}</s>;
    if (options?.treatFontFamilyAsInlineCode === true && run.fontFamily !== undefined) {
      node = <code className={inlineCode}>{node}</code>;
    }
    if (run.hyperlink !== undefined) {
      node = (
        <a href={run.hyperlink} target="_blank" rel="noopener noreferrer">
          {node}
        </a>
      );
    }
    return <span key={index}>{node}</span>;
  });
}

export function renderImage(block: ContentImageBlock): ReactNode {
  return <img src={`data:image/${block.format};base64,${block.base64}`} alt={block.altText ?? ''} className={imageStyle} />;
}

// Takes a renderBlocks callback so each component's own block-grouping logic (which dispatches to its own paragraph/list renderers) handles the recursion into cell content.
export function renderTable(table: ContentTable, renderBlocks: (blocks: readonly ContentBlock[]) => ReactNode): ReactNode {
  return (
    <table className={tableStyle}>
      <tbody>
        {table.rows.map((row, rowIndex) => (
          <tr key={rowIndex}>
            {row.cells.map((cell, cellIndex) => (
              <td key={cellIndex} colSpan={cell.colSpan} rowSpan={cell.rowSpan} className={tableCellStyle}>
                {renderBlocks(cell.blocks)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export interface ListItemNode {
  readonly runs: readonly ContentRun[];
  readonly ordered: boolean;
  readonly children: ListItemNode[];
}

// Reconstructs a nested list tree from a flat run of list-membership paragraphs via a level stack. For markdown, the ordered-vs-bullet distinction is read per item from its numId's "ordered:"/"bullet:" prefix (router.ts's normalizeMarkdownStyling convention); for docx/odt, numId is opaque (no ordered/bullet info available in ContentDocument today), so `ordered` is always false and the caller renders with a neutral marker rather than trusting it.
export function buildListForest(items: readonly ContentParagraph[]): ListItemNode[] {
  const root: ListItemNode[] = [];
  const stack: { level: number; children: ListItemNode[] }[] = [{ level: -1, children: root }];
  for (const item of items) {
    const level = item.list?.level ?? 0;
    const ordered = item.list?.numId.startsWith('ordered:') ?? false;
    const node: ListItemNode = { runs: item.runs, ordered, children: [] };
    while (stack.length > 1 && stack[stack.length - 1]!.level >= level) {
      stack.pop();
    }
    stack[stack.length - 1]!.children.push(node);
    stack.push({ level, children: node.children });
  }
  return root;
}

export interface ListGroup {
  readonly kind: 'listGroup';
  readonly items: readonly ContentParagraph[];
}

export type BlockGroup = ContentBlock | ListGroup;

// Consecutive list-membership paragraphs are collected into one group before rendering, rather than rendered paragraph-by-paragraph, so a run of list items becomes one nested list tree instead of N standalone lists of one item each.
export function collectBlockGroups(blocks: readonly ContentBlock[]): BlockGroup[] {
  const groups: BlockGroup[] = [];
  let pendingListItems: ContentParagraph[] = [];
  const flushList = () => {
    if (pendingListItems.length > 0) {
      groups.push({ kind: 'listGroup', items: pendingListItems });
      pendingListItems = [];
    }
  };
  for (const block of blocks) {
    if (block.kind === 'paragraph' && block.list !== undefined) {
      pendingListItems.push(block);
    } else {
      flushList();
      groups.push(block);
    }
  }
  flushList();
  return groups;
}
