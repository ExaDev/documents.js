import { describe, expect, it } from "vitest";
import { buildBinTable } from "./fkp";

describe("buildBinTable", () => {
  it("places each page number at its own 4-byte slot after every fc, not just the first", () => {
    // Two fcs (8 bytes) followed by two page numbers -- the second page number's own offset (fcs.length * 4 + index * 4) only diverges from a miscounted one once index is greater than zero.
    const bytes = buildBinTable([0x100, 0x200], [7, 9]);
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(8, true)).toBe(7);
    expect(view.getUint32(12, true)).toBe(9);
  });
});
