import { afterEach, describe, expect, it, vi } from "vitest";
import { version } from "../package.json";
import { createProgram } from "./program";
import { EXIT_SUCCESS, EXIT_USAGE_ERROR } from "./runtime/exit-codes";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createProgram", () => {
  it("names itself in --help text with the full conversion/bridge/inspector description", () => {
    const help = createProgram().helpInformation().replace(/\s+/gu, " ");
    expect(help).toContain(
      "every documents.js docx/pptx/odt/odp/ods/odg/odf/pdf/odm/odb/xlsx/csv/svg/markdown/rtf conversion, bridge, and inspector as a scriptable command",
    );
  });

  it("reports the package's own declared version through --version", async () => {
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const program = createProgram();
    await expect(
      program.parseAsync(["node", "document-cli", "--version"]),
    ).rejects.toThrow();
    expect(stdout).toHaveBeenCalledWith(`${version}\n`);
  });

  it("sets EXIT_SUCCESS for a zero-exitCode CommanderError (--help/--version)", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const originalExitCode = process.exitCode;
    const program = createProgram();
    await expect(
      program.parseAsync(["node", "document-cli", "--version"]),
    ).rejects.toThrow();
    expect(process.exitCode).toBe(EXIT_SUCCESS);
    process.exitCode = originalExitCode;
  });

  it("sets EXIT_USAGE_ERROR for a non-zero-exitCode CommanderError (a genuine usage mistake)", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const originalExitCode = process.exitCode;
    const program = createProgram();
    await expect(
      program.parseAsync(["node", "document-cli", "--not-a-real-flag"]),
    ).rejects.toThrow();
    expect(process.exitCode).toBe(EXIT_USAGE_ERROR);
    process.exitCode = originalExitCode;
  });
});
