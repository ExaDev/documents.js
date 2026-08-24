import { describe, expect, it } from "vitest";
import { resolveBinDispatch } from "./bin-dispatch";

describe("resolveBinDispatch", () => {
  it("defaults a bare invocation to the interactive CLI", () => {
    expect(resolveBinDispatch([], undefined)).toEqual({
      pkg: "document-cli",
      command: "npx",
      runnerArgs: ["-y", "document-cli"],
    });
  });

  it("passes unknown args through to the CLI verbatim", () => {
    expect(resolveBinDispatch(["convert", "a.docx", "pdf"], undefined)).toEqual(
      {
        pkg: "document-cli",
        command: "npx",
        runnerArgs: ["-y", "document-cli", "convert", "a.docx", "pdf"],
      },
    );
  });

  it("dispatches `mcp` to the server and drops the token", () => {
    expect(resolveBinDispatch(["mcp"], undefined)).toEqual({
      pkg: "document-mcp",
      command: "npx",
      runnerArgs: ["-y", "document-mcp"],
    });
    expect(resolveBinDispatch(["mcp", "--foo"], undefined)).toEqual({
      pkg: "document-mcp",
      command: "npx",
      runnerArgs: ["-y", "document-mcp", "--foo"],
    });
  });

  it("treats `cli` as the escape hatch for a file named `mcp`", () => {
    // Without the escape hatch, a bare `mcp` would be intercepted as the server dispatch.
    expect(resolveBinDispatch(["cli", "mcp"], undefined)).toEqual({
      pkg: "document-cli",
      command: "npx",
      runnerArgs: ["-y", "document-cli", "mcp"],
    });
  });

  it("uses each package manager native download-and-run command", () => {
    // npm (and a missing agent) -> npx -y.
    expect(resolveBinDispatch([], "npm/10.2.4 node/v20")).toEqual({
      pkg: "document-cli",
      command: "npx",
      runnerArgs: ["-y", "document-cli"],
    });
    expect(resolveBinDispatch([], undefined).command).toBe("npx");
    // pnpm -> pnpm dlx.
    expect(resolveBinDispatch([], "pnpm/9.15.0")).toEqual({
      pkg: "document-cli",
      command: "pnpm",
      runnerArgs: ["dlx", "document-cli"],
    });
    // Yarn Berry (2+) -> yarn dlx.
    expect(resolveBinDispatch([], "yarn/4.1.1")).toEqual({
      pkg: "document-cli",
      command: "yarn",
      runnerArgs: ["dlx", "document-cli"],
    });
    // Yarn classic (1.x) has no `dlx`, so it falls back to npx.
    expect(resolveBinDispatch([], "yarn/1.22.19")).toEqual({
      pkg: "document-cli",
      command: "npx",
      runnerArgs: ["-y", "document-cli"],
    });
    // bun -> bunx (no fetch flag).
    expect(resolveBinDispatch([], "bun/1.1.0")).toEqual({
      pkg: "document-cli",
      command: "bunx",
      runnerArgs: ["document-cli"],
    });
  });
});
