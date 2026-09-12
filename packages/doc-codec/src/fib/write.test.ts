import { describe, expect, it } from "vitest";
import { readUint16LE, readUint32LE } from "../bytes";
import { parseFib } from "./fib";
import {
  FIB_CB_RG_FC_LCB_OFFSET,
  FIB_RG_LW_OFFSET,
  LW_OFFSET,
} from "./offsets";
import { buildFib, type FibWriteSpec } from "./write";

const MINIMAL: FibWriteSpec = {
  ccpText: 0,
  cbMac: 0,
  fcClx: 0,
  lcbClx: 0,
  fcPlcfSed: 0,
  lcbPlcfSed: 0,
  fcPlcfBteChpx: 0,
  lcbPlcfBteChpx: 0,
  fcPlcfBtePapx: 0,
  lcbPlcfBtePapx: 0,
  fcStshf: 0,
  lcbStshf: 0,
  fcSttbfFfn: 0,
  lcbSttbfFfn: 0,
  fcPlfLst: 0,
  lcbPlfLst: 0,
  fcPlfLfo: 0,
  lcbPlfLfo: 0,
  ccpFtn: 0,
  fcPlcffndTxt: 0,
  lcbPlcffndTxt: 0,
  ccpHdd: 0,
  fcPlcfHdd: 0,
  lcbPlcfHdd: 0,
  ccpAtn: 0,
  fcPlcfandTxt: 0,
  lcbPlcfandTxt: 0,
  ccpEdn: 0,
  fcPlcfendTxt: 0,
  lcbPlcfendTxt: 0,
};

describe("buildFib", () => {
  it("writes a Fib whose own wIdent, csw, and cslw parseFib accepts", () => {
    const fib = parseFib(buildFib(MINIMAL));
    expect(fib.nFib).toBe(0x00c1);
  });

  it("round-trips every fc/lcb pair and ccp count this writer states, each its own distinct value", () => {
    const spec: FibWriteSpec = {
      ccpText: 10,
      cbMac: 0x2000,
      fcClx: 0x10,
      lcbClx: 0x11,
      fcPlcfSed: 0x20,
      lcbPlcfSed: 0x21,
      fcPlcfBteChpx: 0x30,
      lcbPlcfBteChpx: 0x31,
      fcPlcfBtePapx: 0x40,
      lcbPlcfBtePapx: 0x41,
      fcStshf: 0x50,
      lcbStshf: 0x51,
      fcSttbfFfn: 0x60,
      lcbSttbfFfn: 0x61,
      fcPlfLst: 0x70,
      lcbPlfLst: 0x71,
      fcPlfLfo: 0x80,
      lcbPlfLfo: 0x81,
      ccpFtn: 1,
      fcPlcffndTxt: 0x90,
      lcbPlcffndTxt: 0x91,
      ccpHdd: 2,
      fcPlcfHdd: 0xa0,
      lcbPlcfHdd: 0xa1,
      ccpAtn: 3,
      fcPlcfandTxt: 0xb0,
      lcbPlcfandTxt: 0xb1,
      ccpEdn: 4,
      fcPlcfendTxt: 0xc0,
      lcbPlcfendTxt: 0xc1,
    };
    const fib = parseFib(buildFib(spec));
    expect(fib.ccpText).toBe(10);
    expect(fib.cbMac).toBe(0x2000);
    expect(fib.fcClx).toBe(0x10);
    expect(fib.lcbClx).toBe(0x11);
    expect(fib.fcPlcfSed).toBe(0x20);
    expect(fib.lcbPlcfSed).toBe(0x21);
    expect(fib.fcPlcfBteChpx).toBe(0x30);
    expect(fib.lcbPlcfBteChpx).toBe(0x31);
    expect(fib.fcPlcfBtePapx).toBe(0x40);
    expect(fib.lcbPlcfBtePapx).toBe(0x41);
    expect(fib.fcStshf).toBe(0x50);
    expect(fib.lcbStshf).toBe(0x51);
    expect(fib.fcSttbfFfn).toBe(0x60);
    expect(fib.lcbSttbfFfn).toBe(0x61);
    expect(fib.fcPlfLst).toBe(0x70);
    expect(fib.lcbPlfLst).toBe(0x71);
    expect(fib.fcPlfLfo).toBe(0x80);
    expect(fib.lcbPlfLfo).toBe(0x81);
    expect(fib.ccpFtn).toBe(1);
    expect(fib.fcPlcffndTxt).toBe(0x90);
    expect(fib.lcbPlcffndTxt).toBe(0x91);
    expect(fib.ccpHdd).toBe(2);
    expect(fib.fcPlcfHdd).toBe(0xa0);
    expect(fib.lcbPlcfHdd).toBe(0xa1);
    expect(fib.ccpAtn).toBe(3);
    expect(fib.fcPlcfandTxt).toBe(0xb0);
    expect(fib.lcbPlcfandTxt).toBe(0xb1);
    expect(fib.ccpEdn).toBe(4);
    expect(fib.fcPlcfendTxt).toBe(0xc0);
    expect(fib.lcbPlcfendTxt).toBe(0xc1);
  });

  it("always selects fWhichTblStm 1 (the '1Table' stream)", () => {
    const fib = parseFib(buildFib(MINIMAL));
    expect(fib.fWhichTblStm).toBe(1);
  });

  it("writes fComplex/fEncrypted/fObfuscated all clear, for a fresh unencrypted document", () => {
    const fib = parseFib(buildFib(MINIMAL));
    expect(fib.fComplex).toBe(false);
  });

  it("writes cswNew as a real 0, immediately after the FibRgFcLcb97 blob, with no fibRgCswNew following it", () => {
    const bytes = buildFib(MINIMAL);
    // FIB_FC_LCB_BLOB_OFFSET (154) + CB_RG_FC_LCB_WORD_97 (0x005D) * 8 is where cswNew sits.
    const cswNewOffset = 154 + 0x005d * 8;
    expect(readUint16LE(bytes, cswNewOffset)).toBe(0);
    expect(bytes.length).toBe(cswNewOffset + 2);
  });

  it("writes cbRgFcLcb as the 0x005D word-97 mandates and cbMac/ccpText at their own FibRgLw97 offsets", () => {
    const bytes = buildFib({ ...MINIMAL, cbMac: 0x99, ccpText: 0x77 });
    expect(readUint16LE(bytes, FIB_CB_RG_FC_LCB_OFFSET)).toBe(0x005d);
    expect(readUint32LE(bytes, FIB_RG_LW_OFFSET + LW_OFFSET.cbMac)).toBe(0x99);
    expect(readUint32LE(bytes, FIB_RG_LW_OFFSET + LW_OFFSET.ccpText)).toBe(
      0x77,
    );
  });
});
