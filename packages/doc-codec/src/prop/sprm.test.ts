import { describe, expect, it } from "vitest";
import { DocFormatError, DocUnsupportedError } from "../errors";
import { SGC, decodeSprm, operandSize, readGrpprl } from "./sprm";

// [MS-DOC] 2.6.1 gives the decomposition as arithmetic rather than a bit diagram: ISPMD = SPRM & 0x01FF, FSPEC = (SPRM / 512) & 0x0001, SGC = (SPRM / 1024) & 0x0007, SPRA = SPRM / 8192.
describe("decodeSprm", () => {
  it("decomposes sprmCFBold (0x0835) into a 1-byte-operand character property", () => {
    const sprm = decodeSprm(0x0835);
    expect(sprm.ispmd).toBe(0x35);
    expect(sprm.fSpec).toBe(0);
    expect(sprm.sgc).toBe(SGC.character);
    expect(sprm.spra).toBe(0);
  });

  it("decomposes sprmCHps (0x4A43) into a 2-byte-operand character property", () => {
    const sprm = decodeSprm(0x4a43);
    expect(sprm.ispmd).toBe(0x43);
    expect(sprm.sgc).toBe(SGC.character);
    expect(sprm.spra).toBe(2);
  });

  it("decomposes sprmPIstd (0x4600) into a 2-byte-operand paragraph property", () => {
    const sprm = decodeSprm(0x4600);
    expect(sprm.ispmd).toBe(0x00);
    expect(sprm.sgc).toBe(SGC.paragraph);
    expect(sprm.spra).toBe(2);
  });

  it("decomposes sprmPJc (0x2461) into a 1-byte-operand paragraph property", () => {
    const sprm = decodeSprm(0x2461);
    expect(sprm.ispmd).toBe(0x61);
    expect(sprm.sgc).toBe(SGC.paragraph);
    expect(sprm.spra).toBe(1);
  });

  it("decomposes sprmCCv (0x6870), whose spra of 3 means a 4-byte operand", () => {
    const sprm = decodeSprm(0x6870);
    expect(sprm.sgc).toBe(SGC.character);
    expect(sprm.spra).toBe(3);
  });

  it("reads fSpec on a sprm that sets it", () => {
    // 0x0855 is sprmCFSpec: ispmd 0x55, sgc 2, spra 0, fSpec 0.
    expect(decodeSprm(0x0855).fSpec).toBe(0);
    // Setting bit 9 of the same value turns fSpec on without disturbing the other fields.
    expect(decodeSprm(0x0855 | 0x0200).fSpec).toBe(1);
    expect(decodeSprm(0x0855 | 0x0200).ispmd).toBe(0x55);
  });
});

// [MS-DOC] 2.6.1's spra table: 0 (a ToggleOperand) and 1 are one byte, 2, 4 and 5 are two, 3 is four, 7 is three, and 6 is variable.
describe("operandSize", () => {
  it("sizes each fixed spra as the specification's own table states", () => {
    const sized = (sprm: number): number =>
      operandSize(decodeSprm(sprm), new Uint8Array(0), 0);
    expect(sized(0x0000)).toBe(1); // spra 0
    expect(sized(0x2000)).toBe(1); // spra 1
    expect(sized(0x4000)).toBe(2); // spra 2
    expect(sized(0x6000)).toBe(4); // spra 3
    expect(sized(0x8000)).toBe(2); // spra 4
    expect(sized(0xa000)).toBe(2); // spra 5
    expect(sized(0xe000)).toBe(3); // spra 7
  });

  it("sizes an ordinary variable-length sprm from its own leading length byte", () => {
    // sprmPShd (0xC64D), spra 6: the first operand byte gives the size of the rest.
    expect(
      operandSize(decodeSprm(0xc64d), new Uint8Array([3, 0, 0, 0]), 0),
    ).toBe(4);
  });

  it("sizes sprmTDefTable from its 2-byte cb rather than a single length byte", () => {
    // TDefTableOperand.cb is "the number of bytes that are used by the remainder of this structure, incremented by 1", so the whole operand is cb + 1 bytes. A single-column row gives cb = 26 and a 27-byte operand.
    const operand = new Uint8Array(64);
    new DataView(operand.buffer).setUint16(0, 26, true);
    expect(operandSize(decodeSprm(0xd608), operand, 0)).toBe(27);
  });

  it("refuses sprmPChgTabs's 255 sentinel rather than mis-sizing the rest of the grpprl", () => {
    expect(() =>
      operandSize(decodeSprm(0xc615), new Uint8Array([0xff, 0, 0, 0]), 0),
    ).toThrow(DocUnsupportedError);
  });

  it("sizes sprmPChgTabs from its length byte when that byte is not the sentinel", () => {
    expect(
      operandSize(decodeSprm(0xc615), new Uint8Array([6, 0, 0, 0, 0, 0, 0]), 0),
    ).toBe(7);
  });
});

describe("readGrpprl", () => {
  it("walks a grpprl of mixed operand widths", () => {
    // sprmCFBold on (1-byte operand), sprmCHps 24 half-points (2-byte operand), sprmCFItalic on.
    const bytes = new Uint8Array([
      0x35, 0x08, 0x01, 0x43, 0x4a, 0x18, 0x00, 0x36, 0x08, 0x01,
    ]);
    const prls = readGrpprl(bytes);
    expect(prls.map((prl) => prl.sprm.value)).toEqual([0x0835, 0x4a43, 0x0836]);
    expect(Array.from(prls[0]?.operand ?? [])).toEqual([0x01]);
    expect(Array.from(prls[1]?.operand ?? [])).toEqual([0x18, 0x00]);
  });

  it("returns nothing for an empty grpprl", () => {
    expect(readGrpprl(new Uint8Array(0))).toEqual([]);
  });

  it("rejects a grpprl whose last sprm's operand runs past its end", () => {
    // sprmCHps declares a 2-byte operand but only one byte remains.
    expect(() => readGrpprl(new Uint8Array([0x43, 0x4a, 0x18]))).toThrow(
      DocFormatError,
    );
  });

  it("rejects a trailing single byte, too short even for a sprm's own two", () => {
    expect(() => readGrpprl(new Uint8Array([0x35, 0x08, 0x01, 0x00]))).toThrow(
      DocFormatError,
    );
  });
});
