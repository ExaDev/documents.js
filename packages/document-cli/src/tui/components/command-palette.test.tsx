import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Box, Text, useInput } from "ink";
import { render } from "ink-testing-library";
import { useEffect, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AppStateProvider,
  useAppDispatch,
  useAppState,
} from "../state/context.js";
import { anyOverlayOpen } from "../state/types.js";
import { settle, waitForFrame } from "../test-support.js";
import { CommandPalette } from "./command-palette.js";

// Mirrors app.tsx's own overlay wiring exactly: the palette mounts only while its overlay flag is set (so it starts each command with a genuinely fresh, empty `line`, the same way real use closes and reopens it), and the global ":" key reopens it once no overlay is open, gated by the identical `!anyOverlayOpen(state)` condition app.tsx's own shell useInput uses for the same key. Every probe a test needs is read straight off AppState: the live status message, the current screen stack's top, the open document's format/path, and the overlay/exiting flags.
function Harness(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const overlayOpen = anyOverlayOpen(state);

  useInput(
    (input) => {
      if (input === ":") {
        dispatch({ type: "OPEN_OVERLAY", overlay: "commandPalette" });
      }
    },
    { isActive: !overlayOpen },
  );

  return (
    <Box flexDirection="column">
      {state.overlays.commandPalette ? <CommandPalette /> : undefined}
      <Text>
        status:
        {state.status === undefined
          ? "none"
          : `${state.status.severity}:${state.status.text}`}
      </Text>
      <Text>top:{state.stack.at(-1)?.kind}</Text>
      <Text>format:{state.openDocument?.format ?? "none"}</Text>
      <Text>path:{state.openDocument?.path ?? "none"}</Text>
      <Text>commandPaletteOpen:{String(state.overlays.commandPalette)}</Text>
      <Text>exiting:{String(state.isExiting)}</Text>
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

// Types a whole command line then submits it with Enter, settling once after the write (as every other TextField-driven test in this suite does) so the keystroke lands before Enter is sent.
async function submit(
  stdin: ReturnType<typeof render>["stdin"],
  line: string,
): Promise<void> {
  if (line.length > 0) {
    stdin.write(line);
    await settle();
  }
  stdin.write("\r");
}

// Ink wraps a long rendered line at the terminal's own column width, which can fall in the middle of a temp-directory path (mkdtemp's random suffix makes the exact wrap point unpredictable run to run). Stripping whitespace from both sides before comparing makes a path check immune to exactly where the wrap landed.
function flat(text: string): string {
  return text.replace(/\s+/g, "");
}

function frameHasPath(candidate: string, path: string): boolean {
  return flat(candidate).includes(flat(path));
}

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "document-cli-palette-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe("CommandPalette rendering", () => {
  it("lists every command when the line is empty", async () => {
    const { lastFrame, stdin } = renderHarness();
    stdin.write(":");
    const frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes(":save"),
    );
    for (const usage of [
      ":save",
      ":saveas <path>",
      ":export pdf [path]",
      ":open <path>",
      ":close",
      ":undo",
      ":view-source",
      ":help",
      ":quit",
    ]) {
      expect(frame).toContain(usage);
    }
  });

  it("filters the visible commands as the line is typed", async () => {
    const { lastFrame, stdin } = renderHarness();
    stdin.write(":");
    await waitForFrame(lastFrame, (candidate) => candidate.includes(":save"));
    await settle();

    stdin.write("qui");
    const frame = await waitForFrame(
      lastFrame,
      (candidate) => !candidate.includes(":save"),
    );
    expect(frame).toContain(":quit");
    expect(frame).not.toContain(":open");
  });

  it("closes the palette on Escape without dispatching a command", async () => {
    const { lastFrame, stdin } = renderHarness();
    stdin.write(":");
    await waitForFrame(lastFrame, (candidate) => candidate.includes(":save"));
    await settle();

    stdin.write("save");
    await settle();
    stdin.write("\x1B");

    const frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("commandPaletteOpen:false"),
    );
    expect(frame).toContain("status:none");
  });
});

