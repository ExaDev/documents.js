import {
  Alert,
  Box,
  Button,
  Container,
  Group,
  Paper,
  Select,
  Spoiler,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import {
  createFileRoute,
  useNavigate,
  useParams,
} from "@tanstack/react-router";
import { DocumentFormatSchema } from "documents.js";
import type { DocumentFormat } from "documents.js";
import { useEffect, useMemo, useState } from "react";

import { createFileAccess } from "../adapters/fileAccess/createFileAccess";
import { NoDocumentOpen } from "../document/NoDocumentOpen";
import { useOpenDocument } from "../document/OpenDocumentContext";
import { useConversions, useDocumentFormats } from "../hooks/useConversions";
import { useConvert } from "../hooks/useConvert";
import {
  contentInspectResult,
  useInspectPdfBytes,
  useReadContent,
} from "../hooks/useInspect";
import type { OpenedFile } from "../ports/fileAccess";
import { donePanel } from "../ui/convertLayout.css";
import { DiagnosticsPanel } from "../ui/DiagnosticsPanel";
import { InspectPanel } from "../ui/InspectPanel";
import { MarkdownPreview } from "../ui/MarkdownPreview";
import { notifyError, notifySuccess } from "../ui/notify";
import { PdfPreview } from "../ui/PdfPreview";
import { flexColumn } from "../ui/previewPanel.css";
import { SheetPreview } from "../ui/SheetPreview";
import { SlidesPreview } from "../ui/SlidesPreview";
import { FormulaPreview } from "../ui/FormulaPreview";
import { WordProcessingPreview } from "../ui/WordProcessingPreview";

// Layout route: convert.index.tsx and convert.$source.$target.tsx become its children (per TanStack Router's file-based nesting convention) and exist only to register typed path params in the route tree — ConvertPanel below owns all the real state and UI directly, so it never remounts when the selected pair changes. That's what fixes "picking a new pair feels like leaving the page": convert.index.tsx and convert.$source.$target.tsx both render nothing, so switching pairs is a params change within one mounted ConvertPanel instance, not a route transition through two sibling routes.
export const Route = createFileRoute("/_document/convert")({
  component: ConvertLayout,
});

export type SheetFormat = "xlsx" | "ods" | "csv" | "xls";

// csv reads as a spreadsheet-kind ContentDocument (readCsvContent), so it previews through the same data grid as xlsx/ods. xls (BIFF8, readXlsContent) is the same spreadsheet kind too. A real type predicate (rather than a plain boolean) lets every call site narrow `source`/`target` straight to a valid SheetPreview `format` prop, with no separate `?? ""` fallback needed to satisfy its `string` type.
export function isSheetFormat(format: string | null): format is SheetFormat {
  return (
    format === "xlsx" ||
    format === "ods" ||
    format === "csv" ||
    format === "xls"
  );
}

export type WordProcessingFormat = "docx" | "odt" | "rtf" | "doc" | "epub";

// doc (readDocContent) and epub (readEpubContent) are the same wordprocessing-kind ContentDocument as docx/odt/rtf.
export function isWordProcessingFormat(
  format: string | null,
): format is WordProcessingFormat {
  return (
    format === "docx" ||
    format === "odt" ||
    format === "rtf" ||
    format === "doc" ||
    format === "epub"
  );
}

export type SlidesFormat = "pptx" | "odp" | "odg" | "svg" | "ppt";

// svg reads as a drawing-kind ContentDocument (readSvgContent), so it previews through the same pages/shapes/vectors renderer as odg. ppt (readPptContent) is the same presentation kind as pptx/odp.
export function isSlidesFormat(format: string | null): format is SlidesFormat {
  return (
    format === "pptx" ||
    format === "odp" ||
    format === "odg" ||
    format === "svg" ||
    format === "ppt"
  );
}

// True for every format whose preview renders the ContentDocument natively via content.read rather than a PDF rendition. PDF itself is the only exception — its "native" representation IS the PDF bytes rendered in an iframe.
export function isContentBackedPreview(format: string | null): boolean {
  return format !== "pdf" && format !== null;
}

function ConvertLayout() {
  const { document } = useOpenDocument();

  return (
    <Container fluid px="xl" py="xl">
      <Stack gap="lg">
        {document === undefined ? (
          <Box maw={600}>
            <Stack gap="lg">
              <Title order={2}>Convert a document</Title>
              <NoDocumentOpen>
                Open a document above to convert it.
              </NoDocumentOpen>
            </Stack>
          </Box>
        ) : (
          // Keyed by the document's own open sequence: a fresh open remounts this panel from scratch, resetting source/target/the previous conversion without the effect-ordering hazard a manual "did the document change" comparison would carry — a setState call from one effect during a commit is not visible to a sibling effect in that same commit, which previously let the pdf-bytes-inspection effect below fire once against a still-stale `source` before the reset had actually taken hold.
          <ConvertPanel
            key={document.id}
            file={document.file}
            detectedFormat={document.format}
          />
        )}
      </Stack>
    </Container>
  );
}

function ConvertPanel({
  file,
  detectedFormat,
}: {
  file: OpenedFile;
  detectedFormat: DocumentFormat | undefined;
}) {
  const params = useParams({ strict: false });
  const navigate = useNavigate();
  const conversions = useConversions();
  const formats = useDocumentFormats();

  // Lazy initializers: seeded once, from whatever the route's params (or this document's own detected format) are at the moment this panel first mounts — route params win, matching the priority a direct deep link into a specific pair should have over the file's own auto-detected format.
  const [source, setSource] = useState<string | null>(
    () => params.source ?? detectedFormat ?? null,
  );
  const [target, setTarget] = useState<string | null>(
    () => params.target ?? null,
  );
  const convert = useConvert();
  // Content-backed previews read their ContentDocument directly via the content.read RPC — no conversion, no target build/encode, no PDF layout pass. PDF (the only non-content-backed format) uses the uploaded file's own bytes in PdfPreview directly.
  const originalContent = useReadContent();
  const resultContent = useReadContent();
  const fileAccess = createFileAccess();

  // Only reflect a *complete* pair in the URL — a half-picked pair isn't a meaningful thing to bookmark. `replace`, not `push`: changing formats mid-exploration is editing current tool state, not creating a new navigable history entry.
  useEffect(() => {
    if (source !== null && target !== null) {
      void navigate({
        to: "/convert/$source/$target",
        params: { source, target },
        replace: true,
      });
    }
  }, [source, target, navigate]);

  // Prefetches the original's content as soon as this document's (auto-detected or manual) source is known, rather than waiting for the user to click Convert — so the "Original" preview panel is already populated the moment the "Done" panel appears. `mutate`'s identity is stable across renders (TanStack Query), so depending on it here doesn't retrigger this effect on every render. Skipped for PDF — its bytes are already what PdfPreview needs.
  const { mutate: mutateOriginalContent } = originalContent;
  useEffect(() => {
    if (source === "pdf") return;
    // A null (nothing picked yet) or otherwise-invalid source fails this parse exactly the same way an explicit `source === null` check would have short-circuited above — a separate null check would only re-reject a case safeParse already rejects, never a distinct one.
    const parsedSource = DocumentFormatSchema.safeParse(source);
    if (!parsedSource.success) return;
    mutateOriginalContent({ format: parsedSource.data, bytes: file.bytes });
  }, [file, source, mutateOriginalContent]);

  const sourceOptions = [
    ...new Set((conversions.data ?? []).map((pair) => pair.source)),
  ].sort();

  // Every known format is always listed — ones the current source can't reach are disabled in place rather than filtered out, so picking "To" first still shows the full picture of what's possible, not a silently shrinking list.
  const validTargets = new Set(
    (conversions.data ?? [])
      .filter((pair) => pair.source === source)
      .map((pair) => pair.target),
  );
  const targetData = [...(formats.data ?? [])].sort().map((format) => ({
    value: format,
    label: format,
    disabled: !validTargets.has(format),
  }));

  const handleSourceChange = (value: string | null) => {
    setSource(value);
    setTarget(null);
    convert.reset();
  };

  const handleTargetChange = (value: string | null) => {
    setTarget(value);
    convert.reset();
  };

  // Called only from the Convert button below, which itself only exists (in its enabled, wired-up form) once source/target are both known defined — the caller has already done that narrowing, so this takes the resolved values directly rather than re-deriving and re-checking them from component state.
  const handleConvert = (sourceValue: string, targetValue: string) => {
    // Mantine's Select works in plain strings, so `sourceValue`/`targetValue` need re-narrowing to DocumentFormat here rather than a cast — they can only ever hold a value drawn from sourceOptions/targetOptions, which are themselves real DocumentFormat values, so this parse cannot practically fail; it is still a genuine boundary validation, not dead code, since nothing about the Select's own string-based API enforces it at the type level.
    const parsedSource = DocumentFormatSchema.safeParse(sourceValue);
    const parsedTarget = DocumentFormatSchema.safeParse(targetValue);
    if (!parsedSource.success || !parsedTarget.success) return;
    convert.mutate(
      {
        source: parsedSource.data,
        targetFormat: parsedTarget.data,
        bytes: file.bytes,
      },
      {
        onSuccess: (result) => {
          notifySuccess("Converted", { diagnostics: result.diagnostics });
          if (parsedTarget.data !== "pdf") {
            resultContent.mutate({
              format: parsedTarget.data,
              bytes: result.document.bytes,
            });
          }
        },
        onError: (error) => {
          notifyError("Conversion failed", error);
        },
      },
    );
  };

  // Structure inspection for content-backed formats derives directly from the ContentDocument already on hand (from content.read) — pure client-side, no second RPC. For PDF, a separate pdf.inspect call parses the bytes directly.
  const originalInspectData = useMemo(
    () =>
      isContentBackedPreview(source) && originalContent.data !== undefined
        ? contentInspectResult(originalContent.data)
        : undefined,
    [source, originalContent.data],
  );
  const originalInspect = useInspectPdfBytes();
  const { mutate: mutateOriginalInspect } = originalInspect;
  useEffect(() => {
    if (isContentBackedPreview(source)) return;
    mutateOriginalInspect(file.bytes);
  }, [source, file, mutateOriginalInspect]);

  const convertedInspectData = useMemo(
    () =>
      isContentBackedPreview(target) && resultContent.data !== undefined
        ? contentInspectResult(resultContent.data)
        : undefined,
    [target, resultContent.data],
  );
  const convertedInspect = useInspectPdfBytes();
  const { mutate: mutateConvertedInspect } = convertedInspect;
  useEffect(() => {
    if (isContentBackedPreview(target) || convert.data === undefined) return;
    mutateConvertedInspect(convert.data.document.bytes);
  }, [target, convert.data, mutateConvertedInspect]);

  // Only ever called once a conversion has succeeded, which requires a target that was already valid at that point and is never cleared back to null afterwards without also clearing doneData.
  const handleDownload = (
    bytes: Uint8Array<ArrayBuffer>,
    targetFormat: string,
  ) => {
    void fileAccess.saveFile(bytes, {
      suggestedName: `${file.name.replace(/\.[^.]+$/, "")}.${targetFormat}`,
      mimeType: "application/octet-stream",
    });
  };

  // Narrowed once here, as a plain const, so every reference below — including inside the JSX event handler closures further down — narrows to defined without each one re-deriving it from the live, always-optional convert.data.
  const doneData = convert.data;

  return (
    <>
      <Box maw={600}>
        <Stack gap="lg">
          <Title order={2}>Convert a document</Title>

          <Paper withBorder p="md">
            <Stack gap="sm">
              {detectedFormat === undefined && (
                <Alert color="yellow">
                  Could not detect "{file.name}"'s format from its extension —
                  pick "From" manually below.
                </Alert>
              )}

              <Group grow>
                <Select
                  label="From"
                  placeholder="Source format"
                  searchable
                  data={sourceOptions}
                  value={source}
                  onChange={handleSourceChange}
                  description={
                    detectedFormat === source ? "Detected from file" : undefined
                  }
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

              {source !== null && target !== null ? (
                <Button
                  onClick={() => {
                    handleConvert(source, target);
                  }}
                  loading={convert.isPending}
                >
                  Convert
                </Button>
              ) : (
                <Button disabled loading={convert.isPending}>
                  Convert
                </Button>
              )}
            </Stack>
          </Paper>
        </Stack>
      </Box>

      {doneData !== undefined && (
        // maxWidth scales with viewport via clamp() rather than jumping to one fixed breakpoint: never narrower than the controls column above (900px), grows at 85% of viewport width, never wider than 2200px so preview text doesn't sprawl on an ultrawide monitor. Below 900px (and always inside the fluid Container's own padding) it simply falls back to 100% of the available width.
        <Paper withBorder p="md" className={donePanel}>
          <Stack gap="md">
            <Group justify="space-between">
              <Text fw={500}>Done</Text>
              <Button
                onClick={() => {
                  // target is narrowed here, not by an added `!== null` render condition: this panel's own existence already proves it was defined at the moment the conversion that produced doneData was kicked off, and it is never cleared back to null afterwards without also clearing doneData.
                  handleDownload(doneData.document.bytes, target!);
                }}
              >
                Download
              </Button>
            </Group>
            <DiagnosticsPanel diagnostics={doneData.diagnostics} />
            <Group align="flex-start" grow wrap="nowrap">
              <Stack gap={4} className={flexColumn}>
                {source === "markdown" ? (
                  <MarkdownPreview
                    label="Original"
                    format={source}
                    content={originalContent.data?.content}
                    loading={originalContent.isPending}
                    // React Query represents "no error" as null, not undefined — normalised here since MarkdownPreview/SheetPreview/PdfPreview's own contract only knows "no error" as undefined.
                    error={originalContent.error ?? undefined}
                  />
                ) : isSheetFormat(source) ? (
                  <SheetPreview
                    label="Original"
                    format={source}
                    content={originalContent.data?.content}
                    loading={originalContent.isPending}
                    error={originalContent.error ?? undefined}
                  />
                ) : isWordProcessingFormat(source) ? (
                  <WordProcessingPreview
                    label="Original"
                    format={source}
                    content={originalContent.data?.content}
                    loading={originalContent.isPending}
                    error={originalContent.error ?? undefined}
                  />
                ) : isSlidesFormat(source) ? (
                  <SlidesPreview
                    label="Original"
                    format={source}
                    content={originalContent.data?.content}
                    loading={originalContent.isPending}
                    error={originalContent.error ?? undefined}
                  />
                ) : source === "odf" ? (
                  <FormulaPreview
                    label="Original"
                    format={source}
                    content={originalContent.data?.content}
                    loading={originalContent.isPending}
                    error={originalContent.error ?? undefined}
                  />
                ) : (
                  // Every other branch above is a specific format check on `source`, so reaching here with `source` genuinely null (rather than "pdf") would mean this whole doneData-gated panel rendered without a completed conversion, which handleConvert/convert.reset() never allow.
                  <PdfPreview
                    label="Original"
                    format={source!}
                    bytes={file.bytes}
                  />
                )}
                <Spoiler
                  maxHeight={0}
                  showLabel="Show structure"
                  hideLabel="Hide structure"
                >
                  {isContentBackedPreview(source) ? (
                    <InspectPanel
                      data={originalInspectData}
                      loading={originalContent.isPending}
                      error={originalContent.error ?? undefined}
                    />
                  ) : (
                    <InspectPanel
                      data={originalInspect.data}
                      loading={originalInspect.isPending}
                      error={originalInspect.error ?? undefined}
                    />
                  )}
                </Spoiler>
              </Stack>
              <Stack gap={4} className={flexColumn}>
                {target === "markdown" ? (
                  <MarkdownPreview
                    label="Converted"
                    format={target}
                    content={resultContent.data?.content}
                    loading={resultContent.isPending}
                    error={resultContent.error ?? undefined}
                  />
                ) : isSheetFormat(target) ? (
                  <SheetPreview
                    label="Converted"
                    format={target}
                    content={resultContent.data?.content}
                    loading={resultContent.isPending}
                    error={resultContent.error ?? undefined}
                  />
                ) : isWordProcessingFormat(target) ? (
                  <WordProcessingPreview
                    label="Converted"
                    format={target}
                    content={resultContent.data?.content}
                    loading={resultContent.isPending}
                    error={resultContent.error ?? undefined}
                  />
                ) : isSlidesFormat(target) ? (
                  <SlidesPreview
                    label="Converted"
                    format={target}
                    content={resultContent.data?.content}
                    loading={resultContent.isPending}
                    error={resultContent.error ?? undefined}
                  />
                ) : target === "odf" ? (
                  <FormulaPreview
                    label="Converted"
                    format={target}
                    content={resultContent.data?.content}
                    loading={resultContent.isPending}
                    error={resultContent.error ?? undefined}
                  />
                ) : (
                  // Same invariant as the Original side's own PdfPreview else-branch above: reaching here with `target` genuinely null would mean this panel rendered without a completed conversion.
                  <PdfPreview
                    label="Converted"
                    format={target!}
                    bytes={doneData.document.bytes}
                  />
                )}
                <Spoiler
                  maxHeight={0}
                  showLabel="Show structure"
                  hideLabel="Hide structure"
                >
                  {isContentBackedPreview(target) ? (
                    <InspectPanel
                      data={convertedInspectData}
                      loading={resultContent.isPending}
                      error={resultContent.error ?? undefined}
                    />
                  ) : (
                    <InspectPanel
                      data={convertedInspect.data}
                      loading={convertedInspect.isPending}
                      error={convertedInspect.error ?? undefined}
                    />
                  )}
                </Spoiler>
              </Stack>
            </Group>
          </Stack>
        </Paper>
      )}
    </>
  );
}
