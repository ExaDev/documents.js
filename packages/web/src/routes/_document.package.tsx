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
import { useEffect, useState } from "react";

import { createFileAccess } from "../adapters/fileAccess/createFileAccess";
import { NoDocumentOpen } from "../document/NoDocumentOpen";
import { useOpenDocument } from "../document/OpenDocumentContext";
import { useReadContent, useRestoreContent } from "../hooks/useContentDump";
import type { OpenedFile } from "../ports/fileAccess";
import { notifyError, notifySuccess } from "../ui/notify";

export const Route = createFileRoute("/_document/package")({
  component: PackagePage,
});

// The Package / JSON tool: a document's internal structure as editable JSON, dump to restore. The dump is the tree-form DocumentTree (stamped with its release-pinned $schema URI) exactly as the reader produced it — the same artefact a conversion pipeline carries internally, not the preview-normalised form — and restore round-trips that JSON back into real bytes for the document's own format through the identical validation every other tree consumer applies.
function PackagePage() {
  const { document } = useOpenDocument();

  return (
    <Container size="lg" py="xl">
      <Stack gap="lg">
        <Title order={2}>Package / JSON</Title>
        {document === undefined ? (
          <NoDocumentOpen>
            Open a document above to see its structure as JSON.
          </NoDocumentOpen>
        ) : document.format === undefined ? (
          <Alert color="yellow">
            The file extension does not identify a known document format.
          </Alert>
        ) : (
          // Keyed by the document's own open sequence: a fresh open remounts this panel from scratch, resetting the edited JSON without calling its setter directly inside an effect (react-hooks/set-state-in-effect).
          <PackagePanel
            key={document.id}
            file={document.file}
            format={document.format}
          />
        )}
      </Stack>
    </Container>
  );
}

function PackagePanel({
  file,
  format,
}: {
  file: OpenedFile;
  format: DocumentFormat;
}) {
  const [json, setJson] = useState("");
  const readContent = useReadContent();
  const restoreContent = useRestoreContent();
  const fileAccess = createFileAccess();

  // Runs once, for the one document this panel instance will ever see -- a fresh open remounts a whole new instance (see the key above) rather than this effect re-running to reset anything.
  const { mutate: readContentMutate } = readContent;
  useEffect(() => {
    readContentMutate(
      { format, bytes: file.bytes },
      {
        onSuccess: (result) => {
          setJson(JSON.stringify(result.package, null, 2));
        },
        onError: (error) => {
          notifyError("Could not read document", error);
        },
      },
    );
  }, [format, file, readContentMutate]);

  const handleRestore = () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (error) {
      notifyError("The JSON does not parse", error);
      return;
    }
    restoreContent.mutate(
      // The worker validates the parsed value against the tree schema and re-stamps the artefact's $schema URI — UI code may not import documents.js's schemas directly, so the whole restore contract lives that side of the RPC boundary.
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
    <>
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
            <Button onClick={handleRestore} loading={restoreContent.isPending}>
              Restore to {format}
            </Button>
          </Stack>
        </Paper>
      )}
    </>
  );
}
