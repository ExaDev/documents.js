import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// sea-entry.ts is a genuinely side-effecting module -- its whole body is the top-level `main().catch(...)` Node's single-executable-application entry point requires (see the file's own comment: SEA runs only a CommonJS entry with no top-level await). Importing it runs that statement immediately, so ./cli's main() is mocked here rather than allowed to run for real, which would otherwise start the genuine stdio transport this module's default (no --transport flag) resolves to -- exactly the "hijacks this test process's own stdio" hazard src/cli.test.ts's own module comment already calls out for main() itself.
describe("sea-entry", () => {
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    vi.resetModules();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
    vi.doUnmock("./cli");
  });

  it("calls main() and does nothing else once it resolves", async () => {
    vi.doMock("./cli", () => ({ main: vi.fn().mockResolvedValue(undefined) }));
    const { main } = await import("./cli");
    await import("./sea-entry");
    // main().catch(...)'s own continuation runs as a microtask after the dynamic import settles -- a macrotask tick flushes it before the assertions below run.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(main).toHaveBeenCalledTimes(1);
    expect(console.error).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(originalExitCode);
  });

  it("logs the rejection and sets a non-zero exit code when main() rejects", async () => {
    const failure = new Error("boom");
    vi.doMock("./cli", () => ({ main: vi.fn().mockRejectedValue(failure) }));
    await import("./sea-entry");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(console.error).toHaveBeenCalledWith(failure);
    expect(process.exitCode).toBe(1);
  });
});
