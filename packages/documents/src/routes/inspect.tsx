import { Alert, Container, Paper, Select, Stack, Title } from "@mantine/core";
import { createFileRoute } from "@tanstack/react-router";
import { DocumentFormatSchema } from "documents.js";
import type { DocumentFormat } from "documents.js";
import { useState } from "react";

import { useDocumentFormats } from "../hooks/useConversions";
import { useInspectDocument } from "../hooks/useInspect";
import type { OpenedFile } from "../ports/fileAccess";
import { inferFormatFromFilename } from "../shared/extensionToFormat";
import { DiagnosticsPanel } from "../ui/DiagnosticsPanel";
import { FileUpload } from "../ui/FileUpload";
import { InspectPanel } from "../ui/InspectPanel";
import { notifyError } from "../ui/notify";

export const Route = createFileRoute("/inspect")({
  component: InspectPage,
});

function InspectPage() {
  const [file, setFile] = useState<OpenedFile | undefined>(undefined);
  const [format, setFormat] = useState<DocumentFormat | undefined>(undefined);
  const formats = useDocumentFormats();
  const inspect = useInspectDocument();

  const runInspect = (opened: OpenedFile, chosenFormat: DocumentFormat) => {
    inspect.mutate(
      { format: chosenFormat, bytes: opened.bytes },
      {
        onError: (error) => {
          notifyError("Could not inspect document", error);
        },
      },
    );
  };

  const handleFile = (opened: OpenedFile) => {
    setFile(opened);
    inspect.reset();
    // Auto-detected format starts inspection immediately, same as pdf-inspect's old PDF-only behaviour -- an undetected extension falls through to the Select below instead of dead-ending, mirroring Convert's own "From" format picker.
    const detected = inferFormatFromFilename(opened.name);
    setFormat(detected);
    if (detected !== undefined) runInspect(opened, detected);
  };

  const handleFormatChange = (value: string | null) => {
    if (value === null || file === undefined) return;
    // Mantine's Select works in plain strings, so `value` needs re-narrowing to DocumentFormat here rather than a cast -- it can only ever hold a value drawn from formats.data, which are themselves real DocumentFormat values, so this parse cannot practically fail.
    const parsed = DocumentFormatSchema.safeParse(value);
    if (!parsed.success) return;
    setFormat(parsed.data);
    runInspect(file, parsed.data);
  };

  return (
    <Container size="sm" py="xl">
      <Stack gap="lg">
        <Title order={2}>Inspect</Title>
        <Paper withBorder p="md">
          <Stack gap="sm">
            <FileUpload
              formatHint={formats.data?.join(", ")}
              file={file}
              onFile={handleFile}
              loading={inspect.isPending}
            />
            {file !== undefined && format === undefined && (
              <Alert color="yellow">
                Could not detect "{file.name}"'s format from its extension --
                pick it below.
              </Alert>
            )}
            {file !== undefined && (
              <Select
                label="Format"
                placeholder="Document format"
                searchable
                data={[...(formats.data ?? [])].sort()}
                value={format ?? null}
                onChange={handleFormatChange}
              />
            )}
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
      </Stack>
    </Container>
  );
}
