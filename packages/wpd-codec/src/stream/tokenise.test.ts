import { describe, expect, it } from "vitest";
import { WpdFormatError } from "../errors";
import {
  GENERIC_HEADER_DOCUMENT_AREA_OFFSET,
  genericHeaderBytes,
} from "../test-support/generic-header";
import { tokeniseDocumentArea } from "./tokenise";

describe("tokeniseDocumentArea", () => {
  // The SDK's own "com<131 (0x83)>ment" example under Single-Byte Functions: a soft hyphen at end of line sitting inside a word.
  it("separates literal characters from a single-byte function", () => {
    const bytes = Uint8Array.from([
      0x63, 0x6f, 0x6d, 0x83, 0x6d, 0x65, 0x6e, 0x74,
    ]);
    expect(tokeniseDocumentArea(bytes, 0)).toEqual([
      { kind: "character", byte: 0x63 },
      { kind: "character", byte: 0x6f },
      { kind: "character", byte: 0x6d },
      { kind: "singleByteFunction", code: 0x83 },
      { kind: "character", byte: 0x6d },
      { kind: "character", byte: 0x65 },
      { kind: "character", byte: 0x6e },
      { kind: "character", byte: 0x74 },
    ]);
  });

  // The SDK's own worked example of a fixed-length function, verbatim: "can't" encoded as can<240 (0xF0)><28 (0x1C)><4 (0x04)><240 (0xF0)>t -- character number 28 of WP character set 4.
  it("reads the SDK's Extended Character example, gates included", () => {
    const bytes = Uint8Array.from([
      0x63, 0x61, 0x6e, 0xf0, 0x1c, 0x04, 0xf0, 0x74,
    ]);
    const tokens = tokeniseDocumentArea(bytes, 0);
    expect(tokens).toHaveLength(5);
    expect(tokens[3]).toEqual({
      kind: "fixedFunction",
      code: 0xf0,
      data: Uint8Array.from([0x1c, 0x04]),
    });
  });

  // Attribute On is three bytes: gate, attribute, gate. Attribute 12 is bold.
  it("reads a three-byte Attribute On", () => {
    expect(tokeniseDocumentArea(Uint8Array.from([0xf2, 12, 0xf2]), 0)).toEqual([
      { kind: "fixedFunction", code: 0xf2, data: Uint8Array.from([12]) },
    ]);
  });

  // The generic header's own document area is exactly two variable-length functions: the Global On style code (0xDD0A, sixteen bytes, naming prefix ID 3 and carrying three bytes of non-deletable data ending in system style 0x21) and the Global Off code (0xDD0B, eleven bytes, no prefix IDs, no non-deletable data, and one byte of deletable data whose value the SDK states is 4).
  it("reads the Global On and Global Off codes of the SDK's generic header", () => {
    const tokens = tokeniseDocumentArea(
      genericHeaderBytes(),
      GENERIC_HEADER_DOCUMENT_AREA_OFFSET,
    );
    expect(tokens).toEqual([
      {
        kind: "variableFunction",
        group: 0xdd,
        subgroup: 0x0a,
        size: 16,
        flags: 0x83,
        prefixIds: [3],
        nonDeletable: Uint8Array.from([0x02, 0x00, 0x21]),
      },
      {
        kind: "variableFunction",
        group: 0xdd,
        subgroup: 0x0b,
        size: 11,
        flags: 0x03,
        prefixIds: [],
        nonDeletable: new Uint8Array(0),
      },
    ]);
  });

  it("skips the null character, which WordPerfect always deletes", () => {
    expect(
      tokeniseDocumentArea(Uint8Array.from([0x41, 0x00, 0x42]), 0),
    ).toEqual([
      { kind: "character", byte: 0x41 },
      { kind: "character", byte: 0x42 },
    ]);
  });

  it("rejects 0xFF, which cannot appear in a document at all", () => {
    expect(() => tokeniseDocumentArea(Uint8Array.from([0xff]), 0)).toThrow(
      WpdFormatError,
    );
  });

  it("rejects a fixed-length function whose end gate does not match its begin gate", () => {
    expect(() =>
      tokeniseDocumentArea(Uint8Array.from([0xf2, 12, 0xf3]), 0),
    ).toThrow(/opens with gate 0xF2 but closes with 0xF3/);
  });

  it("rejects a variable-length function whose two size fields disagree", () => {
    // 0xD3 subgroup 5, size 11, no PIDs, one byte of non-deletable data, then a trailing size of 12 rather than 11.
    const bytes = Uint8Array.from([
      0xd3, 0x05, 11, 0, 0x00, 0x01, 0x00, 0x02, 12, 0, 0xd3,
    ]);
    expect(() => tokeniseDocumentArea(bytes, 0)).toThrow(
      /opens with size 11 but closes with size 12/,
    );
  });

  it("rejects a variable-length function smaller than its own fields", () => {
    const bytes = Uint8Array.from([0xd3, 0x05, 4, 0, 0x00, 4, 0, 0xd3]);
    expect(() => tokeniseDocumentArea(bytes, 0)).toThrow(
      /declares a size of 4, below the 10 bytes/,
    );
  });

  it("rejects a variable-length function claiming more non-deletable data than it has room for", () => {
    // Size 11 leaves one byte for data; this claims five.
    const bytes = Uint8Array.from([
      0xd3, 0x05, 11, 0, 0x00, 0x05, 0x00, 0x02, 11, 0, 0xd3,
    ]);
    expect(() => tokeniseDocumentArea(bytes, 0)).toThrow(
      /declares 5 bytes of non-deletable data, but only 1 remain/,
    );
  });

  it("keeps deletable data out of the non-deletable slice", () => {
    // 0xD3 subgroup 5, size 13, no PIDs, one byte of non-deletable data (0x02) followed by two bytes of deletable data.
    const bytes = Uint8Array.from([
      0xd3, 0x05, 13, 0, 0x00, 0x01, 0x00, 0x02, 0xaa, 0xbb, 13, 0, 0xd3,
    ]);
    const [token] = tokeniseDocumentArea(bytes, 0);
    expect(token).toEqual({
      kind: "variableFunction",
      group: 0xd3,
      subgroup: 0x05,
      size: 13,
      flags: 0,
      prefixIds: [],
      nonDeletable: Uint8Array.from([0x02]),
    });
  });
});
