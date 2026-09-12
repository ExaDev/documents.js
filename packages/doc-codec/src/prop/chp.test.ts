import { describe, expect, it } from "vitest";
import { DocFormatError } from "../errors";
import {
  applyCharacterSprms,
  characterIstdFromGrpprl,
  type CharacterProperties,
} from "./chp";
import { decodeSprm, SGC, type Prl } from "./sprm";

function prl(value: number, operand: readonly number[]): Prl {
  return { sprm: decodeSprm(value), operand: new Uint8Array(operand) };
}

describe("applyCharacterSprms", () => {
  it("turns bold on and off via a plain ToggleOperand", () => {
    const on = applyCharacterSprms([prl(0x0835, [0x01])], {});
    expect(on.bold).toBe(true);
    const off = applyCharacterSprms([prl(0x0835, [0x00])], {});
    expect(off.bold).toBe(false);
  });

  it("resolves a toggle's 0x80 (inherit-from-style) operand from the current value", () => {
    const inherited = applyCharacterSprms([prl(0x0835, [0x80])], {
      bold: true,
    });
    expect(inherited.bold).toBe(true);
    const inheritedFalse = applyCharacterSprms([prl(0x0835, [0x80])], {
      bold: undefined,
    });
    expect(inheritedFalse.bold).toBe(false);
  });

  it("resolves a toggle's 0x81 (invert-style) operand as the opposite of the current value", () => {
    expect(
      applyCharacterSprms([prl(0x0835, [0x81])], { bold: true }).bold,
    ).toBe(false);
    expect(applyCharacterSprms([prl(0x0835, [0x81])], {}).bold).toBe(true);
  });

  it("rejects a ToggleOperand value outside the four the spec defines", () => {
    expect(() => applyCharacterSprms([prl(0x0835, [0x02])], {})).toThrow(
      DocFormatError,
    );
    expect(() => applyCharacterSprms([prl(0x0835, [0x02])], {})).toThrow(/0x2/);
  });

  it("folds italic and strike through the identical toggle path", () => {
    const props = applyCharacterSprms(
      [prl(0x0836, [0x01]), prl(0x0837, [0x01])],
      {},
    );
    expect(props.italic).toBe(true);
    expect(props.strike).toBe(true);
  });

  it("resolves underline from a non-zero Kul value, and no underline from zero", () => {
    expect(applyCharacterSprms([prl(0x2a3e, [0x01])], {}).underline).toBe(true);
    expect(applyCharacterSprms([prl(0x2a3e, [0x00])], {}).underline).toBe(
      false,
    );
  });

  it("halves sprmCHps's half-point operand into points", () => {
    // 24 half-points = 12pt.
    expect(applyCharacterSprms([prl(0x4a43, [24, 0])], {}).sizePt).toBe(12);
  });

  it("resolves sprmCIstd to the run's own character style index", () => {
    expect(applyCharacterSprms([prl(0x4a30, [3, 0])], {}).istd).toBe(3);
  });

  it("resolves sprmCIco through the Ico palette", () => {
    const props = applyCharacterSprms([prl(0x2a42, [0x02])], {}); // Ico 0x02: blue.
    expect(props.color).toEqual({ r: 0, g: 0, b: 1 });
  });

  it("resolves sprmCCv to an exact COLORREF, overriding whatever sprmCIco already set", () => {
    const props = applyCharacterSprms(
      [prl(0x2a42, [0x02]), prl(0x6870, [0x11, 0x22, 0x33, 0x00])],
      {},
    );
    expect(props.color).toEqual({
      r: 0x11 / 255,
      g: 0x22 / 255,
      b: 0x33 / 255,
    });
  });

  it("resolves sprmCRgFtc0 to a font name via the font table it indexes", () => {
    const props = applyCharacterSprms([prl(0x4a4f, [1, 0])], {}, [
      "Calibri",
      "Arial",
    ]);
    expect(props.fontFamily).toBe("Arial");
  });

  it("leaves fontFamily unset when sprmCRgFtc0's own index has no entry in the font table", () => {
    const props = applyCharacterSprms([prl(0x4a4f, [9, 0])], {}, ["Calibri"]);
    expect(props.fontFamily).toBeUndefined();
  });

  it("leaves fontFamily unset entirely when no font table is given at all", () => {
    const props = applyCharacterSprms([prl(0x4a4f, [0, 0])], {});
    expect(props.fontFamily).toBeUndefined();
  });

  it("ignores a paragraph-family sprm even if its opcode happened to collide", () => {
    const into: CharacterProperties = {};
    const result = applyCharacterSprms(
      [
        {
          sprm: { ...decodeSprm(0x0835), sgc: SGC.paragraph },
          operand: new Uint8Array([1]),
        },
      ],
      into,
    );
    expect(result.bold).toBeUndefined();
  });

  it("ignores an unrecognised character sprm without touching any property", () => {
    const result = applyCharacterSprms([prl(0x0000, [0x00])], { bold: true });
    expect(result.bold).toBe(true);
  });

  it("applies the last Prl's value when the same property is set twice", () => {
    const result = applyCharacterSprms(
      [prl(0x0835, [0x01]), prl(0x0835, [0x00])],
      {},
    );
    expect(result.bold).toBe(false);
  });

  it("mutates and returns the same accumulator object it was given", () => {
    const into: CharacterProperties = {};
    const result = applyCharacterSprms([prl(0x0835, [0x01])], into);
    expect(result).toBe(into);
  });
});

describe("characterIstdFromGrpprl", () => {
  it("returns undefined when no sprmCIstd is present", () => {
    expect(characterIstdFromGrpprl([prl(0x0835, [0x01])])).toBeUndefined();
  });

  it("resolves sprmCIstd's own istd value", () => {
    expect(characterIstdFromGrpprl([prl(0x4a30, [5, 0])])).toBe(5);
  });

  it("takes the last sprmCIstd when more than one appears", () => {
    expect(
      characterIstdFromGrpprl([prl(0x4a30, [1, 0]), prl(0x4a30, [2, 0])]),
    ).toBe(2);
  });

  it("ignores a paragraph-family sprm even at the identical opcode value", () => {
    const paragraphSprm: Prl = {
      sprm: { ...decodeSprm(0x4a30), sgc: SGC.paragraph },
      operand: new Uint8Array([9, 0]),
    };
    expect(characterIstdFromGrpprl([paragraphSprm])).toBeUndefined();
  });
});
