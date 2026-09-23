import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Box, Text } from "ink";
import { render } from "ink-testing-library";
import { useEffect, useRef, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exportToPdf } from "../format/export-pdf.js";
import { openDocumentAtPath, saveDocumentTo } from "../format/open-document.js";
import {
  AppStateProvider,
  useAppDispatch,
  useAppState,
} from "../state/context.js";
import { currentScreen, type OpenDocument } from "../state/types.js";
import { flattenFrame, settle, waitForFrame } from "../test-support.js";
import { FilePickerScreen } from "./file-picker.js";

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

vi.mock("../format/open-document.js", async (importOriginal) => {
  const actual = await importOriginal();
  if (!isOpenDocumentModule(actual)) {
    throw new Error(
      "../format/open-document.js mock: importOriginal() returned an unexpected shape",
    );
  }
  return {
    ...actual,
    openDocumentAtPath: vi.fn(actual.openDocumentAtPath),
    saveDocumentTo: vi.fn(actual.saveDocumentTo),
  };
});

function isExportPdfModule(value: unknown): value is {
  exportToPdf: typeof exportToPdf;
} {
  return typeof value === "object" && value !== null && "exportToPdf" in value;
}

vi.mock("../format/export-pdf.js", async (importOriginal) => {
  const actual = await importOriginal();
  if (!isExportPdfModule(actual)) {
    throw new Error(
      "../format/export-pdf.js mock: importOriginal() returned an unexpected shape",
    );
  }
  return { ...actual, exportToPdf: vi.fn(actual.exportToPdf) };
});

// A fixed fixture directory tree, rebuilt fresh for every test: "bDir" before "sub" alphabetically among directories, "aFile.md" before "zFile.md" alphabetically among files — the fixture is deliberately shaped to prove sort order (directories before files, each group alphabetical), not merely to list something.
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "file-picker-test-"));
  mkdirSync(join(root, "sub"));
  mkdirSync(join(root, "bDir"));
  writeFileSync(join(root, "sub", "inner.md"), "# inner\n");
  writeFileSync(join(root, "aFile.md"), "# a\n");
  writeFileSync(join(root, "zFile.md"), "# z\n");
});

afterEach(() => {
  vi.mocked(openDocumentAtPath).mockReset();
  vi.mocked(saveDocumentTo).mockReset();
  vi.mocked(exportToPdf).mockReset();
});

// A minimal OpenDocument test double for the 'open' happy-path tests, where only .format/.path are ever read by the code under test (file-picker.tsx never touches .editor for a document it has just received from openDocumentAtPath). The cast is a deliberate, justified test fixture, not a production narrowing: constructing a genuinely valid MarkdownEditor here would exercise documents.js's real editor construction for no assertion this suite makes.
function fakeOpenDocument(): OpenDocument {
  return {
    format: "markdown",
    editor: { toMarkdownText: () => "# hi\n" },
    originalText: "# hi\n",
    path: "/tmp/opened.md",
  } as unknown as OpenDocument;
}

