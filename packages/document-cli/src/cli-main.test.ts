import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EXIT_INPUT_ERROR,
  EXIT_SUCCESS,
  EXIT_USAGE_ERROR,
} from "./runtime/exit-codes";
import * as programModule from "./program";
import { main } from "./cli-main";

// runTui itself (a real Ink render against a real terminal) is exercised by src/tui/*.test.tsx — this file's own subject is cli-main.ts's dispatch logic around it: which of the three paths (bare invocation, an explicit 'tui' token, or an ordinary registered command) main() takes, how each computes the TUI's own startPath, TTY-gating, and how launchTui's own success/failure maps to an exit code. runTui is mocked throughout so no real Ink instance is ever rendered here.
const runTuiMock =
  vi.fn<(options: { readonly startPath?: string }) => Promise<void>>();
vi.mock("./tui/index.js", () => ({
  runTui: (options: { readonly startPath?: string }) => runTuiMock(options),
}));

describe("main", () => {
  const originalArgv = process.argv;
  const originalExitCode = process.exitCode;
  const originalIsTTY = process.stdout.isTTY;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    runTuiMock.mockReset();
    runTuiMock.mockResolvedValue(undefined);
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
    process.stdout.isTTY = originalIsTTY;
    process.removeAllListeners("SIGINT");
    vi.restoreAllMocks();
  });

  it("launches the TUI on a bare invocation when stdout is a TTY, with no start path", async () => {
    process.stdout.isTTY = true;
    process.argv = ["node", "document-cli"];

    await main();

    expect(runTuiMock).toHaveBeenCalledTimes(1);
    expect(runTuiMock).toHaveBeenCalledWith(
      expect.objectContaining({ startPath: undefined }),
    );
    expect(process.exitCode).toBe(EXIT_SUCCESS);
  });

  it("shows help and exits successfully on a bare invocation when stdout is not a TTY, without launching the TUI", async () => {
    process.stdout.isTTY = false;
    process.argv = ["node", "document-cli"];

    await main();

    expect(runTuiMock).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(EXIT_SUCCESS);
    expect(stdoutSpy).toHaveBeenCalledWith(
      expect.stringContaining("document-cli"),
    );
  });

  it("refuses an explicit 'tui' invocation with a usage error when stdout is not a TTY", async () => {
    process.stdout.isTTY = false;
    process.argv = ["node", "document-cli", "tui"];

    await main();

    expect(runTuiMock).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(EXIT_USAGE_ERROR);
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("requires an interactive terminal"),
    );
  });

  it("launches the TUI for an explicit 'tui' invocation with a TTY, resolving the start path from the first non-flag argument", async () => {
    process.stdout.isTTY = true;
    process.argv = ["node", "document-cli", "tui", "--foo", "somefile.docx"];

    await main();

    expect(runTuiMock).toHaveBeenCalledWith(
      expect.objectContaining({ startPath: "somefile.docx" }),
    );
    expect(process.exitCode).toBe(EXIT_SUCCESS);
  });

  it("launches the TUI for an explicit 'tui' invocation with no file argument, leaving the start path undefined", async () => {
    process.stdout.isTTY = true;
    process.argv = ["node", "document-cli", "tui"];

    await main();

    expect(runTuiMock).toHaveBeenCalledWith(
      expect.objectContaining({ startPath: undefined }),
    );
  });

  it("reports EXIT_INPUT_ERROR and the formatted error when runTui itself rejects with a framework-level failure", async () => {
    process.stdout.isTTY = true;
    process.argv = ["node", "document-cli"];
    runTuiMock.mockRejectedValue(new Error("ink blew up"));

    await main();

    expect(process.exitCode).toBe(EXIT_INPUT_ERROR);
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("ink blew up"),
    );
  });

  it("dispatches an ordinary registered command through the assembled program rather than the TUI", async () => {
    process.argv = ["node", "document-cli", "--help"];

    await main();

    expect(runTuiMock).not.toHaveBeenCalled();
    expect(stdoutSpy).toHaveBeenCalledWith(
      expect.stringContaining("Commands:"),
    );
  });

  it("registers a 'tui [file]' subcommand on the assembled program that also launches the TUI", async () => {
    process.argv = ["node", "document-cli", "tui-registration-probe"];
    // dispatchToken is neither undefined nor "tui", so main() takes the else branch that registers 'tui [file]' on a fresh createProgram() result before parsing — calling createProgram() directly afterwards, as this test does below, would build a SEPARATE program without that registration. Spy on it instead so this test observes the exact program instance main() itself builds and registers against.
    const createProgramSpy = vi.spyOn(programModule, "createProgram");
    await main();
    const registeredProgram = createProgramSpy.mock.results[0]?.value as
      ReturnType<typeof programModule.createProgram> | undefined;
    if (registeredProgram === undefined) {
      throw new Error("expected main() to have called createProgram()");
    }

    await registeredProgram.parseAsync([
      "node",
      "document-cli",
      "tui",
      "registered-file.docx",
    ]);

    expect(runTuiMock).toHaveBeenCalledWith(
      expect.objectContaining({ startPath: "registered-file.docx" }),
    );
  });

  it("propagates a non-CommanderError bug from a registered action instead of swallowing it", async () => {
    const brokenProgram = programModule.createProgram();
    brokenProgram.command("boom").action(() => {
      throw new Error("boom");
    });
    vi.spyOn(programModule, "createProgram").mockReturnValue(brokenProgram);
    process.argv = ["node", "document-cli", "boom"];

    await expect(main()).rejects.toThrow("boom");
  });
});
