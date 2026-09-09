import {
  Alert,
  Button,
  Container,
  Paper,
  Stack,
  Text,
  Textarea,
  Title,
} from "@mantine/core";
import { createFileRoute } from "@tanstack/react-router";
import type { DocumentFormat } from "documents.js";
import { useState } from "react";

import { createFileAccess } from "../adapters/fileAccess/createFileAccess";
import { useReadContent, useRestoreContent } from "../hooks/useContentDump";
import type { OpenedFile } from "../ports/fileAccess";
import { inferFormatFromFilename } from "../shared/extensionToFormat";
import { FileUpload } from "../ui/FileUpload";
import { notifyError, notifySuccess } from "../ui/notify";

export const Route = createFileRoute("/package")({
  component: PackagePage,
});

// The Package / JSON tool: a document's internal structure as editable JSON, dump to restore. The dump is the tree-form DocumentTree (stamped with its release-pinned $schema URI) exactly as the reader produced it -- the same artefact a conversion pipeline carries internally, not the preview-normalised form -- and restore round-trips that JSON back into real bytes for the document's own format through the identical validation every other tree consumer applies.
function PackagePage() {
  const [file, setFile] = useState<OpenedFile | undefined>(undefined);
  const [format, setFormat] = useState<DocumentFormat | undefined>(undefined);
  const [json, setJson] = useState("");
  const readContent = useReadContent();
  const restoreContent = useRestoreContent();
  const fileAccess = createFileAccess();

  const handleFile = (opened: OpenedFile) => {
    const inferred = inferFormatFromFilename(opened.name);
    setFile(opened);
    setFormat(inferred);
    setJson("");
    readContent.reset();
    restoreContent.reset();
    if (inferred !== undefined) {
      readContent.mutate(
        { format: inferred, bytes: opened.bytes },
        {
          onSuccess: (result) => {
            setJson(JSON.stringify(result.package, null, 2));
          },
          onError: (error) => {
            notifyError("Could not read document", error);
          },
        },
      );
    }
  };

  const handleRestore = () => {
    if (file === undefined || format === undefined) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (error) {
      notifyError("The JSON does not parse", error);
      return;
    }
    restoreContent.mutate(
      // The worker validates the parsed value against the tree schema and re-stamps the artefact's $schema URI -- UI code may not import documents.js's schemas directly, so the whole restore contract lives that side of the RPC boundary.
      { format, package: parsed },
      {
        onSuccess: (result) => {
          notifySuccess("Document restored");
          void fileAccess.saveFile(result.bytes, {
            suggestedName: file.name,
            mimeType: "application/octet-stream",
          });
        },
        onError: (error) => {
          notifyError("Could not restore document", error);
        },
      },
    );
  };

  return (
    <Container size="lg" py="xl">
      <Stack gap="lg">
        <Title order={2}>Package / JSON</Title>
        <FileUpload onFile={handleFile} />
        {file !== undefined && format === undefined && (
          <Alert color="yellow">
            The file extension does not identify a known document format.
          </Alert>
        )}
        {readContent.isPending && <Text>Loading document structure…</Text>}
        {json !== "" && (
          <Paper withBorder p="md">
            <Stack gap="md">
              <Text size="sm" c="dimmed">
                The document's tree-form structure. Edit the JSON and restore it
                back into a real {format} document.
              </Text>
              <Textarea
                value={json}
                onChange={(event) => {
                  setJson(event.currentTarget.value);
                }}
                autosize
                minRows={12}
                maxRows={32}
                styles={{
                  input: {
                    fontFamily: "var(--mantine-font-family-monospace)",
                    fontSize: "var(--mantine-font-size-xs)",
                    whiteSpace: "pre",
                    overflowX: "auto",
                  },
                }}
              />
              <Button
                onClick={handleRestore}
                loading={restoreContent.isPending}
              >
                Restore to {format}
              </Button>
            </Stack>
          </Paper>
        )}
      </Stack>
    </Container>
  );
}
