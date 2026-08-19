import { Badge, Group, LoadingOverlay, Paper, Stack, Text } from '@mantine/core';

import { usePdfObjectUrl } from '../hooks/usePdfObjectUrl';
import { iframe as iframeStyle } from './PdfPreview.css';
import { flexColumn, previewFrame } from './previewPanel.css';

export interface PdfPreviewProps {
  label: string;
  format: string;
  bytes?: Uint8Array<ArrayBuffer>;
  loading?: boolean;
  error?: unknown;
}

// Every document.js format can render to PDF (odf included, via odfToPdf), so previewing any format -- not just PDF itself -- is a matter of rendering its PDF rendition. The caller decides whether that rendition needs generating (a non-PDF format) or already exists (the format is PDF outright).
export function PdfPreview({ label, format, bytes, loading, error }: PdfPreviewProps) {
  const url = usePdfObjectUrl(bytes);

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
      <Paper withBorder pos="relative" className={previewFrame()}>
        <LoadingOverlay visible={loading === true} />
        {error !== undefined ? (
          <Group h="100%" justify="center">
            <Text c="dimmed" size="sm">
              Preview unavailable for this format.
            </Text>
          </Group>
        ) : url === undefined ? (
          <Group h="100%" justify="center">
            <Text c="dimmed" size="sm">
              No preview yet.
            </Text>
          </Group>
        ) : (
          <iframe src={url} title={`${label} preview`} className={iframeStyle} />
        )}
      </Paper>
    </Stack>
  );
}
