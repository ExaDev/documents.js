import { AppShell, Group, Title } from '@mantine/core';
import { createRootRoute, Link, Outlet } from '@tanstack/react-router';

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  return (
    <AppShell header={{ height: 56 }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Title order={4}>documents</Title>
          <Group gap="lg">
            <Link to="/">Home</Link>
            <Link to="/convert">Convert</Link>
            <Link to="/metadata">Metadata</Link>
            <Link to="/pdf-inspect">PDF inspect</Link>
            <Link to="/fonts">Fonts</Link>
          </Group>
        </Group>
      </AppShell.Header>
      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
