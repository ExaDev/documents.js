import { describe, expect, it } from "vitest";
import { DocFormatError } from "../errors";
import { buildFib } from "../test-support/fib";
import { parseFib, peekFibBaseFlags, tableStreamName } from "./fib";
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

describe("peekFibBaseFlags", () => {
  it("reads fEncrypted, fObfuscated, and fWhichTblStm from the unencrypted prefix, without requiring a full valid Fib", () => {
    expect(peekFibBaseFlags(buildFib({}))).toEqual({
      fEncrypted: false,
      fObfuscated: false,
      fWhichTblStm: 1,
    });
    expect(peekFibBaseFlags(buildFib({ fEncrypted: true }))).toEqual({
      fEncrypted: true,
      fObfuscated: false,
      fWhichTblStm: 1,
    });
    expect(
      peekFibBaseFlags(buildFib({ fEncrypted: true, fObfuscated: true })),
    ).toEqual({ fEncrypted: true, fObfuscated: true, fWhichTblStm: 1 });
    expect(peekFibBaseFlags(buildFib({ fWhichTblStm: 0 }))).toMatchObject({
      fWhichTblStm: 0,
    });
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

  it("names the actual wrong signature, uppercase and padded to four hex digits", () => {
    expect(() => parseFib(buildFib({ wIdent: 0x00ab }))).toThrow(
      /begins with 0x00AB rather than/,
    );
  });

  it("rejects a csw that disagrees with the mandated 0x000E", () => {
    const fib = buildFib({});
    new DataView(fib.buffer).setUint16(32, 0x0001, true); // csw, per test-support/fib.ts's own offset.
    expect(() => parseFib(fib)).toThrow(
      /Fib.csw is 0x1 rather than the mandated 0xe/,
    );
  });

  it("rejects a cslw that disagrees with the mandated 0x0016", () => {
    const fib = buildFib({});
    new DataView(fib.buffer).setUint16(62, 0x0001, true); // cslw, per test-support/fib.ts's own offset.
    expect(() => parseFib(fib)).toThrow(
      /Fib.cslw is 0x1 rather than the mandated 0x16/,
    );
  });

  it("accepts a cbRgFcLcb whose blob reaches this reader's own highest value index (149, lcbPlfLfo) by exactly one 4-byte value", () => {
    expect(() => parseFib(buildFib({ cbRgFcLcb: 75 }))).not.toThrow();
  });

  it("rejects a cbRgFcLcb whose blob ends exactly at the highest value index this reader needs, one 4-byte value short", () => {
    expect(() => parseFib(buildFib({ cbRgFcLcb: 74 }))).toThrow(
      /a FibRgFcLcb blob of 148 4-byte values, which does not reach value index 149/,
    );
  });

  it("reads fWhichTblStm, which names the Table stream every other offset is relative to", () => {
    expect(tableStreamName(parseFib(buildFib({ fWhichTblStm: 1 })))).toBe(
      "1Table",
    );
    expect(tableStreamName(parseFib(buildFib({ fWhichTblStm: 0 })))).toBe(
      "0Table",
    );
  });

  it("no longer refuses fEncrypted itself -- read.ts's own orchestration does, via peekFibBaseFlags, before parseFib ever runs on genuinely encrypted bytes", () => {
    expect(parseFib(buildFib({ fEncrypted: true })).nFib).toBe(0x00c1);
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

  it("reads every fc/lcb pair and every FibRgLw97 count this reader consumes, each set to its own distinct non-zero value", () => {
    const fib = parseFib(
      buildFib({
        ccpTxbx: 11,
        ccpHdrTxbx: 12,
        fcPlcffndRef: 0x101,
        lcbPlcffndRef: 0x102,
        fcPlcfandRef: 0x103,
        lcbPlcfandRef: 0x104,
        fcPlcfendRef: 0x105,
        lcbPlcfendRef: 0x106,
        fcPlcffndTxt: 0x107,
        lcbPlcffndTxt: 0x108,
        fcPlcfandTxt: 0x109,
        lcbPlcfandTxt: 0x10a,
        fcPlcfendTxt: 0x10b,
        lcbPlcfendTxt: 0x10c,
        fcPlcfHdd: 0x10d,
        lcbPlcfHdd: 0x10e,
        fcPlfLst: 0x10f,
        lcbPlfLst: 0x110,
        fcPlfLfo: 0x111,
        lcbPlfLfo: 0x112,
      }),
    );
    expect(fib.ccpTxbx).toBe(11);
    expect(fib.ccpHdrTxbx).toBe(12);
    expect(fib.fcPlcffndRef).toBe(0x101);
    expect(fib.lcbPlcffndRef).toBe(0x102);
    expect(fib.fcPlcfandRef).toBe(0x103);
    expect(fib.lcbPlcfandRef).toBe(0x104);
    expect(fib.fcPlcfendRef).toBe(0x105);
    expect(fib.lcbPlcfendRef).toBe(0x106);
    expect(fib.fcPlcffndTxt).toBe(0x107);
    expect(fib.lcbPlcffndTxt).toBe(0x108);
    expect(fib.fcPlcfandTxt).toBe(0x109);
    expect(fib.lcbPlcfandTxt).toBe(0x10a);
    expect(fib.fcPlcfendTxt).toBe(0x10b);
    expect(fib.lcbPlcfendTxt).toBe(0x10c);
    expect(fib.fcPlcfHdd).toBe(0x10d);
    expect(fib.lcbPlcfHdd).toBe(0x10e);
    expect(fib.fcPlfLst).toBe(0x10f);
    expect(fib.lcbPlfLst).toBe(0x110);
    expect(fib.fcPlfLfo).toBe(0x111);
    expect(fib.lcbPlfLfo).toBe(0x112);
  });

  it("writes nFibBack as a real little-endian 0x00BF, even though this reader never consumes it", () => {
    const fib = buildFib({});
    expect(new DataView(fib.buffer).getUint16(12, true)).toBe(0x00bf);
  });
});
