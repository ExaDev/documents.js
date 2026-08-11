import { Alert, Box, Button, Container, Group, Paper, Select, Spoiler, Stack, Text, Title } from '@mantine/core';
import { createFileRoute, useNavigate, useParams } from '@tanstack/react-router';
import { DocumentFormatSchema } from 'documents.js';
import type { DocumentFormat } from 'documents.js';
import { useEffect, useMemo, useState } from 'react';

import { createFileAccess } from '../adapters/fileAccess/createFileAccess';
import { useConversions, useDocumentFormats } from '../hooks/useConversions';
import { useConvert } from '../hooks/useConvert';
import { contentInspectResult, useInspectPdfBytes } from '../hooks/useInspect';
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
import { takePendingReopen } from '../ui/reopenMailbox';

// Layout route: convert.index.tsx and convert.$source.$target.tsx become its children (per TanStack Router's file-based nesting convention) and exist only to register typed path params in the route tree -- this component owns all the real state and UI directly, so it never remounts when the selected pair changes. That's the actual fix for "picking a new pair feels like leaving the page": the old sibling-routes structure fully remounted (destroying `file`/`convert` state) on every pair change, since convert.index.tsx and convert.$source.$target.tsx both parented directly to root.
export const Route = createFileRoute('/convert')({
  component: ConvertLayout,
});

function isSheetFormat(format: string | null): boolean {
  return format === 'xlsx' || format === 'ods';
}

// Cheapest same-variant bridge target for previewing a format's native content -- avoids a full PDF layout pass for formats whose preview already renders the ContentDocument natively. Formats not yet covered by a native preview component fall through to 'pdf' (their only rendering path today).
function previewBridgeTarget(format: DocumentFormat): DocumentFormat {
  switch (format) {
    case 'markdown':
      return 'docx';
    case 'xlsx':
      return 'ods';
    case 'ods':
      return 'xlsx';
    default:
      return 'pdf';
  }
}

