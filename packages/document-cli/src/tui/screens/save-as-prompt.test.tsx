import { Box, Text } from "ink";
import { render } from "ink-testing-library";
import type { ReactElement } from "react";
import { Component, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveDocumentTo } from "../format/open-document.js";
import {
  AppStateProvider,
  useAppDispatch,
  useAppState,
} from "../state/context.js";
import type { OpenDocument } from "../state/types.js";
import { settle, waitForFrame } from "../test-support.js";
import { NewDocumentPickerScreen } from "./new-document-picker.js";
import { SaveAsPromptScreen } from "./save-as-prompt.js";

// Catches a render-phase throw (SaveAsPromptScreen's own defensive "should be unreachable" check, exercised deliberately below) so it surfaces as an observable frame instead of an unhandled error killing the whole ink-testing-library render.
class CaughtError extends Component<
  { readonly children: ReactNode },
  { readonly message: string | undefined }
> {
  constructor(props: { readonly children: ReactNode }) {
    super(props);
    this.state = { message: undefined };
  }

  static getDerivedStateFromError(error: unknown): { message: string } {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  override render(): ReactNode {
    if (this.state.message !== undefined) {
      return <Text>caughtError:{this.state.message}</Text>;
    }
    return this.props.children;
  }
}

// A type guard against the already-imported binding's own real type, not an inline `import(...)` type query -- mirrors export-options.test.tsx's own isExportPdfModule for the identical reason (avoids a project-wide consistent-type-imports exception for this one file, and is a genuine runtime check besides).
function isOpenDocumentModule(
  value: unknown,
): value is { saveDocumentTo: typeof saveDocumentTo } {
  return (
    typeof value === "object" && value !== null && "saveDocumentTo" in value
  );
}

vi.mock("../format/open-document.js", async (importOriginal) => {
  const actual = await importOriginal();
  if (!isOpenDocumentModule(actual)) {
    throw new Error(
      "../format/open-document.js mock: importOriginal() returned an unexpected shape",
    );
  }
  return { ...actual, saveDocumentTo: vi.fn(() => Promise.resolve()) };
});

const CWD = "/work/docs";

// Mirrors the app shell's own Ctrl+S/:saveas handler: pushes the real SAVE_AS_REQUEST transition exactly once a document exists, so `state.stack` genuinely grows by one saveAsPrompt entry the way it does in the real app -- POP_SCREEN is a no-op at stack length 1 (see reducer.ts), so asserting a cancel/save actually pops requires a real prior push, not just rendering SaveAsPromptScreen standalone. A `useRef` guard rather than a reactive "push if not already there" effect: once the screen under test itself dispatches POP_SCREEN, the stack top reverts to non-saveAsPrompt, which would otherwise make a reactive effect fire a second, unwanted SAVE_AS_REQUEST and mask every pop this suite exists to observe.
function Harness(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const document = state.openDocument;
  const onSaveAsPrompt = state.stack.at(-1)?.kind === "saveAsPrompt";
  const requested = useRef(false);

  useEffect(() => {
    if (document !== undefined && !requested.current) {
      requested.current = true;
      dispatch({ type: "SAVE_AS_REQUEST" });
    }
  }, [document, dispatch]);

  return (
    <Box flexDirection="column">
      {document === undefined ? (
        <NewDocumentPickerScreen />
      ) : onSaveAsPrompt ? (
        <SaveAsPromptScreen />
      ) : (
        <Text>pushing saveAsPrompt...</Text>
      )}
      <Text>stackLen:{state.stack.length}</Text>
      <Text>
        status:
        {state.status === undefined
          ? "none"
          : `${state.status.severity}:${state.status.text}`}
      </Text>
    </Box>
  );
}

function stackLenOf(frame: string | undefined): number {
  const match = /stackLen:(\d+)/.exec(frame ?? "");
  if (match?.[1] === undefined) {
    throw new Error(
      `No stackLen: marker found in frame:\n${frame ?? "(none)"}`,
    );
  }
  return Number(match[1]);
}

async function renderOnSaveAsPrompt(): Promise<ReturnType<typeof render>> {
  const rendered = render(
    <AppStateProvider cwd={CWD}>
      <Harness />
    </AppStateProvider>,
  );
  // Selects the first creatable format (docx), which has no path yet.
  rendered.stdin.write("\r");
  await waitForFrame(rendered.lastFrame, (frame) => frame.includes("Save as"));
  // SaveAsPromptScreen mounted via an effect-driven conditional swap (NewDocumentPickerScreen -> SaveAsPromptScreen) -- per test-support.ts's own settle() doc comment, its useInput listener is not guaranteed attached the instant its text appears, so a stdin.write() sent immediately after this point can be silently dropped.
  await settle();
  return rendered;
}

describe("SaveAsPromptScreen", () => {
  beforeEach(() => {
    vi.mocked(saveDocumentTo).mockClear();
  });

  it("shows a message and nothing else when there is no open document", () => {
    const { lastFrame } = render(
      <AppStateProvider cwd={CWD}>
        <SaveAsPromptScreen />
      </AppStateProvider>,
    );
    expect(lastFrame()).toContain("There is no open document to save.");
    expect(lastFrame()).not.toContain("Save as");
  });

  it("pre-fills the destination with untitled.<ext> in cwd for a freshly created document with no path", async () => {
    const rendered = await renderOnSaveAsPrompt();
    expect(rendered.lastFrame()).toContain(`${CWD}/untitled.docx`);
  });

  it("dispatches SAVE_SUCCESS and pops the screen when the save succeeds", async () => {
    vi.mocked(saveDocumentTo).mockResolvedValueOnce(undefined);
    const rendered = await renderOnSaveAsPrompt();
    const stackLenBefore = stackLenOf(rendered.lastFrame());

    rendered.stdin.write("\r");

    // Waits for BOTH the status update AND the stack pop together: onSubmit's handler dispatches SAVE_SUCCESS and, once that resolves, a separate POP_SCREEN -- two renders, not one -- so a predicate that only checks the status text can resolve on the first render, before the second dispatch's pop has actually committed.
    await vi.waitFor(() => {
      expect(rendered.lastFrame()).toMatch(/status:info:Saved/);
      expect(stackLenOf(rendered.lastFrame())).toBe(stackLenBefore - 1);
    });
    expect(vi.mocked(saveDocumentTo)).toHaveBeenCalledTimes(1);
  });

  it("saves to the path built from what the user typed, appended after the pre-filled default", async () => {
    vi.mocked(saveDocumentTo).mockResolvedValueOnce(undefined);
    const rendered = await renderOnSaveAsPrompt();

    // Appends rather than clearing first: ink-text-input's own backspace/cursor handling is exercised by text-field.test.ts, not re-tested here -- this only needs to prove the destination field's live value (not some other value) is what reaches saveDocumentTo.
    rendered.stdin.write("-v2");
    await vi.waitFor(() => {
      expect(rendered.lastFrame()).toContain(`${CWD}/untitled.docx-v2`);
    });
    rendered.stdin.write("\r");

    await vi.waitFor(() => {
      expect(vi.mocked(saveDocumentTo)).toHaveBeenCalledTimes(1);
    });
    expect(vi.mocked(saveDocumentTo).mock.calls[0]?.[1]).toBe(
      `${CWD}/untitled.docx-v2`,
    );
  });

  it("surfaces a SAVE_ERROR status and leaves the screen open (does not pop) when the save fails", async () => {
    vi.mocked(saveDocumentTo).mockRejectedValueOnce(new Error("disk full"));
    const rendered = await renderOnSaveAsPrompt();
    const stackLenBefore = stackLenOf(rendered.lastFrame());

    rendered.stdin.write("\r");

    await vi.waitFor(() => {
      expect(rendered.lastFrame()).toMatch(
        /status:error:Could not save .*disk full/,
      );
    });
    expect(rendered.lastFrame()).toContain("Save as");
    expect(stackLenOf(rendered.lastFrame())).toBe(stackLenBefore);
  });

  it("pops the screen on Escape without calling saveDocumentTo", async () => {
    const rendered = await renderOnSaveAsPrompt();
    const stackLenBefore = stackLenOf(rendered.lastFrame());

    rendered.stdin.write("");

    await vi.waitFor(() => {
      expect(stackLenOf(rendered.lastFrame())).toBe(stackLenBefore - 1);
    });
    expect(vi.mocked(saveDocumentTo)).not.toHaveBeenCalled();
  });

  it("throws its own exact invariant-violation message for a document with no path that isn't writable (a state the OpenDocument type itself guarantees can't happen)", async () => {
    // Deliberately bypasses OpenDocument's own type guarantee (every non-writable variant -- OdbOpenDocument, XlsxOpenDocument, etc -- requires path: string) to prove defaultDestinationFor's defensive check actually fires when that invariant is violated, the same way a real bug in a future OpenDocument variant might violate it. Cast is unavoidable here: there is no way to construct this object through OpenDocument's own real type.
    const impossibleDocument = {
      format: "odb",
      path: undefined,
      tables: [],
      forms: [],
      reports: [],
    } as unknown as OpenDocument;

    function BadDocHarness(): ReactElement {
      const state = useAppState();
      const dispatch = useAppDispatch();
      const requested = useRef(false);
      useEffect(() => {
        if (!requested.current) {
          requested.current = true;
          dispatch({
            type: "OPEN_FILE_SUCCESS",
            path: "unused",
            doc: impossibleDocument,
          });
        }
      }, [dispatch]);
      if (state.openDocument === undefined) {
        return <Text>loading...</Text>;
      }
      return <SaveAsPromptScreen />;
    }

    const rendered = render(
      <AppStateProvider cwd={CWD}>
        <CaughtError>
          <BadDocHarness />
        </CaughtError>
      </AppStateProvider>,
    );

    await waitForFrame(rendered.lastFrame, (frame) =>
      frame.startsWith("caughtError:"),
    );
    expect(rendered.lastFrame()).toContain(
      "A document with no path is always a WritableOpenDocument",
    );
  });
});
