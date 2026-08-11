import { Alert, Box, Button, Container, Group, Paper, Select, Spoiler, Stack, Text, Title } from '@mantine/core';
import { createFileRoute, useNavigate, useParams } from '@tanstack/react-router';
import { DocumentFormatSchema } from 'documents.js';
import { useEffect, useMemo, useState } from 'react';

import { createFileAccess } from '../adapters/fileAccess/createFileAccess';
import { useConversions, useDocumentFormats } from '../hooks/useConversions';
import { useConvert } from '../hooks/useConvert';
import { contentInspectResult, useInspectPdfBytes, useReadContent } from '../hooks/useInspect';
import type { OpenedFile } from '../ports/fileAccess';
import { inferFormatFromFilename } from '../shared/extensionToFormat';
import { donePanel } from '../ui/convertLayout.css';
import { DiagnosticsPanel } from '../ui/DiagnosticsPanel';
import { FileUpload } from '../ui/FileUpload';
import { InspectPanel } from '../ui/InspectPanel';
import { MarkdownPreview } from '../ui/MarkdownPreview';
import { notifyError, notifySuccess } from '../ui/notify';
import { PdfPreview } from '../ui/PdfPreview';
import { flexColumn } from '../ui/previewPanel.css';
import { SheetPreview } from '../ui/SheetPreview';
import { SlidesPreview } from '../ui/SlidesPreview';
import { FormulaPreview } from '../ui/FormulaPreview';
import { takePendingReopen } from '../ui/reopenMailbox';
import { WordProcessingPreview } from '../ui/WordProcessingPreview';

// Layout route: convert.index.tsx and convert.$source.$target.tsx become its children (per TanStack Router's file-based nesting convention) and exist only to register typed path params in the route tree -- this component owns all the real state and UI directly, so it never remounts when the selected pair changes. That's the actual fix for "picking a new pair feels like leaving the page": the old sibling-routes structure fully remounted (destroying `file`/`convert` state) on every pair change, since convert.index.tsx and convert.$source.$target.tsx both parented directly to root.
export const Route = createFileRoute('/convert')({
  component: ConvertLayout,
});

function isSheetFormat(format: string | null): boolean {
  return format === 'xlsx' || format === 'ods';
}

function isWordProcessingFormat(format: string | null): boolean {
  return format === 'docx' || format === 'odt';
}

function isSlidesFormat(format: string | null): boolean {
  return format === 'pptx' || format === 'odp' || format === 'odg';
}

