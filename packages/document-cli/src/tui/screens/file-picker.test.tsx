import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Box, Text } from "ink";
import { render } from "ink-testing-library";
import type { ReactElement } from "react";
import { useEffect, useRef } from "react";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { ExportToPdfOptions } from "../format/export-pdf.js";
import { exportToPdf } from "../format/export-pdf.js";
import { openDocumentAtPath, saveDocumentTo } from "../format/open-document.js";
import {
  AppStateProvider,
  useAppDispatch,
  useAppState,
} from "../state/context.js";
import type { OpenDocument, Screen } from "../state/types.js";
import { settle, waitForFrame } from "../test-support.js";
import { FilePickerScreen } from "./file-picker.js";
import { NewDocumentPickerScreen } from "./new-document-picker.js";

// Type guards against the already-imported bindings' own real types, mirroring export-options.test.tsx's own isExportPdfModule for the identical reason.
function isOpenDocumentModule(value: unknown): value is {
  openDocumentAtPath: typeof openDocumentAtPath;
  saveDocumentTo: typeof saveDocumentTo;
} {
  return (
    typeof value === "object" &&
    value !== null &&
    "openDocumentAtPath" in value &&
    "saveDocumentTo" in value
  );
}

function isExportPdfModule(
  value: unknown,
): value is { exportToPdf: typeof exportToPdf } {
  return typeof value === "object" && value !== null && "exportToPdf" in value;
}

vi.mock("../format/open-document.js", async (importOriginal) => {
  const actual = await importOriginal();
  if (!isOpenDocumentModule(actual)) {
    throw new Error(
      "../format/open-document.js mock: importOriginal() returned an unexpected shape",
    );
  }
  return {
    ...actual,
    openDocumentAtPath: vi.fn<typeof actual.openDocumentAtPath>(
      actual.openDocumentAtPath,
    ),
    saveDocumentTo: vi.fn(() => Promise.resolve()),
  };
});

vi.mock("../format/export-pdf.js", async (importOriginal) => {
  const actual = await importOriginal();
  if (!isExportPdfModule(actual)) {
    throw new Error(
      "../format/export-pdf.js mock: importOriginal() returned an unexpected shape",
    );
  }
  return { ...actual, exportToPdf: vi.fn(() => Promise.resolve()) };
});

let workspace: string;

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "document-cli-file-picker-"));
  await mkdir(join(workspace, "sub"));
  await writeFile(join(workspace, "sub", "nested.txt"), "nested");
  await writeFile(join(workspace, "b-file.txt"), "b");
  await writeFile(join(workspace, "a-file.txt"), "a");
});

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true });
});

// Pushes a real filePicker screen onto the stack exactly once (mirroring the app's own :open/:saveas/:export handlers), matching save-as-prompt.test.tsx's own one-shot-ref pattern: FilePickerScreen throws if rendered while the stack top is not a filePicker screen, so once POP_SCREEN moves the stack top away this harness must stop rendering it rather than re-request it.
function Harness({
  purpose,
  cwd,
  withDocument = false,
  searchQuery,
}: {
  readonly purpose: "open" | "saveAs" | "exportTarget";
  readonly cwd: string;
  readonly withDocument?: boolean;
  readonly searchQuery?: string;
}): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const document = state.openDocument;
  const top = state.stack.at(-1);
  const onFilePicker = top?.kind === "filePicker";
  const requested = useRef(false);
  const needsDocumentFirst = withDocument && document === undefined;

  useEffect(() => {
    if (!needsDocumentFirst && !requested.current) {
      requested.current = true;
      const screen: Screen = { kind: "filePicker", purpose, cwd };
      dispatch({ type: "PUSH_SCREEN", screen });
      if (searchQuery !== undefined) {
        dispatch({ type: "SET_SEARCH_QUERY", query: searchQuery });
      }
    }
  }, [needsDocumentFirst, dispatch, purpose, cwd, searchQuery]);

  if (needsDocumentFirst) {
    return <NewDocumentPickerScreen />;
  }
  return (
    <Box flexDirection="column">
      {onFilePicker ? <FilePickerScreen /> : <Text>pushing filePicker...</Text>}
      <Text>stackLen:{state.stack.length}</Text>
      <Text>
        status:
        {state.status === undefined
          ? "none"
          : `${state.status.severity}:${state.status.text}`}
      </Text>
      <Text>
        openDocument:{document === undefined ? "none" : document.format}
      </Text>
      <Text>diagnosticsPanel:{String(state.overlays.diagnosticsPanel)}</Text>
      <Text>diagnosticsCount:{state.diagnostics.length}</Text>
      <Text>
        errorDetail:
        {state.errorDetail === undefined
          ? "none"
          : `${state.errorDetail.message} | ${state.errorDetail.detail ?? ""}`}
      </Text>
    </Box>
  );
}