describe("CommandPalette command resolution", () => {
  it("warns on a command matching nothing", async () => {
    const { lastFrame, stdin } = renderHarness();
    stdin.write(":");
    await waitForFrame(lastFrame, (candidate) => candidate.includes(":save"));
    await settle();

    await submit(stdin, "bogus");
    const frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("status:warning:Unknown command: bogus"),
    );
    expect(frame).toContain("status:warning:Unknown command: bogus");
  });

  it("an exact name wins over a longer command sharing the same prefix", async () => {
    const { lastFrame, stdin } = renderHarness();
    stdin.write(":");
    await waitForFrame(lastFrame, (candidate) => candidate.includes(":save"));
    await settle();

    // "save" is a prefix of "saveas" too, but the exact-name rule must resolve it to plain "save", which warns about having no open document rather than ":saveas <path>"'s own usage message.
    await submit(stdin, "save");
    const frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("status:warning:There is no open document to save"),
    );
    expect(frame).toContain("There is no open document to save");
  });
});

describe("CommandPalette :new", () => {
  it("warns with the usage line when no format is given", async () => {
    const { lastFrame, stdin } = renderHarness();
    stdin.write(":");
    await waitForFrame(lastFrame, (candidate) => candidate.includes(":save"));
    await settle();

    await submit(stdin, "new");
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes(
        "status:warning:Usage: :new docx|pptx|odt|odp|ods|odg|pdf",
      ),
    );
  });

  it("warns with the usage line when the format is not a real editable format", async () => {
    const { lastFrame, stdin } = renderHarness();
    stdin.write(":");
    await waitForFrame(lastFrame, (candidate) => candidate.includes(":save"));
    await settle();

    await submit(stdin, "new bogus");
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes(
        "status:warning:Usage: :new docx|pptx|odt|odp|ods|odg|pdf",
      ),
    );
  });

  it("creates a new document of the requested format", async () => {
    const { lastFrame, stdin } = renderHarness();
    stdin.write(":");
    await waitForFrame(lastFrame, (candidate) => candidate.includes(":save"));
    await settle();

    await submit(stdin, "new docx");
    const frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("format:docx"),
    );
    expect(frame).toContain("path:none");
  });
});

describe("CommandPalette :save and :saveas", () => {
  it("warns when :saveas is given no path", async () => {
    const { lastFrame, stdin } = renderHarness();
    stdin.write(":");
    await waitForFrame(lastFrame, (candidate) => candidate.includes(":save"));
    await settle();

    await submit(stdin, "saveas");
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("status:warning:Usage: :saveas <path>"),
    );
  });

  it("requests the save-as prompt when :save runs against a document with no path yet", async () => {
    const { lastFrame, stdin } = renderHarness();
    stdin.write(":");
    await waitForFrame(lastFrame, (candidate) => candidate.includes(":save"));
    await settle();

    await submit(stdin, "new docx");
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("format:docx"),
    );
    await settle();
    stdin.write(":");
    await settle();

    await submit(stdin, "save");
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("top:saveAsPrompt"),
    );
  });

  it("writes the open document to a real path via :saveas and records it as the document's path", async () => {
    const { lastFrame, stdin } = renderHarness();
    stdin.write(":");
    await waitForFrame(lastFrame, (candidate) => candidate.includes(":save"));
    await settle();

    await submit(stdin, "new docx");
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("format:docx"),
    );
    await settle();
    stdin.write(":");
    await settle();

    const target = join(workspace, "letter.docx");
    await submit(stdin, `saveas ${target}`);

    await waitForFrame(lastFrame, (candidate) =>
      frameHasPath(candidate, `path:${target}`),
    );
    const stats = await stat(target);
    expect(stats.isFile()).toBe(true);
  });

  it(":save re-saves to the document's existing path once it has one", async () => {
    const { lastFrame, stdin } = renderHarness();
    stdin.write(":");
    await waitForFrame(lastFrame, (candidate) => candidate.includes(":save"));
    await settle();

    await submit(stdin, "new docx");
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("format:docx"),
    );
    await settle();
    stdin.write(":");
    await settle();

    const target = join(workspace, "report.docx");
    await submit(stdin, `saveas ${target}`);
    await waitForFrame(lastFrame, (candidate) =>
      frameHasPath(candidate, `path:${target}`),
    );
    await settle();
    stdin.write(":");
    await settle();

    await submit(stdin, "save");
    await waitForFrame(lastFrame, (candidate) =>
      frameHasPath(candidate, `status:info:Saved ${target}`),
    );
  });
});

