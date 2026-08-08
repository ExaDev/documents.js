import { Alert, Button, Container, Group, Paper, Stack, Table, Text, Title } from '@mantine/core';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

import { createFileAccess } from '../adapters/fileAccess/createFileAccess';
import { useExtractSourceFonts } from '../hooks/useFonts';
import type { OpenedFile } from '../ports/fileAccess';
import { inferFormatFromFilename } from '../shared/extensionToFormat';

export const Route = createFileRoute('/fonts')({
  component: FontsPage,
});

function FontsPage() {
  const [file, setFile] = useState<OpenedFile | undefined>(undefined);
  const extractFonts = useExtractSourceFonts();
  const fileAccess = createFileAccess();

  const handleOpen = () => {
    void fileAccess.openFile({}).then((opened) => {
      if (opened === undefined) return;
      const format = inferFormatFromFilename(opened.name);
      setFile(opened);
      extractFonts.reset();
      if (format !== undefined) {
        extractFonts.mutate({ format, bytes: opened.bytes });
      }
    });
  };

  return (
    <Container size="sm" py="xl">
      <Stack gap="lg">
        <Title order={2}>Embedded fonts</Title>
        <Paper withBorder p="md">
          <Group justify="space-between">
            <Text>{file?.name ?? 'No file selected'}</Text>
            <Button variant="light" onClick={handleOpen}>
              Choose document
            </Button>
          </Group>
          {file !== undefined && inferFormatFromFilename(file.name) === undefined && (
            <Alert color="red" mt="sm">
              Could not recognise "{file.name}"'s format from its extension.
            </Alert>
          )}
        </Paper>

        {extractFonts.isError && <Alert color="red">{extractFonts.error.message}</Alert>}

        {extractFonts.data && (
          <Paper withBorder p="md">
            {extractFonts.data.length === 0 ? (
              <Text c="dimmed">No embedded fonts found.</Text>
            ) : (
              <Table>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Family</Table.Th>
                    <Table.Th>Bold</Table.Th>
                    <Table.Th>Italic</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {extractFonts.data.map((font, index) => (
                    <Table.Tr key={index}>
                      <Table.Td>{font.family}</Table.Td>
                      <Table.Td>{font.bold ? 'yes' : 'no'}</Table.Td>
                      <Table.Td>{font.italic ? 'yes' : 'no'}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )}
          </Paper>
        )}
      </Stack>
    </Container>
  );
}
