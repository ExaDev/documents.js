import {
  Alert,
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
import { useState } from "react";

import { createFileAccess } from "../adapters/fileAccess/createFileAccess";
import { useReadMetadata, useWriteMetadata } from "../hooks/useMetadata";
import type { OpenedFile } from "../ports/fileAccess";
import { inferFormatFromFilename } from "../shared/extensionToFormat";
import { FileUpload } from "../ui/FileUpload";
import { notifyError, notifySuccess } from "../ui/notify";

export const Route = createFileRoute("/metadata")({
  component: MetadataPage,
});

function MetadataPage() {
  const [file, setFile] = useState<OpenedFile | undefined>(undefined);
  const [format, setFormat] = useState<DocumentFormat | undefined>(undefined);
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

  const handleFile = (opened: OpenedFile) => {
    const inferred = inferFormatFromFilename(opened.name);
    setFile(opened);
    setFormat(inferred);
    setTitleOverride(undefined);
    setAuthorOverride(undefined);
    if (inferred === undefined) {
      // No mutate() follows for this pick, so nothing else clears a previous file's read result on its own — without this, the old data table and title/author fields would stay visible underneath the "could not recognise" alert.
      readMetadata.reset();
      return;
    }
    // A write still in flight for the previous file belongs to that file, not this one — left unreset, its own pending state would still show the new file's Save button as loading the moment this read resolves and the panel reappears.
    writeMetadata.reset();
    readMetadata.mutate(
      { format: inferred, bytes: opened.bytes },
      {
        onError: (error) => {
          notifyError("Could not read metadata", error);
        },
      },
    );
  };

  const handleSave = () => {
    if (file === undefined || format === undefined) return;
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
    <Container size="sm" py="xl">
      <Stack gap="lg">
        <Title order={2}>Document metadata</Title>
        <Paper withBorder p="md">
          <Stack gap="sm">
            <FileUpload
              file={file}
              onFile={handleFile}
              loading={readMetadata.isPending}
            />
            {file !== undefined && format === undefined && (
              <Alert color="red">
                Could not recognise "{file.name}"'s format from its extension.
              </Alert>
            )}
          </Stack>
        </Paper>

        {readMetadata.data && (
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
        )}
      </Stack>
    </Container>
  );
}
