import { Badge, Group, LoadingOverlay, Paper, Stack, Text } from '@mantine/core';
import type { ContentBlock, ContentDocument, ContentParagraph } from 'documents.js';
import type { ReactNode } from 'react';

import { buildListForest, collectBlockGroups, HEADING_STYLE_PATTERN, HEADING_TAGS, renderImage, renderRuns, renderTable } from './contentBlocks';
import { heading as headingStyle, paragraph as paragraphStyle } from './contentBlocks.css';
import * as styles from './MarkdownPreview.css';
import { flexColumn, previewFrame } from './previewPanel.css';

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
    <Stack gap={4} className={flexColumn}>
      <Group gap="xs">
        <Text size="sm" fw={500}>
          {label}
        </Text>
        <Badge size="xs" variant="light">
          {format}
        </Badge>
      </Group>
      <Paper withBorder pos="relative" className={previewFrame({ scroll: true, padded: true })}>
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

// markdown-codec lowers `inline code` to a run carrying an explicit fontFamily -- the only markdown construct that sets one -- so for markdown-sourced content, any run with fontFamily is inline code.
function renderRunsMd(runs: Parameters<typeof renderRuns>[0]): ReactNode {
  return renderRuns(runs, { treatFontFamilyAsInlineCode: true });
}

function renderContentDocument(content: ContentDocument): ReactNode {
  if (content.kind !== 'wordprocessing') return null;
  return content.sections.map((section, sectionIndex) => (
    <div key={sectionIndex}>{renderBlockGroups(section.blocks)}</div>
  ));
}

function renderBlockGroups(blocks: readonly ContentBlock[]): ReactNode {
  return collectBlockGroups(blocks).map((group, index) =>
    group.kind === 'listGroup' ? (
      <div key={index}>{renderListNodes(buildListForest(group.items))}</div>
    ) : (
      <div key={index}>{renderBlock(group)}</div>
    ),
  );
}

function renderBlock(block: ContentBlock): ReactNode {
  if (block.kind === 'paragraph') return renderParagraph(block);
  if (block.kind === 'table') return renderTable(block, renderBlockGroups);
  if (block.kind === 'image') return renderImage(block);
  return null;
}

function renderParagraph(paragraph: ContentParagraph): ReactNode {
  const headingMatch = HEADING_STYLE_PATTERN.exec(paragraph.styleId ?? '');
  if (headingMatch !== null) {
    const Tag = HEADING_TAGS[Number(headingMatch[1])];
    if (Tag !== undefined) return <Tag className={headingStyle}>{renderRunsMd(paragraph.runs)}</Tag>;
  }
  if (paragraph.styleId === 'quote') {
    return <blockquote className={styles.blockquote}>{renderRunsMd(paragraph.runs)}</blockquote>;
  }
  if (paragraph.styleId === 'code-block') {
    return (
      <pre className={styles.codeBlock}>
        <code>{paragraph.runs.map((run) => run.text).join('')}</code>
      </pre>
    );
  }
  if (paragraph.styleId === 'horizontal-rule') {
    return <hr className={styles.hr} />;
  }
  return <p className={paragraphStyle}>{renderRunsMd(paragraph.runs)}</p>;
}

// Groups consecutive same-type siblings into one <ul>/<ol> -- almost always exactly one group per call (a whole nesting level is normally uniformly ordered or bullet), but a genuine type change between adjacent siblings at the same level renders as two adjacent lists, matching how a browser would render the equivalent raw HTML.
function renderListNodes(nodes: ReturnType<typeof buildListForest>): ReactNode {
  const groups: { ordered: boolean; nodes: typeof nodes }[] = [];
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
        {renderRunsMd(node.runs)}
        {node.children.length > 0 && renderListNodes(node.children)}
      </li>
    ));
    return group.ordered ? (
      <ol key={groupIndex} className={styles.list}>
        {items}
      </ol>
    ) : (
      <ul key={groupIndex} className={styles.list}>
        {items}
      </ul>
    );
  });
}
