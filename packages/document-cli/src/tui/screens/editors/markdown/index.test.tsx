import { createDocx } from "documents.js";
import { render } from "ink-testing-library";
import { useEffect, type ReactElement } from "react";
import { describe, expect, it } from "vitest";
import {
  AppStateProvider,
  useAppDispatch,
  useAppState,
} from "../../../state/context.js";
import { waitForFrame } from "../../../test-support.js";
import { MarkdownBodyListScreen } from "./index.js";

describe("MarkdownBodyListScreen", () => {
  it("reports itself and 'no open document' when nothing is open", () => {
    const { lastFrame } = render(
      <AppStateProvider>
        <MarkdownBodyListScreen />
      </AppStateProvider>,
    );
    expect(lastFrame()).toContain(
      "MarkdownBodyListScreen requires an open markdown document, found no open document.",
    );
  });

  it("names the actual mismatched format when a different one is open", async () => {
    function Harness(): ReactElement | undefined {
      const state = useAppState();
      const dispatch = useAppDispatch();
      useEffect(() => {
        dispatch({
          type: "OPEN_FILE_SUCCESS",
          path: "report.docx",
          doc: { format: "docx", editor: createDocx(), path: "report.docx" },
        });
      }, [dispatch]);
      return state.openDocument === undefined ? undefined : (
        <MarkdownBodyListScreen />
      );
    }
    const { lastFrame } = render(
      <AppStateProvider>
        <Harness />
      </AppStateProvider>,
    );
    const frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("MarkdownBodyListScreen"),
    );
    expect(frame).toContain(
      "MarkdownBodyListScreen requires an open markdown document, found docx.",
    );
  });
});
