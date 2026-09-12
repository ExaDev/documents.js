import { afterEach, describe, expect, it } from "vitest";

import type { Diagnostic } from "../shared/diagnostics";
import { mountWithMantine } from "../test/mountComponent";
import { DiagnosticsPanel } from "./DiagnosticsPanel";

let unmount: (() => void) | undefined;

afterEach(() => {
  unmount?.();
  unmount = undefined;
});

function renderPanel(diagnostics: readonly Diagnostic[]): string {
  const mounted = mountWithMantine(
    <DiagnosticsPanel diagnostics={diagnostics} />,
  );
  unmount = mounted.unmount;
  return mounted.container.innerHTML;
}

function diagnostic(overrides: Partial<Diagnostic> = {}): Diagnostic {
  return { severity: "info", code: "x", message: "a message", ...overrides };
}

// jsdom renders every element at zero size (it has no layout engine), so Spoiler's own measured-height-vs-maxHeight comparison can never observe a real overflow and its "Show N more" control never appears regardless of item count -- the wrapper element Mantine's Box always renders for a `<Spoiler>`, present whether or not the control itself is showing, is the only DOM signal jsdom can give for "this content was wrapped in a Spoiler", so it is what these tests check for instead.
const SPOILER_WRAPPER_CLASS = "mantine-Spoiler-root";
// MantineProvider injects its own <style> elements into the mount container regardless of what its children render, so an empty DiagnosticsPanel (which returns null) still leaves non-empty innerHTML -- the panel's own root Stack is the actual signal that it rendered anything at all.
const PANEL_ROOT_CLASS = "mantine-Stack-root";

describe("DiagnosticsPanel", () => {
  it("renders nothing for an empty diagnostics list", () => {
    expect(renderPanel([])).not.toContain(PANEL_ROOT_CLASS);
  });

  it("renders a warning's message", () => {
    const html = renderPanel([
      diagnostic({ severity: "warning", message: "a warning happened" }),
    ]);
    expect(html).toContain("a warning happened");
  });

  it("renders a page badge when a diagnostic carries a pageIndex, 1-indexed for display", () => {
    const html = renderPanel([diagnostic({ pageIndex: 0 })]);
    expect(html).toContain("Page 1");
  });

  it("renders no page badge when a diagnostic carries no pageIndex", () => {
    const html = renderPanel([diagnostic({ pageIndex: undefined })]);
    expect(html).not.toContain("Page");
  });

  it("renders info diagnostics directly, uncollapsed, when at or under the collapse threshold", () => {
    const html = renderPanel([
      diagnostic({ message: "one" }),
      diagnostic({ message: "two" }),
    ]);
    expect(html).toContain("one");
    expect(html).toContain("two");
    expect(html).not.toContain(SPOILER_WRAPPER_CLASS);
  });

  it("collapses info diagnostics behind a Spoiler once there are more than the threshold", () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      diagnostic({ message: `info ${i}` }),
    );
    const html = renderPanel(many);
    expect(html).toContain(SPOILER_WRAPPER_CLASS);
  });

  it("never collapses warnings, however many there are", () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      diagnostic({ severity: "warning", message: `warn ${i}` }),
    );
    const html = renderPanel(many);
    for (let i = 0; i < 6; i++) {
      expect(html).toContain(`warn ${i}`);
    }
    expect(html).not.toContain(SPOILER_WRAPPER_CLASS);
  });

  it("renders both warnings (uncollapsed) and a collapsed info spoiler together", () => {
    const html = renderPanel([
      diagnostic({ severity: "warning", message: "the warning" }),
      ...Array.from({ length: 6 }, (_, i) =>
        diagnostic({ message: `info ${i}` }),
      ),
    ]);
    expect(html).toContain("the warning");
    expect(html).toContain(SPOILER_WRAPPER_CLASS);
  });
});
