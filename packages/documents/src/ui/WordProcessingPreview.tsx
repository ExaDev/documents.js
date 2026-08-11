import { Badge, Group, LoadingOverlay, Paper, Stack, Text } from '@mantine/core';
import type { ContentBlock, ContentDocument, ContentParagraph } from 'documents.js';
import type { ReactNode } from 'react';

import type { ListItemNode } from './contentBlocks';
import { buildListForest, collectBlockGroups, HEADING_STYLE_PATTERN, HEADING_TAGS, renderImage, renderRuns, renderTable } from './contentBlocks';
import { heading as headingStyle, paragraph as paragraphStyle } from './contentBlocks.css';
import { flexColumn, previewFrame } from './previewPanel.css';
import * as styles from './WordProcessingPreview.css';

export interface WordProcessingPreviewProps {
  label: string;
  format: string;
  content?: ContentDocument;
  loading?: boolean;
  error?: unknown;
}

// Renders a docx/odt-sourced ContentDocument natively as HTML instead of round-tripping it through a PDF rendition. Headings are detected via the same heading-{N} convention MarkdownPreview uses (router.ts's normalizeWordprocessingHeadings rewrites the raw Heading{N} styleIds into it). Known, bounded gaps vs a full wordprocessor: (1) blockquotes, code blocks, and horizontal rules render as plain paragraphs -- no mapping from a real docx/odt style name to those semantic roles exists today; (2) lists render with a neutral marker (not bullet, not numbered) because ordered-vs-bullet cannot be determined from ContentDocument alone (numbering definitions aren't folded in); (3) embedded objects (formulas, nested documents) and page breaks render nothing -- they have no HTML equivalent in this flowing-text preview (a PDF export still renders them correctly via the layout engine).
export function WordProcessingPreview({ label, format, content, loading, error }: WordProcessingPreviewProps) {
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
    if (Tag !== undefined) return <Tag className={headingStyle}>{renderRuns(paragraph.runs)}</Tag>;
  }
  return <p className={paragraphStyle}>{renderRuns(paragraph.runs)}</p>;
}

// Unlike MarkdownPreview's renderListNodes (which groups consecutive same-type siblings into separate <ul>/<ol>), every list here renders as one <ul> with the neutral marker -- ordered-vs-bullet is unknown, so there is no type to split on.
function renderListNodes(nodes: readonly ListItemNode[]): ReactNode {
  return (
    <ul className={styles.neutralList}>
      {nodes.map((node, nodeIndex) => (
        <li key={nodeIndex} className={styles.neutralListItem}>
          {renderRuns(node.runs)}
          {node.children.length > 0 && renderListNodes(node.children)}
        </li>
      ))}
    </ul>
  );
}
