import { Alert, Container, Paper, Stack, Table, Text, Title } from '@mantine/core';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

import { usePdfInspect } from '../hooks/usePdfInspect';
import type { OpenedFile } from '../ports/fileAccess';
import { FileUpload } from '../ui/FileUpload';

export const Route = createFileRoute('/pdf-inspect')({
  component: PdfInspectPage,
});

function PdfInspectPage() {
  const [file, setFile] = useState<OpenedFile | undefined>(undefined);
  const inspect = usePdfInspect();

  const handleFile = (opened: OpenedFile) => {
    setFile(opened);
    inspect.mutate({ bytes: opened.bytes });
  };

  return (
    <Container size="sm" py="xl">
      <Stack gap="lg">
        <Title order={2}>PDF inspect</Title>
        <Paper withBorder p="md">
          <FileUpload accept={{ 'application/pdf': ['.pdf'] }} formatHint="PDF" file={file} onFile={handleFile} loading={inspect.isPending} />
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
