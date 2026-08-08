import { ActionIcon, AppShell, Burger, Group, Title, useComputedColorScheme, useMantineColorScheme } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { createRootRoute, Outlet } from '@tanstack/react-router';
import { IconMoon, IconSun } from '@tabler/icons-react';

import { Sidebar } from './-Sidebar';

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  const [navOpened, { toggle: toggleNav }] = useDisclosure();
  const { toggleColorScheme } = useMantineColorScheme();
  // useMantineColorScheme().colorScheme is the raw stored preference ('light' | 'dark' | 'auto') -- the icon needs the OS-resolved value so it reflects what's actually on screen when the preference is 'auto', not the literal string 'auto'.
  const computedColorScheme = useComputedColorScheme('light');

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 240, breakpoint: 'sm', collapsed: { mobile: !navOpened } }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" gap="sm" justify="space-between">
          <Group gap="sm">
            <Burger opened={navOpened} onClick={toggleNav} hiddenFrom="sm" size="sm" />
            <Title order={4}>documents</Title>
          </Group>
          <ActionIcon variant="subtle" size="lg" aria-label="Toggle color scheme" onClick={toggleColorScheme}>
            {computedColorScheme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
          </ActionIcon>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="xs">
        <Sidebar />
      </AppShell.Navbar>
      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
