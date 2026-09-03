import { CONTAINER_REC_VER, RECORD_HEADER_SIZE } from "./header";

// The write-side mirror of record/header.ts and record/tree.ts: byte primitives and the atom/container builders every writer module in this package composes records from. [MS-PPT] 2.3.1 RecordHeader: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/df201194-0cd0-4dfb-bf10-eea353d8eabc
//
// Every test fixture in this package used to hand-build its own copy of these builders under src/test-support/records.ts; that module is gone now and every test imports writeAtom/writeContainer (aliased to the shorter atom/container names it always used) directly from here instead, so a fixture and a genuinely written file are assembled by identical code with no second copy to drift.

export function concatBytes(
  ...parts: readonly Uint8Array<ArrayBuffer>[]
): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

export function u8(value: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array([value & 0xff]);
}

export function u16le(value: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return bytes;
}

export function i16le(value: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setInt16(0, value, true);
  return bytes;
}

export function u32le(value: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

export function i32le(value: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setInt32(0, value, true);
  return bytes;
}

// Each byte is one character's code unit, the way [MS-PPT]'s PrintableAnsiString stores text -- an indexed loop rather than a spread or split, which would decompose by code point or UTF-16 unit and mean something different for text outside the ASCII range this function is used for (the writer's own hardcoded producer user name).
export function asciiBytes(text: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    bytes[i] = text.charCodeAt(i);
  }
  return bytes;
}

export function utf16le(text: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(text.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < text.length; i++) {
    view.setUint16(i * 2, text.charCodeAt(i), true);
  }
  return bytes;
}

export interface RecordWriteOptions {
  readonly recVer?: number;
  readonly recInstance?: number;
}

function recordHeaderBytes(
  recVer: number,
  recInstance: number,
  recType: number,
  recLen: number,
): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(RECORD_HEADER_SIZE);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, (recVer & 0xf) | ((recInstance & 0xfff) << 4), true);
  view.setUint16(2, recType, true);
  view.setUint32(4, recLen, true);
  return bytes;
}

// An atom record: an 8-byte header whose recLen is the payload's own length, followed by the payload.
export function writeAtom(
  recType: number,
  data: Uint8Array<ArrayBuffer>,
  options: RecordWriteOptions = {},
): Uint8Array<ArrayBuffer> {
  const { recVer = 0x0, recInstance = 0x000 } = options;
  return concatBytes(
    recordHeaderBytes(recVer, recInstance, recType, data.length),
    data,
  );
}

// A container record: recVer 0xF, and a recLen covering every child's header plus data.
export function writeContainer(
  recType: number,
  children: readonly Uint8Array<ArrayBuffer>[],
  options: Omit<RecordWriteOptions, "recVer"> = {},
): Uint8Array<ArrayBuffer> {
  const { recInstance = 0x000 } = options;
  const body = concatBytes(...children);
  return concatBytes(
    recordHeaderBytes(CONTAINER_REC_VER, recInstance, recType, body.length),
    body,
  );
}
