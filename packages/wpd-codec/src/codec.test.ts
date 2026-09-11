import { describe, expect, it } from "vitest";
import { WpdBytesSchema } from "./codec";

// Direct coverage of hasWordPerfectOrCompoundHeader's two independent every()-over-a-magic-byte-array checks, neither of which any other test in this package exercises: read.test.ts and container.test.ts only ever build bytes that already carry a genuine WPD or compound file ID, and never a byte array that partially, but not fully, matches one.
describe("WpdBytesSchema", () => {
  it("accepts bytes carrying the exact WPD file ID", () => {
    const bytes = new Uint8Array([0xff, 0x57, 0x50, 0x43, 0, 0, 0, 0]);
    expect(WpdBytesSchema.safeParse(bytes).success).toBe(true);
  });

  it("rejects bytes matching the WPD file ID's first byte but not its second", () => {
    const bytes = new Uint8Array([0xff, 0x00, 0x50, 0x43, 0, 0, 0, 0]);
    expect(WpdBytesSchema.safeParse(bytes).success).toBe(false);
  });

  it("accepts bytes carrying the exact OLE compound file signature", () => {
    const bytes = new Uint8Array([
      0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
    ]);
    expect(WpdBytesSchema.safeParse(bytes).success).toBe(true);
  });

  it("rejects bytes matching the compound signature's first byte but not its second", () => {
    const bytes = new Uint8Array([
      0xd0, 0x00, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
    ]);
    expect(WpdBytesSchema.safeParse(bytes).success).toBe(false);
  });

  it("rejects bytes matching neither signature, with a message naming both", () => {
    const result = WpdBytesSchema.safeParse(new Uint8Array([1, 2, 3, 4]));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        "not a WordPerfect document (no FF 57 50 43 file ID, and no OLE compound file signature that could wrap one)",
      );
    }
  });
});
