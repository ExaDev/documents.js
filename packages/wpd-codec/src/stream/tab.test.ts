import { describe, expect, it } from "vitest";
import { tabEffectFor } from "./tab";

// "bits 3-7: tab type" -- so a definition byte is the type shifted up past the three flag bits, and those flags (soft type, dot leader, generic search) change nothing about what the code does to the text.
function definition(tabType: number, flags = 0): number {
  return (tabType << 3) | flags;
}

describe("tabEffectFor", () => {
  // Back tab, table tab, left tab, bar tab, centre tab, right tab and decimal tab all advance to the next tab stop, which the shared content model spells as the tab character itself.
  it.each([
    ["back tab", 0b00000],
    ["table tab", 0b00001],
    ["left tab", 0b00010],
    ["bar tab", 0b00100],
    ["centre tab", 0b01010],
    ["right tab", 0b10010],
    ["decimal tab", 0b11010],
  ])("reads a %s as a tab", (_name, tabType) => {
    expect(tabEffectFor(definition(tabType))).toEqual({ kind: "tab" });
  });

  // An indent holds the left margin at the tab stop it moves to, a position that comes from the document's own tab-stop table rather than the function. The horizontal advance is a tab's, so that is what survives.
  it.each([
    ["left indent", 0b00110],
    ["left/right indent", 0b00111],
  ])("reads a %s as a tab", (_name, tabType) => {
    expect(tabEffectFor(definition(tabType))).toEqual({ kind: "tab" });
  });

  // These three are not tabs at all: they begin a line-scoped alignment, and they are the missing half of the construct the single-byte End of Center Align functions already end.
  it.each([
    ["centre on margins", 0b01000, "center"],
    ["centre on current position", 0b01001, "center"],
    ["flush right", 0b10000, "right"],
  ])("reads %s as an alignment", (_name, tabType, alignment) => {
    expect(tabEffectFor(definition(tabType))).toEqual({
      kind: "align",
      alignment,
    });
  });

  // The three flag bits below the type are soft type, dot leader and generic search; none of them changes the effect.
  it.each([0b001, 0b010, 0b100, 0b111])(
    "ignores the flag bits %i below the tab type",
    (flags) => {
      expect(tabEffectFor(definition(0b00010, flags))).toEqual({ kind: "tab" });
    },
  );

  // The enumeration is not contiguous -- the number encodes structure rather than counting -- so a value it does not name contributes nothing rather than being guessed at as the nearest type it does.
  it.each([0b00011, 0b00101, 0b01111, 0b11111])(
    "declines the unnamed tab type %i",
    (tabType) => {
      expect(tabEffectFor(definition(tabType))).toBeUndefined();
    },
  );
});