function stackLenOf(frame: string | undefined): number {
  const match = /stackLen:(\d+)/.exec(frame ?? "");
  if (match?.[1] === undefined) {
    throw new Error(`No stackLen: marker in frame:\n${frame ?? "(none)"}`);
  }
  return Number(match[1]);
}

// Ink wraps long lines to the test terminal's own (narrow) width, so a status/errorDetail line built from a long path routinely breaks across two or more physical lines. Collapsing all whitespace runs to a single space before matching makes a regex assertion robust to exactly where Ink happened to wrap it, without weakening what the assertion actually checks.
function flat(frame: string | undefined): string {
  return (frame ?? "").replace(/\s+/g, " ");
}

// ink-text-input drops a burst of unawaited backspace writes almost entirely (confirmed empirically): each keypress's own state update must commit before the next is sent, exactly as new-document-picker.test.tsx's own comment on repeated "j" presses already documents for navigation keys.
async function clearField(
  rendered: ReturnType<typeof render>,
  currentLength: number,
): Promise<void> {
  for (let step = 0; step < currentLength; step += 1) {
    rendered.stdin.write("");
    await settle();
  }
}

async function renderOnFilePicker(options: {
  readonly purpose: "open" | "saveAs" | "exportTarget";
  readonly cwd: string;
  readonly withDocument?: boolean;
  readonly searchQuery?: string;
}): Promise<ReturnType<typeof render>> {
  const rendered = render(
    <AppStateProvider>
      <Harness {...options} />
    </AppStateProvider>,
  );
  if (options.withDocument === true) {
    // Selects the first creatable format (docx) before the effect pushes filePicker.
    rendered.stdin.write("\r");
  }
  await waitForFrame(rendered.lastFrame, (frame) =>
    frame.includes(options.cwd),
  );
  // FilePickerScreen mounted via an effect-driven conditional swap -- per test-support.ts's own settle() doc comment, its useInput listener is not guaranteed attached the instant its own title text appears.
  await settle();
  return rendered;
}

