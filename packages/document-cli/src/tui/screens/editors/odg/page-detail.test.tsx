import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vitest";
import { OdgHarness } from "./test-support.js";

const EFFECT_SETTLE_MS = 50;

// See page-list.test.tsx's own comment: a screen's `useInput` effect (setRawMode + attach the readable listener) has not necessarily flushed the instant `vi.waitFor` first observes that screen's own text, so a short real delay after each screen transition, before that screen's first interactive keystroke, is needed to avoid racing ahead of it.
async function settle(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, EFFECT_SETTLE_MS);
  });
}

// From the odg root (pageList), add a page and drill into it -- a real user's own interaction path, not a pre-seeded stack.
async function navigateToPageDetail(
  stdin: { readonly write: (data: string) => void },
  lastFrame: () => string | undefined,
): Promise<void> {
  await vi.waitFor(() => {
    expect(lastFrame()).toContain("top:pageList");
  });
  await settle();

  stdin.write("a");
  await vi.waitFor(() => {
    expect(lastFrame()).toContain("Page 1");
  });

  stdin.write("\r");
  await vi.waitFor(() => {
    expect(lastFrame()).toContain("top:pageDetail");
  });
  await settle();
}

describe("OdgPageDetailScreen", () => {
  it("shows a freshly added, empty page with no items yet", async () => {
    const { lastFrame, stdin } = render(<OdgHarness />);
    await navigateToPageDetail(stdin, lastFrame);

    const frame = lastFrame();
    expect(frame).toContain("Page 1");
    expect(frame).toContain("No items yet");
  });

  it('opens the add-item kind menu on "a"', async () => {
    const { lastFrame, stdin } = render(<OdgHarness />);
    await navigateToPageDetail(stdin, lastFrame);

    stdin.write("a");
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("Rectangle");
    });
    expect(lastFrame()).toContain("Text box");
  });
});
