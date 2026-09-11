import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EXIT_SUCCESS, EXIT_USAGE_ERROR } from "./runtime/exit-codes";
import { main } from "./cli-main-sea";

// Only the TUI-free dispatch this module owns is exercised here -- every real command's own behaviour is already covered by document-cli's own command-level tests and its full test/smoke.test.mjs (spawning the real dist/cli.js), which src/cli-main.ts's identical `createProgram().parseAsync()` call already reaches. This file exists to prove the one thing genuinely different about the SEA dispatch: no TUI subcommand, and an explicit `tui` invocation refused with a clear message rather than silently doing nothing.
describe("main", () => {
  const originalArgv = process.argv;
  const originalExitCode = process.exitCode;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it("shows help and exits successfully on a bare invocation", async () => {
    process.argv = ["node", "sea-entry.js"];
    await main();
    expect(process.exitCode).toBe(EXIT_SUCCESS);
    expect(stdoutSpy).toHaveBeenCalledWith(
      expect.stringContaining("document-cli"),
    );
  });

  it("refuses tui with a clear message instead of attempting to launch it", async () => {
    process.argv = ["node", "sea-entry.js", "tui"];
    await main();
    expect(process.exitCode).toBe(EXIT_USAGE_ERROR);
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("the TUI is not available in this build"),
    );
  });

  it("dispatches a real command through the ordinary program", async () => {
    process.argv = ["node", "sea-entry.js", "--help"];
    await main();
    expect(stdoutSpy).toHaveBeenCalledWith(
      expect.stringContaining("Commands:"),
    );
  });
});