// True for formats whose preview renders the ContentDocument natively (MarkdownPreview, SheetPreview) rather than a PDF rendition (PdfPreview). The structure panel derives its data client-side from .content for these, instead of calling pdf.inspect on PDF bytes.
function isContentBackedPreview(format: string | null): boolean {
  return format === 'markdown' || isSheetFormat(format);
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
  // Separate mutations from the same convert RPC, purely to produce a content/bytes rendition for side-by-side preview. For formats with a native preview component (markdown, spreadsheet) this targets the cheapest same-variant bridge so .content is populated without a full PDF layout pass; for everything else it still targets 'pdf' since PdfPreview needs actual PDF bytes. Skipped entirely when the format in question already is PDF, since the bytes are then already what the preview needs.
  const originalPreview = useConvert();
  const resultPreview = useConvert();
  const fileAccess = createFileAccess();

  // Only reflect a *complete* pair in the URL -- a half-picked pair isn't a meaningful thing to bookmark. `replace`, not `push`: changing formats mid-exploration is editing current tool state, not creating a new navigable history entry.
  useEffect(() => {
    if (source !== null && target !== null) {
      void navigate({ to: '/convert/$source/$target', params: { source, target }, replace: true });
    }
  }, [source, target, navigate]);

  // Prefetches the original's preview rendition as soon as a file and its (auto-detected or manual) source are both known, rather than waiting for the user to click Convert -- so the "Original" preview panel is already populated the moment the "Done" panel appears. `mutate`'s identity is stable across renders (TanStack Query), so depending on it here doesn't retrigger this effect on every render.
  const { mutate: mutateOriginalPreview } = originalPreview;
  useEffect(() => {
    if (file === undefined || source === null || source === 'pdf') return;
    const parsedSource = DocumentFormatSchema.safeParse(source);
    if (!parsedSource.success) return;
    mutateOriginalPreview({ source: parsedSource.data, targetFormat: previewBridgeTarget(parsedSource.data), bytes: file.bytes });
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
            resultPreview.mutate({ source: parsedTarget.data, targetFormat: previewBridgeTarget(parsedTarget.data), bytes: result.document.bytes });
          }
        },
        onError: (error) => notifyError('Conversion failed', error),
      },
    );
  };

  // By the time convert.data exists, source/target reset to null/undefined the moment either changes again (handleSourceChange/handleTargetChange/handleFile all call convert.reset()), so these always describe the pair that actually produced convert.data -- no risk of pairing stale bytes with a since-changed format label. These bytes are only consumed by PdfPreview (for PDF-backed formats) -- content-backed formats render from .content instead.
  const originalPreviewBytes = source === 'pdf' ? file?.bytes : originalPreview.data?.document.bytes;
  const convertedPreviewBytes = target === 'pdf' ? convert.data?.document.bytes : resultPreview.data?.document.bytes;

  // For content-backed formats (markdown, spreadsheet), structure inspection derives directly from the .content the preview conversion already returned -- pure client-side, no second RPC. For PDF-backed formats, a separate pdf.inspect call parses the already-available PDF bytes.
  const originalContent = isContentBackedPreview(source) ? originalPreview.data?.content : undefined;
  const originalContentInspect = useMemo(() => (originalContent !== undefined ? contentInspectResult(originalContent) : undefined), [originalContent]);
  const originalInspect = useInspectPdfBytes();
  const { mutate: mutateOriginalInspect } = originalInspect;
  useEffect(() => {
    if (isContentBackedPreview(source)) return;
    if (originalPreviewBytes === undefined) return;
    mutateOriginalInspect(originalPreviewBytes);
  }, [source, originalPreviewBytes, mutateOriginalInspect]);

  const convertedContent = isContentBackedPreview(target) ? resultPreview.data?.content : undefined;
  const convertedContentInspect = useMemo(() => (convertedContent !== undefined ? contentInspectResult(convertedContent) : undefined), [convertedContent]);
  const convertedInspect = useInspectPdfBytes();
  const { mutate: mutateConvertedInspect } = convertedInspect;
  useEffect(() => {
    if (isContentBackedPreview(target)) return;
    if (convertedPreviewBytes === undefined) return;
    mutateConvertedInspect(convertedPreviewBytes);
  }, [target, convertedPreviewBytes, mutateConvertedInspect]);

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
                      content={originalPreview.data?.content}
                      loading={originalPreview.isPending}
                      // React Query represents "no error" as null, not undefined -- normalised here since MarkdownPreview/SheetPreview/PdfPreview's own contract only knows "no error" as undefined.
                      error={originalPreview.error ?? undefined}
                    />
                  ) : isSheetFormat(source) ? (
                    <SheetPreview
                      label="Original"
                      format={source ?? ''}
                      content={originalPreview.data?.content}
                      loading={originalPreview.isPending}
                      error={originalPreview.error ?? undefined}
                    />
                  ) : (
                    <PdfPreview
                      label="Original"
                      format={source ?? ''}
                      bytes={originalPreviewBytes}
                      loading={source !== 'pdf' && originalPreview.isPending}
                      error={source !== 'pdf' && originalPreview.error !== null ? originalPreview.error : undefined}
                    />
                  )}
                  <Spoiler maxHeight={0} showLabel="Show structure" hideLabel="Hide structure">
                    {isContentBackedPreview(source) ? (
                      <InspectPanel data={originalContentInspect} loading={originalPreview.isPending} error={originalPreview.error ?? undefined} />
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
                      content={resultPreview.data?.content}
                      loading={resultPreview.isPending}
                      error={resultPreview.error ?? undefined}
                    />
                  ) : isSheetFormat(target) ? (
                    <SheetPreview
                      label="Converted"
                      format={target ?? ''}
                      content={resultPreview.data?.content}
                      loading={resultPreview.isPending}
                      error={resultPreview.error ?? undefined}
                    />
                  ) : (
                    <PdfPreview
                      label="Converted"
                      format={target ?? ''}
                      bytes={convertedPreviewBytes}
                      loading={target !== 'pdf' && resultPreview.isPending}
                      error={target !== 'pdf' && resultPreview.error !== null ? resultPreview.error : undefined}
                    />
                  )}
                  <Spoiler maxHeight={0} showLabel="Show structure" hideLabel="Hide structure">
                    {isContentBackedPreview(target) ? (
                      <InspectPanel data={convertedContentInspect} loading={resultPreview.isPending} error={resultPreview.error ?? undefined} />
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
