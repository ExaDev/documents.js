import { describe, expect, it } from "vitest";
import { GLOBAL_KEYS } from "./global-keys";

describe("GLOBAL_KEYS", () => {
  it("declares the exact global key bindings, in order", () => {
    expect(GLOBAL_KEYS).toEqual([
      { keys: "↑ / k", description: "Move the selection up" },
      { keys: "↓ / j", description: "Move the selection down" },
      {
        keys: "Enter / → / l",
        description: "Open or edit the selected item",
      },
      {
        keys: "Esc / ← / h",
        description: "Go back to the previous screen",
      },
      { keys: "PageUp / PageDown", description: "Scroll a page at a time" },
      { keys: "Home / End", description: "Jump to the first or last item" },
      { keys: "a", description: "Append a new item to the current list" },
      {
        keys: "m",
        description: "Show the open document's metadata (read-only)",
      },
      { keys: "Ctrl+S", description: "Save the open document" },
      { keys: "Ctrl+W", description: "Close the open document" },
      { keys: "Ctrl+Z", description: "Undo the last change" },
      { keys: "q / Ctrl+C", description: "Quit" },
      { keys: ":", description: "Open the command palette" },
      { keys: "/", description: "Search within the current screen" },
      { keys: "?", description: "Show this help" },
      { keys: "Ctrl+D", description: "Show the diagnostics panel" },
    ]);
  });
});
