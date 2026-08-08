import { ActionIcon, AppShell, Burger, Group, Menu, Title, useMantineColorScheme } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { createRootRoute, Outlet } from '@tanstack/react-router';
import { IconCheck, IconDeviceDesktop, IconMoon, IconSun } from '@tabler/icons-react';

import { Sidebar } from './-Sidebar';

export const Route = createRootRoute({
  component: RootLayout,
});

// 'auto' is Mantine's own name for "follow the OS preference" -- labelled "System" here since that's what every other app calls it, with its own distinct icon rather than resolving to whichever of light/dark it currently renders as. Showing the selected mode (not the resolved one) is what lets the menu's checkmark unambiguously mark which of the three is active.
const COLOR_SCHEME_OPTIONS = [
  { value: 'light', label: 'Light', icon: IconSun },
  { value: 'dark', label: 'Dark', icon: IconMoon },
  { value: 'auto', label: 'System', icon: IconDeviceDesktop },
] as const;

function RootLayout() {
  const [navOpened, { toggle: toggleNav }] = useDisclosure();
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const ActiveIcon = COLOR_SCHEME_OPTIONS.find((option) => option.value === colorScheme)?.icon ?? IconDeviceDesktop;

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
          <Menu position="bottom-end" shadow="sm" withArrow>
            <Menu.Target>
              <ActionIcon variant="subtle" size="lg" aria-label="Change color scheme">
                <ActiveIcon size={18} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              {COLOR_SCHEME_OPTIONS.map((option) => (
                <Menu.Item
                  key={option.value}
                  leftSection={<option.icon size={16} />}
                  rightSection={colorScheme === option.value ? <IconCheck size={14} /> : undefined}
                  onClick={() => setColorScheme(option.value)}
                >
                  {option.label}
                </Menu.Item>
              ))}
            </Menu.Dropdown>
          </Menu>
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
