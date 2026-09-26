import { createFileRoute } from "@tanstack/react-router";

import { RecentFilesPanel } from "../ui/RecentFilesPanel";
import { ToolPage } from "../ui/ToolPage";

export const Route = createFileRoute("/recent")({
  component: RecentPage,
});

function RecentPage() {
  return (
    <ToolPage
      title="Recent files"
      description="Documents you have opened in this browser, newest first. Reopen one to pick up where you left off."
    >
      <RecentFilesPanel />
    </ToolPage>
  );
}
