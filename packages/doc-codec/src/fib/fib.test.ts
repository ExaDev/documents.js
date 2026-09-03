import { describe, expect, it } from "vitest";
import { DocFormatError, DocUnsupportedError } from "../errors";
import { buildFib } from "../test-support/fib";
import { parseFib, tableStreamName } from "./fib";
import {
  FIB_FC_LCB_BLOB_OFFSET,
  FIB_RG_LW_OFFSET,
  FIB_RG_W_OFFSET,
} from "./offsets";

// The offsets the whole reader depends on, restated here as an independent check rather than only exercised through parseFib: each is the running sum of the field sizes [MS-DOC] 2.5.1 declares for the Fib, and a single wrong one silently shifts every subsequent read onto neighbouring bytes -- exactly the failure mode that produces plausible-looking wrong output instead of an error.
describe("Fib field offsets", () => {
  it("places FibRgW97 after the 32-byte FibBase and its 2-byte count", () => {
    expect(FIB_RG_W_OFFSET).toBe(34);
  });

  it("places FibRgLw97 after FibRgW97's 28 bytes and its own 2-byte count", () => {
    expect(FIB_RG_LW_OFFSET).toBe(64);
  });

  it("places FibRgFcLcbBlob after FibRgLw97's 88 bytes and cbRgFcLcb's 2", () => {
    expect(FIB_FC_LCB_BLOB_OFFSET).toBe(154);
  });
});

describe("parseFib", () => {
  it("reads the counts and offsets a document's text is reached through", () => {
    const fib = parseFib(
      buildFib({
        ccpText: 42,
        ccpFtn: 7,
        cbMac: 0x1000,
        fcClx: 0x1f8,
        lcbClx: 0x2d,
        fcPlcfBteChpx: 0x300,
        lcbPlcfBteChpx: 0x0c,
        fcPlcfBtePapx: 0x400,
        lcbPlcfBtePapx: 0x0c,
        fcStshf: 0x10,
        lcbStshf: 0x80,
      }),
    );
    expect(fib.nFib).toBe(0x00c1);
    expect(fib.ccpText).toBe(42);
    expect(fib.ccpFtn).toBe(7);
    expect(fib.cbMac).toBe(0x1000);
    expect(fib.fcClx).toBe(0x1f8);
    expect(fib.lcbClx).toBe(0x2d);
    expect(fib.fcPlcfBteChpx).toBe(0x300);
    expect(fib.lcbPlcfBteChpx).toBe(0x0c);
    expect(fib.fcPlcfBtePapx).toBe(0x400);
    expect(fib.lcbPlcfBtePapx).toBe(0x0c);
    expect(fib.fcStshf).toBe(0x10);
    expect(fib.lcbStshf).toBe(0x80);
  });

  it("rejects a stream whose first two bytes are not the mandated 0xA5EC", () => {
    expect(() => parseFib(buildFib({ wIdent: 0x1234 }))).toThrow(
      DocFormatError,
    );
    expect(() => parseFib(buildFib({ wIdent: 0x1234 }))).toThrow(/0xA5EC/);
  });

  it("reads fWhichTblStm, which names the Table stream every other offset is relative to", () => {
    expect(tableStreamName(parseFib(buildFib({ fWhichTblStm: 1 })))).toBe(
      "1Table",
    );
    expect(tableStreamName(parseFib(buildFib({ fWhichTblStm: 0 })))).toBe(
      "0Table",
    );
  });

  it("refuses an encrypted document rather than reading its ciphertext as text", () => {
    expect(() => parseFib(buildFib({ fEncrypted: true }))).toThrow(
      DocUnsupportedError,
    );
  });

  it("reports fComplex, which marks a document last written by an incremental save", () => {
    expect(parseFib(buildFib({ fComplex: true })).fComplex).toBe(true);
    expect(parseFib(buildFib({})).fComplex).toBe(false);
  });

  it("rejects a stream too short to hold the fixed part of the Fib", () => {
    expect(() => parseFib(new Uint8Array(100))).toThrow(DocFormatError);
  });

  it("rejects a cbRgFcLcb too small to reach fcClx, rather than reading past the blob", () => {
    // fcClx sits at value index 66 of FibRgFcLcb97, so a blob of fewer than 34 64-bit values cannot contain it.
    expect(() => parseFib(buildFib({ cbRgFcLcb: 20 }))).toThrow(DocFormatError);
  });

  it("accepts the 0x005D blob size [MS-DOC] mandates for nFib 0x00C1", () => {
    expect(parseFib(buildFib({ cbRgFcLcb: 0x005d })).ccpText).toBe(0);
  });
});