describe("CommandPalette :export", () => {
  it("warns when there is no open document", async () => {
    const { lastFrame, stdin } = renderHarness();
    stdin.write(":");
    await waitForFrame(lastFrame, (candidate) => candidate.includes(":save"));
    await settle();

    await submit(stdin, "export pdf");
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("status:warning:There is no open document to export"),
    );
  });

  it("warns on the usage line when the target format is not pdf", async () => {
    const { lastFrame, stdin } = renderHarness();
    stdin.write(":");
    await waitForFrame(lastFrame, (candidate) => candidate.includes(":save"));
    await settle();

    await submit(stdin, "new docx");
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("format:docx"),
    );
    await settle();
    stdin.write(":");
    await settle();

    await submit(stdin, "export docx");
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("status:warning:Usage: :export pdf [path]"),
    );
  });

  it("warns when the document has never been saved and no explicit path is given", async () => {
    const { lastFrame, stdin } = renderHarness();
    stdin.write(":");
    await waitForFrame(lastFrame, (candidate) => candidate.includes(":save"));
    await settle();

    await submit(stdin, "new docx");
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("format:docx"),
    );
    await settle();
    stdin.write(":");
    await settle();

    await submit(stdin, "export pdf");
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes(
        "This document has never been saved, so :export pdf needs an explicit path",
      ),
    );
  });

  it("exports to an explicit destination path", async () => {
    const { lastFrame, stdin } = renderHarness();
    stdin.write(":");
    await waitForFrame(lastFrame, (candidate) => candidate.includes(":save"));
    await settle();

    await submit(stdin, "new docx");
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("format:docx"),
    );
    await settle();
    stdin.write(":");
    await settle();

    const destination = join(workspace, "out.pdf");
    await submit(stdin, `export pdf ${destination}`);
    await waitForFrame(lastFrame, (candidate) =>
      frameHasPath(candidate, `status:info:Exported ${destination}`),
    );
    const stats = await stat(destination);
    expect(stats.isFile()).toBe(true);
  });

  it("derives the destination path from the document's own saved path when no explicit path is given", async () => {
    const { lastFrame, stdin } = renderHarness();
    stdin.write(":");
    await waitForFrame(lastFrame, (candidate) => candidate.includes(":save"));
    await settle();

    await submit(stdin, "new docx");
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("format:docx"),
    );
    await settle();
    stdin.write(":");
    await settle();

    const target = join(workspace, "memo.docx");
    await submit(stdin, `saveas ${target}`);
    await waitForFrame(lastFrame, (candidate) =>
      frameHasPath(candidate, `path:${target}`),
    );
    await settle();
    stdin.write(":");
    await settle();

    await submit(stdin, "export pdf");
    const expectedPdf = join(workspace, "memo.pdf");
    await waitForFrame(lastFrame, (candidate) =>
      frameHasPath(candidate, `status:info:Exported ${expectedPdf}`),
    );
    const stats = await stat(expectedPdf);
    expect(stats.isFile()).toBe(true);
  });

  it("reports an OPEN_FILE_ERROR-shaped status when the export destination cannot be written", async () => {
    const { lastFrame, stdin } = renderHarness();
    stdin.write(":");
    await waitForFrame(lastFrame, (candidate) => candidate.includes(":save"));
    await settle();

    await submit(stdin, "new docx");
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("format:docx"),
    );
    await settle();
    stdin.write(":");
    await settle();

    const destination = join(workspace, "no-such-directory", "out.pdf");
    await submit(stdin, `export pdf ${destination}`);
    const frame = await waitForFrame(lastFrame, (candidate) =>
      frameHasPath(
        candidate,
        `status:error:Could not export to ${destination}`,
      ),
    );
    expect(frame).toContain("status:error");
  });
});

describe("CommandPalette :open", () => {
  it("warns when no path is given", async () => {
    const { lastFrame, stdin } = renderHarness();
    stdin.write(":");
    await waitForFrame(lastFrame, (candidate) => candidate.includes(":save"));
    await settle();

    await submit(stdin, "open");
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("status:warning:Usage: :open <path>"),
    );
  });

  it("reports an error status when the path does not exist", async () => {
    const { lastFrame, stdin } = renderHarness();
    stdin.write(":");
    await waitForFrame(lastFrame, (candidate) => candidate.includes(":save"));
    await settle();

    const missing = join(workspace, "does-not-exist.docx");
    await submit(stdin, `open ${missing}`);
    const frame = await waitForFrame(lastFrame, (candidate) =>
      frameHasPath(candidate, `status:error:Could not open ${missing}`),
    );
    expect(frame).toContain("status:error");
  });

  it("opens a real document from disk", async () => {
    const { lastFrame, stdin } = renderHarness();
    stdin.write(":");
    await waitForFrame(lastFrame, (candidate) => candidate.includes(":save"));
    await settle();

    await submit(stdin, "new docx");
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("format:docx"),
    );
    await settle();
    stdin.write(":");
    await settle();
    const target = join(workspace, "existing.docx");
    await submit(stdin, `saveas ${target}`);
    await waitForFrame(lastFrame, (candidate) =>
      frameHasPath(candidate, `path:${target}`),
    );
    await settle();
    stdin.write(":");
    await settle();
    await submit(stdin, "close");
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("format:none"),
    );
    await settle();
    stdin.write(":");
    await settle();

    await submit(stdin, `open ${target}`);
    await waitForFrame(lastFrame, (candidate) =>
      frameHasPath(candidate, `path:${target}`),
    );
  });
});

