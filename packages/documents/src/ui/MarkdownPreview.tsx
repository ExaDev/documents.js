import { Badge, Group, LoadingOverlay, Paper, Stack, Text } from '@mantine/core';
import type { ContentBlock, ContentDocument, ContentParagraph, ContentRun } from 'documents.js';
import type { ReactNode } from 'react';

export interface MarkdownPreviewProps {
  label: string;
  format: string;
  content?: ContentDocument;
  loading?: boolean;
  error?: unknown;
}

// Renders a markdown-sourced ContentDocument natively as HTML instead of round-tripping it through the PDF pipeline the way PdfPreview does for every other format -- markdown isn't paginated, so a print-layout PDF is a poor fit for it, and it sidesteps documents.js's own markdownToPdf entirely (see ExaDev/documents#1). The paragraph styleId/list.numId values consumed here are the small convention src/rpc/router.ts's normalizeMarkdownStyling rewrites markdown-codec's own private ones into -- never the raw "Heading1"/"md1:ordered@1" strings themselves, so this component has no dependency on markdown-codec's internal string formats.
export function MarkdownPreview({ label, format, content, loading, error }: MarkdownPreviewProps) {
  return (
    <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
      <Group gap="xs">
        <Text size="sm" fw={500}>
          {label}
        </Text>
        <Badge size="xs" variant="light">
          {format}
        </Badge>
      </Group>
      <Paper withBorder pos="relative" style={{ height: '70vh', overflow: 'auto', padding: 24 }}>
        <LoadingOverlay visible={loading === true} />
        {error !== undefined ? (
          <Group h="100%" justify="center">
            <Text c="dimmed" size="sm">
              Preview unavailable for this format.
            </Text>
          </Group>
        ) : content === undefined ? (
          <Group h="100%" justify="center">
            <Text c="dimmed" size="sm">
              No preview yet.
            </Text>
          </Group>
        ) : (
          renderContentDocument(content)
        )}
      </Paper>
    </Stack>
  );
}

function renderContentDocument(content: ContentDocument): ReactNode {
  if (content.kind !== 'wordprocessing') return null;
  return content.sections.map((section, sectionIndex) => (
    <div key={sectionIndex}>{renderBlockGroups(section.blocks)}</div>
  ));
}

interface ListGroup {
  readonly kind: 'listGroup';
  readonly items: readonly ContentParagraph[];
}

// Consecutive list-membership paragraphs are collected into one group before rendering, rather than rendered paragraph-by-paragraph, so a run of list items becomes one nested <ul>/<ol> tree instead of N standalone lists of one item each.
function renderBlockGroups(blocks: readonly ContentBlock[]): ReactNode {
  const groups: (ContentBlock | ListGroup)[] = [];
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
  return groups.map((group, index) => (group.kind === 'listGroup' ? <div key={index}>{renderListNodes(buildListForest(group.items))}</div> : <div key={index}>{renderBlock(group)}</div>));
}

const HEADING_TAGS: Record<number, 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'> = { 1: 'h1', 2: 'h2', 3: 'h3', 4: 'h4', 5: 'h5', 6: 'h6' };
const HEADING_STYLE_PATTERN = /^heading-([1-6])$/;

