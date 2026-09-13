import { describe, expect, it } from "vitest";
import { FIB_FC_LCB_BLOB_OFFSET } from "../fib/offsets";
import { buildFib } from "./fib";

describe("buildFib", () => {
  it("writes a pair whose last byte lands exactly at the declared blob boundary", () => {
    // fcClx sits at value index 66; a cbRgFcLcb of 34 gives a blob of exactly 272 bytes (34 * 8), which ends precisely at fcClx/lcbClx's own last byte -- the boundary the pair-writer's own bounds guard checks.
    const bytes = buildFib({
      cbRgFcLcb: 34,
      fcClx: 0xabcdef,
      lcbClx: 0x123456,
    });
    const view = new DataView(bytes.buffer);
    const offset = FIB_FC_LCB_BLOB_OFFSET + 66 * 4;
    expect(view.getUint32(offset, true)).toBe(0xabcdef);
    expect(view.getUint32(offset + 4, true)).toBe(0x123456);
  });
});
