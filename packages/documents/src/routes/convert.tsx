import { Alert, Box, Button, Container, Group, Paper, Select, Stack, Text, Title } from '@mantine/core';
import { createFileRoute, useNavigate, useParams } from '@tanstack/react-router';
import { DocumentFormatSchema } from 'documents.js';
import { useEffect, useState } from 'react';

import { createFileAccess } from '../adapters/fileAccess/createFileAccess';
import { useConversions, useDocumentFormats } from '../hooks/useConversions';
import { useConvert } from '../hooks/useConvert';
import type { OpenedFile } from '../ports/fileAccess';
import { inferFormatFromFilename } from '../shared/extensionToFormat';
import { DiagnosticsPanel } from '../ui/DiagnosticsPanel';
import { FileUpload } from '../ui/FileUpload';
import { MarkdownPreview } from '../ui/MarkdownPreview';
import { notifyError, notifySuccess } from '../ui/notify';
import { PdfPreview } from '../ui/PdfPreview';
import { takePendingReopen } from '../ui/reopenMailbox';

// Layout route: convert.index.tsx and convert.$source.$target.tsx become its children (per TanStack Router's file-based nesting convention) and exist only to register typed path params in the route tree -- this component owns all the real state and UI directly, so it never remounts when the selected pair changes. That's the actual fix for "picking a new pair feels like leaving the page": the old sibling-routes structure fully remounted (destroying `file`/`convert` state) on every pair change, since convert.index.tsx and convert.$source.$target.tsx both parented directly to root.
export const Route = createFileRoute('/convert')({
  component: ConvertLayout,
});

