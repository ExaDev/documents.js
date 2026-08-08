import { Alert, Button, Container, Group, Paper, Stack, Table, Text, Title } from '@mantine/core';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

import { createFileAccess } from '../adapters/fileAccess/createFileAccess';
import { usePdfInspect } from '../hooks/usePdfInspect';
import type { OpenedFile } from '../ports/fileAccess';

export const Route = createFileRoute('/pdf-inspect')({
  component: PdfInspectPage,
});

function PdfInspectPage() {
  const [file, setFile] = useState<OpenedFile | undefined>(undefined);
  const inspect = usePdfInspect();
  const fileAccess = createFileAccess();

  const handleOpen = () => {
    void fileAccess.openFile({ accept: { 'application/pdf': ['.pdf'] } }).then((opened) => {
      if (opened === undefined) return;
      setFile(opened);
      inspect.mutate({ bytes: opened.bytes });
    });
  };

  return (
    <Container size="sm" py="xl">
      <Stack gap="lg">
        <Title order={2}>PDF inspect</Title>
        <Paper withBorder p="md">
          <Group justify="space-between">
            <Text>{file?.name ?? 'No file selected'}</Text>
            <Button variant="light" onClick={handleOpen}>
              Choose PDF
            </Button>
          </Group>
        </Paper>

        {inspect.isError && <Alert color="red">{inspect.error.message}</Alert>}

        {inspect.data && (
          <Paper withBorder p="md">
            <Stack gap="sm">
              <Text>
                <strong>{inspect.data.pageCount}</strong> page{inspect.data.pageCount === 1 ? '' : 's'}
              </Text>
              <Table>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Item kind</Table.Th>
                    <Table.Th>Count</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {Object.entries(inspect.data.itemKindCounts).map(([kind, count]) => (
                    <Table.Tr key={kind}>
                      <Table.Td>{kind}</Table.Td>
                      <Table.Td>{count}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
              {inspect.data.metadata.title !== undefined && <Text>Title: {inspect.data.metadata.title}</Text>}
              {inspect.data.metadata.producer !== undefined && <Text>Producer: {inspect.data.metadata.producer}</Text>}
            </Stack>
          </Paper>
        )}
      </Stack>
    </Container>
  );
}
