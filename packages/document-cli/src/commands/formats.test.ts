import { createLocalDocumentConverter } from "documents.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProgram } from "../program";

function spyOnStdout(): { calls(): string[] } {
  const chunks: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    chunks.push(typeof chunk === "string" ? chunk : chunk.toString());
    return true;
  });
  return { calls: () => chunks };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("formats command", () => {
  it("prints one 'source -> target' line per supported conversion", async () => {
    const stdout = spyOnStdout();
    await createProgram().parseAsync(["node", "document-cli", "formats"]);
    const { conversions } = createLocalDocumentConverter();
    for (const { source, target } of conversions) {
      expect(stdout.calls()).toContain(`${source} -> ${target}\n`);
    }
  });

  it("appends a trailing line naming the commands not covered by the list", async () => {
    const stdout = spyOnStdout();
    await createProgram().parseAsync(["node", "document-cli", "formats"]);
    expect(stdout.calls().at(-1)).toContain(
      "not covered by this list, each its own command:",
    );
    expect(stdout.calls().at(-1)).toContain("odm-to-pdf");
    expect(stdout.calls().at(-1)).toContain("outline");
  });

  it("emits a JSON array under --json instead of the human-readable table", async () => {
    const stdout = spyOnStdout();
    await createProgram().parseAsync([
      "node",
      "document-cli",
      "formats",
      "--json",
    ]);
    const { conversions } = createLocalDocumentConverter();
    expect(stdout.calls()).toHaveLength(1);
    expect(JSON.parse(stdout.calls()[0] ?? "")).toEqual(conversions);
  });

  it("does not print the trailing not-covered line under --json", async () => {
    const stdout = spyOnStdout();
    await createProgram().parseAsync([
      "node",
      "document-cli",
      "formats",
      "--json",
    ]);
    expect(stdout.calls().join("")).not.toContain("not covered by this list");
  });

  it("documents itself and its --json flag in its own --help text", () => {
    const command = createProgram().commands.find(
      (candidate) => candidate.name() === "formats",
    );
    if (command === undefined) {
      throw new Error("the program registers no 'formats' command");
    }
    // Commander wraps long option/command descriptions onto multiple lines at its own detected terminal width, so a verbatim multi-word substring check would be at the mercy of wherever that wrap lands -- collapsing all whitespace first checks the actual wording regardless of how commander happened to lay it out.
    const help = command.helpInformation().replace(/\s+/gu, " ");
    expect(help).toContain(
      "list every source -> target conversion this CLI supports via a <source>-to-<target> command",
    );
    expect(help).toContain(
      "emit the conversion list as a JSON array instead of a human-readable table",
    );
  });
});
