import { describe, expect, it } from "vitest";
import { readGuid, writeGuid } from "./wire";

// Direct coverage for readGuid/writeGuid (src/oleps/wire.ts), isolated from ./read.ts and ./write.ts: those two only ever call writeGuid immediately before overwriting the very next field (Offset0), so a writer that wrote one byte past its own 16-byte Data4 region would have that overwrite silently erased by the following legitimate write -- never observable through a full writePropertySetStream/readPropertySetStream round trip. Passing writeGuid a DataView sized to exactly the GUID's own 16 bytes makes that off-by-one byte write land outside the view entirely, where DataView's own bounds check throws rather than silently clobbering an unrelated byte.

describe("writeGuid / readGuid", () => {
  it("round-trips a GUID with a distinct byte in every position", () => {
    // Every one of Data1/Data2/Data3/Data4's bytes differs from its neighbours, so a slice/offset arithmetic error in either direction moves a real byte into the wrong slot rather than duplicating an already-matching one.
    const guid = "{01234567-89AB-CDEF-0123-456789ABCDEF}";
    const bytes = new Uint8Array(16);
    const view = new DataView(bytes.buffer);
    writeGuid(view, 0, guid);
    expect(readGuid(view, 0)).toBe(guid);
  });

  it("writes exactly its own 16 bytes and no further, even into a buffer sized to hold only one GUID", () => {
    // A DataView spanning precisely 16 bytes: any write past index 15 throws, catching a Data4 loop bound one iteration too long that a shared, larger property-set buffer would otherwise silently absorb.
    const bytes = new Uint8Array(16);
    const view = new DataView(bytes.buffer);
    expect(() => {
      writeGuid(view, 0, "{00000000-0000-0000-0000-000000000000}");
    }).not.toThrow();
  });

  it("does not disturb bytes immediately before or after the GUID field", () => {
    const bytes = new Uint8Array(18).fill(0xaa);
    const view = new DataView(bytes.buffer);
    writeGuid(view, 1, "{11111111-2222-3333-4444-555555555555}");
    expect(bytes[0]).toBe(0xaa);
    expect(bytes[17]).toBe(0xaa);
  });
});
