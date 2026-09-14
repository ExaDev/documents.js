import { describe, expect, it, vi } from "vitest";

// bin.ts is a real executable entry point: importing it runs its top-level code immediately, which spawns a child process and calls process.exit. Every test here mocks node:child_process's spawnSync and stubs process.exit/argv/env before a fresh dynamic import, then restores them.

interface SpawnSyncCall {
  readonly command: string;
  readonly args: readonly string[];
  readonly options: unknown;
}

async function runBin(
  argv: readonly string[],
  userAgent: string | undefined,
  status: number | null,
): Promise<{ readonly call: SpawnSyncCall; readonly exitCode: unknown }> {
  vi.resetModules();
  let call: SpawnSyncCall | undefined;
  vi.doMock("node:child_process", () => ({
    spawnSync: (command: string, args: readonly string[], options: unknown) => {
      call = { command, args, options };
      return { status };
    },
  }));
  const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
    return undefined as never;
  });
  const originalArgv = process.argv;
  const originalUserAgent = process.env.npm_config_user_agent;
  process.argv = ["node", "documents.js", ...argv];
  if (userAgent === undefined) {
    delete process.env.npm_config_user_agent;
  } else {
    process.env.npm_config_user_agent = userAgent;
  }
  try {
    await import("./bin");
  } finally {
    process.argv = originalArgv;
    if (originalUserAgent === undefined) {
      delete process.env.npm_config_user_agent;
    } else {
      process.env.npm_config_user_agent = originalUserAgent;
    }
  }
  if (call === undefined) {
    throw new Error("expected spawnSync to have been called");
  }
  const exitCode = exitSpy.mock.calls[0]?.[0];
  exitSpy.mockRestore();
  vi.doUnmock("node:child_process");
  return { call, exitCode };
}

describe("bin", () => {
  it("strips the node/script argv[0..1] before resolving dispatch, not the full argv", () => {
    return runBin(["mcp"], "npm/10.2.4 node/v20", 0).then(({ call }) => {
      // Without process.argv.slice(2), argv[0] would be "node" (not "mcp"), never triggering the mcp dispatch path -- this only resolves to document-mcp because the strip happened.
      expect(call.command).toBe("npx");
      expect(call.args).toEqual(["-y", "document-mcp"]);
    });
  });

  it("spawns with the exact resolved args array and { stdio: 'inherit' } options", () => {
    return runBin(["convert", "a.docx"], "npm/10.2.4 node/v20", 0).then(
      ({ call }) => {
        expect(call.args).toEqual(["-y", "document-cli", "convert", "a.docx"]);
        expect(call.options).toEqual({ stdio: "inherit" });
      },
    );
  });

  it("exits with the spawned process's own non-zero status, not always the same code", () => {
    return runBin([], "npm/10.2.4 node/v20", 2).then(({ exitCode }) => {
      expect(exitCode).toBe(2);
    });
  });

  it("exits with 1 when spawnSync reports no status at all (e.g. killed by a signal)", () => {
    return runBin([], "npm/10.2.4 node/v20", null).then(({ exitCode }) => {
      expect(exitCode).toBe(1);
    });
  });
});
