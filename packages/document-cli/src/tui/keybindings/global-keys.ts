export interface KeyBinding {
  readonly keys: string;
  readonly description: string;
}

// The single source of truth for the global bindings: the key-handling code branches on these same combinations and the help overlay renders this table verbatim, so behaviour and documentation cannot drift apart. Screen-local bindings (a format's own editing keys) belong with that screen, not here.
export const GLOBAL_KEYS: readonly KeyBinding[] = [
  { keys: '↑ / k', description: 'Move the selection up' },
  { keys: '↓ / j', description: 'Move the selection down' },
  { keys: 'Enter / → / l', description: 'Open or edit the selected item' },
  { keys: 'Esc / ← / h', description: 'Go back to the previous screen' },
  { keys: 'PageUp / PageDown', description: 'Scroll a page at a time' },
  { keys: 'Home / End', description: 'Jump to the first or last item' },
  { keys: 'a', description: 'Append a new item to the current list' },
  { keys: 'm', description: "Show the open document's metadata (read-only)" },
  { keys: 'Ctrl+S', description: 'Save the open document' },
  { keys: 'Ctrl+W', description: 'Close the open document' },
  { keys: 'Ctrl+Z', description: 'Undo the last change' },
  { keys: 'q / Ctrl+C', description: 'Quit' },
  { keys: ':', description: 'Open the command palette' },
  { keys: '/', description: 'Search within the current screen' },
  { keys: '?', description: 'Show this help' },
  { keys: 'Ctrl+D', description: 'Show the diagnostics panel' },
];
