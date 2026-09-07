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

// Renders a docx/odt-sourced ContentDocument natively as HTML instead of round-tripping it through a PDF rendition. Headings, blockquotes, code blocks, and lists (ordered vs bullet) are detected via the shared conventions router.ts's normalizeWordprocessingSemantics/normalizeDocxListKinds rewrite real docx/odt style names and numbering data into (see contentBlocks.tsx's own doc comments on HEADING_STYLE_PATTERN and buildListForest). Horizontal rules are detected two ways: odt via LibreOffice's built-in "Horizontal Line" style, docx via ContentParagraph.borders (ExaDev/documents.js#1082) -- an otherwise-empty paragraph whose only border is a bottom edge, the shape Word's own AutoCorrect "---" then Enter produces with no named style involved. odt's own reader does not populate ContentParagraph.borders yet (ODF's fo:border-* shorthand needs its own parser, tracked separately), so an odt producer that builds a border-only rule without the named style still renders as a plain paragraph for now. Embedded objects render inline as native MathML for a formula, or a labelled placeholder for everything else (a nested document is not expected to be laid out by this preview, per document-schema.js's own ContentEmbeddedObject doc comment); page breaks (docx's own pageBreak block, odt's paragraph-level pageBreakBefore/pageBreakAfter) render as a visible break marker rather than an actual page boundary, since this is flowing HTML, not paginated layout (a PDF export still renders a real page break via the layout engine). Block rendering itself is shared with SlidesPreview via renderBlocksNeutral in contentBlocks.tsx.
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
