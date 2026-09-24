import { Paper } from "@mantine/core";
import { createFileRoute } from "@tanstack/react-router";

import { RecentFilesPanel } from "../ui/RecentFilesPanel";
import { ToolPage } from "../ui/ToolPage";

export const Route = createFileRoute("/recent")({
  component: RecentPage,
});

function RecentPage() {
  return (
    <ToolPage title="Recent files">
      <Paper withBorder p="md">
        <RecentFilesPanel />
      </Paper>
    </ToolPage>
  );
}