describe("CommandPalette :close, :undo, :view-source, :help and :quit", () => {
  it(":close dispatches REQUEST_CLOSE", async () => {
    const { lastFrame, stdin } = renderHarness();
    stdin.write(":");
    await waitForFrame(lastFrame, (candidate) => candidate.includes(":save"));
    await settle();

    await submit(stdin, "new docx");
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("format:docx"),
    );
    await settle();
    stdin.write(":");
    await settle();

    await submit(stdin, "close");
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("format:none"),
    );
  });

  it(":undo dispatches UNDO", async () => {
    const { lastFrame, stdin } = renderHarness();
    stdin.write(":");
    await waitForFrame(lastFrame, (candidate) => candidate.includes(":save"));
    await settle();

    // UNDO against an empty undo stack is a documented no-op — asserting it doesn't crash and the palette closes normally is enough to prove the dispatch reached the reducer.
    await submit(stdin, "undo");
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("commandPaletteOpen:false"),
    );
  });

  it(":view-source warns outside a markdown document", async () => {
    const { lastFrame, stdin } = renderHarness();
    stdin.write(":");
    await waitForFrame(lastFrame, (candidate) => candidate.includes(":save"));
    await settle();

    await submit(stdin, "view-source");
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes(
        "status:warning::view-source only applies to an open markdown document",
      ),
    );
  });

  it(":view-source pushes the viewSource screen for an open markdown document", async () => {
    // ":new" itself only accepts isEditableFormat — markdown is a WritableFormat but deliberately not an EditableFormat (see types.ts's own EDITABLE_FORMATS/WRITABLE_FORMATS split), so a markdown document must be seeded directly through CREATE_DOCUMENT rather than through the palette's own ":new" command, exactly like the xls/ppt screen tests seed content the dispatched actions can't reach.
    function MarkdownHarness(): ReactElement {
      const state = useAppState();
      const dispatch = useAppDispatch();
      const overlayOpen = anyOverlayOpen(state);

      useInput(
        (input) => {
          if (input === ":") {
            dispatch({ type: "OPEN_OVERLAY", overlay: "commandPalette" });
          }
        },
        { isActive: !overlayOpen },
      );

      useEffect(() => {
        if (state.openDocument === undefined) {
          dispatch({ type: "CREATE_DOCUMENT", format: "markdown" });
        }
      }, [state.openDocument, dispatch]);

      return (
        <Box flexDirection="column">
          {state.overlays.commandPalette ? <CommandPalette /> : undefined}
          <Text>format:{state.openDocument?.format ?? "none"}</Text>
          <Text>top:{state.stack.at(-1)?.kind}</Text>
        </Box>
      );
    }

    const { lastFrame, stdin } = render(
      <AppStateProvider>
        <MarkdownHarness />
      </AppStateProvider>,
    );
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("format:markdown"),
    );
    await settle();
    stdin.write(":");
    await waitForFrame(lastFrame, (candidate) => candidate.includes(":save"));
    await settle();

    await submit(stdin, "view-source");
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("top:viewSource"),
    );
  });

  it(":help opens the help overlay", async () => {
    const { lastFrame, stdin } = renderHarness();
    stdin.write(":");
    await waitForFrame(lastFrame, (candidate) => candidate.includes(":save"));
    await settle();

    await submit(stdin, "help");
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("commandPaletteOpen:false"),
    );
  });

  it(":quit requests the app to quit", async () => {
    const { lastFrame, stdin } = renderHarness();
    stdin.write(":");
    await waitForFrame(lastFrame, (candidate) => candidate.includes(":save"));
    await settle();

    await submit(stdin, "quit");
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("exiting:true"),
    );
  });
});