function renderBlock(block: ContentBlock): ReactNode {
  if (block.kind === 'paragraph') return renderParagraph(block);
  if (block.kind === 'table') {
    return (
      <table style={{ borderCollapse: 'collapse', marginBlock: 12 }}>
        <tbody>
          {block.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.cells.map((cell, cellIndex) => (
                <td key={cellIndex} colSpan={cell.colSpan} rowSpan={cell.rowSpan} style={{ border: '1px solid var(--mantine-color-default-border)', padding: '4px 8px' }}>
                  {renderBlockGroups(cell.blocks)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  if (block.kind === 'image') {
    return <img src={`data:image/${block.format};base64,${block.base64}`} alt={block.altText ?? ''} style={{ maxWidth: '100%' }} />;
  }
  // pageBreak and embeddedObject have no HTML equivalent worth rendering here -- markdown itself never produces either (see this file's own module comment), so this only matters if a non-markdown-sourced ContentDocument were ever passed in by mistake.
  return null;
}

function renderParagraph(paragraph: ContentParagraph): ReactNode {
  const headingMatch = HEADING_STYLE_PATTERN.exec(paragraph.styleId ?? '');
  if (headingMatch !== null) {
    const level = Number(headingMatch[1]);
    const Tag = HEADING_TAGS[level];
    if (Tag !== undefined) return <Tag style={{ marginBlock: '0.6em 0.3em' }}>{renderRuns(paragraph.runs)}</Tag>;
  }
  if (paragraph.styleId === 'quote') {
    return (
      <blockquote style={{ margin: '0.6em 0', paddingLeft: 12, borderLeft: '3px solid var(--mantine-color-default-border)', color: 'var(--mantine-color-dimmed)' }}>
        {renderRuns(paragraph.runs)}
      </blockquote>
    );
  }
  if (paragraph.styleId === 'code-block') {
    return (
      <pre style={{ background: 'var(--mantine-color-default)', padding: 12, borderRadius: 4, overflowX: 'auto' }}>
        <code>{paragraph.runs.map((run) => run.text).join('')}</code>
      </pre>
    );
  }
  if (paragraph.styleId === 'horizontal-rule') {
    return <hr style={{ border: 'none', borderTop: '1px solid var(--mantine-color-default-border)', margin: '1em 0' }} />;
  }
  return <p style={{ margin: '0.4em 0', lineHeight: 1.5 }}>{renderRuns(paragraph.runs)}</p>;
}

function renderRuns(runs: readonly ContentRun[]): ReactNode {
  return runs.map((run, index) => {
    let node: ReactNode = run.text;
    if (run.bold === true) node = <strong>{node}</strong>;
    if (run.italic === true) node = <em>{node}</em>;
    if (run.underline === true) node = <u>{node}</u>;
    if (run.strike === true) node = <s>{node}</s>;
    // Markdown has no construct that sets a run's fontFamily other than inline code (markdown-codec lowers `` `x` `` to a run carrying fontFamily: "Courier New", confirmed against its actual output) -- checking for any explicit fontFamily is a safe, correct signal here specifically because this component only ever renders markdown-sourced content.
    if (run.fontFamily !== undefined) {
      node = (
        <code style={{ background: 'var(--mantine-color-default)', padding: '1px 4px', borderRadius: 3 }}>{node}</code>
      );
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

interface ListItemNode {
  readonly runs: readonly ContentRun[];
  readonly ordered: boolean;
  readonly children: ListItemNode[];
}

// Reconstructs a nested list tree from a flat run of list-membership paragraphs via a level stack -- markdown-codec keeps one numId for an entire uniformly-typed nested outline (confirmed by documents.js's own read.test.ts), so ordered-vs-bullet is read per item from its own numId's "ordered:"/"bullet:" prefix rather than assumed constant across the whole group, correctly handling a bullet list that nests an ordered sub-list (or vice versa) despite that switching numId partway through.
function buildListForest(items: readonly ContentParagraph[]): ListItemNode[] {
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

// Groups consecutive same-type siblings into one <ul>/<ol> -- almost always exactly one group per call (a whole nesting level is normally uniformly ordered or bullet), but a genuine type change between adjacent siblings at the same level renders as two adjacent lists, matching how a browser would render the equivalent raw HTML.
function renderListNodes(nodes: readonly ListItemNode[]): ReactNode {
  const groups: { ordered: boolean; nodes: ListItemNode[] }[] = [];
  for (const node of nodes) {
    const last = groups[groups.length - 1];
    if (last?.ordered === node.ordered) {
      last.nodes.push(node);
    } else {
      groups.push({ ordered: node.ordered, nodes: [node] });
    }
  }
  return groups.map((group, groupIndex) => {
    const items = group.nodes.map((node, nodeIndex) => (
      <li key={nodeIndex}>
        {renderRuns(node.runs)}
        {node.children.length > 0 && renderListNodes(node.children)}
      </li>
    ));
    return group.ordered ? (
      <ol key={groupIndex} style={{ margin: '0.3em 0', paddingLeft: 24 }}>
        {items}
      </ol>
    ) : (
      <ul key={groupIndex} style={{ margin: '0.3em 0', paddingLeft: 24 }}>
        {items}
      </ul>
    );
  });
}
