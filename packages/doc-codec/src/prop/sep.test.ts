import { describe, expect, it } from "vitest";
import { readAllSectionProperties } from "./sep";
import { applySectionSprms } from "./sep";
import { decodeSprm, SGC, type Prl } from "./sprm";

function prl(value: number, operand: readonly number[]): Prl {
  return { sprm: decodeSprm(value), operand: new Uint8Array(operand) };
}

function uint16(value: number): number[] {
  return [value & 0xff, (value >> 8) & 0xff];
}

function int16(value: number): number[] {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setInt16(0, value, true);
  return Array.from(bytes);
}

describe("applySectionSprms", () => {
  it("resolves pageSize.widthPt and heightPt", () => {
    const props = applySectionSprms(
      [prl(0xb01f, uint16(12240)), prl(0xb020, uint16(15840))],
      {},
    );
    expect(props.pageWidthPt).toBe(612);
    expect(props.pageHeightPt).toBe(792);
  });

  it("resolves margins.leftPt and rightPt", () => {
    const props = applySectionSprms(
      [prl(0xb021, uint16(1800)), prl(0xb022, uint16(1800))],
      {},
    );
    expect(props.marginLeftPt).toBe(90);
    expect(props.marginRightPt).toBe(90);
  });

  it("resolves margins.topPt/bottomPt from a positive (minimum-margin) YAS as its own absolute value", () => {
    const props = applySectionSprms(
      [prl(0x9023, int16(1440)), prl(0x9024, int16(1440))],
      {},
    );
    expect(props.marginTopPt).toBe(72);
    expect(props.marginBottomPt).toBe(72);
  });

  it("resolves margins.topPt/bottomPt from a negative (fixed-margin) YAS as its own absolute value too", () => {
    const props = applySectionSprms(
      [prl(0x9023, int16(-1440)), prl(0x9024, int16(-1440))],
      {},
    );
    expect(props.marginTopPt).toBe(72);
    expect(props.marginBottomPt).toBe(72);
  });

  it("ignores a non-section-family sprm even at a colliding opcode value", () => {
    const characterSprm: Prl = {
      sprm: { ...decodeSprm(0xb01f), sgc: SGC.character },
      operand: new Uint8Array(uint16(12240)),
    };
    expect(applySectionSprms([characterSprm], {}).pageWidthPt).toBeUndefined();
  });

  it("ignores a paragraph-family sprm that never reaches the section switch at all", () => {
    const result = applySectionSprms([prl(0x0000, [0])], {
      pageWidthPt: 400,
    });
    expect(result.pageWidthPt).toBe(400);
  });

  it("falls through the switch's own default case for a section-family sprm this reader does not convert", () => {
    // sgc bits 10-12 of 0x1000 decode to SGC.section (4), but the full value matches none of the SPRM_S_* opcodes this reader handles -- the one way to actually reach the switch's default case rather than the sgc guard above it.
    const result = applySectionSprms([prl(0x1000, [0])], {
      pageWidthPt: 400,
    });
    expect(result.pageWidthPt).toBe(400);
  });

  it("applies the last Prl's value when the same property is set twice", () => {
    const result = applySectionSprms(
      [prl(0xb01f, uint16(100)), prl(0xb01f, uint16(200))],
      {},
    );
    expect(result.pageWidthPt).toBe(10);
  });
});

describe("readAllSectionProperties", () => {
  it("resolves to a single zero-start entry with no properties when the file has no PlcfSed at all", () => {
    const sections = readAllSectionProperties(
      new Uint8Array(0),
      new Uint8Array(0),
      { fcPlcfSed: 0, lcbPlcfSed: 0 },
    );
    expect(sections).toEqual([{ startCp: 0 }]);
  });

  it("resolves to a single zero-start entry when the PlcfSed is present but genuinely empty (one terminating key, no Sed elements)", () => {
    const table = new Uint8Array(4); // a single uint32 key, zero data elements: parsePlc's own count = (4 - 4) / 16 = 0.
    const sections = readAllSectionProperties(new Uint8Array(0), table, {
      fcPlcfSed: 0,
      lcbPlcfSed: 4,
    });
    expect(sections).toEqual([{ startCp: 0 }]);
  });

  it("names 'PlcfSed in the Table stream' when the declared PlcfSed itself runs past the table's own end", () => {
    expect(() =>
      readAllSectionProperties(new Uint8Array(0), new Uint8Array(4), {
        fcPlcfSed: 0,
        lcbPlcfSed: 100,
      }),
    ).toThrow(/PlcfSed in the Table stream/);
  });

  it("names 'PlcfSed' when the PlcfSed's own declared size fails parsePlc's element-count arithmetic", () => {
    expect(() =>
      readAllSectionProperties(new Uint8Array(0), new Uint8Array(20), {
        fcPlcfSed: 0,
        lcbPlcfSed: 10, // (10 - 4) / (4 + 12) = 0.375, not a whole number of Sed elements.
      }),
    ).toThrow(/PlcfSed is 10 bytes/);
  });

  it("names 'Sepx grpprl in the WordDocument stream' when the declared Sepx runs past the WordDocument's own end", () => {
    const table = new Uint8Array(20);
    const view = new DataView(table.buffer);
    view.setUint32(0, 0, true); // aCp[0].
    view.setUint32(4, 0, true); // aCp[1] (ccpText).
    view.setUint32(10, 0, true); // sed.fcSepx -- points at wordDocument offset 0.
    view.setUint32(16, 0xffffffff, true); // sed.fcMpr -- ignored.

    const wordDocument = new Uint8Array(4);
    new DataView(wordDocument.buffer).setUint16(0, 10, true); // Sepx.cb declares 10 bytes, but only 2 remain after it.

    expect(() =>
      readAllSectionProperties(wordDocument, table, {
        fcPlcfSed: 0,
        lcbPlcfSed: 20,
      }),
    ).toThrow(/Sepx grpprl in the WordDocument stream/);
  });

  it("resolves a real single-section document's own page size from its PlcfSed/Sepx", () => {
    // PlcfSed ([MS-DOC] 2.9.269): 2 keys (aCp[0]=0, aCp[1]=ccpText=0) then one 12-byte Sed naming where the Sepx lives.
    const table = new Uint8Array(20);
    const view = new DataView(table.buffer);
    view.setUint32(0, 0, true); // aCp[0].
    view.setUint32(4, 0, true); // aCp[1] (ccpText).
    view.setUint16(8, 0, true); // sed.fn -- ignored.
    view.setUint32(10, 0, true); // sed.fcSepx -- points at wordDocument offset 0.
    view.setUint16(14, 0, true); // sed.fnMpr -- ignored.
    view.setUint32(16, 0xffffffff, true); // sed.fcMpr -- ignored.

    const wordDocument = new Uint8Array(6);
    const wordView = new DataView(wordDocument.buffer);
    const grpprl = [0x1f, 0xb0, 0x40, 0x1f]; // sprmSXaPage, 8000 twips (400pt).
    wordView.setUint16(0, grpprl.length, true); // Sepx.cb.
    wordDocument.set(grpprl, 2);

    const sections = readAllSectionProperties(wordDocument, table, {
      fcPlcfSed: 0,
      lcbPlcfSed: 20,
    });
    expect(sections).toEqual([{ startCp: 0, pageWidthPt: 400 }]);
  });
});