// Mirrors app.tsx's own router narrowly, since AppStateProvider exposes no way to seed initial state directly: optionally creates a markdown document first (so purposes that need `state.openDocument` have one), pushes a filePicker screen for the given purpose/cwd once the stack is ready, optionally seeds a search query once the picker has mounted, and renders FilePickerScreen only while it is genuinely the top of the stack — exactly what stops the invariant throw once a dispatch (OPEN_FILE_SUCCESS, POP_SCREEN) replaces or pops it off the stack.
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
  const top = currentScreen(state);
  const openFormat = state.openDocument?.format;
  // Guards the PUSH_SCREEN dispatch below to fire exactly once per mount: every test's own later interaction (Escape, a successful save/export/open) pops or replaces the pushed filePicker screen deliberately, and this harness must never re-push it once that has happened.
  const hasPushedFilePicker = useRef(false);

  useEffect(() => {
    if (withDocument && openFormat === undefined) {
      dispatch({ type: "CREATE_DOCUMENT", format: "markdown" });
      return;
    }
    if (
      !hasPushedFilePicker.current &&
      top.kind !== "filePicker" &&
      (!withDocument || openFormat !== undefined)
    ) {
      hasPushedFilePicker.current = true;
      dispatch({
        type: "PUSH_SCREEN",
        screen: { kind: "filePicker", purpose, cwd },
      });
      return;
    }
    if (
      searchQuery !== undefined &&
      top.kind === "filePicker" &&
      state.searchQuery !== searchQuery
    ) {
      dispatch({ type: "SET_SEARCH_QUERY", query: searchQuery });
    }
  }, [
    withDocument,
    openFormat,
    top.kind,
    purpose,
    cwd,
    searchQuery,
    state.searchQuery,
    dispatch,
  ]);

  return (
    <Box flexDirection="column">
      {top.kind === "filePicker" ? <FilePickerScreen /> : <Text>closed</Text>}
      <Text>screen:{top.kind}</Text>
      <Text>
        openFormat:
        {state.openDocument === undefined ? "none" : state.openDocument.format}
      </Text>
      <Text>
        status:
        {state.status === undefined
          ? "none"
          : `${state.status.severity}:${state.status.text}`}
      </Text>
      <Text>
        error:
        {state.errorDetail === undefined ? "none" : state.errorDetail.message}
      </Text>
      <Text>
        diagnosticsPanelOpen:{String(state.overlays.diagnosticsPanel)}
      </Text>
    </Box>
  );
}

function renderPicker(
  purpose: "open" | "saveAs" | "exportTarget",
  cwd: string,
  options: {
    readonly withDocument?: boolean;
    readonly searchQuery?: string;
  } = {},
): ReturnType<typeof render> {
  return render(
    <AppStateProvider>
      <Harness purpose={purpose} cwd={cwd} {...options} />
    </AppStateProvider>,
  );
}

// Every predicate/assertion in this suite reads the flattened frame: a long probe line (an absolute path under a system temp directory routinely exceeds the 100-column stub width) can genuinely word-wrap mid-string, splitting a literal substring an assertion expects intact — see flattenFrame's own doc comment.
async function waitForFlatFrame(
  rendered: ReturnType<typeof render>,
  predicate: (frame: string) => boolean,
): Promise<string> {
  return waitForFrame(() => flattenFrame(rendered.lastFrame()), predicate);
}

// Sends `count` down-arrow presses one at a time, settling between each: batching several keys into a single stdin.write() call has been observed to lose presses (ink's own keypress parsing does not reliably split a multi-byte chunk with no escape prefix into one event per byte), and even one key per call still needs its own settle() before the next, since a keypress's own selectedIndex update is only guaranteed visible to the following one once its render has committed.
async function pressDown(
  rendered: ReturnType<typeof render>,
  count: number,
): Promise<void> {
  for (let step = 0; step < count; step += 1) {
    rendered.stdin.write("j");
    await settle();
  }
}

// FilePickerScreen only mounts once this harness's own effect-driven PUSH_SCREEN swaps it in for the placeholder "closed" text — exactly the effect-swap race test-support.ts's settle() doc comment describes, where a screen's own useInput listener is not guaranteed attached the instant its text first appears. Every caller settles here, once, before its first stdin.write.
async function waitForBrowseMode(
  rendered: ReturnType<typeof render>,
): Promise<string> {
  const frame = await waitForFlatFrame(rendered, (candidate) =>
    candidate.includes("screen:filePicker"),
  );
  await settle();
  return frame;
}

