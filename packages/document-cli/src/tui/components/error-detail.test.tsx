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
import { ErrorDetail } from "./error-detail.js";

// Seeds a real errorDetail through OPEN_FILE_ERROR -- the same action a genuinely failed :open/export dispatches -- exactly once, guarded by a ref.
function Harness(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const seeded = useRef(false);

  useEffect(() => {
    if (!seeded.current) {
      seeded.current = true;
      dispatch({
        type: "OPEN_FILE_ERROR",
        message: "Could not open report.docx",
        detail: "ENOENT: no such file or directory",
      });
    }
  }, [dispatch]);

  return (
    <Box flexDirection="column">
      <ErrorDetail />
      <Text>hasErrorDetail:{String(state.errorDetail !== undefined)}</Text>
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

describe("ErrorDetail", () => {
  it("renders an empty box when there is no error detail to show", async () => {
    function EmptyHarness(): ReactElement {
      return <ErrorDetail />;
    }
    const { lastFrame } = render(
      <AppStateProvider>
        <EmptyHarness />
      </AppStateProvider>,
    );
    await settle();
    const frame = lastFrame();
    expect(frame).not.toContain("Esc or Enter to dismiss");
    expect(frame ?? "").not.toContain("undefined");
  });

  it("renders the error message and its detail", async () => {
    const { lastFrame } = renderHarness();
    const frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("Could not open report.docx"),
    );
    expect(frame).toContain("ENOENT: no such file or directory");
    expect(frame).toContain("Esc or Enter to dismiss");
  });

  it("omits the detail line when the error carries none", async () => {
    function NoDetailHarness(): ReactElement {
      const state = useAppState();
      const dispatch = useAppDispatch();
      const seeded = useRef(false);

      useEffect(() => {
        if (!seeded.current) {
          seeded.current = true;
          dispatch({
            type: "OPEN_FILE_ERROR",
            message: "Could not open report.docx",
            detail: undefined,
          });
        }
      }, [dispatch]);

      return (
        <Box flexDirection="column">
          <ErrorDetail />
          <Text>done:{String(state.errorDetail !== undefined)}</Text>
        </Box>
      );
    }

    const { lastFrame } = render(
      <AppStateProvider>
        <NoDetailHarness />
      </AppStateProvider>,
    );
    const frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("done:true"),
    );
    expect(frame).toContain("Could not open report.docx");
    expect(frame).not.toContain("ENOENT");
  });

  it("dismisses the error detail on Escape", async () => {
    const { lastFrame, stdin } = renderHarness();
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("hasErrorDetail:true"),
    );
    await settle();

    stdin.write("\x1B");
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("hasErrorDetail:false"),
    );
  });

  it("dismisses the error detail on Enter", async () => {
    const { lastFrame, stdin } = renderHarness();
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("hasErrorDetail:true"),
    );
    await settle();

    stdin.write("\r");
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("hasErrorDetail:false"),
    );
  });
});
