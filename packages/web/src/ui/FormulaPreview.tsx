import {
  Badge,
  Group,
  LoadingOverlay,
  Paper,
  Stack,
  Text,
} from "@mantine/core";
import type { ContentDocument } from "documents.js";

import { MathMlView } from "./MathMlView";
import { flexColumn, previewFrame } from "./previewPanel.css";
import * as styles from "./FormulaPreview.css";

export interface FormulaPreviewProps {
  label: string;
  format: string;
  content?: ContentDocument;
  loading?: boolean;
  error?: unknown;
}

// Renders an odf-sourced formula ContentDocument as native browser MathML instead of routing through a PDF rendition, via the shared MathMlView (mathml.ts's own top-of-file note explains the imperative DOM walk).
export function FormulaPreview({
  label,
  format,
  content,
  loading,
  error,
}: FormulaPreviewProps) {
  const formula = content?.kind === "formula" ? content.formula : undefined;

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
        className={previewFrame({ scroll: true })}
      >
        <LoadingOverlay visible={loading === true} />
        {error !== undefined ? (
          <Group h="100%" justify="center">
            <Text c="dimmed" size="sm">
              Preview unavailable for this format.
            </Text>
          </Group>
        ) : formula === undefined ? (
          <Group h="100%" justify="center">
            <Text c="dimmed" size="sm">
              No preview yet.
            </Text>
          </Group>
        ) : (
          <MathMlView
            mathml={formula.mathml}
            className={styles.formulaContainer}
          />
        )}
      </Paper>
    </Stack>
  );
}
