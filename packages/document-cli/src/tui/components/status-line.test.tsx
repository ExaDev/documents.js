import { render } from "ink-testing-library";
import { useEffect, type ReactElement } from "react";
import { describe, expect, it } from "vitest";
import {
  AppStateProvider,
  useAppDispatch,
  useAppState,
} from "../state/context.js";
import { settle, waitForFrame } from "../test-support.js";
import {
  StatusLine,
  statusColour,
  TRANSIENT_STATUS_TTL_MS,
} from "./status-line.js";

// Real time, not faked: vi.useFakeTimers left the expiry effect's own setTimeout unadvanced in this Ink render harness even with shouldAdvanceTime set, so these tests wait out the real TTL instead. The buffer over the TTL is generous because this machine's own real timers can lag well behind their nominal delay under heavy concurrent CPU load; the per-test timeout below is set even higher again so vitest's own default 5000ms test timeout can never race this wait.
const TTL_WAIT_MS = TRANSIENT_STATUS_TTL_MS + 15000;
const TTL_TEST_TIMEOUT_MS = TTL_WAIT_MS + 5000;

describe("statusColour", () => {
  it("maps each severity to its own distinct colour", () => {
    expect(statusColour("info")).toBe("cyan");
    expect(statusColour("warning")).toBe("yellow");
    expect(statusColour("error")).toBe("red");
  });
});

describe("StatusLine rendering", () => {
  it('shows "no document" when nothing is open', async () => {
    const { lastFrame } = render(
      <AppStateProvider>
        <StatusLine />
      </AppStateProvider>,
    );
    const frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("no document"),
    );
    expect(frame).not.toContain("●");
  });

  it("shows the open document's own path once one exists", async () => {
    function OpenHarness(): ReactElement {
      const state = useAppState();
      const dispatch = useAppDispatch();

      useEffect(() => {
        if (state.openDocument === undefined) {
          dispatch({ type: "CREATE_DOCUMENT", format: "docx" });
        }
      }, [state.openDocument, dispatch]);

      return <StatusLine />;
    }

    const { lastFrame } = render(
      <AppStateProvider>
        <OpenHarness />
      </AppStateProvider>,
    );
    const frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("untitled"),
    );
    expect(frame).not.toContain("no document");
  });

  it("shows the unsaved-changes dot once a mutation is pending", async () => {
    function DirtyHarness(): ReactElement {
      const state = useAppState();
      const dispatch = useAppDispatch();

      useEffect(() => {
        if (state.openDocument === undefined) {
          dispatch({ type: "CREATE_DOCUMENT", format: "docx" });
          return;
        }
        if (!state.hasUnsavedChanges) {
          dispatch({
            type: "APPEND_PARAGRAPH",
            text: "Hello",
            styleId: undefined,
            alignment: undefined,
          });
        }
      }, [state.openDocument, state.hasUnsavedChanges, dispatch]);

      return <StatusLine />;
    }

    const { lastFrame } = render(
      <AppStateProvider>
        <DirtyHarness />
      </AppStateProvider>,
    );
    const frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("●"),
    );
    expect(frame).toContain("untitled");
  });

  it("shows the diagnostics badge once diagnostics exist and the panel is closed", async () => {
    function DiagnosticHarness(): ReactElement {
      const state = useAppState();
      const dispatch = useAppDispatch();

      useEffect(() => {
        if (state.diagnostics.length === 0) {
          dispatch({
            type: "APPEND_DIAGNOSTIC",
            diagnostic: { severity: "warning", message: "Substituted a font" },
          });
        }
      }, [state.diagnostics.length, dispatch]);

      return <StatusLine />;
    }

    const { lastFrame } = render(
      <AppStateProvider>
        <DiagnosticHarness />
      </AppStateProvider>,
    );
    const frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("diagnostics -- Ctrl+D"),
    );
    expect(frame).toContain("1 diagnostics");
  });

  it("hides the diagnostics badge while the diagnostics panel is itself open", async () => {
    function DiagnosticHarness(): ReactElement {
      const state = useAppState();
      const dispatch = useAppDispatch();

      useEffect(() => {
        if (state.diagnostics.length === 0) {
          dispatch({
            type: "APPEND_DIAGNOSTIC",
            diagnostic: { severity: "warning", message: "Substituted a font" },
          });
          dispatch({ type: "OPEN_OVERLAY", overlay: "diagnosticsPanel" });
        }
      }, [state.diagnostics.length, dispatch]);

      return <StatusLine />;
    }

    const { lastFrame } = render(
      <AppStateProvider>
        <DiagnosticHarness />
      </AppStateProvider>,
    );
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("no document"),
    );
    await settle();
    expect(lastFrame()).not.toContain("diagnostics -- Ctrl+D");
  });

  it("shows the current status message in its own colour-mapped role", async () => {
    function StatusHarness(): ReactElement {
      const state = useAppState();
      const dispatch = useAppDispatch();

      useEffect(() => {
        if (state.status === undefined) {
          dispatch({
            type: "SET_STATUS",
            severity: "warning",
            text: "Something needs attention",
          });
        }
      }, [state.status, dispatch]);

      return <StatusLine />;
    }

    const { lastFrame } = render(
      <AppStateProvider>
        <StatusHarness />
      </AppStateProvider>,
    );
    const frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("Something needs attention"),
    );
    expect(frame).toContain("no document");
  });
});

describe("StatusLine transient status expiry", () => {
  it(
    "clears an info status automatically once its TTL elapses",
    async () => {
      function TransientHarness(): ReactElement {
        const state = useAppState();
        const dispatch = useAppDispatch();

        useEffect(() => {
          if (state.status === undefined) {
            dispatch({ type: "SET_STATUS", severity: "info", text: "Saved" });
          }
        }, [state.status, dispatch]);

        return <StatusLine />;
      }

      const { lastFrame } = render(
        <AppStateProvider>
          <TransientHarness />
        </AppStateProvider>,
      );
      await waitForFrame(lastFrame, (candidate) => candidate.includes("Saved"));

      await waitForFrame(
        lastFrame,
        (candidate) => !candidate.includes("Saved"),
        TTL_WAIT_MS,
      );
    },
    TTL_TEST_TIMEOUT_MS,
  );

  it(
    "never auto-clears an error status",
    async () => {
      function ErrorHarness(): ReactElement {
        const state = useAppState();
        const dispatch = useAppDispatch();

        useEffect(() => {
          if (state.status === undefined) {
            dispatch({
              type: "SET_STATUS",
              severity: "error",
              text: "Could not save",
            });
          }
        }, [state.status, dispatch]);

        return <StatusLine />;
      }

      const { lastFrame } = render(
        <AppStateProvider>
          <ErrorHarness />
        </AppStateProvider>,
      );
      await waitForFrame(lastFrame, (candidate) =>
        candidate.includes("Could not save"),
      );

      // Real time past the TTL an info/warning status would have expired at -- an error status must still be showing.
      await new Promise((resolve) => {
        setTimeout(resolve, TTL_WAIT_MS);
      });
      expect(lastFrame()).toContain("Could not save");
    },
    TTL_TEST_TIMEOUT_MS,
  );
});