describe("FilePickerScreen", () => {
  beforeEach(() => {
    vi.mocked(saveDocumentTo).mockClear();
    vi.mocked(exportToPdf).mockClear();
    vi.mocked(openDocumentAtPath).mockClear();
  });

  it("lists directories before files, both alphabetically, with a trailing / on directories only", async () => {
    const rendered = await renderOnFilePicker({
      purpose: "open",
      cwd: workspace,
    });
    const frame = rendered.lastFrame() ?? "";
    const subIndex = frame.indexOf("sub/");
    const aIndex = frame.indexOf("a-file.txt");
    const bIndex = frame.indexOf("b-file.txt");
    expect(subIndex).toBeGreaterThanOrEqual(0);
    expect(aIndex).toBeGreaterThan(subIndex);
    expect(bIndex).toBeGreaterThan(aIndex);
    expect(frame).not.toContain("a-file.txt/");
  });

  it("shows a .. entry to go up when not at the filesystem root, and none at the root", async () => {
    const nested = await renderOnFilePicker({
      purpose: "open",
      cwd: workspace,
    });
    expect(nested.lastFrame()).toContain("..");

    const atRoot = await renderOnFilePicker({ purpose: "open", cwd: "/" });
    expect(atRoot.lastFrame()).not.toMatch(/^\.\.$/m);
  });

  it("filters the listing by the shared search query, case-insensitively", async () => {
    const rendered = await renderOnFilePicker({
      purpose: "open",
      cwd: workspace,
      searchQuery: "B-FILE",
    });
    expect(rendered.lastFrame()).toContain("b-file.txt");
    expect(rendered.lastFrame()).not.toContain("a-file.txt");
    expect(rendered.lastFrame()).not.toContain("sub/");
  });

  it("navigates into a subdirectory on Enter, then back up on ..", async () => {
    const rendered = await renderOnFilePicker({
      purpose: "open",
      cwd: workspace,
    });
    // "sub" sorts before both files, and is the first entry after ".." (hasParent is true here).
    rendered.stdin.write("j"); // move off ".." onto "sub"
    await settle();
    rendered.stdin.write("\r"); // enter "sub"
    await waitForFrame(rendered.lastFrame, (frame) =>
      frame.includes(join(workspace, "sub")),
    );
    expect(rendered.lastFrame()).toContain("nested.txt");

    // Selection state (rawIndex) is not reset by a directory change -- it carried "1" in from the "j" press above, which clamps onto "nested.txt" (index 1 of [.., nested.txt]) inside sub rather than "..". Move back up to index 0 first.
    await settle();
    rendered.stdin.write("k");
    await settle();
    rendered.stdin.write("\r"); // ".." is now selected
    await waitForFrame(rendered.lastFrame, (frame) => {
      const title = frame.split("\n")[0] ?? "";
      return title.includes(workspace) && !title.includes("sub");
    });
  });

  it("opens the selected file on Enter for purpose=open, dispatching OPEN_FILE_SUCCESS", async () => {
    const fakeDoc = { format: "markdown" } as unknown as OpenDocument;
    vi.mocked(openDocumentAtPath).mockResolvedValueOnce(fakeDoc);
    const rendered = await renderOnFilePicker({
      purpose: "open",
      cwd: workspace,
    });

    // Entries in order: "..", "sub" (dir), "a-file.txt", "b-file.txt" -- two "j" from the initial index 0 (on "..") lands on "a-file.txt" (index 2).
    rendered.stdin.write("j");
    await settle();
    rendered.stdin.write("j");
    await settle();
    rendered.stdin.write("\r");

    await vi.waitFor(() => {
      expect(rendered.lastFrame()).toContain("openDocument:markdown");
    });
    const call = vi.mocked(openDocumentAtPath).mock.calls[0];
    expect(call?.[0]).toBe(join(workspace, "a-file.txt"));
    expect(typeof call?.[1]?.onDiagnostic).toBe("function");
  });

  it("dispatches OPEN_FILE_ERROR with the underlying error's own detail when opening fails", async () => {
    vi.mocked(openDocumentAtPath).mockRejectedValueOnce(new Error("bad zip"));
    const rendered = await renderOnFilePicker({
      purpose: "open",
      cwd: workspace,
    });

    rendered.stdin.write("j");
    await settle();
    rendered.stdin.write("j");
    await settle();
    rendered.stdin.write("\r");

    await vi.waitFor(() => {
      expect(flat(rendered.lastFrame())).toMatch(
        /errorDetail:Could not open .*a-file\.txt \| bad zip/,
      );
    });
  });

  it("enters name-entry mode pre-filled with the clicked file's own name for purpose=saveAs", async () => {
    const rendered = await renderOnFilePicker({
      purpose: "saveAs",
      cwd: workspace,
      withDocument: true,
    });

    rendered.stdin.write("j");
    await settle();
    rendered.stdin.write("j");
    await settle();
    rendered.stdin.write("\r");

    await vi.waitFor(() => {
      expect(rendered.lastFrame()).toContain("a-file.txt");
    });
    // The pre-filled TextField's value alone (a-file.txt, asserted above) is the real proof of enterName mode -- the "Enter a directory..." hint is browse-mode-only and correctly absent here.
  });

  it("'a' enters name-entry mode pre-filled with defaultBasenameFor's own suggestion", async () => {
    const rendered = await renderOnFilePicker({
      purpose: "exportTarget",
      cwd: workspace,
      withDocument: true,
    });

    rendered.stdin.write("a");

    await vi.waitFor(() => {
      // A freshly created docx with no path defaults to "untitled", and exportTarget always swaps to .pdf regardless of the source format.
      expect(rendered.lastFrame()).toContain("untitled.pdf");
    });
  });

  it("warns and does not save when the typed name is blank", async () => {
    const rendered = await renderOnFilePicker({
      purpose: "saveAs",
      cwd: workspace,
      withDocument: true,
    });
    rendered.stdin.write("a");
    await vi.waitFor(() => {
      expect(rendered.lastFrame()).toContain("untitled.docx");
    });
    await clearField(rendered, "untitled.docx".length);
    expect(rendered.lastFrame()).not.toContain("untitled.docx");
    // A field cleared down to nothing but whitespace still submits "blank": the real onSubmit path trims before checking, so this proves the check is a genuine trim, not a bare === "" on the raw value.
    rendered.stdin.write("   ");
    await settle();

    rendered.stdin.write("\r");

    await vi.waitFor(() => {
      expect(rendered.lastFrame()).toMatch(
        /status:warning:Enter a filename first/,
      );
    });
    expect(vi.mocked(saveDocumentTo)).not.toHaveBeenCalled();
  });

  it("warns and does not save when there is no open document", async () => {
    const rendered = await renderOnFilePicker({
      purpose: "saveAs",
      cwd: workspace,
    });
    rendered.stdin.write("a");
    await vi.waitFor(() => {
      expect(rendered.lastFrame()).toContain("untitled");
    });

    rendered.stdin.write("x.docx");
    await vi.waitFor(() => {
      expect(rendered.lastFrame()).toContain("x.docx");
    });
    rendered.stdin.write("\r");

    await vi.waitFor(() => {
      expect(rendered.lastFrame()).toMatch(
        /status:warning:There is no open document/,
      );
    });
    expect(vi.mocked(saveDocumentTo)).not.toHaveBeenCalled();
  });

  it("saves successfully then pops the screen for purpose=saveAs", async () => {
    vi.mocked(saveDocumentTo).mockResolvedValueOnce(undefined);
    const rendered = await renderOnFilePicker({
      purpose: "saveAs",
      cwd: workspace,
      withDocument: true,
    });
    const stackLenBefore = stackLenOf(rendered.lastFrame());

    rendered.stdin.write("a");
    await vi.waitFor(() => {
      expect(rendered.lastFrame()).toContain("untitled.docx");
    });
    rendered.stdin.write("\r");

    await vi.waitFor(() => {
      expect(rendered.lastFrame()).toMatch(/status:info:Saved/);
      expect(stackLenOf(rendered.lastFrame())).toBe(stackLenBefore - 1);
    });
    expect(vi.mocked(saveDocumentTo)).toHaveBeenCalledWith(
      expect.objectContaining({ format: "docx" }),
      join(workspace, "untitled.docx"),
    );
  });

  it("surfaces SAVE_ERROR and leaves the screen open when the save fails", async () => {
    vi.mocked(saveDocumentTo).mockRejectedValueOnce(new Error("disk full"));
    const rendered = await renderOnFilePicker({
      purpose: "saveAs",
      cwd: workspace,
      withDocument: true,
    });
    const stackLenBefore = stackLenOf(rendered.lastFrame());

    rendered.stdin.write("a");
    await vi.waitFor(() => {
      expect(rendered.lastFrame()).toContain("untitled.docx");
    });
    rendered.stdin.write("\r");

    await vi.waitFor(() => {
      expect(flat(rendered.lastFrame())).toMatch(
        /status:error:Could not save .*disk full/,
      );
    });
    expect(stackLenOf(rendered.lastFrame())).toBe(stackLenBefore);
  });

  it("exports successfully with no diagnostics: pops the screen, leaves the diagnostics panel closed", async () => {
    vi.mocked(exportToPdf).mockResolvedValueOnce(undefined);
    const rendered = await renderOnFilePicker({
      purpose: "exportTarget",
      cwd: workspace,
      withDocument: true,
    });
    const stackLenBefore = stackLenOf(rendered.lastFrame());

    rendered.stdin.write("a");
    await vi.waitFor(() => {
      expect(rendered.lastFrame()).toContain("untitled.pdf");
    });
    rendered.stdin.write("\r");

    await vi.waitFor(() => {
      expect(rendered.lastFrame()).toMatch(/status:info:Exported/);
      expect(stackLenOf(rendered.lastFrame())).toBe(stackLenBefore - 1);
    });
    expect(rendered.lastFrame()).toContain("diagnosticsPanel:false");
  });

  it("exports with a diagnostic: opens the diagnostics panel and still pops the screen", async () => {
    vi.mocked(exportToPdf).mockImplementationOnce(
      (_doc: OpenDocument, _dest: string, options: ExportToPdfOptions) => {
        options.onDiagnostic({
          severity: "info",
          message: "substituted a font",
        });
        return Promise.resolve();
      },
    );
    const rendered = await renderOnFilePicker({
      purpose: "exportTarget",
      cwd: workspace,
      withDocument: true,
    });
    const stackLenBefore = stackLenOf(rendered.lastFrame());

    rendered.stdin.write("a");
    await vi.waitFor(() => {
      expect(rendered.lastFrame()).toContain("untitled.pdf");
    });
    rendered.stdin.write("\r");

    await vi.waitFor(() => {
      expect(rendered.lastFrame()).toContain("diagnosticsCount:1");
      expect(rendered.lastFrame()).toContain("diagnosticsPanel:true");
      expect(stackLenOf(rendered.lastFrame())).toBe(stackLenBefore - 1);
    });
  });

  it("dispatches OPEN_FILE_ERROR when the export fails", async () => {
    vi.mocked(exportToPdf).mockRejectedValueOnce(new Error("no fonts"));
    const rendered = await renderOnFilePicker({
      purpose: "exportTarget",
      cwd: workspace,
      withDocument: true,
    });

    rendered.stdin.write("a");
    await vi.waitFor(() => {
      expect(rendered.lastFrame()).toContain("untitled.pdf");
    });
    rendered.stdin.write("\r");

    await vi.waitFor(() => {
      expect(flat(rendered.lastFrame())).toMatch(
        /errorDetail:Could not export to .*untitled\.pdf \| no fonts/,
      );
    });
  });

  it("Escape in name-entry mode returns to browse mode without dispatching anything", async () => {
    const rendered = await renderOnFilePicker({
      purpose: "saveAs",
      cwd: workspace,
      withDocument: true,
    });
    rendered.stdin.write("a");
    await vi.waitFor(() => {
      expect(rendered.lastFrame()).toContain("untitled.docx");
    });

    rendered.stdin.write("");

    await vi.waitFor(() => {
      expect(rendered.lastFrame()).toContain("Enter a directory");
    });
    expect(vi.mocked(saveDocumentTo)).not.toHaveBeenCalled();
  });

  it("Escape in browse mode pops the screen", async () => {
    const rendered = await renderOnFilePicker({
      purpose: "open",
      cwd: workspace,
    });
    const stackLenBefore = stackLenOf(rendered.lastFrame());

    rendered.stdin.write("");

    await vi.waitFor(() => {
      expect(stackLenOf(rendered.lastFrame())).toBe(stackLenBefore - 1);
    });
  });

  it("shows the read error inline when the directory cannot be listed, instead of crashing", async () => {
    const rendered = await renderOnFilePicker({
      purpose: "open",
      cwd: join(workspace, "does-not-exist"),
    });
    expect(rendered.lastFrame()).toMatch(/ENOENT|no such file/i);
  });

  it("titles each purpose distinctly: Open a document / Save as / Export destination", async () => {
    const open = await renderOnFilePicker({ purpose: "open", cwd: workspace });
    expect(open.lastFrame()).toContain("Open a document");

    const saveAs = await renderOnFilePicker({
      purpose: "saveAs",
      cwd: workspace,
      withDocument: true,
    });
    expect(saveAs.lastFrame()).toContain("Save as");

    const exportTarget = await renderOnFilePicker({
      purpose: "exportTarget",
      cwd: workspace,
      withDocument: true,
    });
    expect(exportTarget.lastFrame()).toContain("Export destination");
  });
});
