import { describe, expect, it } from "vitest";
import { bytes } from "./test-support/bytes";
import type { RtfToken } from "./tokenize";
import { tokenizeRtf } from "./tokenize";

// Every fixture here is taken or minimally adapted from the RTF 1.9.1 specification's own examples and its own stated tokenization rules ("Control Word", "Control Symbol", "Group", "Destinations", "Special Characters"), so a failure names a spec rule rather than a preference.

function textOf(token: RtfToken | undefined): string {
  if (token?.kind !== "text") {
    throw new Error(`expected a text token, got ${token?.kind ?? "nothing"}`);
  }
  return String.fromCharCode(...token.bytes);
}

describe("control word tokenization", () => {
  it("reads a bare control word terminated by a backslash", () => {
    expect(tokenizeRtf(bytes("\\par\\pard"))).toEqual([
      { kind: "controlWord", name: "par" },
      { kind: "controlWord", name: "pard" },
    ]);
  });

  it("discards a single space delimiter without emitting it as text", () => {
    expect(tokenizeRtf(bytes("\\par hello"))).toEqual([
      { kind: "controlWord", name: "par" },
      { kind: "text", bytes: bytes("hello") },
    ]);
  });

  it("keeps every space after the first, because only one space is the delimiter", () => {
    expect(textOf(tokenizeRtf(bytes("\\par  hello"))[1])).toBe(" hello");
  });

  it("reads a positive numeric parameter", () => {
    expect(tokenizeRtf(bytes("\\fs24"))).toEqual([
      { kind: "controlWord", name: "fs", param: 24 },
    ]);
  });

  it("reads a negative numeric parameter, as \\u-4064 for U+F020 in the spec's own Unicode example", () => {
    expect(tokenizeRtf(bytes("\\u-4064"))).toEqual([
      { kind: "controlWord", name: "u", param: -4064 },
    ]);
  });

  it("discards the space delimiting a parameterised control word", () => {
    expect(tokenizeRtf(bytes("\\fs24 Text"))).toEqual([
      { kind: "controlWord", name: "fs", param: 24 },
      { kind: "text", bytes: bytes("Text") },
    ]);
  });

  it("terminates a control word at a non-letter non-digit without consuming it", () => {
    expect(tokenizeRtf(bytes("\\pard{"))).toEqual([
      { kind: "controlWord", name: "pard" },
      { kind: "groupStart" },
    ]);
  });

  it("stops a control word name at 32 letters, the spec's stated maximum", () => {
    const overlong = "a".repeat(40);
    const [token] = tokenizeRtf(bytes(`\\${overlong}`));
    expect(token).toEqual({ kind: "controlWord", name: "a".repeat(32) });
  });
});

describe("control symbol tokenization", () => {
  it("reads a control symbol and does not treat a following space as a delimiter", () => {
    expect(tokenizeRtf(bytes("\\~ x"))).toEqual([
      { kind: "controlSymbol", symbol: "~" },
      { kind: "text", bytes: bytes(" x") },
    ]);
  });

  it("reads the escaped literals \\\\, \\{ and \\} the spec names for using those characters as text", () => {
    expect(tokenizeRtf(bytes("\\\\\\{\\}"))).toEqual([
      { kind: "controlSymbol", symbol: "\\" },
      { kind: "controlSymbol", symbol: "{" },
      { kind: "controlSymbol", symbol: "}" },
    ]);
  });

  it("reads the ignorable-destination marker \\* as a control symbol", () => {
    expect(tokenizeRtf(bytes("{\\*\\generator X}"))).toEqual([
      { kind: "groupStart" },
      { kind: "controlSymbol", symbol: "*" },
      { kind: "controlWord", name: "generator" },
      { kind: "text", bytes: bytes("X") },
      { kind: "groupEnd" },
    ]);
  });

  it("reads \\'hh as a hexadecimal byte value", () => {
    expect(tokenizeRtf(bytes("\\'e9"))).toEqual([{ kind: "hex", byte: 0xe9 }]);
  });

  it("treats a backslash before a line break as \\par, per the spec's carriage-return rule", () => {
    expect(tokenizeRtf(bytes("a\\\r\nb"))).toEqual([
      { kind: "text", bytes: bytes("a") },
      { kind: "controlWord", name: "par" },
      { kind: "text", bytes: bytes("b") },
    ]);
  });
});

describe("group and text tokenization", () => {
  it("ignores bare CRLF in text, which the spec says a reader must skip", () => {
    expect(tokenizeRtf(bytes("one\r\ntwo"))).toEqual([
      { kind: "text", bytes: bytes("onetwo") },
    ]);
  });

  it("tokenizes the specification's own worked header example into balanced groups", () => {
    const sample =
      "{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0\\froman Tms Rmn;}{\\f1\\fdecor Symbol;}}" +
      "{\\colortbl;\\red0\\green0\\blue0;}\\pard\\plain \\fs20 This is plain text.\\par}";
    const tokens = tokenizeRtf(bytes(sample));
    const starts = tokens.filter((token) => token.kind === "groupStart").length;
    const ends = tokens.filter((token) => token.kind === "groupEnd").length;
    // The five groups the fixture spells: the file group, the \fonttbl group, one group per <fontinfo>, and the \colortbl group.
    expect(starts).toBe(5);
    expect(ends).toBe(5);
    expect(tokens[0]).toEqual({ kind: "groupStart" });
    expect(tokens[1]).toEqual({ kind: "controlWord", name: "rtf", param: 1 });
    expect(tokens.at(-1)).toEqual({ kind: "groupEnd" });
  });

  it("reads \\binN as exactly N raw bytes, braces and backslashes included", () => {
    const payload = "{\\}";
    expect(tokenizeRtf(bytes(`\\bin3 ${payload}!`))).toEqual([
      { kind: "binary", bytes: bytes(payload) },
      { kind: "text", bytes: bytes("!") },
    ]);
  });

  it("stops a \\binN run at end of input rather than reading past it", () => {
    expect(tokenizeRtf(bytes("\\bin9 ab"))).toEqual([
      { kind: "binary", bytes: bytes("ab") },
    ]);
  });
});
