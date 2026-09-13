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
import { OdtBodyListScreen } from "./index.js";

describe("OdtBodyListScreen", () => {
  it("reports itself and 'no open document' when nothing is open", () => {
    const { lastFrame } = render(
      <AppStateProvider>
        <OdtBodyListScreen />
      </AppStateProvider>,
    );
    expect(lastFrame()).toContain(
      "OdtBodyListScreen requires an open odt document, found no open document.",
    );
  });

  it("names the actual mismatched format when a different one is open", async () => {
    function Harness(): ReactElement {
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
        <OdtBodyListScreen />
      );
    }
    const { lastFrame } = render(
      <AppStateProvider>
        <Harness />
      </AppStateProvider>,
    );
    const frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("OdtBodyListScreen"),
    );
    expect(frame).toContain(
      "OdtBodyListScreen requires an open odt document, found markdown.",
    );
  });
});
