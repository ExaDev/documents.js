import { Box, Text } from "ink";
import { render } from "ink-testing-library";
import { useEffect, type ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { GLOBAL_KEYS } from "../keybindings/global-keys.js";
import {
  AppStateProvider,
  useAppDispatch,
  useAppState,
} from "../state/context.js";
import { settle, waitForFrame } from "../test-support.js";
import { HelpOverlay } from "./help-overlay.js";

// Opens the help overlay itself on mount, matching app.tsx's own gating (HelpOverlay is only ever rendered while `overlays.help` is true) -- this lets a close test start from a genuinely-open overlay and prove the close actually flipped it, rather than the flag trivially already reading false before any key was ever sent.
function Harness(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();

  useEffect(() => {
    dispatch({ type: "OPEN_OVERLAY", overlay: "help" });
  }, [dispatch]);

  return (
    <Box flexDirection="column">
      {state.overlays.help ? <HelpOverlay /> : undefined}
      <Text>helpOpen:{String(state.overlays.help)}</Text>
    </Box>
  );
}

function renderHarness(): ReturnType<typeof render> {
  return render(
    <AppStateProvider>
      <Harness />
    </AppStateProvider>,
  );
}

describe("HelpOverlay", () => {
  it("renders every global key binding and its description", async () => {
    const { lastFrame } = renderHarness();
    const frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("Key bindings"),
    );
    for (const binding of GLOBAL_KEYS) {
      expect(frame).toContain(binding.keys);
      expect(frame).toContain(binding.description);
    }
    expect(frame).toContain("Esc to close");
  });

  it("closes the help overlay on Escape", async () => {
    const { lastFrame, stdin } = renderHarness();
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("Key bindings"),
    );
    await settle();
    stdin.write("\x1B");
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("helpOpen:false"),
    );
  });

  it('closes the help overlay on "?"', async () => {
    const { lastFrame, stdin } = renderHarness();
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("Key bindings"),
    );
    await settle();
    stdin.write("?");
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("helpOpen:false"),
    );
  });

  it("closes the help overlay on Enter", async () => {
    const { lastFrame, stdin } = renderHarness();
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("Key bindings"),
    );
    await settle();
    stdin.write("\r");
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("helpOpen:false"),
    );
  });

  it("stays open on an unrelated key", async () => {
    const { lastFrame, stdin } = renderHarness();
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("Key bindings"),
    );
    await settle();
    stdin.write("x");
    await settle();
    const frame = lastFrame();
    expect(frame).toContain("helpOpen:true");
  });
});
