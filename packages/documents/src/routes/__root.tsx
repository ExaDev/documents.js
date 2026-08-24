import {
  ActionIcon,
  AppShell,
  Burger,
  Group,
  Title,
  Tooltip,
  useMantineColorScheme,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { createRootRoute, Outlet } from "@tanstack/react-router";
import { IconDeviceDesktop, IconMoon, IconSun } from "@tabler/icons-react";

import { Sidebar } from "./-Sidebar";

export const Route = createRootRoute({
  component: RootLayout,
});

// 'auto' is Mantine's own name for "follow the OS preference" -- labelled "System" here since that's what every other app calls it. Order is the cycle order the header button steps through on each click.
const COLOR_SCHEME_OPTIONS = [
  { value: "light", label: "Light", icon: IconSun },
  { value: "dark", label: "Dark", icon: IconMoon },
  { value: "auto", label: "System", icon: IconDeviceDesktop },
] as const;

// A computed index into a fixed-length array is `T | undefined` under noUncheckedIndexedAccess even when the arithmetic guarantees it's always in range (modulo COLOR_SCHEME_OPTIONS.length) -- this asserts that invariant explicitly rather than papering over it with a fallback option, which would silently substitute a different-but-valid choice if the arithmetic were ever wrong.
function optionAt(index: number) {
  const option = COLOR_SCHEME_OPTIONS[index];
  if (option === undefined)
    throw new Error(`Color scheme option index ${index} out of range`);
  return option;
}

function RootLayout() {
  const [navOpened, { toggle: toggleNav }] = useDisclosure();
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const activeIndex = COLOR_SCHEME_OPTIONS.findIndex(
    (option) => option.value === colorScheme,
  );
  const activeOption = optionAt(activeIndex === -1 ? 0 : activeIndex);
  const nextOption = optionAt(
    (Math.max(activeIndex, 0) + 1) % COLOR_SCHEME_OPTIONS.length,
  );
  const cycleColorScheme = () => {
    setColorScheme(nextOption.value);
  };

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{
        width: 240,
        breakpoint: "sm",
        collapsed: { mobile: !navOpened },
      }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" gap="sm" justify="space-between">
          <Group gap="sm">
            <Burger
              opened={navOpened}
              onClick={toggleNav}
              hiddenFrom="sm"
              size="sm"
            />
            <Title order={4}>documents</Title>
          </Group>
          <Tooltip
            label={`Color scheme: ${activeOption.label} (click for ${nextOption.label})`}
          >
            <ActionIcon
              variant="subtle"
              size="lg"
              aria-label={`Color scheme: ${activeOption.label}. Click to switch to ${nextOption.label}.`}
              onClick={cycleColorScheme}
            >
              <activeOption.icon size={18} />
            </ActionIcon>
          </Tooltip>
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
