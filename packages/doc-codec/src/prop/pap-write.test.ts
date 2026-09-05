import { describe, expect, it } from "vitest";
import { encodeParagraphGrpprl } from "./pap-write";

// pap-write.ts's own grpprl encoding at the byte level, for the one property write.test.ts's own round trip through this package's own reader cannot verify: sprm ORDER. prop/pap.ts folds sprms by last-Prl-wins regardless of the order they arrive in, so a round trip through this package alone reads back identically whether sprmPIlvl or sprmPIlfo comes first -- a real consumer (confirmed directly against a LibreOffice-authored .doc) applies the list membership at the moment it sees the id sprm, so the level sprm MUST already be in the grpprl by then. This file pins the emitted byte sequence directly, the same way table/decoration.test.ts pins encodeTableRowGrpprl's own bytes "so they can be checked... by hand" against the specification's own field tables, rather than relying on a round trip that cannot fail on this class of bug.

describe("encodeParagraphGrpprl list membership", () => {
  it("emits sprmPIlvl before sprmPIlfo, byte for byte", () => {
    const bytes = encodeParagraphGrpprl(
      { list: { numId: "9", level: 2 } },
      () => 5,
    );
    // sprmPIlvl (0x260a): opcode LE, then the 1-byte zero-based level. sprmPIlfo (0x460b): opcode LE, then the 2-byte signed one-based ilfo.
    expect(bytes).toEqual([0x0a, 0x26, 0x02, 0x0b, 0x46, 0x05, 0x00]);
  });

  it("places sprmPIlvl's opcode strictly before sprmPIlfo's, regardless of the level or ilfo value", () => {
    const bytes = encodeParagraphGrpprl(
      { list: { numId: "1", level: 7 } },
      () => 200,
    );
    const ilvlOpcodeIndex = bytes.indexOf(0x0a);
    const ilfoOpcodeIndex = bytes.indexOf(0x0b);
    expect(ilvlOpcodeIndex).toBeGreaterThanOrEqual(0);
    expect(ilfoOpcodeIndex).toBeGreaterThan(ilvlOpcodeIndex);
  });

  it("writes no list sprms at all for a paragraph with no list membership", () => {
    expect(encodeParagraphGrpprl({}, () => 1)).toEqual([]);
  });
});
