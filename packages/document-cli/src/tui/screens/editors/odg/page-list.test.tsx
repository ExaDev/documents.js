import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vitest";
import { OdgHarness } from "./test-support.js";

const EFFECT_SETTLE_MS = 50;

// `vi.waitFor`'s first predicate check can resolve the instant a freshly-mounted screen's own render commits, which happens before that screen's own `useInput` effect (setRawMode + attach the readable listener) has actually flushed -- so a `stdin.write` sent immediately after a screen-transition wait can race ahead of the listener that would have handled it. A short real delay after confirming a new screen is showing, before the first interactive keystroke sent to it, gives that effect a genuine chance to run.
async function settle(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, EFFECT_SETTLE_MS);
  });
}

describe("OdgPageListScreen", () => {
  it('lists the drawing pages and adds one on "a"', async () => {
    const { lastFrame, stdin } = render(<OdgHarness />);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("Drawing pages");
    });
    await settle();

    stdin.write("a");
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("Page 1");
    });
  });

  it("pushes pageDetail for the selected page on Enter", async () => {
    const { lastFrame, stdin } = render(<OdgHarness />);
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
  });
});
