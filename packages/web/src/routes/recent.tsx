import { Container, Paper, Stack, Title } from "@mantine/core";
import { createFileRoute } from "@tanstack/react-router";

import { RecentFilesPanel } from "../ui/RecentFilesPanel";

export const Route = createFileRoute("/recent")({
  component: RecentPage,
});

function RecentPage() {
  return (
    <Container size="sm" py="xl">
      <Stack gap="lg">
        <Title order={2}>Recent files</Title>
        <Paper withBorder p="md">
          <RecentFilesPanel />
        </Paper>
      </Stack>
    </Container>
  );
}
