import { describe, expect, it } from "vitest";
import { readRecordAt, readRecordSequence } from "../record/tree";
import {
  RT_TextBytesAtom,
  RT_TextCharsAtom,
  RT_TextHeaderAtom,
} from "../record/types";
import {
  asciiBytes,
  atom,
  concatBytes,
  u32le,
  utf16le,
} from "../test-support/records";
import {
  TEXT_TYPE_BODY,
  TEXT_TYPE_TITLE,
  characterCountOf,
  readTextBody,
  readTextHeaderAtom,
  splitParagraphs,
} from "./atoms";

describe("readTextHeaderAtom", () => {
  it("reads the textType that says which placeholder the text belongs to", () => {
    const bytes = atom(RT_TextHeaderAtom, u32le(TEXT_TYPE_TITLE));
    expect(readTextHeaderAtom(readRecordAt(bytes, 0))).toBe(TEXT_TYPE_TITLE);
  });

  it("reads Tx_TYPE_BODY as distinct from Tx_TYPE_TITLE", () => {
    const bytes = atom(RT_TextHeaderAtom, u32le(TEXT_TYPE_BODY));
    expect(readTextHeaderAtom(readRecordAt(bytes, 0))).toBe(TEXT_TYPE_BODY);
  });
});

describe("readTextBody", () => {
  it("decodes a TextBytesAtom, each byte being a character's low byte with a 0x00 high byte", () => {
    const bytes = atom(RT_TextBytesAtom, asciiBytes("Hello"));
    expect(readTextBody(readRecordSequence(bytes, 0, bytes.length))).toBe(
      "Hello",
    );
  });

  it("decodes a TextCharsAtom as UTF-16, so a non-Latin character survives", () => {
    const bytes = atom(RT_TextCharsAtom, utf16le("Grüße"));
    expect(readTextBody(readRecordSequence(bytes, 0, bytes.length))).toBe(
      "Grüße",
    );
  });

  it("returns undefined when neither text atom is present, rather than an empty string", () => {
    const bytes = atom(RT_TextHeaderAtom, u32le(TEXT_TYPE_BODY));
    expect(
      readTextBody(readRecordSequence(bytes, 0, bytes.length)),
    ).toBeUndefined();
  });

  it("prefers the TextCharsAtom when a producer emitted both", () => {
    const bytes = concatBytes(
      atom(RT_TextCharsAtom, utf16le("wide")),
      atom(RT_TextBytesAtom, asciiBytes("narrow")),
    );
    expect(readTextBody(readRecordSequence(bytes, 0, bytes.length))).toBe(
      "wide",
    );
  });

  it("reads a TextCharsAtom of zero length as the empty string", () => {
    const bytes = atom(RT_TextCharsAtom, new Uint8Array(0));
    expect(readTextBody(readRecordSequence(bytes, 0, bytes.length))).toBe("");
  });
});

describe("characterCountOf", () => {
  it("counts one more character than the atom stores, for the unstored terminating paragraph mark", () => {
    // [MS-PPT] 2.9.x worked example: a 21-byte textBytes array has a text body length of 22 "because of the terminating line break character", and the TextCFRun counts sum to 22.
    expect(characterCountOf("an \runderlined\rcircle")).toBe(22);
  });

  it("counts an empty text body as the terminator alone", () => {
    expect(characterCountOf("")).toBe(1);
  });
});

describe("splitParagraphs", () => {
  it("splits on the stored carriage return that separates paragraphs within one text body", () => {
    expect(
      splitParagraphs("a sunny day\rthe blue sky\rsome green grass"),
    ).toEqual([
      { text: "a sunny day", start: 0 },
      { text: "the blue sky", start: 12 },
      { text: "some green grass", start: 25 },
    ]);
  });

  it("reports the character offset of each paragraph, counting the separator itself", () => {
    expect(splitParagraphs("ab\rcd").map((p) => p.start)).toEqual([0, 3]);
  });

  it("yields a single empty paragraph for an empty text body", () => {
    expect(splitParagraphs("")).toEqual([{ text: "", start: 0 }]);
  });

  it("yields an empty paragraph between two consecutive separators", () => {
    expect(splitParagraphs("a\r\rb").map((p) => p.text)).toEqual([
      "a",
      "",
      "b",
    ]);
  });

  it("keeps a vertical tab inside its paragraph, converted to a newline rather than ending it", () => {
    expect(splitParagraphs("one\u000Btwo")).toEqual([
      { text: "one\ntwo", start: 0 },
    ]);
  });
});
