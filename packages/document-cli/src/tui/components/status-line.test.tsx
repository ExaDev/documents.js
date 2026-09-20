import { render } from "ink-testing-library";
import { useEffect, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

// How far fake time moves per poll below. Fine enough that a frame is observed close to the timeout that produced it, coarse enough that crossing the TTL takes a small number of iterations rather than hundreds.
const ADVANCE_STEP_MS = 50;
// Enough fake time for the expiry timeout to fire with room to spare, derived from the TTL itself rather than picked.
const ADVANCE_BUDGET_MS = TRANSIENT_STATUS_TTL_MS * 2;

// The fake-timer counterpart to test-support's waitForFrame, kept local because it is the only place in this suite that drives a component's own scheduled timeout rather than waiting on effect flushing alone. Polling for the same reason waitForFrame polls (the number of scheduler ticks between a timeout firing and its state update reaching lastFrame is a React and Ink implementation detail), but each step advances FAKE time, so crossing a multi-second TTL costs nothing on the wall clock and cannot lose a race against a loaded machine. advanceTimersByTimeAsync is what makes that work: it flushes microtasks between timers, which is how the dispatch a fired timeout performs gets rendered before the next poll reads the frame.
async function advanceToFrame(
  getFrame: () => string | undefined,
  predicate: (frame: string) => boolean,
): Promise<void> {
  for (
    let elapsed = 0;
    elapsed <= ADVANCE_BUDGET_MS;
    elapsed += ADVANCE_STEP_MS
  ) {
    const frame = getFrame();
    if (frame !== undefined && predicate(frame)) {
      return;
    }
    await vi.advanceTimersByTimeAsync(ADVANCE_STEP_MS);
  }
  throw new Error(
    `Fake time advanced ${ADVANCE_BUDGET_MS}ms without a frame matching the predicate. Last frame:\n${getFrame() ?? "(no frame rendered yet)"}`,
  );
}

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

// Fake timers for this block alone: these are the only tests whose subject is a scheduled timeout rather than effect flushing, and the rest of the file's waitForFrame polling needs real ones to make progress.
describe("StatusLine transient status expiry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("clears an info status automatically once its TTL elapses", async () => {
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
    await advanceToFrame(lastFrame, (candidate) => candidate.includes("Saved"));

    await advanceToFrame(
      lastFrame,
      (candidate) => !candidate.includes("Saved"),
    );
  });

  it("never auto-clears an error status", async () => {
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
    await advanceToFrame(lastFrame, (candidate) =>
      candidate.includes("Could not save"),
    );

    // Well past the TTL an info or warning status would have expired at, so a still-present message proves the effect never armed its timer rather than merely that the clock has not reached it yet.
    await vi.advanceTimersByTimeAsync(ADVANCE_BUDGET_MS);
    expect(lastFrame()).toContain("Could not save");
  });
});
