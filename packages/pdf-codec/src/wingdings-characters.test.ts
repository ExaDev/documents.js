import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  WEBDINGS_CHARACTERS,
  WINGDINGS_2_CHARACTERS,
  WINGDINGS_3_CHARACTERS,
} from "./dingbat-characters";
import { WINGDINGS_CHARACTERS } from "./wingdings-characters";

// The vendored source-reference list of WG2 N4384, read straight from its file, so a table entry that was transcribed wrongly shows up as a mismatch rather than agreeing with itself. Each entry line is `UCS;identifier[;identifier]`, hexadecimal code point then one or two decimal identifiers.
function sourceReferences(): ReadonlyMap<number, string> {
  const text = readFileSync(
    new URL(
      "../assets/unicode-wingdings/source-references.txt",
      import.meta.url,
    ),
    "utf8",
  );
  const characterOf = new Map<number, string>();
  for (const line of text.split("\n")) {
    if (line === "" || line.startsWith("#")) {
      continue;
    }
    const [codePoint = "", ...identifiers] = line.split(";");
    for (const identifier of identifiers) {
      characterOf.set(
        Number(identifier),
        String.fromCodePoint(Number.parseInt(codePoint, 16)),
      );
    }
  }
  return characterOf;
}

const CODE_COUNT = 256;
const SPACE_CODE = 0x20;

describe("the symbol font tables against Unicode's source references", () => {
  it.each([
    ["Webdings", WEBDINGS_CHARACTERS, 0],
    ["Wingdings", WINGDINGS_CHARACTERS, 1000],
    ["Wingdings 2", WINGDINGS_2_CHARACTERS, 2000],
    ["Wingdings 3", WINGDINGS_3_CHARACTERS, 3000],
  ] as const)(
    "gives every %s code the character the list gives its identifier, a space at 0x20, and nothing where the list gives none",
    (_, table, identifierBase) => {
      const references = sourceReferences();
      expect(table).toHaveLength(CODE_COUNT);
      const mismatches = table.flatMap((character, code) => {
        // Every table holds a space at 0x20, outside the list's identifiers, since each font draws one there.
        const expected =
          code === SPACE_CODE
            ? " "
            : (references.get(identifierBase + code) ?? "");
        return character === expected ? [] : [{ code, character, expected }];
      });
      expect(mismatches).toEqual([]);
    },
  );

  it("names the characters the investigation found the fonts drawing", () => {
    expect(WINGDINGS_2_CHARACTERS[0x50]).toBe("\u{1F5F8}");
    expect(WINGDINGS_2_CHARACTERS[0x6c]).toBe("③");
    expect(WINGDINGS_3_CHARACTERS[0xea]).toBe("\u{1F892}");
    expect(WEBDINGS_CHARACTERS[0x3d]).toBe("⏺");
  });

  it("maps no code of any table to a Private Use Area code point", () => {
    const privateUse = /\p{Co}/u;
    for (const table of [
      WEBDINGS_CHARACTERS,
      WINGDINGS_2_CHARACTERS,
      WINGDINGS_3_CHARACTERS,
    ]) {
      expect(table.filter((character) => privateUse.test(character))).toEqual(
        [],
      );
    }
  });
});
