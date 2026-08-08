import { Alert, Button, Container, Group, List, Paper, Select, Stack, Text, Title } from '@mantine/core';
import { createFileRoute, useNavigate, useParams } from '@tanstack/react-router';
import { DocumentFormatSchema } from 'documents.js';
import { useEffect, useState } from 'react';

import { createFileAccess } from '../adapters/fileAccess/createFileAccess';
import { useConversions } from '../hooks/useConversions';
import { useConvert } from '../hooks/useConvert';
import type { OpenedFile } from '../ports/fileAccess';
import { FileUpload } from '../ui/FileUpload';

// Layout route: convert.index.tsx and convert.$source.$target.tsx become its children (per TanStack Router's file-based nesting convention) and exist only to register typed path params in the route tree -- this component owns all the real state and UI directly, so it never remounts when the selected pair changes. That's the actual fix for "picking a new pair feels like leaving the page": the old sibling-routes structure fully remounted (destroying `file`/`convert` state) on every pair change, since convert.index.tsx and convert.$source.$target.tsx both parented directly to root.
export const Route = createFileRoute('/convert')({
  component: ConvertLayout,
});

function ConvertLayout() {
  const params = useParams({ strict: false });
  const navigate = useNavigate();
  const conversions = useConversions();

  // Lazy initializers, not an effect: this only needs to seed state once, from whatever the route's params are at the moment ConvertLayout first mounts (e.g. a deep link to /convert/docx/pdf) -- `params` merges the currently matched leaf route's params up into this parent route via `strict: false`. Syncing via an effect instead would set state synchronously during render's commit phase for no benefit here (the initial value never needs to react to a *later* params change; the navigate() effect below is what keeps params in sync with state, not the other way around after mount).
  const [source, setSource] = useState<string | null>(() => params.source ?? null);
  const [target, setTarget] = useState<string | null>(() => params.target ?? null);
  const [file, setFile] = useState<OpenedFile | undefined>(undefined);
  const convert = useConvert();
  const fileAccess = createFileAccess();

  // Only reflect a *complete* pair in the URL -- a half-picked pair isn't a meaningful thing to bookmark. `replace`, not `push`: changing formats mid-exploration is editing current tool state, not creating a new navigable history entry.
  useEffect(() => {
    if (source !== null && target !== null) {
      void navigate({ to: '/convert/$source/$target', params: { source, target }, replace: true });
    }
  }, [source, target, navigate]);

  const sourceOptions = [...new Set((conversions.data ?? []).map((pair) => pair.source))].sort();
  const targetOptions = [...new Set((conversions.data ?? []).filter((pair) => pair.source === source).map((pair) => pair.target))].sort();

  const handleSourceChange = (value: string | null) => {
    setSource(value);
    setTarget(null);
    convert.reset();
  };

  const handleTargetChange = (value: string | null) => {
    setTarget(value);
    convert.reset();
  };

  const handleFile = (opened: OpenedFile) => {
    setFile(opened);
    convert.reset();
  };

  const handleConvert = () => {
    if (file === undefined || source === null || target === null) return;
    // Mantine's Select works in plain strings, so `source`/`target` need re-narrowing to DocumentFormat here rather than a cast -- they can only ever hold a value drawn from sourceOptions/targetOptions, which are themselves real DocumentFormat values, so this parse cannot practically fail.
    const parsedSource = DocumentFormatSchema.safeParse(source);
    const parsedTarget = DocumentFormatSchema.safeParse(target);
    if (!parsedSource.success || !parsedTarget.success) return;
    convert.mutate({ source: parsedSource.data, targetFormat: parsedTarget.data, bytes: file.bytes });
  };

  const handleDownload = () => {
    if (convert.data === undefined) return;
    void fileAccess.saveFile(convert.data.document.bytes, {
      suggestedName: `${file?.name.replace(/\.[^.]+$/, '') ?? 'document'}.${target ?? 'bin'}`,
      mimeType: 'application/octet-stream',
    });
  };

  return (
    <Container size="sm" py="xl">
      <Stack gap="lg">
        <Title order={2}>Convert a document</Title>

        <Group grow>
          <Select
            label="From"
            placeholder="Source format"
            searchable
            data={sourceOptions}
            value={source}
            onChange={handleSourceChange}
          />
          <Select
            label="To"
            placeholder="Target format"
            searchable
            data={targetOptions}
            value={target}
            onChange={handleTargetChange}
            disabled={source === null}
          />
        </Group>

        <Paper withBorder p="md">
          <Stack gap="sm">
            <FileUpload file={file} onFile={handleFile} />
            <Button onClick={handleConvert} disabled={file === undefined || source === null || target === null} loading={convert.isPending}>
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
