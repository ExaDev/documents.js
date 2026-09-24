import {
  Button,
  Container,
  Paper,
  Stack,
  Table,
  TextInput,
  Title,
} from "@mantine/core";
import { createFileRoute } from "@tanstack/react-router";
import type { DocumentFormat } from "documents.js";
import { useEffect, useState } from "react";

import { createFileAccess } from "../adapters/fileAccess/createFileAccess";
import { NoDocumentOpen } from "../document/NoDocumentOpen";
import { useOpenDocument } from "../document/OpenDocumentContext";
import { UnrecognisedFormatAlert } from "../document/UnrecognisedFormatAlert";
import { useReadMetadata, useWriteMetadata } from "../hooks/useMetadata";
import type { OpenedFile } from "../ports/fileAccess";
import { notifyError, notifySuccess } from "../ui/notify";

export const Route = createFileRoute("/_document/metadata")({
  component: MetadataPage,
});

function MetadataPage() {
  const { document } = useOpenDocument();

  return (
    <Container size="sm" py="xl">
      <Stack gap="lg">
        <Title order={2}>Document metadata</Title>

        {document === undefined ? (
          <NoDocumentOpen>
            Open a document above to see its metadata.
          </NoDocumentOpen>
        ) : document.format === undefined ? (
          <UnrecognisedFormatAlert fileName={document.file.name} />
        ) : (
          // Keyed by the document's own open sequence: a fresh open (even re-picking the identical file) remounts this panel from scratch, which is what resets title/author overrides. Calling their setters directly inside an effect is exactly the pattern this project's eslint config (react-hooks/set-state-in-effect) steers away from.
          <MetadataPanel
            key={document.id}
            file={document.file}
            format={document.format}
          />
        )}
      </Stack>
    </Container>
  );
}

function MetadataPanel({
  file,
  format,
}: {
  file: OpenedFile;
  format: DocumentFormat;
}) {
  // An override that wins once the user edits the field, otherwise the read's own value — this avoids echoing the read result into a second piece of state (which would need a placeholder initial value with no real meaning, since it is always overwritten the moment a read succeeds).
  const [titleOverride, setTitleOverride] = useState<string | undefined>(
    undefined,
  );
  const [authorOverride, setAuthorOverride] = useState<string | undefined>(
    undefined,
  );
  const readMetadata = useReadMetadata();
  const writeMetadata = useWriteMetadata();
  const fileAccess = createFileAccess();

  const title = titleOverride ?? readMetadata.data?.title ?? "";
  const author = authorOverride ?? readMetadata.data?.author ?? "";

  // Runs once, for the one document this panel instance will ever see: a fresh open remounts a whole new instance (see the key above) rather than this effect re-running to reset anything.
  const { mutate: readMetadataMutate } = readMetadata;
  useEffect(() => {
    readMetadataMutate(
      { format, bytes: file.bytes },
      {
        onError: (error) => {
          notifyError("Could not read metadata", error);
        },
      },
    );
  }, [format, file, readMetadataMutate]);

  const handleSave = () => {
    writeMetadata.mutate(
      {
        sourceFormat: format,
        targetFormat: format,
        bytes: file.bytes,
        overrides: { title, author },
      },
      {
        onSuccess: (bytes) => {
          notifySuccess("Metadata saved");
          void fileAccess.saveFile(bytes, {
            suggestedName: file.name,
            mimeType: "application/octet-stream",
          });
        },
        onError: (error) => {
          notifyError("Could not save metadata", error);
        },
      },
    );
  };

  return (
    readMetadata.data && (
      <Paper withBorder p="md">
        <Stack gap="sm">
          <TextInput
            label="Title"
            value={title}
            onChange={(event) => {
              setTitleOverride(event.currentTarget.value);
            }}
          />
          <TextInput
            label="Author"
            value={author}
            onChange={(event) => {
              setAuthorOverride(event.currentTarget.value);
            }}
          />
          <Table>
            <Table.Tbody>
              {readMetadata.data.creator !== undefined && (
                <Table.Tr>
                  <Table.Td>Creator</Table.Td>
                  <Table.Td>{readMetadata.data.creator}</Table.Td>
                </Table.Tr>
              )}
              {readMetadata.data.createdIso !== undefined && (
                <Table.Tr>
                  <Table.Td>Created</Table.Td>
                  <Table.Td>{readMetadata.data.createdIso}</Table.Td>
                </Table.Tr>
              )}
              {readMetadata.data.modifiedIso !== undefined && (
                <Table.Tr>
                  <Table.Td>Modified</Table.Td>
                  <Table.Td>{readMetadata.data.modifiedIso}</Table.Td>
                </Table.Tr>
              )}
              {readMetadata.data.producer !== undefined && (
                <Table.Tr>
                  <Table.Td>Producer</Table.Td>
                  <Table.Td>{readMetadata.data.producer}</Table.Td>
                </Table.Tr>
              )}
            </Table.Tbody>
          </Table>
          <Button
            onClick={handleSave}
            loading={writeMetadata.isPending}
            w="fit-content"
          >
            Save and download
          </Button>
        </Stack>
      </Paper>
    )
  );
}
