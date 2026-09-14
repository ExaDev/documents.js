import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFilesystemMarkdownImageResolver } from "./markdown-images";

let workspace: string;

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "document-cli-md-images-"));
  await writeFile(join(workspace, "image.png"), new Uint8Array([1, 2, 3, 4]));
  // A real file at the exact path resolve(workspace, destination) lands on for a genuine scheme-prefixed destination ("http://x" resolves through the literal "http:" path segment produced by the double slash), so the guard's short-circuit is provable: bypassing it would find and read this fixture rather than merely failing to find nothing, which a plain "expect undefined" test can't distinguish from a guard that never ran.
  await mkdir(join(workspace, "http:"), { recursive: true });
  await writeFile(join(workspace, "http:", "x"), new Uint8Array([5, 6, 7]));
  // A destination containing the literal substring "data:" after its first character, so an unanchored data-URI match (rather than the real ^-anchored one) is the only thing that would treat it as a data URI.
  await writeFile(join(workspace, "1data:x"), new Uint8Array([8, 9]));
  // Likewise for the scheme regex: "http://" appears from the second character onward, so only an unanchored scheme match would exclude it.
  await mkdir(join(workspace, "1http:"), { recursive: true });
  await writeFile(join(workspace, "1http:", "x"), new Uint8Array([10, 11]));
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

  it("guards an empty destination before any filesystem read is attempted, not merely because the read would fail", () => {
    // Pointing baseDir directly at a real FILE (not a directory) makes resolve(baseDir, "") equal that file's own path -- so if the guard's condition were bypassed for any reason, readFileSync would succeed and return real bytes instead of undefined. A guard that merely happens to fail the same way a broken guard would (both landing on undefined because the fallback read errors) can't tell these apart; this can.
    const fileAsBaseDir = join(workspace, "image.png");
    const resolver = createFilesystemMarkdownImageResolver(fileAsBaseDir);
    expect(resolver("")).toBeUndefined();
  });

  it("guards a scheme-prefixed destination before any filesystem read is attempted, not merely because the read would fail", () => {
    // "http://x" resolves, via path.resolve's own segment-joining, to the real fixture at workspace/http:/x -- so bypassing the scheme guard here returns real bytes, not undefined-by-coincidence.
    const resolver = createFilesystemMarkdownImageResolver(workspace);
    expect(resolver("http://x")).toBeUndefined();
  });

  it("only excludes a scheme match anchored at the very start of the destination", () => {
    // "1http://x" does not start with a letter, so the real ^-anchored scheme regex must not match it -- it falls through to an actual (successful) read of the fixture at workspace/1http:/x. An unanchored variant of the same regex would match the embedded "http://" and wrongly short-circuit to undefined.
    const resolver = createFilesystemMarkdownImageResolver(workspace);
    expect(resolver("1http://x")?.bytes).toEqual(new Uint8Array([10, 11]));
  });

  it("only excludes a data: match anchored at the very start of the destination", () => {
    // "1data:x" does not start with "data:", so the real ^-anchored regex must not match it -- it falls through to an actual (successful) read of the fixture at workspace/1data:x. An unanchored variant would match the embedded "data:" and wrongly short-circuit to undefined.
    const resolver = createFilesystemMarkdownImageResolver(workspace);
    expect(resolver("1data:x")?.bytes).toEqual(new Uint8Array([8, 9]));
  });
});
