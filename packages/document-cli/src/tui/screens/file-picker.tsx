import { readdirSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { Box, Text } from "ink";
import { useState, type ReactElement } from "react";
import { formatToExtension } from "../../format.js";
import { ListView } from "../components/list-view.js";
import { TextField } from "../components/text-field.js";
import { describeError } from "../errors.js";
import { exportToPdf } from "../format/export-pdf.js";
import { openDocumentAtPath, saveDocumentTo } from "../format/open-document.js";
import { useNavigationInput } from "../keybindings/use-navigation-input.js";
import { useAppDispatch, useAppState } from "../state/context.js";
import {
  anyOverlayOpen,
  currentScreen,
  isWritableDocument,
  type OpenDocument,
} from "../state/types.js";

interface FileEntry {
  readonly name: string;
  readonly isDirectory: boolean;
}

const PARENT_ENTRY: FileEntry = { name: "..", isDirectory: true };

// Reads the directory during render rather than caching it in state: a file picker's whole job is to reflect the real filesystem, and a stale cached listing (from before a save just created the very file being browsed to) would be actively wrong. A read failure (permissions, a directory removed out from under the picker) is reported inline rather than left to crash the render.
function readEntries(dir: string): {
  readonly entries: readonly FileEntry[];
  readonly error: string | undefined;
} {
  try {
    const raw = readdirSync(dir, { withFileTypes: true });
    const byName = (a: FileEntry, b: FileEntry): number =>
      a.name.localeCompare(b.name);
    const directories = raw
      .filter((entry) => entry.isDirectory())
      .map((entry): FileEntry => ({ name: entry.name, isDirectory: true }))
      .sort(byName);
    const files = raw
      .filter((entry) => !entry.isDirectory())
      .map((entry): FileEntry => ({ name: entry.name, isDirectory: false }))
      .sort(byName);
    return { entries: [...directories, ...files], error: undefined };
  } catch (error) {
    return { entries: [], error: describeError(error) };
  }
}

// The basename this screen offers once the user asks to name a destination file: an existing document keeps its own name (or its own name with the extension swapped to .pdf for an export target); a never-saved document falls back to a generic "untitled" stem.
function defaultBasenameFor(
  purpose: "saveAs" | "exportTarget",
  document: OpenDocument | undefined,
): string {
  const sourcePath = document?.path;
  const stem =
    sourcePath === undefined
      ? "untitled"
      : basename(sourcePath, extname(sourcePath));
  if (purpose === "exportTarget") {
    return `${stem}.pdf`;
  }
  return document !== undefined && isWritableDocument(document)
    ? `${stem}.${formatToExtension(document.format)}`
    : stem;
}

function titleFor(purpose: "open" | "saveAs" | "exportTarget"): string {
  switch (purpose) {
    case "open":
      return "Open a document";
    case "saveAs":
      return "Save as";
    case "exportTarget":
      return "Export destination";
  }
}

export function FilePickerScreen(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  // The router in app.tsx only ever mounts this component while the top of the stack is a filePicker screen -- see currentScreen's own doc comment for the same reasoning applied to an empty stack.
  const screen = currentScreen(state);
  if (screen.kind !== "filePicker") {
    throw new Error(
      "FilePickerScreen was rendered while the current screen was not a filePicker screen.",
    );
  }
  const { purpose, cwd } = screen;

  const [currentDir, setCurrentDir] = useState(cwd);
  const [mode, setMode] = useState<"browse" | "enterName">("browse");
  const [filename, setFilename] = useState("");

  const isActive = !anyOverlayOpen(state);
  const { entries: rawEntries, error: listError } = readEntries(currentDir);
  const query = state.searchQuery.trim().toLowerCase();
  const filtered =
    query === ""
      ? rawEntries
      : rawEntries.filter((entry) => entry.name.toLowerCase().includes(query));
  const hasParent = dirname(currentDir) !== currentDir;
  const displayEntries = hasParent ? [PARENT_ENTRY, ...filtered] : filtered;

  function openAtPath(path: string): void {
    void (async () => {
      try {
        const doc = await openDocumentAtPath(path, {
          onDiagnostic: (diagnostic) => {
            dispatch({ type: "APPEND_DIAGNOSTIC", diagnostic });
          },
        });
        dispatch({ type: "OPEN_FILE_SUCCESS", path, doc });
      } catch (error) {
        dispatch({
          type: "OPEN_FILE_ERROR",
          message: `Could not open ${path}`,
          detail: describeError(error),
        });
      }
    })();
  }

  function submitDestination(name: string): void {
    const trimmed = name.trim();
    if (trimmed === "") {
      dispatch({
        type: "SET_STATUS",
        severity: "warning",
        text: "Enter a filename first",
      });
      return;
    }
    const doc = state.openDocument;
    if (doc === undefined) {
      dispatch({
        type: "SET_STATUS",
        severity: "warning",
        text: "There is no open document",
      });
      return;
    }
    const destination = join(currentDir, trimmed);

    if (purpose === "saveAs") {
      void (async () => {
        try {
          await saveDocumentTo(doc, destination);
          dispatch({ type: "SAVE_SUCCESS", path: destination });
          dispatch({ type: "POP_SCREEN" });
        } catch (error) {
          dispatch({
            type: "SAVE_ERROR",
            message: `Could not save ${destination}: ${describeError(error)}`,
          });
        }
      })();
      return;
    }

    let diagnosticCount = 0;
    void (async () => {
      try {
        await exportToPdf(doc, destination, {
          onDiagnostic: (diagnostic) => {
            diagnosticCount += 1;
            dispatch({ type: "APPEND_DIAGNOSTIC", diagnostic });
          },
        });
        dispatch({
          type: "SET_STATUS",
          severity: "info",
          text: `Exported ${destination}`,
        });
        // Diagnostics are first-class, not a badge the user might miss: any produced by a successful export open the panel immediately.
        if (diagnosticCount > 0) {
          dispatch({ type: "OPEN_OVERLAY", overlay: "diagnosticsPanel" });
        }
        dispatch({ type: "POP_SCREEN" });
      } catch (error) {
        dispatch({
          type: "OPEN_FILE_ERROR",
          message: `Could not export to ${destination}`,
          detail: describeError(error),
        });
      }
    })();
  }

  const { selectedIndex } = useNavigationInput({
    itemCount: displayEntries.length,
    onSelect: (index) => {
      const entry = displayEntries[index];
      if (entry === undefined) {
        return;
      }
      if (entry.name === "..") {
        setCurrentDir(dirname(currentDir));
        return;
      }
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory) {
        setCurrentDir(fullPath);
        return;
      }
      if (purpose === "open") {
        openAtPath(fullPath);
        return;
      }
      setFilename(entry.name);
      setMode("enterName");
    },
    onBack: () => {
      dispatch({ type: "POP_SCREEN" });
    },
    onAppend:
      purpose === "open"
        ? undefined
        : () => {
            setFilename(defaultBasenameFor(purpose, state.openDocument));
            setMode("enterName");
          },
    isActive: isActive && mode === "browse",
  });

  return (
    <Box flexDirection="column">
      <Text bold>
        {titleFor(purpose)} -- {currentDir}
      </Text>
      {listError === undefined ? undefined : (
        <Text color="red">{listError}</Text>
      )}
      <ListView
        items={displayEntries}
        selectedIndex={selectedIndex}
        emptyMessage="This directory is empty."
        renderItem={(entry, isSelected) => (
          <Text color={isSelected ? "cyan" : undefined} inverse={isSelected}>
            {entry.isDirectory ? `${entry.name}/` : entry.name}
          </Text>
        )}
      />
      {mode === "enterName" ? (
        <Box>
          <Text color="cyan">{currentDir}/ </Text>
          <TextField
            value={filename}
            isFocused={isActive}
            placeholder="filename"
            onChange={setFilename}
            onSubmit={submitDestination}
            onCancel={() => {
              setMode("browse");
            }}
          />
        </Box>
      ) : (
        <Text dimColor>
          {purpose === "open"
            ? "Enter to open, Esc to cancel"
            : "Enter a directory to browse into it, a to name the destination file, Esc to cancel"}
        </Text>
      )}
    </Box>
  );
}
