import { render } from 'ink';
import { App } from './app.js';

export interface RunTuiOptions {
  // Opened immediately on startup, skipping the launcher screen -- app.tsx's own AppShell effect drives this.
  readonly startPath?: string;
  // Seeds AppState.cwd, which the file picker, save-as prompt, and export-destination default all read instead of calling process.cwd() themselves -- see state/types.ts's own comment on the field.
  readonly cwd?: string;
  // Wired into <format>ToPdf's own signal during an in-app export, exactly like the CLI's conversion commands -- NOT the TUI's normal quit path. Ink's own useInput-driven q/Ctrl+C handling (exitOnCtrlC: false in AppShell) is the real, confirm-if-dirty quit mechanism and is unaffected by this signal under ordinary operation. This signal exists only for the narrower case of the process being aborted from OUTSIDE the running session (e.g. a real SIGINT delivered while Ink owns terminal raw mode, so the user isn't the one pressing keys in-app) -- in that case the session force-exits immediately, since there is no one left to prompt for a save confirmation.
  readonly signal?: AbortSignal;
  readonly stdin?: NodeJS.ReadStream;
  readonly stdout?: NodeJS.WriteStream;
}

// Resolves on every ordinary in-app exit (a confirmed quit, a confirmed close) and never rejects for a recoverable, in-app condition -- a malformed startPath, a failed save, an export diagnostic all render as an in-app error toast/screen (see app.tsx's AppShell and the ErrorDetail overlay) rather than propagating here. Only rejects for a genuine framework-level failure: an uncaught exception during render, or Ink's own instance settling with a thrown error via exit(error) (which nothing in this app currently does deliberately, but the contract holds regardless).
export async function runTui(options: RunTuiOptions = {}): Promise<void> {
  const instance = render(<App startPath={options.startPath} cwd={options.cwd} />, {
    stdin: options.stdin ?? process.stdin,
    stdout: options.stdout ?? process.stdout,
    exitOnCtrlC: false,
  });

  const forceExit = (): void => {
    instance.unmount();
  };
  options.signal?.addEventListener('abort', forceExit, { once: true });

  try {
    await instance.waitUntilExit();
  } finally {
    options.signal?.removeEventListener('abort', forceExit);
  }
}
