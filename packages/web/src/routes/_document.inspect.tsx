import { Alert, Container, Paper, Select, Stack, Title } from "@mantine/core";
import { createFileRoute } from "@tanstack/react-router";
import { DocumentFormatSchema } from "documents.js";
import type { DocumentFormat } from "documents.js";
import { useEffect, useState } from "react";

import { NoDocumentOpen } from "../document/NoDocumentOpen";
import { useOpenDocument } from "../document/OpenDocumentContext";
import { useDocumentFormats } from "../hooks/useConversions";
import { useInspectDocument } from "../hooks/useInspect";
import type { OpenedFile } from "../ports/fileAccess";
import { DiagnosticsPanel } from "../ui/DiagnosticsPanel";
import { InspectPanel } from "../ui/InspectPanel";
import { notifyError } from "../ui/notify";

export const Route = createFileRoute("/_document/inspect")({
  component: InspectPage,
});

function InspectPage() {
  const { document } = useOpenDocument();

  return (
    <Container size="sm" py="xl">
      <Stack gap="lg">
        <Title order={2}>Inspect</Title>

        {document === undefined ? (
          <NoDocumentOpen>
            Open a document above to inspect its structure.
          </NoDocumentOpen>
        ) : (
          // Keyed by the document's own open sequence: a fresh open remounts this panel from scratch, resetting any manual format override without calling its setter directly inside an effect (react-hooks/set-state-in-effect).
          <InspectionPanel
            key={document.id}
            file={document.file}
            detectedFormat={document.format}
          />
        )}
      </Stack>
    </Container>
  );
}

function InspectionPanel({
  file,
  detectedFormat,
}: {
  file: OpenedFile;
  detectedFormat: DocumentFormat | undefined;
}) {
  // The manual override once auto-detection can't name a format — mirrors Convert's own "From" Select, and is intentionally local to this panel rather than pushed back into the shared document: correcting the format here is about getting Inspect itself to run, not about redeclaring what the open document "really is" for every other tool.
  const [formatOverride, setFormatOverride] = useState<
    DocumentFormat | undefined
  >(undefined);
  const formats = useDocumentFormats();
  const inspect = useInspectDocument();

  const format = formatOverride ?? detectedFormat;

  // Runs once, for the one document this panel instance will ever see: a fresh open remounts a whole new instance (see the key above) rather than this effect re-running to reset anything. Skips inspecting outright when there is no detected format yet: handleFormatChange below is what runs inspection once the user picks one manually.
  const { mutate: inspectMutate } = inspect;
  useEffect(() => {
    if (detectedFormat === undefined) return;
    inspectMutate(
      { format: detectedFormat, bytes: file.bytes },
      {
        onError: (error) => {
          notifyError("Could not inspect document", error);
        },
      },
    );
  }, [detectedFormat, file, inspectMutate]);

  const handleFormatChange = (value: string | null) => {
    // Mantine's Select works in plain strings, so `value` needs re-narrowing to DocumentFormat here rather than a cast — it can only ever hold a value drawn from formats.data, which are themselves real DocumentFormat values, so this parse cannot practically fail. safeParse's own enum check already rejects a `null` clear the same way it would reject any other non-member string, so there is no separate `value === null` case to test for.
    const parsed = DocumentFormatSchema.safeParse(value);
    if (!parsed.success) return;
    setFormatOverride(parsed.data);
    inspect.mutate(
      { format: parsed.data, bytes: file.bytes },
      {
        onError: (error) => {
          notifyError("Could not inspect document", error);
        },
      },
    );
  };

  return (
    <>
      <Paper withBorder p="md">
        <Stack gap="sm">
          {format === undefined && (
            <Alert color="yellow">
              Could not detect "{file.name}"'s format from its extension, so
              pick it below.
            </Alert>
          )}
          <Select
            label="Format"
            placeholder="Document format"
            searchable
            data={[...(formats.data ?? [])].sort()}
            value={format ?? null}
            onChange={handleFormatChange}
          />
        </Stack>
      </Paper>

      {inspect.data && (
        <Paper withBorder p="md">
          <Stack gap="sm">
            <DiagnosticsPanel diagnostics={inspect.data.diagnostics} />
            <InspectPanel data={inspect.data} loading={inspect.isPending} />
          </Stack>
        </Paper>
      )}
    </>
  );
}
