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

import { OpenDocumentProvider } from "../document/OpenDocumentContext";
import { Sidebar } from "./-Sidebar";

export const Route = createRootRoute({
  component: RootLayout,
});

// 'auto' is Mantine's own name for "follow the OS preference" — labelled "System" here since that's what every other app calls it. Order is the cycle order the header button steps through on each click.
const COLOR_SCHEME_OPTIONS = [
  { value: "light", label: "Light", icon: IconSun },
  { value: "dark", label: "Dark", icon: IconMoon },
  { value: "auto", label: "System", icon: IconDeviceDesktop },
] as const;

type ColorSchemeOption = (typeof COLOR_SCHEME_OPTIONS)[number];

// A computed index into a fixed-length array is `T | undefined` under noUncheckedIndexedAccess even when the arithmetic guarantees it's always in range (modulo COLOR_SCHEME_OPTIONS.length) — this asserts that invariant explicitly rather than papering over it with a fallback option, which would silently substitute a different-but-valid choice if the arithmetic were ever wrong. Exported so __root.test.ts can drive the throw path directly with a genuinely out-of-range index, the only way to exercise it at all: RootLayout's own two call sites never produce one.
export function optionAt(index: number) {
  const option = COLOR_SCHEME_OPTIONS[index];
  if (option === undefined)
    throw new Error(`Color scheme option index ${index} out of range`);
  return option;
}

// The header button's own cycle-and-lookup logic, factored out of RootLayout so __root.test.ts can drive every branch (an unrecognised current value falling back to index 0, and the wrap-around from the last option back to the first) without mounting the real AppShell/RouterProvider tree neither of these pure lookups needs.
export function activeColorSchemeOption(currentValue: string) {
  const activeIndex = COLOR_SCHEME_OPTIONS.findIndex(
    (option) => option.value === currentValue,
  );
  return optionAt(activeIndex === -1 ? 0 : activeIndex);
}

export function nextColorSchemeOption(currentValue: string) {
  const activeIndex = COLOR_SCHEME_OPTIONS.findIndex(
    (option) => option.value === currentValue,
  );
  return optionAt((Math.max(activeIndex, 0) + 1) % COLOR_SCHEME_OPTIONS.length);
}

// Factored out so a test can assert the exact wording without depending on Mantine's Tooltip actually opening — its floating content mounts into a portal only once Floating UI's own hover/focus interaction completes, which jsdom (no real layout engine, no real pointer) does not reliably drive.
export function colorSchemeTooltipLabel(
  activeOption: ColorSchemeOption,
  nextOption: ColorSchemeOption,
): string {
  return `Color scheme: ${activeOption.label} (click for ${nextOption.label})`;
}

// Factored out for the identical reason colorSchemeTooltipLabel is: AppShell's navbar prop drives generated CSS variables (breakpoint-keyed media queries, a collapse transform) that only Mantine's own build-time-styled internals read, so asserting against the real rendered stylesheet would test Mantine's implementation rather than this component's own logic. This pure function is what a test can actually pin down: the width and breakpoint are fixed, and collapsed.mobile is the one bit that depends on navOpened, collapsed on mobile exactly when the nav drawer is not open.
export function navbarConfig(navOpened: boolean): {
  width: number;
  breakpoint: string;
  collapsed: { mobile: boolean };
} {
  return { width: 240, breakpoint: "sm", collapsed: { mobile: !navOpened } };
}

function RootLayout() {
  const [navOpened, { toggle: toggleNav }] = useDisclosure();
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const activeOption = activeColorSchemeOption(colorScheme);
  const nextOption = nextColorSchemeOption(colorScheme);
  const cycleColorScheme = () => {
    setColorScheme(nextOption.value);
  };

  return (
    // The open document is provided here, at the root, rather than inside the '/_document' layout: Recent Files sits outside that layout and opens into the same document, and a provider mounted inside the layout is unmounted (losing the open document) the moment a route outside it is visited.
    <OpenDocumentProvider>
      <AppShell
        header={{ height: 56 }}
        navbar={navbarConfig(navOpened)}
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
            <Tooltip label={colorSchemeTooltipLabel(activeOption, nextOption)}>
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
    </OpenDocumentProvider>
  );
}
