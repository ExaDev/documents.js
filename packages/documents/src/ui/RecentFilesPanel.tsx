import { ActionIcon, Badge, Group, Stack, Text, Tooltip } from '@mantine/core';
import { useNavigate } from '@tanstack/react-router';
import { IconFile, IconReload, IconTrash } from '@tabler/icons-react';
import { DocumentFormatSchema } from 'documents.js';

import type { RecentFileRecord } from '../db/dexie';
import { removeRecentFile, useRecentFiles } from '../hooks/useRecentFiles';
import { notifyError } from './notify';
import { setPendingReopen } from './reopenMailbox';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

function relativeTime(timestamp: number): string {
  const elapsedMs = Date.now() - timestamp;
  if (elapsedMs < MINUTE_MS) return 'just now';
  if (elapsedMs < HOUR_MS) return `${Math.floor(elapsedMs / MINUTE_MS)}m ago`;
  if (elapsedMs < DAY_MS) return `${Math.floor(elapsedMs / HOUR_MS)}h ago`;
  return `${Math.floor(elapsedMs / DAY_MS)}d ago`;
}

export function RecentFilesPanel() {
  const files = useRecentFiles();
  const navigate = useNavigate();

  const handleReopen = async (record: RecentFileRecord) => {
    if (record.handle === undefined) return;
    const parsedFormat = DocumentFormatSchema.safeParse(record.format);
    if (!parsedFormat.success) return;
    try {
      let permission = await record.handle.queryPermission({ mode: 'read' });
      if (permission !== 'granted') permission = await record.handle.requestPermission({ mode: 'read' });
      if (permission !== 'granted') {
        notifyError('Permission needed', new Error(`Access to "${record.name}" was not granted.`));
        return;
      }
      const nativeFile = await record.handle.getFile();
      const bytes = new Uint8Array(await nativeFile.arrayBuffer());
      setPendingReopen({ file: { bytes, name: record.name, handle: record.handle }, format: parsedFormat.data });
      void navigate({ to: '/convert' });
    } catch (error) {
      notifyError(`Could not reopen "${record.name}"`, error);
    }
  };

  const handleRemove = (id: number | undefined) => {
    if (id === undefined) return;
    void removeRecentFile(id);
  };

  if (files === undefined) return null;

  if (files.length === 0) {
    return (
      <Stack align="center" gap="xs" py="xl">
        <IconFile size={36} opacity={0.4} />
        <Text c="dimmed" size="sm">
          Files you open will show up here.
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap={4}>
      {files.map((record) => (
        <Group key={record.id} justify="space-between" wrap="nowrap" py={6} px="xs">
          <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
            <IconFile size={20} style={{ flexShrink: 0 }} />
            <Stack gap={0} style={{ minWidth: 0 }}>
              <Text size="sm" fw={500} truncate>
                {record.name}
              </Text>
              <Group gap={6}>
                <Badge size="xs" variant="light">
                  {record.format}
                </Badge>
                <Text size="xs" c="dimmed">
                  {formatBytes(record.sizeBytes)} · {relativeTime(record.lastOpenedAt)}
                </Text>
              </Group>
            </Stack>
          </Group>
          <Group gap={4} wrap="nowrap">
            <Tooltip label={record.handle !== undefined ? 'Reopen in Convert' : "This browser can't reopen files directly -- pick it again from the tool you need"}>
              <ActionIcon variant="subtle" disabled={record.handle === undefined} onClick={() => void handleReopen(record)}>
                <IconReload size={16} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Remove">
              <ActionIcon variant="subtle" color="red" onClick={() => handleRemove(record.id)}>
                <IconTrash size={16} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
      ))}
    </Stack>
  );
}
