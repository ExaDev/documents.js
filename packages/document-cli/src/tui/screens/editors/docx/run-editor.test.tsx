import { createDocx } from "documents.js";
import { render } from "ink-testing-library";
import { useEffect, type ReactElement } from "react";
import { describe, expect, it } from "vitest";
import {
  AppStateProvider,
  useAppDispatch,
  useAppState,
} from "../../../state/context.js";
import { settle, waitForFrame } from "../../../test-support.js";
import type { DocxOpenDocument } from "../../../state/types.js";
import { RunEditorScreen } from "./run-editor.js";

function buildDocxWithOneRun(): DocxOpenDocument {
  const editor = createDocx();
  editor.body.appendParagraph({ text: "original" });
  return { format: "docx", editor, path: undefined };
}

function Harness({
  doc,
}: {
  readonly doc: DocxOpenDocument;
}): ReactElement | undefined {
  const state = useAppState();
  const dispatch = useAppDispatch();
  useEffect(() => {
    dispatch({ type: "OPEN_FILE_SUCCESS", path: "notes.docx", doc });
    dispatch({
      type: "PUSH_SCREEN",
      screen: { kind: "runEditor", blockIndex: 0, runIndex: 0 },
    });
  }, [dispatch, doc]);
  return state.openDocument === undefined ? undefined : <RunEditorScreen />;
}

describe("RunEditorScreen", () => {
  it("commits the edited text and pops back on Enter", async () => {
    const doc = buildDocxWithOneRun();
    const { lastFrame, stdin } = render(
      <AppStateProvider>
        <Harness doc={doc} />
      </AppStateProvider>,
    );
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("Edit run"),
    );
    await settle();
    stdin.write("changed");
    await waitForFrame(lastFrame, (candidate) => candidate.includes("changed"));
    stdin.write("\r");
    await waitForFrame(
      lastFrame,
      (candidate) => !candidate.includes("Edit run"),
    );
    expect(doc.editor.paragraphs()[0]?.runs()[0]?.text).toBe("originalchanged");
  });

  it("discards the draft and pops back on Escape, leaving the run text untouched", async () => {
    const doc = buildDocxWithOneRun();
    const { lastFrame, stdin } = render(
      <AppStateProvider>
        <Harness doc={doc} />
      </AppStateProvider>,
    );
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("Edit run"),
    );
    await settle();
    stdin.write("more text");
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("more text"),
    );
    stdin.write("\x1B");
    await waitForFrame(
      lastFrame,
      (candidate) => !candidate.includes("Edit run"),
    );
    expect(doc.editor.paragraphs()[0]?.runs()[0]?.text).toBe("original");
  });
});
