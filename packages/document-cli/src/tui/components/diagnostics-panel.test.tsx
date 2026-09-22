import { Box, Text } from "ink";
import { render } from "ink-testing-library";
import { useEffect, useRef, type ReactElement } from "react";
import { describe, expect, it } from "vitest";
import {
  AppStateProvider,
  useAppDispatch,
  useAppState,
} from "../state/context.js";
import { settle, waitForFrame } from "../test-support.js";
import { DiagnosticsPanel } from "./diagnostics-panel.js";

// Seeds two real diagnostics (one with a page index, one without) through APPEND_DIAGNOSTIC — there is no other way to populate `state.diagnostics` — exactly once, guarded by a ref so re-renders don't keep appending.
function Harness(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const seeded = useRef(false);

  useEffect(() => {
    if (!seeded.current) {
      seeded.current = true;
      dispatch({
        type: "APPEND_DIAGNOSTIC",
        diagnostic: { severity: "warning", message: "Substituted a font" },
      });
      dispatch({
        type: "APPEND_DIAGNOSTIC",
        diagnostic: {
          severity: "info",
          message: "Dropped an unsupported field",
          pageIndex: 2,
        },
      });
    }
  }, [dispatch]);

  return (
    <Box flexDirection="column">
      <DiagnosticsPanel />
      <Text>diagnosticCount:{state.diagnostics.length}</Text>
      <Text>panelOpen:{String(state.overlays.diagnosticsPanel)}</Text>
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

describe("DiagnosticsPanel", () => {
  it("lists each diagnostic, formatting a page-scoped one with its page number", async () => {
    const { lastFrame } = renderHarness();
    const frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("Diagnostics (2)"),
    );
    expect(frame).toContain("warning: Substituted a font");
    expect(frame).toContain("info (page 3): Dropped an unsupported field");
  });

  it("shows the empty message when there are no diagnostics", async () => {
    function EmptyHarness(): ReactElement {
      return (
        <Box flexDirection="column">
          <DiagnosticsPanel />
        </Box>
      );
    }
    const { lastFrame } = render(
      <AppStateProvider>
        <EmptyHarness />
      </AppStateProvider>,
    );
    const frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("Diagnostics (0)"),
    );
    expect(frame).toContain("No diagnostics have been reported.");
  });

  it("dismisses the selected diagnostic on Enter", async () => {
    const { lastFrame, stdin } = renderHarness();
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("diagnosticCount:2"),
    );
    await settle();

    stdin.write("\r");
    const frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("diagnosticCount:1"),
    );
    // The first (index 0) entry was dismissed, leaving only the page-scoped one.
    expect(frame).toContain("Dropped an unsupported field");
    expect(frame).not.toContain("Substituted a font");
  });

  it("closes the diagnostics panel overlay on Escape", async () => {
    function OpenHarness(): ReactElement {
      const state = useAppState();
      const dispatch = useAppDispatch();

      useEffect(() => {
        dispatch({ type: "OPEN_OVERLAY", overlay: "diagnosticsPanel" });
      }, [dispatch]);

      return (
        <Box flexDirection="column">
          {state.overlays.diagnosticsPanel ? <DiagnosticsPanel /> : undefined}
          <Text>panelOpen:{String(state.overlays.diagnosticsPanel)}</Text>
        </Box>
      );
    }

    const { lastFrame, stdin } = render(
      <AppStateProvider>
        <OpenHarness />
      </AppStateProvider>,
    );
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("panelOpen:true"),
    );
    await settle();

    stdin.write("\x1B");
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("panelOpen:false"),
    );
  });
});