// True for every format whose preview renders the ContentDocument natively via content.read rather than a PDF rendition. PDF itself is the only exception -- its "native" representation IS the PDF bytes rendered in an iframe.
function isContentBackedPreview(format: string | null): boolean {
  return format !== 'pdf' && format !== null;
}

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
  // Content-backed previews read their ContentDocument directly via the content.read RPC -- no conversion, no target build/encode, no PDF layout pass. PDF (the only non-content-backed format) uses the uploaded file's own bytes in PdfPreview directly.
  const originalContent = useReadContent();
  const resultContent = useReadContent();
  const fileAccess = createFileAccess();

  // Only reflect a *complete* pair in the URL -- a half-picked pair isn't a meaningful thing to bookmark. `replace`, not `push`: changing formats mid-exploration is editing current tool state, not creating a new navigable history entry.
  useEffect(() => {
    if (source !== null && target !== null) {
      void navigate({ to: '/convert/$source/$target', params: { source, target }, replace: true });
    }
  }, [source, target, navigate]);

  // Prefetches the original's content as soon as a file and its (auto-detected or manual) source are both known, rather than waiting for the user to click Convert -- so the "Original" preview panel is already populated the moment the "Done" panel appears. `mutate`'s identity is stable across renders (TanStack Query), so depending on it here doesn't retrigger this effect on every render. Skipped for PDF -- its bytes are already what PdfPreview needs.
  const { mutate: mutateOriginalContent } = originalContent;
  useEffect(() => {
    if (file === undefined || source === null || source === 'pdf') return;
    const parsedSource = DocumentFormatSchema.safeParse(source);
    if (!parsedSource.success) return;
    mutateOriginalContent({ format: parsedSource.data, bytes: file.bytes });
  }, [file, source, mutateOriginalContent]);

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
            resultContent.mutate({ format: parsedTarget.data, bytes: result.document.bytes });
          }
        },
        onError: (error) => notifyError('Conversion failed', error),
      },
    );
  };

  // Structure inspection for content-backed formats derives directly from the ContentDocument already on hand (from content.read) -- pure client-side, no second RPC. For PDF, a separate pdf.inspect call parses the bytes directly.
  const originalInspectData = useMemo(
    () => isContentBackedPreview(source) && originalContent.data !== undefined ? contentInspectResult(originalContent.data) : undefined,
    [source, originalContent.data],
  );
  const originalInspect = useInspectPdfBytes();
  const { mutate: mutateOriginalInspect } = originalInspect;
  useEffect(() => {
    if (isContentBackedPreview(source) || file === undefined) return;
    mutateOriginalInspect(file.bytes);
  }, [source, file, mutateOriginalInspect]);

  const convertedInspectData = useMemo(
    () => isContentBackedPreview(target) && resultContent.data !== undefined ? contentInspectResult(resultContent.data) : undefined,
    [target, resultContent.data],
  );
  const convertedInspect = useInspectPdfBytes();
  const { mutate: mutateConvertedInspect } = convertedInspect;
  useEffect(() => {
    if (isContentBackedPreview(target) || convert.data === undefined) return;
    mutateConvertedInspect(convert.data.document.bytes);
  }, [target, convert.data, mutateConvertedInspect]);

  const handleDownload = () => {
    if (convert.data === undefined) return;
    void fileAccess.saveFile(convert.data.document.bytes, {
      suggestedName: `${file?.name.replace(/\.[^.]+$/, '') ?? 'document'}.${target ?? 'bin'}`,
      mimeType: 'application/octet-stream',
    });
  };

  return (
    // Fluid, not a fixed max-width -- Mantine's Container size prop is a static breakpoint (same cap at 1920px and 2560px alike), which is what previously left a growing dead margin on wide screens. The Done panel below applies its own clamp()-based max-width instead, so it scales continuously with viewport rather than jumping to one arbitrary number.
    <Container fluid px="xl" py="xl">
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
          // maxWidth scales with viewport via clamp() rather than jumping to one fixed breakpoint: never narrower than the controls column above (900px), grows at 85% of viewport width, never wider than 2200px so preview text doesn't sprawl on an ultrawide monitor. Below 900px (and always inside the fluid Container's own padding) it simply falls back to 100% of the available width.
          <Paper withBorder p="md" className={donePanel}>
            <Stack gap="md">
              <Group justify="space-between">
                <Text fw={500}>Done</Text>
                <Button onClick={handleDownload}>Download</Button>
              </Group>
              <DiagnosticsPanel diagnostics={convert.data.diagnostics} />
              <Group align="flex-start" grow wrap="nowrap">
                <Stack gap={4} className={flexColumn}>
                  {source === 'markdown' ? (
                    <MarkdownPreview
                      label="Original"
                      format={source}
                      content={originalContent.data}
                      loading={originalContent.isPending}
                      // React Query represents "no error" as null, not undefined -- normalised here since MarkdownPreview/SheetPreview/PdfPreview's own contract only knows "no error" as undefined.
                      error={originalContent.error ?? undefined}
                    />
                  ) : isSheetFormat(source) ? (
                    <SheetPreview
                      label="Original"
                      format={source ?? ''}
                      content={originalContent.data}
                      loading={originalContent.isPending}
                      error={originalContent.error ?? undefined}
                    />
                  ) : isWordProcessingFormat(source) ? (
                    <WordProcessingPreview
                      label="Original"
                      format={source ?? ''}
                      content={originalContent.data}
                      loading={originalContent.isPending}
                      error={originalContent.error ?? undefined}
                    />
                  ) : isSlidesFormat(source) ? (
                    <SlidesPreview
                      label="Original"
                      format={source ?? ''}
                      content={originalContent.data}
                      loading={originalContent.isPending}
                      error={originalContent.error ?? undefined}
                    />
                  ) : source === 'odf' ? (
                    <FormulaPreview
                      label="Original"
                      format={source ?? ''}
                      content={originalContent.data}
                      loading={originalContent.isPending}
                      error={originalContent.error ?? undefined}
                    />
                  ) : (
                    <PdfPreview
                      label="Original"
                      format={source ?? ''}
                      bytes={file?.bytes}
                    />
                  )}
                  <Spoiler maxHeight={0} showLabel="Show structure" hideLabel="Hide structure">
                    {isContentBackedPreview(source) ? (
                      <InspectPanel data={originalInspectData} loading={originalContent.isPending} error={originalContent.error ?? undefined} />
                    ) : (
                      <InspectPanel data={originalInspect.data} loading={originalInspect.isPending} error={originalInspect.error ?? undefined} />
                    )}
                  </Spoiler>
                </Stack>
                <Stack gap={4} className={flexColumn}>
                  {target === 'markdown' ? (
                    <MarkdownPreview
                      label="Converted"
                      format={target}
                      content={resultContent.data}
                      loading={resultContent.isPending}
                      error={resultContent.error ?? undefined}
                    />
                  ) : isSheetFormat(target) ? (
                    <SheetPreview
                      label="Converted"
                      format={target ?? ''}
                      content={resultContent.data}
                      loading={resultContent.isPending}
                      error={resultContent.error ?? undefined}
                    />
                  ) : isWordProcessingFormat(target) ? (
                    <WordProcessingPreview
                      label="Converted"
                      format={target ?? ''}
                      content={resultContent.data}
                      loading={resultContent.isPending}
                      error={resultContent.error ?? undefined}
                    />
                  ) : isSlidesFormat(target) ? (
                    <SlidesPreview
                      label="Converted"
                      format={target ?? ''}
                      content={resultContent.data}
                      loading={resultContent.isPending}
                      error={resultContent.error ?? undefined}
                    />
                  ) : target === 'odf' ? (
                    <FormulaPreview
                      label="Converted"
                      format={target ?? ''}
                      content={resultContent.data}
                      loading={resultContent.isPending}
                      error={resultContent.error ?? undefined}
                    />
                  ) : (
                    <PdfPreview
                      label="Converted"
                      format={target ?? ''}
                      bytes={convert.data.document.bytes}
                    />
                  )}
                  <Spoiler maxHeight={0} showLabel="Show structure" hideLabel="Hide structure">
                    {isContentBackedPreview(target) ? (
                      <InspectPanel data={convertedInspectData} loading={resultContent.isPending} error={resultContent.error ?? undefined} />
                    ) : (
                      <InspectPanel data={convertedInspect.data} loading={convertedInspect.isPending} error={convertedInspect.error ?? undefined} />
                    )}
                  </Spoiler>
                </Stack>
              </Group>
            </Stack>
          </Paper>
        )}
      </Stack>
    </Container>
  );
}
