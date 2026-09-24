import { ActionIcon, Badge, Group, Stack, Text, Tooltip } from "@mantine/core";
import { useNavigate } from "@tanstack/react-router";
import { IconFile, IconReload, IconTrash } from "@tabler/icons-react";

import type { RecentFileRecord } from "../db/dexie";
import { useOpenDocument } from "../document/OpenDocumentContext";
import { removeRecentFile, useRecentFiles } from "../hooks/useRecentFiles";
import { relativeTime } from "../shared/relativeTime";
import { notifyError } from "./notify";
import { iconFlexShrink, minWidthZero } from "./RecentFilesPanel.css";

// Exported so a test can pin the exact KB/MB boundary directly, rather than only through rendered text.
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// Factored out for the identical reason __root.tsx's colorSchemeTooltipLabel is: Mantine's Tooltip only mounts its floating label content once genuinely open (hover/focus), which a render-only test cannot drive, so this pure lookup is what a test can actually assert against.
export function reopenTooltipLabel(hasHandle: boolean): string {
  return hasHandle
    ? "Reopen in Convert"
    : "This browser can't reopen files directly — pick it again from the tool you need";
}

export function RecentFilesPanel() {
  const files = useRecentFiles();
  const navigate = useNavigate();
  const { openDocument } = useOpenDocument();

  // Reads the file back off disk through its stored handle and opens it as the app's one shared document, so every tool sees it without a second pick. The record's own stored format is not consulted: openDocument re-infers the format from the filename, which is the same rule that decided the record was worth storing in the first place, so there is exactly one place formats are inferred.
  const handleReopen = async (record: RecentFileRecord) => {
    if (record.handle === undefined) return;
    try {
      let permission = await record.handle.queryPermission({ mode: "read" });
      if (permission !== "granted")
        permission = await record.handle.requestPermission({ mode: "read" });
      if (permission !== "granted") {
        notifyError(
          "Permission needed",
          new Error(`Access to "${record.name}" was not granted.`),
        );
        return;
      }
      const nativeFile = await record.handle.getFile();
      const bytes = new Uint8Array(await nativeFile.arrayBuffer());
      openDocument({ bytes, name: record.name, handle: record.handle });
      void navigate({ to: "/convert" });
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
      {files.map((record) => {
        const hasHandle = record.handle !== undefined;
        return (
          <Group
            key={record.id}
            justify="space-between"
            wrap="nowrap"
            py={6}
            px="xs"
          >
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
                    {formatBytes(record.sizeBytes)} ·{" "}
                    {relativeTime(record.lastOpenedAt)}
                  </Text>
                </Group>
              </Stack>
            </Group>
            <Group gap={4} wrap="nowrap">
              {/* One boolean feeds both the tooltip label and the disabled state — the disabled assertions already covering both a handle-backed and a handle-less record are what makes this single check observable at all, since the tooltip's own label text never mounts in a render-only test (see reopenTooltipLabel's comment). */}
              <Tooltip label={reopenTooltipLabel(hasHandle)}>
                <ActionIcon
                  variant="subtle"
                  disabled={!hasHandle}
                  aria-label={`Reopen ${record.name}`}
                  onClick={() => void handleReopen(record)}
                >
                  <IconReload size={16} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label="Remove">
                <ActionIcon
                  variant="subtle"
                  color="red"
                  aria-label={`Remove ${record.name} from recent files`}
                  onClick={() => {
                    handleRemove(record.id);
                  }}
                >
                  <IconTrash size={16} />
                </ActionIcon>
              </Tooltip>
            </Group>
          </Group>
        );
      })}
    </Stack>
  );
}