describe("FilePickerScreen", () => {
  it.each([
    ["open", "Open a document"],
    ["saveAs", "Save as"],
    ["exportTarget", "Export destination"],
  ] as const)(
    "shows the %s title alongside the current directory",
    async (purpose, title) => {
      const rendered = renderPicker(purpose, root);
      const frame = await waitForBrowseMode(rendered);
      expect(frame).toContain(`${title} — ${root}`);
    },
  );

  it("lists directories before files, each group sorted alphabetically, with a parent entry first", async () => {
    const rendered = renderPicker("open", root);
    const frame = await waitForBrowseMode(rendered);

    const parentIndex = frame.indexOf("../");
    const bDirIndex = frame.indexOf("bDir/");
    const subIndex = frame.indexOf("sub/");
    const aFileIndex = frame.indexOf("aFile.md");
    const zFileIndex = frame.indexOf("zFile.md");

    expect(parentIndex).toBeGreaterThanOrEqual(0);
    expect(parentIndex).toBeLessThan(bDirIndex);
    expect(bDirIndex).toBeLessThan(subIndex);
    expect(subIndex).toBeLessThan(aFileIndex);
    expect(aFileIndex).toBeLessThan(zFileIndex);
  });

  it("shows no parent entry at the filesystem root, where dirname equals the directory itself", async () => {
    const rendered = renderPicker("open", "/");
    const frame = await waitForBrowseMode(rendered);
    expect(frame).not.toContain("..");
  });

  it("shows the read-error text inline instead of a listing when the directory cannot be read", async () => {
    const filePath = join(root, "aFile.md");
    const rendered = renderPicker("open", filePath);
    const frame = await waitForFlatFrame(
      rendered,
      (candidate) =>
        candidate.includes("ENOTDIR") || candidate.includes("ENOENT"),
    );
    expect(frame).toMatch(/ENOTDIR|ENOENT/);
  });

  it("filters the listing by the search query, case-insensitively, against both directories and files", async () => {
    const rendered = renderPicker("open", root, { searchQuery: "bdir" });
    // waitForBrowseMode's own predicate only proves the filePicker screen mounted, not that this harness's separate, later SET_SEARCH_QUERY effect dispatch has already applied — wait on the filtered result itself instead.
    const frame = await waitForFlatFrame(
      rendered,
      (candidate) =>
        candidate.includes("screen:filePicker") && !candidate.includes("sub/"),
    );
    expect(frame).toContain("bDir/");
    expect(frame).not.toContain("sub/");
    expect(frame).not.toContain("aFile.md");
    expect(frame).not.toContain("zFile.md");
  });

  it("navigates into a selected directory and back out via the parent entry", async () => {
    const rendered = renderPicker("open", root);
    await waitForBrowseMode(rendered);

    // Row order is: ../, bDir/, sub/, aFile.md, zFile.md — one down-then-select reaches bDir/.
    await pressDown(rendered, 1);
    rendered.stdin.write("\r");
    let frame = await waitForFlatFrame(rendered, (candidate) =>
      candidate.includes(join(root, "bDir")),
    );
    expect(frame).toContain(`Open a document — ${join(root, "bDir")}`);
    await settle();

    // bDir is empty, so its own listing is just the parent entry.
    rendered.stdin.write("\r");
    frame = await waitForFlatFrame(rendered, (candidate) =>
      candidate.includes(`— ${root}`),
    );
    expect(frame).toContain(`Open a document — ${root}`);
  });

  it("opens the selected file for the 'open' purpose and reaches the document's own root screen", async () => {
    vi.mocked(openDocumentAtPath).mockResolvedValueOnce(fakeOpenDocument());
    const rendered = renderPicker("open", root);
    await waitForBrowseMode(rendered);

    // ../, bDir/, sub/, aFile.md — three downs from the parent entry. Each down-press is its own stdin.write() with a settle() after it: a keypress's own state update is only guaranteed visible to the next one once its render has actually committed (test-support.ts's own settle() doc comment), and batching several keys into one write() call has been observed to lose presses.
    await pressDown(rendered, 3);
    rendered.stdin.write("\r");

    const frame = await waitForFlatFrame(rendered, (candidate) =>
      candidate.includes("openFormat:markdown"),
    );
    expect(frame).not.toContain("screen:filePicker");
    const call = vi.mocked(openDocumentAtPath).mock.calls[0];
    expect(call?.[0]).toBe(join(root, "aFile.md"));
    expect(typeof call?.[1]?.onDiagnostic).toBe("function");
  });

  it("reports an open failure without leaving the picker when openDocumentAtPath rejects", async () => {
    vi.mocked(openDocumentAtPath).mockRejectedValueOnce(new Error("nope"));
    const rendered = renderPicker("open", root);
    await waitForBrowseMode(rendered);

    await pressDown(rendered, 3);
    rendered.stdin.write("\r");

    const frame = await waitForFlatFrame(rendered, (candidate) =>
      candidate.includes("error:Could not open"),
    );
    expect(frame).toContain(`error:Could not open ${join(root, "aFile.md")}`);
    expect(frame).toContain("screen:filePicker");
  });

  it("pressing 'a' does nothing for the 'open' purpose", async () => {
    const rendered = renderPicker("open", root);
    const before = await waitForBrowseMode(rendered);
    rendered.stdin.write("a");
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
    expect(flattenFrame(rendered.lastFrame())).toBe(before);
  });

  it.each(["saveAs", "exportTarget"] as const)(
    "pressing 'a' enters name-entry mode with the default basename, for %s",
    async (purpose) => {
      const rendered = renderPicker(purpose, root, { withDocument: true });
      await waitForBrowseMode(rendered);
      rendered.stdin.write("a");

      const expected =
        purpose === "exportTarget" ? "untitled.pdf" : "untitled.md";
      const frame = await waitForFlatFrame(rendered, (candidate) =>
        candidate.includes(expected),
      );
      expect(frame).toContain(`${root}/ `);
      expect(frame).toContain(expected);
    },
  );

  it("selecting a file for 'saveAs' pre-fills its own name in name-entry mode", async () => {
    const rendered = renderPicker("saveAs", root, { withDocument: true });
    await waitForBrowseMode(rendered);

    await pressDown(rendered, 3);
    rendered.stdin.write("\r");

    const frame = await waitForFlatFrame(rendered, (candidate) =>
      candidate.includes(`${root}/ `),
    );
    expect(frame).toContain("aFile.md");
  });

  it("Escape in name-entry mode returns to browse mode without dispatching anything", async () => {
    const rendered = renderPicker("saveAs", root, { withDocument: true });
    await waitForBrowseMode(rendered);
    rendered.stdin.write("a");
    await waitForFlatFrame(rendered, (candidate) =>
      candidate.includes("untitled.md"),
    );
    await settle();

    rendered.stdin.write("\u001B");

    const frame = await waitForFlatFrame(rendered, (candidate) =>
      candidate.includes("Enter a directory to browse into it"),
    );
    expect(frame).not.toContain("untitled.md");
  });

  it("warns instead of saving when the destination name is blank", async () => {
    const rendered = renderPicker("saveAs", root, { withDocument: true });
    await waitForBrowseMode(rendered);
    rendered.stdin.write("a");
    await waitForFlatFrame(rendered, (candidate) =>
      candidate.includes("untitled.md"),
    );
    await settle();
    // "untitled.md" is 11 characters; clear every one of them with backspace so the submitted value is the empty string. One backspace per stdin.write() call, each settled before the next: batching several keys into a single write() has been observed to lose presses.
    for (let step = 0; step < 11; step += 1) {
      rendered.stdin.write("\x7f");
      await settle();
    }
    rendered.stdin.write("\r");

    const frame = await waitForFlatFrame(rendered, (candidate) =>
      candidate.includes("status:warning"),
    );
    expect(frame).toContain("status:warning:Enter a filename first");
    expect(vi.mocked(saveDocumentTo)).not.toHaveBeenCalled();
  });

  it("warns instead of saving when there is no open document", async () => {
    const rendered = renderPicker("saveAs", root);
    await waitForBrowseMode(rendered);
    await pressDown(rendered, 3);
    rendered.stdin.write("\r");
    await waitForFlatFrame(rendered, (candidate) =>
      candidate.includes(`${root}/ `),
    );
    await settle();
    rendered.stdin.write("\r");

    const frame = await waitForFlatFrame(rendered, (candidate) =>
      candidate.includes("status:warning"),
    );
    expect(frame).toContain("status:warning:There is no open document");
    expect(vi.mocked(saveDocumentTo)).not.toHaveBeenCalled();
  });

  it("saves the document to the entered destination and pops the screen on success", async () => {
    vi.mocked(saveDocumentTo).mockResolvedValueOnce(undefined);
    const rendered = renderPicker("saveAs", root, { withDocument: true });
    await waitForBrowseMode(rendered);
    rendered.stdin.write("a");
    await waitForFlatFrame(rendered, (candidate) =>
      candidate.includes("untitled.md"),
    );
    await settle();
    rendered.stdin.write("\r");

    // "status:info" alone would match the pre-existing "New markdown document" status from CREATE_DOCUMENT before the save has actually landed; wait for the save's own status text specifically.
    const frame = await waitForFlatFrame(rendered, (candidate) =>
      candidate.includes("status:info:Saved"),
    );
    expect(frame).toContain(`status:info:Saved ${join(root, "untitled.md")}`);
    expect(frame).not.toContain("screen:filePicker");
    expect(vi.mocked(saveDocumentTo)).toHaveBeenCalledWith(
      expect.objectContaining({ format: "markdown" }),
      join(root, "untitled.md"),
    );
  });

  it("reports a save failure inline without popping the screen", async () => {
    vi.mocked(saveDocumentTo).mockRejectedValueOnce(new Error("disk full"));
    const rendered = renderPicker("saveAs", root, { withDocument: true });
    await waitForBrowseMode(rendered);
    rendered.stdin.write("a");
    await waitForFlatFrame(rendered, (candidate) =>
      candidate.includes("untitled.md"),
    );
    await settle();
    rendered.stdin.write("\r");

    const frame = await waitForFlatFrame(rendered, (candidate) =>
      candidate.includes("status:error"),
    );
    expect(frame).toContain(
      `status:error:Could not save ${join(root, "untitled.md")}: disk full`,
    );
    expect(frame).toContain("screen:filePicker");
  });

  it("exports to the entered destination, pops the screen, and leaves diagnostics closed when none were reported", async () => {
    vi.mocked(exportToPdf).mockResolvedValueOnce(undefined);
    const rendered = renderPicker("exportTarget", root, { withDocument: true });
    await waitForBrowseMode(rendered);
    rendered.stdin.write("a");
    await waitForFlatFrame(rendered, (candidate) =>
      candidate.includes("untitled.pdf"),
    );
    await settle();
    rendered.stdin.write("\r");

    // "status:info" alone would match the pre-existing "New markdown document" status from CREATE_DOCUMENT before the export has actually landed; wait for the export's own status text specifically.
    const frame = await waitForFlatFrame(rendered, (candidate) =>
      candidate.includes("status:info:Exported"),
    );
    expect(frame).toContain(
      `status:info:Exported ${join(root, "untitled.pdf")}`,
    );
    expect(frame).toContain("diagnosticsPanelOpen:false");
    expect(frame).not.toContain("screen:filePicker");
  });

  it("opens the diagnostics panel when the export reports at least one diagnostic, and still pops the screen", async () => {
    vi.mocked(exportToPdf).mockImplementationOnce((_doc, _dest, options) => {
      options.onDiagnostic({
        severity: "info",
        message: "substituted a glyph",
      });
      return Promise.resolve();
    });
    const rendered = renderPicker("exportTarget", root, { withDocument: true });
    await waitForBrowseMode(rendered);
    rendered.stdin.write("a");
    await waitForFlatFrame(rendered, (candidate) =>
      candidate.includes("untitled.pdf"),
    );
    await settle();
    rendered.stdin.write("\r");

    const frame = await waitForFlatFrame(rendered, (candidate) =>
      candidate.includes("diagnosticsPanelOpen:true"),
    );
    expect(frame).not.toContain("screen:filePicker");
  });

  it("reports an export failure inline without popping the screen", async () => {
    vi.mocked(exportToPdf).mockRejectedValueOnce(new Error("bad font"));
    const rendered = renderPicker("exportTarget", root, { withDocument: true });
    await waitForBrowseMode(rendered);
    rendered.stdin.write("a");
    await waitForFlatFrame(rendered, (candidate) =>
      candidate.includes("untitled.pdf"),
    );
    await settle();
    rendered.stdin.write("\r");

    const frame = await waitForFlatFrame(rendered, (candidate) =>
      candidate.includes("error:Could not export"),
    );
    expect(frame).toContain(
      `error:Could not export to ${join(root, "untitled.pdf")}`,
    );
    expect(frame).toContain("screen:filePicker");
  });

  it("Escape in browse mode pops the screen", async () => {
    const rendered = renderPicker("open", root);
    await waitForBrowseMode(rendered);
    rendered.stdin.write("\u001B");
    const frame = await waitForFlatFrame(rendered, (candidate) =>
      candidate.includes("screen:launcher"),
    );
    expect(frame).toContain("screen:launcher");
  });
});
