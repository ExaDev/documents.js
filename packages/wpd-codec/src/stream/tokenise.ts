import { byteAt, sliceAt, uint16At } from "../bytes/view";
import { WpdFormatError } from "../errors";

// -- The document area's function-code stream, per WPFF Document Structure, "Document Area" --
//
// "Document formatting is accomplished by embedding function codes in the text of a document. A function is any byte greater than 127 (0x7F)." Everything at or below 0x7F is a literal character, and the four ranges above it are these: 0x80-0xCF single-byte functions, standing alone with no payload and no end gate; 0xD0-0xEF variable-length multi-byte functions, self-describing through a size field; 0xF0-0xFE fixed-length multi-byte functions, whose length this module holds as a table; and 0xFF, which "cannot be used. -1 is reserved so no size is assigned to this value."
//
// Every multi-byte function -- both kinds -- appears as a matched pair of gates: "The first occurrence is the begin gate ... and a second occurrence is the end gate", with the same function code at both ends. This module verifies both gates and the variable form's duplicated size field, because those redundancies are the format's own integrity check: a stream that has gone out of step produces a mismatched gate at the very next function rather than silently decoding rubbish for the rest of the file.
//
// This module is deliberately structural only. It decodes no characters, resolves no prefix IDs, and attaches no meaning to any subgroup -- that is src/read.ts's job. What it guarantees is that the byte stream was walked correctly: every token's extent is exactly what the format says it is.

// A literal character byte, 1 (0x01) through 127 (0x7F). Byte 0 never reaches here: "The character 0 (0x00) has special meaning as the null character and is always deleted by WordPerfect", so the walk skips it outright.
export interface WpdCharacterToken {
  readonly kind: "character";
  readonly byte: number;
}

// A single-byte function, 128 (0x80) through 207 (0xCF).
export interface WpdSingleByteFunctionToken {
  readonly kind: "singleByteFunction";
  readonly code: number;
}

// A variable-length multi-byte function, group 208 (0xD0) through 239 (0xEF).
export interface WpdVariableFunctionToken {
  readonly kind: "variableFunction";
  readonly group: number;
  readonly subgroup: number;
  // The function's total size including both gates -- the value that appears twice, once after the subgroup and once before the end gate.
  readonly size: number;
  // bits 0-2 the paired/encased/revert kind, bit 6 "ignore function ... inactive due to the context of a function enclosing it", bit 7 PRFXID.
  readonly flags: number;
  // The prefix IDs this function names, in order; empty when bit 7 of the flags is clear. "Document parsing programs must allow for prefix ID references in every variable-length function code."
  readonly prefixIds: readonly number[];
  // "The non-deletable portion of a function code is the documented part of the function." The deletable data that may follow it is formatter-specific, undocumented, and deliberately not exposed: the SDK's own instruction is to skip it using the size field.
  readonly nonDeletable: Uint8Array;
}

// A fixed-length multi-byte function, 240 (0xF0) through 254 (0xFE).
export interface WpdFixedFunctionToken {
  readonly kind: "fixedFunction";
  readonly code: number;
  // The payload between the two gates: `size - 2` bytes, since the gates are one byte each.
  readonly data: Uint8Array;
}

export type WpdToken =
  | WpdCharacterToken
  | WpdSingleByteFunctionToken
  | WpdVariableFunctionToken
  | WpdFixedFunctionToken;

export const FIRST_SINGLE_BYTE_FUNCTION = 0x80;
export const FIRST_VARIABLE_FUNCTION = 0xd0;
export const FIRST_FIXED_FUNCTION = 0xf0;

// The SDK's "Fixed-Length Multi-Byte Functions" size table, indexed by code less 0xF0. Every entry counts both gates, so the smallest (3) is a gate, one payload byte, and a gate -- the shape of Attribute On and Attribute Off. 0xFF has no entry at all: "Cannot be used."
const FIXED_FUNCTION_SIZES: readonly number[] = [
  4, // 0xF0 Extended Character
  5, // 0xF1 Undo
  3, // 0xF2 Attribute On
  3, // 0xF3 Attribute Off
  3, // 0xF4 reserved
  3, // 0xF5 reserved
  4, // 0xF6 reserved
  4, // 0xF7 reserved
  4, // 0xF8 reserved
  5, // 0xF9 reserved
  5, // 0xFA reserved
  6, // 0xFB Highlight On
  6, // 0xFC Highlight Off
  8, // 0xFD reserved
  8, // 0xFE reserved
];

// A variable-length function with neither prefix IDs nor any data at all: two gates, the size field twice, the subgroup, the flags byte, and the non-deletable size. Every "[size = 10]" the SDK prints against an encased function with no payload confirms the arithmetic.
const MIN_VARIABLE_FUNCTION_SIZE = 10;

// The trailing [size] short plus the end gate, which sit at the end of every variable-length function.
const VARIABLE_FUNCTION_TRAILER_SIZE = 3;