function ConvertLayout() {
  const params = useParams({ strict: false });
  const navigate = useNavigate();
  const conversions = useConversions();
  const formats = useDocumentFormats();

  // Captured once via its own lazy initializer -- takePendingReopen clears the mailbox on read, so the source/file initializers below must read this already-resolved value rather than calling takePendingReopen() a second time (which would find it empty).
  const [pendingReopen] = useState(() => takePendingReopen());

  // Lazy initializers, not an effect: this only needs to seed state once, from whatever the route's params (or a Recent Files reopen) are at the moment ConvertLayout first mounts -- `params` merges the currently matched leaf route's params up into this parent route via `strict: false`. Syncing via an effect instead would set state synchronously during render's commit phase for no benefit here (the initial value never needs to react to a *later* params change; the navigate() effect below is what keeps params in sync with state, not the other way around after mount).
  const [source, setSource] = useState<string | null>(() => params.source ?? pendingReopen?.format ?? null);
  const [target, setTarget] = useState<string | null>(() => params.target ?? null);
  const [file, setFile] = useState<OpenedFile | undefined>(() => pendingReopen?.file);
  const convert = useConvert();
  // Separate mutations from the same convert RPC, purely to produce a PDF rendition for side-by-side preview -- every documents.js format can render to PDF (odf included), so "preview this document" is just "convert it to PDF and drop it in an iframe". Skipped entirely when the format in question already is PDF, since the bytes are then already what the preview needs.
  const originalPreview = useConvert();
  const resultPreview = useConvert();
  const fileAccess = createFileAccess();

  // Only reflect a *complete* pair in the URL -- a half-picked pair isn't a meaningful thing to bookmark. `replace`, not `push`: changing formats mid-exploration is editing current tool state, not creating a new navigable history entry.
  useEffect(() => {
    if (source !== null && target !== null) {
      void navigate({ to: '/convert/$source/$target', params: { source, target }, replace: true });
    }
  }, [source, target, navigate]);

  // Prefetches the original's PDF preview as soon as a file and its (auto-detected or manual) source are both known, rather than waiting for the user to click Convert -- so the "Original" preview panel is already populated the moment the "Done" panel appears. `mutate`'s identity is stable across renders (TanStack Query), so depending on it here doesn't retrigger this effect on every render.
  const { mutate: mutateOriginalPreview } = originalPreview;
  useEffect(() => {
    if (file === undefined || source === null || source === 'pdf') return;
    const parsedSource = DocumentFormatSchema.safeParse(source);
    if (!parsedSource.success) return;
    mutateOriginalPreview({ source: parsedSource.data, targetFormat: 'pdf', bytes: file.bytes });
  }, [file, source, mutateOriginalPreview]);

  const sourceOptions = [...new Set((conversions.data ?? []).map((pair) => pair.source))].sort();

  // Every known format is always listed -- ones the current source can't reach are disabled in place rather than filtered out, so picking "To" first still shows the full picture of what's possible, not a silently shrinking list.
  const validTargets = new Set((conversions.data ?? []).filter((pair) => pair.source === source).map((pair) => pair.target));
  const targetData = [...(formats.data ?? [])].sort().map((format) => ({ value: format, label: format, disabled: !validTargets.has(format) }));

  const handleSourceChange = (value: string | null) => {
    setSource(value);
    setTarget(null);
    convert.reset();
  };

  const handleTargetChange = (value: string | null) => {
    setTarget(value);
    convert.reset();
  };

  const handleFile = (opened: OpenedFile) => {
    setFile(opened);
    convert.reset();
    // Auto-detected format overrides "From" outright -- a fresh drop is the strongest signal of intent, stronger than whatever was previously selected. When the extension isn't recognised, "From" is left untouched (manual or previously-detected) and the Alert below explains why nothing changed.
    const detected = inferFormatFromFilename(opened.name);
    if (detected !== undefined) handleSourceChange(detected);
  };

  const handleConvert = () => {
    if (file === undefined || source === null || target === null) return;
    // Mantine's Select works in plain strings, so `source`/`target` need re-narrowing to DocumentFormat here rather than a cast -- they can only ever hold a value drawn from sourceOptions/targetOptions, which are themselves real DocumentFormat values, so this parse cannot practically fail.
    const parsedSource = DocumentFormatSchema.safeParse(source);
    const parsedTarget = DocumentFormatSchema.safeParse(target);
    if (!parsedSource.success || !parsedTarget.success) return;
    convert.mutate(
      { source: parsedSource.data, targetFormat: parsedTarget.data, bytes: file.bytes },
      {
        onSuccess: (result) => {
          notifySuccess('Converted', { diagnostics: result.diagnostics });
          if (parsedTarget.data !== 'pdf') {
            resultPreview.mutate({ source: parsedTarget.data, targetFormat: 'pdf', bytes: result.document.bytes });
          }
        },
        onError: (error) => notifyError('Conversion failed', error),
      },
    );
  };

  // By the time convert.data exists, source/target reset to null/undefined the moment either changes again (handleSourceChange/handleTargetChange/handleFile all call convert.reset()), so these always describe the pair that actually produced convert.data -- no risk of pairing stale bytes with a since-changed format label.
  const originalPdfBytes = source === 'pdf' ? file?.bytes : originalPreview.data?.document.bytes;
  const convertedPdfBytes = target === 'pdf' ? convert.data?.document.bytes : resultPreview.data?.document.bytes;

  const handleDownload = () => {
    if (convert.data === undefined) return;
    void fileAccess.saveFile(convert.data.document.bytes, {
      suggestedName: `${file?.name.replace(/\.[^.]+$/, '') ?? 'document'}.${target ?? 'bin'}`,
      mimeType: 'application/octet-stream',
    });
  };

  return (
    <Container size="xl" py="xl">
      <Stack gap="lg">
        <Box maw={600}>
          <Stack gap="lg">
            <Title order={2}>Convert a document</Title>

            <Paper withBorder p="md">
              <Stack gap="sm">
                <FileUpload file={file} onFile={handleFile} />
                {file !== undefined && inferFormatFromFilename(file.name) === undefined && (
                  <Alert color="yellow">Could not detect "{file.name}"'s format from its extension -- pick "From" manually below.</Alert>
                )}

                <Group grow>
                  <Select
                    label="From"
                    placeholder="Source format"
                    searchable
                    data={sourceOptions}
                    value={source}
                    onChange={handleSourceChange}
                    description={file !== undefined && inferFormatFromFilename(file.name) === source ? 'Detected from file' : undefined}
                  />
                  <Select
                    label="To"
                    placeholder="Target format"
                    searchable
                    data={targetData}
                    value={target}
                    onChange={handleTargetChange}
                    disabled={source === null}
                  />
                </Group>

                <Button onClick={handleConvert} disabled={file === undefined || source === null || target === null} loading={convert.isPending}>
                  Convert
                </Button>
              </Stack>
            </Paper>
          </Stack>
        </Box>

        {convert.data && (
          <Paper withBorder p="md">
            <Stack gap="md">
              <Group justify="space-between">
                <Text fw={500}>Done</Text>
                <Button onClick={handleDownload}>Download</Button>
              </Group>
              <DiagnosticsPanel diagnostics={convert.data.diagnostics} />
              <Group align="flex-start" grow wrap="nowrap">
                {source === 'markdown' ? (
                  <MarkdownPreview
                    label="Original"
                    format={source}
                    content={originalPreview.data?.content}
                    loading={originalPreview.isPending}
                    // React Query represents "no error" as null, not undefined -- normalised here since MarkdownPreview/PdfPreview's own contract only knows "no error" as undefined.
                    error={originalPreview.error ?? undefined}
                  />
                ) : (
                  <PdfPreview
                    label="Original"
                    format={source ?? ''}
                    bytes={originalPdfBytes}
                    loading={source !== 'pdf' && originalPreview.isPending}
                    error={source !== 'pdf' && originalPreview.error !== null ? originalPreview.error : undefined}
                  />
                )}
                {target === 'markdown' ? (
                  <MarkdownPreview
                    label="Converted"
                    format={target}
                    content={resultPreview.data?.content}
                    loading={resultPreview.isPending}
                    error={resultPreview.error ?? undefined}
                  />
                ) : (
                  <PdfPreview
                    label="Converted"
                    format={target ?? ''}
                    bytes={convertedPdfBytes}
                    loading={target !== 'pdf' && resultPreview.isPending}
                    error={target !== 'pdf' && resultPreview.error !== null ? resultPreview.error : undefined}
                  />
                )}
              </Group>
            </Stack>
          </Paper>
        )}
      </Stack>
    </Container>
  );
}
