import { ActionIcon, Badge, Group, Stack, Text, Tooltip } from '@mantine/core';
import { useNavigate } from '@tanstack/react-router';
import { IconFile, IconReload, IconTrash } from '@tabler/icons-react';
import { DocumentFormatSchema } from 'documents.js';

import type { RecentFileRecord } from '../db/dexie';
import { removeRecentFile, useRecentFiles } from '../hooks/useRecentFiles';
import { relativeTime } from '../shared/relativeTime';
import { notifyError } from './notify';
import { iconFlexShrink, minWidthZero } from './RecentFilesPanel.css';
import { setPendingReopen } from './reopenMailbox';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
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
          <Group gap="sm" wrap="nowrap" className={minWidthZero}>
            <IconFile size={20} className={iconFlexShrink} />
            <Stack gap={0} className={minWidthZero}>
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
