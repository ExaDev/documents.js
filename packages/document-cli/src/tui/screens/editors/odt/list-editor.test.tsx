import { createOdt, openOdt } from "documents.js";
import { render } from "ink-testing-library";
import { useEffect, type ReactElement } from "react";
import { describe, expect, it } from "vitest";
import {
  AppStateProvider,
  useAppDispatch,
  useAppState,
} from "../../../state/context.js";
import { currentScreen } from "../../../state/types.js";
import { settle, waitForFrame } from "../../../test-support.js";
import { ListEditorScreen } from "./list-editor.js";

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

function buildThreeItemListBytes(): Uint8Array<ArrayBuffer> {
  const editor = createOdt();
  const list = editor.body.appendList();
  list.addItem().appendParagraph({ text: "first item" });
  list.addItem().appendParagraph({ text: "second item" });
  list.addItem().appendParagraph({ text: "third item" });
  return editor.toBytes();
}

// Opens the test document AND pushes listEditor for its one list in a single effect, matching pptx/shape-editor.test.tsx's own OpenAtShapeEditor pattern.
function OpenAtListEditor({
  bytes,
}: {
  readonly bytes: Uint8Array<ArrayBuffer>;
}): ReactElement | undefined {
  const dispatch = useAppDispatch();
  useEffect(() => {
    dispatch({
      type: "OPEN_FILE_SUCCESS",
      path: "test.odt",
      doc: { format: "odt", editor: openOdt(bytes), path: "test.odt" },
    });
    dispatch({
      type: "PUSH_SCREEN",
      screen: { kind: "listEditor", blockIndex: 0 },
    });
  }, [bytes, dispatch]);
  return undefined;
}

function Harness({
  bytes,
}: {
  readonly bytes: Uint8Array<ArrayBuffer>;
}): ReactElement {
  const state = useAppState();
  if (state.openDocument === undefined) {
    return <OpenAtListEditor bytes={bytes} />;
  }
  const screen = currentScreen(state);
  if (screen.kind !== "listEditor") {
    return <OpenAtListEditor bytes={bytes} />;
  }
  return <ListEditorScreen />;
}

function renderListEditor(
  bytes: Uint8Array<ArrayBuffer>,
): ReturnType<typeof render> {
  return render(
    <AppStateProvider>
      <Harness bytes={bytes} />
    </AppStateProvider>,
  );
}

describe("ListEditorScreen", () => {
  it("renders each real item's own text, not a placeholder", async () => {
    const { lastFrame } = renderListEditor(buildThreeItemListBytes());
    const frame = await waitForText(lastFrame, "List 0");
    expect(frame).toContain("first item");
    expect(frame).not.toContain("item content is not readable");
  });

  // ink-testing-library's Stdout mock renders with no TTY, so a selected row's own inverse/colour styling never reaches `lastFrame()` as a visible difference -- the cursor's real position is asserted behaviourally instead, via which item Enter opens at each position, exactly what the reducer/UI actually need the cursor for.
  it("moves the selection cursor down and up through the items with j/k", async () => {
    const { lastFrame, stdin } = renderListEditor(buildThreeItemListBytes());
    await waitForText(lastFrame, "first item");

    await sendKey(stdin, "j");
    await sendKey(stdin, "j");
    await sendKey(stdin, ENTER_KEY);
    const atThird = await waitForText(lastFrame, "List 0, item 3");
    expect(atThird).toContain("third item");

    await sendKey(stdin, ESCAPE_KEY);
    await waitForText(lastFrame, "List 0 (3 items)");
    await sendKey(stdin, "k");
    await sendKey(stdin, ENTER_KEY);
    const atSecond = await waitForText(lastFrame, "List 0, item 2");
    expect(atSecond).toContain("second item");
  });

  it("opens the run text editor on Enter, seeded with the selected item's real text, and commits SET_LIST_ITEM_TEXT", async () => {
    const { lastFrame, stdin } = renderListEditor(buildThreeItemListBytes());
    await waitForText(lastFrame, "first item");

    // Move to the second item, then edit it.
    await sendKey(stdin, "j");
    await sendKey(stdin, ENTER_KEY);
    const editing = await waitForText(lastFrame, "List 0, item 2");
    expect(editing).toContain("second item");

    // RunTextEditor's own TextField seeds `value` with the item's current text and positions the cursor at its end -- typed characters append.
    stdin.write(", EDITED");
    await waitForText(lastFrame, "second item, EDITED");
    await sendKey(stdin, ENTER_KEY);

    const committed = await waitForText(lastFrame, "second item, EDITED");
    expect(committed).toContain("first item");
    expect(committed).toContain("third item");
  });

  it("cancels the edit on Esc without committing a change", async () => {
    const { lastFrame, stdin } = renderListEditor(buildThreeItemListBytes());
    await waitForText(lastFrame, "first item");

    await sendKey(stdin, ENTER_KEY);
    await waitForText(lastFrame, "List 0, item 1");
    stdin.write("should not be committed");
    await waitForText(lastFrame, "should not be committed");

    await sendKey(stdin, ESCAPE_KEY);
    const frame = await waitForText(lastFrame, "List 0 (3 items)");
    expect(frame).toContain("first item");
    expect(frame).not.toContain("should not be committed");
  });
});
