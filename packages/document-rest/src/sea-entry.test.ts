import { describe, expect, it, vi } from "vitest";

// sea-entry.ts calls main() at module top level (the SEA-compatible CommonJS entry point Node's single-executable application feature runs -- see that file's own comment), so the only way to observe its catch handler is to control what main() itself does and import the module fresh.
const mainMock = vi.fn();
vi.mock("./cli", () => ({ main: mainMock }));

describe("sea-entry", () => {
  it("logs the error and sets a nonzero exit code when main() rejects", async () => {
    const originalExitCode = process.exitCode;
    const error = new Error("listen EADDRINUSE");
    mainMock.mockRejectedValue(error);
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await import("./sea-entry");
    await vi.waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith(error);
    });
    expect(process.exitCode).toBe(1);

    consoleErrorSpy.mockRestore();
    process.exitCode = originalExitCode;
  });
});
