import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LARGE_RESULT_THRESHOLD_BYTES,
  resolveDocumentOutput,
} from "./document-output";

describe("resolveDocumentOutput", () => {
  it("writes to outputPath and reports the path plus byte length when one is given", async () => {
    const dir = mkdtempSync(join(tmpdir(), "document-output-test-"));
    const path = join(dir, "out.bin");
    const bytes = new TextEncoder().encode("hello");

    const result = await resolveDocumentOutput(bytes, { outputPath: path });

    expect(result).toEqual({ path, byteLength: bytes.byteLength });
    expect(readFileSync(path)).toEqual(Buffer.from(bytes));
  });

  it("returns inline base64 bytes with no large flag when no outputPath is given and below the threshold", async () => {
    const bytes = new TextEncoder().encode("hello");

    const result = await resolveDocumentOutput(bytes, {});

    expect("large" in result).toBe(false);
    expect(result.byteLength).toBe(bytes.byteLength);
    if (!("bytesBase64" in result)) {
      throw new Error("expected inline bytes");
    }
    expect(Buffer.from(result.bytesBase64, "base64")).toEqual(
      Buffer.from(bytes),
    );
  });

  it("does not flag large at exactly the threshold boundary", async () => {
    const bytes = new Uint8Array(LARGE_RESULT_THRESHOLD_BYTES);

    const result = await resolveDocumentOutput(bytes, {});

    expect("large" in result).toBe(false);
  });

  it("flags large: true one byte above the threshold", async () => {
    const bytes = new Uint8Array(LARGE_RESULT_THRESHOLD_BYTES + 1);

    const result = await resolveDocumentOutput(bytes, {});

    expect("large" in result && result.large).toBe(true);
  });
});
