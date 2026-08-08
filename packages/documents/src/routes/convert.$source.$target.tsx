import { Alert, Button, Container, Group, List, Paper, Stack, Text, Title } from '@mantine/core';
import { createFileRoute } from '@tanstack/react-router';
import { type DocumentFormat, DocumentFormatSchema } from 'documents.js';
import { useState } from 'react';

import { createFileAccess } from '../adapters/fileAccess/createFileAccess';
import { useConvert } from '../hooks/useConvert';
import type { OpenedFile } from '../ports/fileAccess';

export const Route = createFileRoute('/convert/$source/$target')({
  component: ConvertPairPage,
});

function ConvertPairPage() {
  const { source: rawSource, target: rawTarget } = Route.useParams();
  const source = DocumentFormatSchema.safeParse(rawSource);
  const target = DocumentFormatSchema.safeParse(rawTarget);

  if (!source.success || !target.success) {
    return (
      <Container size="sm" py="xl">
        <Alert color="red" title="Unknown format">
          {`"${rawSource}" or "${rawTarget}" is not a supported document format.`}
        </Alert>
      </Container>
    );
  }

  return <ConvertPairTool source={source.data} target={target.data} />;
}

function ConvertPairTool({ source, target }: { source: DocumentFormat; target: DocumentFormat }) {
  const [file, setFile] = useState<OpenedFile | undefined>(undefined);
  const convert = useConvert();
  const fileAccess = createFileAccess();

  const handleOpen = () => {
    void fileAccess.openFile({}).then((opened) => {
      if (opened !== undefined) {
        setFile(opened);
        convert.reset();
      }
    });
  };

  const handleConvert = () => {
    if (file === undefined) return;
    convert.mutate({ source, targetFormat: target, bytes: file.bytes });
  };

  const handleDownload = () => {
    if (convert.data === undefined) return;
    void fileAccess.saveFile(convert.data.document.bytes, {
      suggestedName: `${file?.name.replace(/\.[^.]+$/, '') ?? 'document'}.${target}`,
      mimeType: 'application/octet-stream',
    });
  };

  return (
    <Container size="sm" py="xl">
      <Stack gap="lg">
        <Title order={2}>
          {source} &rarr; {target}
        </Title>

        <Paper withBorder p="md">
          <Stack gap="sm">
            <Group justify="space-between">
              <Text>{file?.name ?? 'No file selected'}</Text>
              <Button variant="light" onClick={handleOpen}>
                Choose file
              </Button>
            </Group>
            <Button onClick={handleConvert} disabled={file === undefined} loading={convert.isPending}>
              Convert
            </Button>
          </Stack>
        </Paper>

        {convert.isError && (
          <Alert color="red" title="Conversion failed">
            {convert.error.message}
          </Alert>
        )}

        {convert.data && (
          <Paper withBorder p="md">
            <Stack gap="sm">
              <Group justify="space-between">
                <Text fw={500}>Done</Text>
                <Button onClick={handleDownload}>Download</Button>
              </Group>
              {convert.data.diagnostics.length > 0 && (
                <List size="sm">
                  {convert.data.diagnostics.map((diagnostic, index) => (
                    <List.Item key={index}>
                      <Text c={diagnostic.severity === 'warning' ? 'orange' : 'dimmed'} span>
                        [{diagnostic.severity}]
                      </Text>{' '}
                      {diagnostic.message}
                    </List.Item>
                  ))}
                </List>
              )}
            </Stack>
          </Paper>
        )}
      </Stack>
    </Container>
  );
}
