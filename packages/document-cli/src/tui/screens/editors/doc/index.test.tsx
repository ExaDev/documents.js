import { openMarkdown } from "documents.js";
import { render } from "ink-testing-library";
import { useEffect, type ReactElement } from "react";
import { describe, expect, it } from "vitest";
import {
  AppStateProvider,
  useAppDispatch,
  useAppState,
} from "../../../state/context.js";
import { waitForFrame } from "../../../test-support.js";
import { DocBodyListScreen } from "./index.js";

describe("DocBodyListScreen", () => {
  it("reports itself and 'no open document' when nothing is open", () => {
    const { lastFrame } = render(
      <AppStateProvider>
        <DocBodyListScreen />
      </AppStateProvider>,
    );
    expect(lastFrame()).toContain(
      "DocBodyListScreen requires an open doc document, found no open document.",
    );
  });

  it("names the actual mismatched format when a different one is open", async () => {
    function Harness(): ReactElement | undefined {
      const state = useAppState();
      const dispatch = useAppDispatch();
      useEffect(() => {
        dispatch({
          type: "OPEN_FILE_SUCCESS",
          path: "notes.md",
          doc: {
            format: "markdown",
            editor: openMarkdown("# Title\n"),
            originalText: "# Title\n",
            path: "notes.md",
          },
        });
      }, [dispatch]);
      return state.openDocument === undefined ? undefined : (
        <DocBodyListScreen />
      );
    }
    const { lastFrame } = render(
      <AppStateProvider>
        <Harness />
      </AppStateProvider>,
    );
    const frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("DocBodyListScreen"),
    );
    expect(frame).toContain(
      "DocBodyListScreen requires an open doc document, found markdown.",
    );
  });
});
