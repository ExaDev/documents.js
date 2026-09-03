import { CONTAINER_REC_VER, RECORD_HEADER_SIZE } from "../record/header";

// Byte builders for the unit suites: every fixture in this package is a hand-constructed record tree assembled from [MS-PPT] 2.3.1's own header layout, not a captured binary. That is deliberate -- a fixture built from the spec's field tables states what the parser is being held to, whereas a real .ppt file would only state what one producer happened to emit, and could not be reduced to the single record under test.

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

// Each byte is one character's code unit, the way [MS-PPT]'s TextBytesAtom and PrintableAnsiString both store text. Written as an indexed loop rather than a spread or split, which would decompose by code point or UTF-16 unit and mean something different for text outside the ASCII range these fixtures use.
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

interface HeaderOptions {
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
export function atom(
  recType: number,
  data: Uint8Array<ArrayBuffer>,
  options: HeaderOptions = {},
): Uint8Array<ArrayBuffer> {
  const { recVer = 0x0, recInstance = 0x000 } = options;
  return concatBytes(
    recordHeaderBytes(recVer, recInstance, recType, data.length),
    data,
  );
}

// A container record: recVer 0xF, and a recLen covering every child's header plus data.
export function container(
  recType: number,
  children: readonly Uint8Array<ArrayBuffer>[],
  options: Omit<HeaderOptions, "recVer"> = {},
): Uint8Array<ArrayBuffer> {
  const { recInstance = 0x000 } = options;
  const body = concatBytes(...children);
  return concatBytes(
    recordHeaderBytes(CONTAINER_REC_VER, recInstance, recType, body.length),
    body,
  );
}
