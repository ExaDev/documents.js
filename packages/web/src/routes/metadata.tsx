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
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const readMetadata = useReadMetadata();
  const writeMetadata = useWriteMetadata();
  const fileAccess = createFileAccess();

  const handleFile = (opened: OpenedFile) => {
    const inferred = inferFormatFromFilename(opened.name);
    setFile(opened);
    setFormat(inferred);
    readMetadata.reset();
    writeMetadata.reset();
    if (inferred !== undefined) {
      readMetadata.mutate(
        { format: inferred, bytes: opened.bytes },
        {
          onSuccess: (metadata) => {
            setTitle(metadata.title ?? "");
            setAuthor(metadata.author ?? "");
          },
          onError: (error) => {
            notifyError("Could not read metadata", error);
          },
        },
      );
    }
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
                  setTitle(event.currentTarget.value);
                }}
              />
              <TextInput
                label="Author"
                value={author}
                onChange={(event) => {
                  setAuthor(event.currentTarget.value);
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
