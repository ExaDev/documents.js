import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { readInput, resolveDefaultOutputPath, writeOutput } from "./io";

let workspace: string;
const originalStdin = process.stdin;

function fakeStdin(chunks: readonly unknown[]): AsyncIterable<unknown> {
  return {
    [Symbol.asyncIterator]() {
      let index = 0;
      return {
        next(): Promise<IteratorResult<unknown>> {
          if (index >= chunks.length) {
            return Promise.resolve({ done: true, value: undefined });
          }
          const value = chunks[index];
          index += 1;
          return Promise.resolve({ done: false, value });
        },
      };
    },
  };
}

function installFakeStdin(chunks: readonly unknown[]): void {
  Object.defineProperty(process, "stdin", {
    value: fakeStdin(chunks),
    configurable: true,
  });
}

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "document-cli-runtime-io-"));
});

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true });
});

afterEach(() => {
  Object.defineProperty(process, "stdin", {
    value: originalStdin,
    configurable: true,
  });
});

describe("readInput", () => {
  it("reads a real file's bytes from disk", async () => {
    const path = join(workspace, "input.bin");
    await writeFile(path, new Uint8Array([9, 8, 7]));
    const bytes = await readInput(path);
    expect(bytes).toEqual(new Uint8Array([9, 8, 7]));
  });

  it("propagates Node's own ENOENT error unmodified for a missing file", async () => {
    await expect(readInput(join(workspace, "missing.bin"))).rejects.toThrow(
      /ENOENT/,
    );
  });

  it("reads and concatenates every chunk from stdin when the path is '-'", async () => {
    installFakeStdin([Buffer.from([1, 2]), Buffer.from([3, 4, 5])]);
    const bytes = await readInput("-");
    expect(bytes).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
  });

  it("returns an empty array for stdin with no chunks at all", async () => {
    installFakeStdin([]);
    expect(await readInput("-")).toEqual(new Uint8Array());
  });

  it("throws when a stdin chunk is not a buffer", async () => {
    installFakeStdin(["not a buffer"]);
    await expect(readInput("-")).rejects.toThrow(/Unexpected non-buffer chunk/);
  });

  it("throws when the signal is already aborted before any chunk is read", async () => {
    installFakeStdin([Buffer.from([1])]);
    const controller = new AbortController();
    controller.abort();
    await expect(readInput("-", { signal: controller.signal })).rejects.toThrow(
      /aborted/,
    );
  });

  it("throws once the signal aborts partway through reading stdin", async () => {
    const controller = new AbortController();
    // A custom async iterable (rather than the plain fakeStdin array) so the signal can be aborted as a side effect of producing the second chunk, simulating a signal that fires between two chunks arriving.
    Object.defineProperty(process, "stdin", {
      value: {
        [Symbol.asyncIterator]() {
          let index = 0;
          return {
            next(): Promise<IteratorResult<unknown>> {
              if (index === 0) {
                index += 1;
                return Promise.resolve({
                  done: false,
                  value: Buffer.from([1]),
                });
              }
              if (index === 1) {
                index += 1;
                controller.abort();
                return Promise.resolve({
                  done: false,
                  value: Buffer.from([2]),
                });
              }
              return Promise.resolve({ done: true, value: undefined });
            },
          };
        },
      },
      configurable: true,
    });
    await expect(readInput("-", { signal: controller.signal })).rejects.toThrow(
      /aborted/,
    );
  });
});

describe("writeOutput", () => {
  it("writes bytes to a real file on disk", async () => {
    const path = join(workspace, "output.bin");
    await writeOutput(path, new Uint8Array([1, 2, 3]));
    expect(await readFile(path)).toEqual(Buffer.from([1, 2, 3]));
  });

  it("writes to stdout when the path is '-'", async () => {
    const written: Uint8Array[] = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((
      chunk: Uint8Array,
      callback?: (error?: Error | null) => void,
    ) => {
      written.push(chunk);
      callback?.(null);
      return true;
    }) as typeof process.stdout.write;
    try {
      await writeOutput("-", new Uint8Array([4, 5, 6]));
    } finally {
      process.stdout.write = original;
    }
    expect(written).toEqual([new Uint8Array([4, 5, 6])]);
  });

  it("rejects when writing to stdout fails", async () => {
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((
      _chunk: Uint8Array,
      callback?: (error?: Error | null) => void,
    ) => {
      callback?.(new Error("EPIPE: broken pipe"));
      return true;
    }) as typeof process.stdout.write;
    try {
      await expect(writeOutput("-", new Uint8Array([1]))).rejects.toThrow(
        /EPIPE/,
      );
    } finally {
      process.stdout.write = original;
    }
  });
});

describe("resolveDefaultOutputPath", () => {
  it("swaps the extension for the target format's canonical extension", () => {
    expect(resolveDefaultOutputPath("report.docx", "pdf")).toBe("report.pdf");
  });

  it("preserves the directory of the input path", () => {
    expect(resolveDefaultOutputPath("a/b/report.docx", "pdf")).toBe(
      "a/b/report.pdf",
    );
  });

  it("uses markdown's own 'md' extension, not the format name itself", () => {
    expect(resolveDefaultOutputPath("report.docx", "markdown")).toBe(
      "report.md",
    );
  });

  it("handles an input path with no directory component", () => {
    expect(resolveDefaultOutputPath("report.docx", "pdf")).toBe("report.pdf");
  });
});
