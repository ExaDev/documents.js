import {
  Badge,
  Group,
  LoadingOverlay,
  Paper,
  Stack,
  Text,
} from "@mantine/core";
import type { ContentDocument } from "documents.js";
import type { ReactNode } from "react";

import { renderBlocksNeutral } from "./contentBlocks";
import { flexColumn, previewFrame } from "./previewPanel.css";

export interface WordProcessingPreviewProps {
  label: string;
  format: string;
  content?: ContentDocument;
  loading?: boolean;
  error?: unknown;
}

// Renders a docx/odt-sourced ContentDocument natively as HTML instead of round-tripping it through a PDF rendition. Headings are detected via the same heading-{N} convention MarkdownPreview uses (router.ts's normalizeWordprocessingSemantics rewrites headingLevel / raw Heading{N} styleIds into it). Known, bounded gaps vs a full wordprocessor: (1) blockquotes, code blocks, and horizontal rules render as plain paragraphs -- no mapping from a real docx/odt style name to those semantic roles exists today; (2) lists render with a neutral marker (not bullet, not numbered) because ordered-vs-bullet cannot be determined from ContentDocument alone (numbering definitions aren't folded in); (3) embedded objects (formulas, nested documents) and page breaks render nothing -- they have no HTML equivalent in this flowing-text preview (a PDF export still renders them correctly via the layout engine). Block rendering itself is shared with SlidesPreview via renderBlocksNeutral in contentBlocks.tsx.
export function WordProcessingPreview({
  label,
  format,
  content,
  loading,
  error,
}: WordProcessingPreviewProps) {
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
      <Paper
        withBorder
        pos="relative"
        className={previewFrame({ scroll: true, padded: true })}
      >
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
  if (content.kind !== "wordprocessing") return null;
  return content.sections.map((section, sectionIndex) => (
    <div key={sectionIndex}>{renderBlocksNeutral(section.blocks)}</div>
  ));
}
