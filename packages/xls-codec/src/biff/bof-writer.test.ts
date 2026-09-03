import { describe, expect, it } from "vitest";

import { writeBofData } from "./bof-writer";
import {
  BIFF8_VERSION,
  BOF_TYPE_WORKBOOK,
  BOF_TYPE_WORKSHEET,
} from "./record-types";

function u16(bytes: Uint8Array<ArrayBuffer>, offset: number): number {
  return new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint16(offset, true);
}

describe("writeBofData", () => {
  it("writes a 16-byte payload, [MS-XLS] 2.4.21's own BIFF8 BOF length", () => {
    expect(writeBofData(BOF_TYPE_WORKBOOK).length).toBe(16);
  });

  it("declares the BIFF8 version this reader requires", () => {
    // splitSubstreams.ts's own readBofDocumentType rejects anything but 0x0600.
    expect(u16(writeBofData(BOF_TYPE_WORKBOOK), 0)).toBe(BIFF8_VERSION);
  });

  it("declares the given substream document type", () => {
    expect(u16(writeBofData(BOF_TYPE_WORKBOOK), 2)).toBe(BOF_TYPE_WORKBOOK);
    expect(u16(writeBofData(BOF_TYPE_WORKSHEET), 2)).toBe(BOF_TYPE_WORKSHEET);
  });

  it("declares one of the two [MS-XLS]-permitted rupYear values", () => {
    const rupYear = u16(writeBofData(BOF_TYPE_WORKBOOK), 6);
    expect([0x07cc, 0x07cd]).toContain(rupYear);
  });
});
