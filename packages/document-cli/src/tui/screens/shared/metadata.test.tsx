import { createDocx, createMarkdownEditor, openDocx } from "documents.js";
import { render } from "ink-testing-library";
import { useEffect, type ReactElement } from "react";
import { describe, expect, it } from "vitest";
import {
  AppStateProvider,
  useAppDispatch,
  useAppState,
} from "../../state/context.js";
import { currentScreen } from "../../state/types.js";
import { settle, waitForFrame } from "../../test-support.js";
import { MetadataScreen } from "./metadata.js";

const ENTER_KEY = "\r";
const ESCAPE_KEY = "\x1B";

function waitForText(
  lastFrame: () => string | undefined,
  text: string,
): Promise<string> {
  return waitForFrame(lastFrame, (frame) => frame.includes(text));
}

async function sendKey(
  stdin: { readonly write: (data: string) => void },
  key: string,
): Promise<void> {
  await settle();
  stdin.write(key);
}

function buildDocxWithTitleBytes(): Uint8Array<ArrayBuffer> {
  const editor = createDocx();
  editor.metadata = { title: "Original title", author: "Original author" };
  return editor.toBytes();
}

// Opens the test document AND pushes metadata for it in a single effect, matching list-editor.test.tsx's own OpenAtListEditor pattern.
function OpenAtMetadata({
  bytes,
}: {
  readonly bytes: Uint8Array<ArrayBuffer>;
}): ReactElement | undefined {
  const dispatch = useAppDispatch();
  useEffect(() => {
    dispatch({
      type: "OPEN_FILE_SUCCESS",
      path: "test.docx",
      doc: { format: "docx", editor: openDocx(bytes), path: "test.docx" },
    });
    dispatch({ type: "PUSH_SCREEN", screen: { kind: "metadata" } });
  }, [bytes, dispatch]);
  return undefined;
}

function OpenMarkdownAtMetadata(): ReactElement | undefined {
  const dispatch = useAppDispatch();
  useEffect(() => {
    dispatch({
      type: "OPEN_FILE_SUCCESS",
      path: "test.md",
      doc: {
        format: "markdown",
        editor: createMarkdownEditor(),
        originalText: undefined,
        path: "test.md",
      },
    });
    dispatch({ type: "PUSH_SCREEN", screen: { kind: "metadata" } });
  }, [dispatch]);
  return undefined;
}

function Harness({
  bytes,
}: {
  readonly bytes: Uint8Array<ArrayBuffer>;
}): ReactElement {
  const state = useAppState();
  if (state.openDocument === undefined) {
    return <OpenAtMetadata bytes={bytes} />;
  }
  const screen = currentScreen(state);
  if (screen.kind !== "metadata") {
    return <OpenAtMetadata bytes={bytes} />;
  }
  return <MetadataScreen />;
}

function MarkdownHarness(): ReactElement {
  const state = useAppState();
  if (state.openDocument === undefined) {
    return <OpenMarkdownAtMetadata />;
  }
  const screen = currentScreen(state);
  if (screen.kind !== "metadata") {
    return <OpenMarkdownAtMetadata />;
  }
  return <MetadataScreen />;
}

describe("MetadataScreen", () => {
  it("renders the document's real current metadata, not a placeholder", async () => {
    const { lastFrame } = render(
      <AppStateProvider>
        <Harness bytes={buildDocxWithTitleBytes()} />
      </AppStateProvider>,
    );
    const frame = await waitForText(lastFrame, "Original title");
    expect(frame).toContain("Original author");
  });

  it("commits a title edit through the live editor.metadata setter, reading back through the same live view", async () => {
    const { lastFrame, stdin } = render(
      <AppStateProvider>
        <Harness bytes={buildDocxWithTitleBytes()} />
      </AppStateProvider>,
    );
    await waitForText(lastFrame, "Original title");

    // title is the first row -- Enter opens it for editing, seeded with the current value.
    await sendKey(stdin, ENTER_KEY);
    await waitForText(lastFrame, "Editing title");
    stdin.write(" EDITED");
    await waitForText(lastFrame, "Original title EDITED");
    await sendKey(stdin, ENTER_KEY);

    const committed = await waitForText(lastFrame, "Original title EDITED");
    // Untouched fields survive the edit -- MetadataOverrides' own partial-merge semantics.
    expect(committed).toContain("Original author");
  });

  it("commits a keywords edit as a comma-split array, dropping blank entries", async () => {
    const { lastFrame, stdin } = render(
      <AppStateProvider>
        <Harness bytes={buildDocxWithTitleBytes()} />
      </AppStateProvider>,
    );
    await waitForText(lastFrame, "Original title");

    // keywords is the fourth row.
    await sendKey(stdin, "j");
    await sendKey(stdin, "j");
    await sendKey(stdin, "j");
    await sendKey(stdin, ENTER_KEY);
    await waitForText(lastFrame, "Editing keywords");
    stdin.write("alpha, beta,, gamma ,");
    await sendKey(stdin, ENTER_KEY);

    const committed = await waitForText(
      lastFrame,
      "keywords: alpha, beta, gamma",
    );
    expect(committed).not.toContain("keywords: alpha, beta,, gamma");
  });

  it("cancels the edit on Esc without committing a change", async () => {
    const { lastFrame, stdin } = render(
      <AppStateProvider>
        <Harness bytes={buildDocxWithTitleBytes()} />
      </AppStateProvider>,
    );
    await waitForText(lastFrame, "Original title");

    await sendKey(stdin, ENTER_KEY);
    await waitForText(lastFrame, "Editing title");
    stdin.write("should not be committed");
    await waitForText(lastFrame, "should not be committed");

    await sendKey(stdin, ESCAPE_KEY);
    const frame = await waitForText(lastFrame, "Edit a field");
    expect(frame).toContain("Original title");
    expect(frame).not.toContain("should not be committed");
  });

  it("shows markdown's own current metadata read-only, with no field list to edit through", async () => {
    const { lastFrame } = render(
      <AppStateProvider>
        <MarkdownHarness />
      </AppStateProvider>,
    );
    const frame = await waitForText(lastFrame, "read-only");
    expect(frame).not.toContain("Edit a field");
  });
});