function readVariableFunction(
  bytes: Uint8Array,
  offset: number,
  limit: number,
): { token: WpdVariableFunctionToken; nextOffset: number } {
  const group = byteAt(bytes, offset);
  const subgroup = byteAt(bytes, offset + 1);
  const size = uint16At(bytes, offset + 2);
  const flags = byteAt(bytes, offset + 4);

  if (size < MIN_VARIABLE_FUNCTION_SIZE) {
    throw new WpdFormatError(
      `The variable-length function 0x${group.toString(16).toUpperCase()} at offset ${offset} declares a size of ${size}, below the ${MIN_VARIABLE_FUNCTION_SIZE} bytes its own gates and fields occupy.`,
    );
  }
  const end = offset + size;
  if (end > limit) {
    throw new WpdFormatError(
      `The variable-length function 0x${group.toString(16).toUpperCase()} at offset ${offset} declares a size of ${size}, which runs past the end of the document area at offset ${limit}.`,
    );
  }

  let cursor = offset + 5;
  const prefixIds: number[] = [];
  // "When the flags byte has the high bit set, there is prefix data associated with the function. The byte following the flags byte (the number of prefix IDs byte) shows how many prefix IDs are referenced."
  if ((flags & 0x80) !== 0) {
    const prefixIdCount = byteAt(bytes, cursor);
    cursor += 1;
    for (let index = 0; index < prefixIdCount; index += 1) {
      prefixIds.push(uint16At(bytes, cursor));
      cursor += 2;
    }
  }

  const nonDeletableSize = uint16At(bytes, cursor);
  cursor += 2;
  const availableForData = end - VARIABLE_FUNCTION_TRAILER_SIZE - cursor;
  if (nonDeletableSize > availableForData) {
    throw new WpdFormatError(
      `The variable-length function 0x${group.toString(16).toUpperCase()} subgroup ${subgroup} at offset ${offset} declares ${nonDeletableSize} bytes of non-deletable data, but only ${availableForData} remain inside its own ${size}-byte extent.`,
    );
  }
  const nonDeletable = sliceAt(bytes, cursor, nonDeletableSize);

  // "Each end gate is preceded by a size value (short), which should always be the same value as the size encountered at the beginning of the function." Checking it is what turns a mis-stepped walk into an immediate, located failure.
  const trailingSize = uint16At(bytes, end - 3);
  if (trailingSize !== size) {
    throw new WpdFormatError(
      `The variable-length function 0x${group.toString(16).toUpperCase()} at offset ${offset} opens with size ${size} but closes with size ${trailingSize}.`,
    );
  }
  const endGate = byteAt(bytes, end - 1);
  if (endGate !== group) {
    throw new WpdFormatError(
      `The variable-length function at offset ${offset} opens with gate 0x${group.toString(16).toUpperCase()} but closes with 0x${endGate.toString(16).toUpperCase()}.`,
    );
  }

  return {
    token: {
      kind: "variableFunction",
      group,
      subgroup,
      size,
      flags,
      prefixIds,
      nonDeletable,
    },
    nextOffset: end,
  };
}

function readFixedFunction(
  bytes: Uint8Array,
  offset: number,
  limit: number,
): { token: WpdFixedFunctionToken; nextOffset: number } {
  const code = byteAt(bytes, offset);
  const size = FIXED_FUNCTION_SIZES[code - FIRST_FIXED_FUNCTION];
  if (size === undefined) {
    throw new WpdFormatError(
      `Function code 0x${code.toString(16).toUpperCase()} at offset ${offset} cannot appear in a document: -1 is reserved and has no assigned size.`,
    );
  }
  const end = offset + size;
  if (end > limit) {
    throw new WpdFormatError(
      `The ${size}-byte fixed-length function 0x${code.toString(16).toUpperCase()} at offset ${offset} runs past the end of the document area at offset ${limit}.`,
    );
  }
  const endGate = byteAt(bytes, end - 1);
  if (endGate !== code) {
    throw new WpdFormatError(
      `The fixed-length function at offset ${offset} opens with gate 0x${code.toString(16).toUpperCase()} but closes with 0x${endGate.toString(16).toUpperCase()}.`,
    );
  }
  return {
    token: {
      kind: "fixedFunction",
      code,
      data: sliceAt(bytes, offset + 1, size - 2),
    },
    nextOffset: end,
  };
}

// Walks the document area from `offset` to `limit`, yielding one token per character or function. Throws on the first byte the format says cannot be there rather than resynchronising: a WordPerfect stream carries no resynchronisation point, so anything after a mis-step is guesswork.
export function tokeniseDocumentArea(
  bytes: Uint8Array,
  offset: number,
  limit: number = bytes.length,
): WpdToken[] {
  const tokens: WpdToken[] = [];
  let cursor = offset;
  while (cursor < limit) {
    const byte = byteAt(bytes, cursor);
    if (byte === 0x00) {
      cursor += 1;
      continue;
    }
    if (byte < FIRST_SINGLE_BYTE_FUNCTION) {
      tokens.push({ kind: "character", byte });
      cursor += 1;
      continue;
    }
    if (byte < FIRST_VARIABLE_FUNCTION) {
      tokens.push({ kind: "singleByteFunction", code: byte });
      cursor += 1;
      continue;
    }
    if (byte < FIRST_FIXED_FUNCTION) {
      const { token, nextOffset } = readVariableFunction(bytes, cursor, limit);
      tokens.push(token);
      cursor = nextOffset;
      continue;
    }
    const { token, nextOffset } = readFixedFunction(bytes, cursor, limit);
    tokens.push(token);
    cursor = nextOffset;
  }
  return tokens;
}
