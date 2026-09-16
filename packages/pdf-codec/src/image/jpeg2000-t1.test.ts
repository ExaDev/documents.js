import { describe, expect, it } from "vitest";
import { Jpeg2000UnsupportedError } from "./jpeg2000-errors";
import type { Jpeg2000CodeBlockDecodeOptions } from "./jpeg2000-t1";
import { decodeJpeg2000CodeBlock } from "./jpeg2000-t1";

function baseOptions(): Jpeg2000CodeBlockDecodeOptions {
  return {
    width: 4,
    height: 4,
    subband: "LL",
    zeroBitPlanes: 0,
    maxBitPlanes: 1,
    totalPasses: 1,
    codeBlockStyle: 0,
    data: new Uint8Array(0),
  };
}

// throwForUnsupportedStyle runs before any code-block data is touched, so these style-flag checks need no real encoded bytes at all.
describe("decodeJpeg2000CodeBlock: unsupported code-block styles", () => {
  it("rejects selective arithmetic coding bypass (lazy mode)", () => {
    expect(() =>
      decodeJpeg2000CodeBlock({ ...baseOptions(), codeBlockStyle: 0x01 }),
    ).toThrow(Jpeg2000UnsupportedError);
  });

  it("rejects termination of the arithmetic coder on every coding pass", () => {
    expect(() =>
      decodeJpeg2000CodeBlock({ ...baseOptions(), codeBlockStyle: 0x04 }),
    ).toThrow(Jpeg2000UnsupportedError);
  });

  it("accepts the predictable-termination flag without throwing", () => {
    expect(() =>
      decodeJpeg2000CodeBlock({ ...baseOptions(), codeBlockStyle: 0x10 }),
    ).not.toThrow();
  });

  it("accepts a code-block style with none of the flags set", () => {
    expect(() =>
      decodeJpeg2000CodeBlock({ ...baseOptions(), codeBlockStyle: 0 }),
    ).not.toThrow();
  });
});
