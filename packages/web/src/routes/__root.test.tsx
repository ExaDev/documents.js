import type * as MantineCore from "@mantine/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { mountWithMantine } from "../test/mountComponent";
import {
  activeColorSchemeOption,
  colorSchemeTooltipLabel,
  navbarConfig,
  nextColorSchemeOption,
  optionAt,
  Route,
} from "./__root";

vi.mock("@tanstack/react-router", () => ({
  createRootRoute: (options: unknown) => ({ options }),
  Outlet: () => <div data-testid="outlet" />,
}));

vi.mock("./-Sidebar", () => ({
  Sidebar: () => <div data-testid="sidebar" />,
}));

const setColorScheme = vi.fn<(value: string) => void>();
let colorScheme = "light";
vi.mock("@mantine/core", async (importOriginal) => {
  const actual = await importOriginal<typeof MantineCore>();
  return {
    ...actual,
    useMantineColorScheme: () => ({
      colorScheme,
      setColorScheme: (value: string) => {
        setColorScheme(value);
      },
    }),
  };
});

describe("optionAt", () => {
  it("returns the option at a genuinely in-range index", () => {
    expect(optionAt(0).value).toBe("light");
    expect(optionAt(2).value).toBe("auto");
  });

  it("throws for an out-of-range index rather than silently substituting a fallback", () => {
    expect(() => optionAt(99)).toThrow(
      "Color scheme option index 99 out of range",
    );
    expect(() => optionAt(-1)).toThrow(
      "Color scheme option index -1 out of range",
    );
  });
});

describe("activeColorSchemeOption", () => {
  it("finds the option matching the current value", () => {
    expect(activeColorSchemeOption("dark").value).toBe("dark");
    expect(activeColorSchemeOption("auto").value).toBe("auto");
  });

  it("falls back to the first option (light) for a value that isn't one of the three", () => {
    expect(activeColorSchemeOption("not-a-real-scheme").value).toBe("light");
  });
});

describe("nextColorSchemeOption", () => {
  it("steps to the following option in cycle order", () => {
    expect(nextColorSchemeOption("light").value).toBe("dark");
    expect(nextColorSchemeOption("dark").value).toBe("auto");
  });

  it("wraps from the last option back to the first", () => {
    expect(nextColorSchemeOption("auto").value).toBe("light");
  });

  it("treats an unrecognised current value as if it were the first option, stepping to the second", () => {
    expect(nextColorSchemeOption("not-a-real-scheme").value).toBe("dark");
  });
});

describe("colorSchemeTooltipLabel", () => {
  it("names the active option and offers the next one", () => {
    expect(colorSchemeTooltipLabel(optionAt(0), optionAt(1))).toBe(
      "Color scheme: Light (click for Dark)",
    );
  });
});

describe("navbarConfig", () => {
  it("collapses the mobile navbar when the drawer is not open", () => {
    expect(navbarConfig(false)).toEqual({
      width: 240,
      breakpoint: "sm",
      collapsed: { mobile: true },
    });
  });

  it("leaves the mobile navbar expanded once the drawer is open", () => {
    expect(navbarConfig(true)).toEqual({
      width: 240,
      breakpoint: "sm",
      collapsed: { mobile: false },
    });
  });
});

describe("RootLayout", () => {
  let unmount: (() => void) | undefined;

  afterEach(() => {
    unmount?.();
    unmount = undefined;
    colorScheme = "light";
    setColorScheme.mockClear();
  });

  function render() {
    const RootLayout = Route.options.component;
    if (RootLayout === undefined)
      throw new Error("root route has no component");
    const mounted = mountWithMantine(<RootLayout />);
    unmount = mounted.unmount;
    return mounted.container;
  }

  it("renders the sidebar and the routed outlet", () => {
    const container = render();
    expect(container.querySelector('[data-testid="sidebar"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="outlet"]')).not.toBeNull();
  });

  it("labels the colour scheme button with the active and next option", () => {
    colorScheme = "light";
    const container = render();
    const button = container.querySelector(
      'button[aria-label^="Color scheme"]',
    );
    expect(button?.getAttribute("aria-label")).toBe(
      "Color scheme: Light. Click to switch to Dark.",
    );
  });

  it("cycles to the next colour scheme when clicked", () => {
    colorScheme = "dark";
    const container = render();
    const button = container.querySelector<HTMLButtonElement>(
      'button[aria-label^="Color scheme"]',
    );
    button?.click();
    expect(setColorScheme).toHaveBeenCalledWith("auto");
  });
});
