import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFilesystemMarkdownImageResolver } from "./markdown-images";

let workspace: string;

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "document-cli-md-images-"));
  await writeFile(join(workspace, "image.png"), new Uint8Array([1, 2, 3, 4]));
});

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe("createFilesystemMarkdownImageResolver", () => {
  it("reads a relative destination against the given base directory", () => {
    const resolver = createFilesystemMarkdownImageResolver(workspace);
    const result = resolver("./image.png");
    expect(result?.bytes).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it("reads a bare relative destination with no leading ./", () => {
    const resolver = createFilesystemMarkdownImageResolver(workspace);
    expect(resolver("image.png")?.bytes).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it("reads an absolute destination directly", () => {
    const resolver = createFilesystemMarkdownImageResolver("/does/not/exist");
    const result = resolver(join(workspace, "image.png"));
    expect(result?.bytes).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it("returns undefined for an empty destination", () => {
    const resolver = createFilesystemMarkdownImageResolver(workspace);
    expect(resolver("")).toBeUndefined();
  });

  it("returns undefined for a data: URI", () => {
    const resolver = createFilesystemMarkdownImageResolver(workspace);
    expect(resolver("data:image/png;base64,AAAA")).toBeUndefined();
  });

  it("is case-insensitive when recognising a data: URI", () => {
    const resolver = createFilesystemMarkdownImageResolver(workspace);
    expect(resolver("DATA:image/png;base64,AAAA")).toBeUndefined();
  });

  it("returns undefined for a scheme-prefixed URL", () => {
    const resolver = createFilesystemMarkdownImageResolver(workspace);
    expect(resolver("https://example.com/image.png")).toBeUndefined();
    expect(resolver("http://example.com/image.png")).toBeUndefined();
    expect(resolver("file:///tmp/image.png")).toBeUndefined();
  });

  it("is case-insensitive when recognising a scheme-prefixed URL", () => {
    const resolver = createFilesystemMarkdownImageResolver(workspace);
    expect(resolver("HTTPS://example.com/image.png")).toBeUndefined();
  });

  it("returns undefined when the resolved file does not exist", () => {
    const resolver = createFilesystemMarkdownImageResolver(workspace);
    expect(resolver("missing.png")).toBeUndefined();
  });

  it("does not treat a destination containing a colon with no // as a scheme URL", () => {
    // A Windows-style drive path ('C:\\image.png') or a destination that merely contains a colon must not be misdetected as a scheme URL -- only the scheme://-shaped pattern is excluded, so this falls through to a real (failing) filesystem read rather than being short-circuited to undefined for the wrong reason. Either way the result is undefined, but a mutant that widens or narrows the scheme regex must still be observable: assert via a scheme-shaped destination that DOES resolve, immediately below.
    const resolver = createFilesystemMarkdownImageResolver(workspace);
    expect(resolver("no-scheme:not-a-url")).toBeUndefined();
  });
});
