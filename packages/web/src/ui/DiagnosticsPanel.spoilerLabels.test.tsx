import type * as MantineCore from "@mantine/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Diagnostic } from "../shared/diagnostics";
import { mountWithMantine } from "../test/mountComponent";

// jsdom has no real layout engine, so Mantine's real Spoiler (DiagnosticsPanel.test.tsx's own top-of-file comment explains this) never measures an overflow and never renders its showLabel/hideLabel text at all, regardless of item count -- this file mocks just Spoiler to capture the exact label strings DiagnosticsPanel passes it, since that's the only way to observe them at all under jsdom.
let latestShowLabel: string | undefined;
vi.mock("@mantine/core", async (importOriginal) => {
  const actual = await importOriginal<typeof MantineCore>();
  return {
    ...actual,
    Spoiler: (props: { showLabel: string; children: React.ReactNode }) => {
      latestShowLabel = props.showLabel;
      return <div data-testid="fake-spoiler">{props.children}</div>;
    },
  };
});

const { DiagnosticsPanel } = await import("./DiagnosticsPanel");

let unmount: (() => void) | undefined;

afterEach(() => {
  unmount?.();
  unmount = undefined;
  latestShowLabel = undefined;
});

function diagnostic(overrides: Partial<Diagnostic> = {}): Diagnostic {
  return { severity: "info", code: "x", message: "a message", ...overrides };
}

describe("DiagnosticsPanel's Spoiler showLabel", () => {
  it("names the exact number of collapsed info diagnostics", () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      diagnostic({ message: `info ${i}` }),
    );
    const mounted = mountWithMantine(<DiagnosticsPanel diagnostics={many} />);
    unmount = mounted.unmount;
    expect(latestShowLabel).toBe("Show 8 more");
  });
});
