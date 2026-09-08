// Builders for hand-constructed MS-ODRAW (Escher) byte sequences, mirroring test-support/biff.ts's own "state the input as the field layout the spec gives, not as an opaque captured blob" discipline -- see that module's own top comment.
//
// Test-support only: excluded from the published dist by tsdown.config.ts, and exempt from the Worker-isomorphism lint rule.

import { u16, u32 } from "./biff";

/** [MS-ODRAW] 2.2.1 OfficeArtRecordHeader: an 8-byte header -- a little-endian word packing `recVer` (low nibble) and `recInstance` (remaining 12 bits), a little-endian recType, then a little-endian recLen counting `body`'s own length. */
function escherRecord(
  recVer: number,
  recInstance: number,
  recType: number,
  body: readonly number[],
): number[] {
  const verInstance = (recVer & 0xf) | ((recInstance & 0xfff) << 4);
  return [...u16(verInstance), ...u16(recType), ...u32(body.length), ...body];
}

/** One Escher atom: recVer is always non-0xF for an atom (0x0 for every atom this fixture builder produces, since none of this package's own atom readers inspect recVer). */
export function escherAtom(
  recType: number,
  recInstance: number,
  body: readonly number[],
): number[] {
  return escherRecord(0x0, recInstance, recType, body);
}

/** One Escher container: recVer === 0xF marks it as one, per [MS-ODRAW] 2.2.1. */
export function escherContainer(
  recType: number,
  recInstance: number,
  children: readonly (readonly number[])[],
): number[] {
  const body = children.flatMap((child) => child);
  return escherRecord(0xf, recInstance, recType, body);
}

/** [MS-ODRAW] OfficeArtFBSE: the fixed fields this package's own readBseImage reads past, then an embedded blip record's own bytes -- nameData is always omitted (cbName 0), which every real BSE this reader is meant to accept also does when the file carries no picture name. */
export function bseEntry(embeddedBlip: readonly number[]): number[] {
  return [
    0x00, // btWin32
    0x00, // btMacOS
    ...new Array<number>(16).fill(0), // rgbUid
    ...u16(0xff), // tag
    ...u32(embeddedBlip.length), // size
    ...u32(1), // cRef
    ...u32(0), // foDelay
    0x00, // unused1
    0x00, // cbName
    0x00, // unused2
    0x00, // unused3
    ...embeddedBlip,
  ];
}

/** One embedded OfficeArtBlip record with a single rgbUid (the common case): its own header, one 16-byte UID, a tag byte, then the literal file bytes. */
export function embeddedBlip(
  recType: number,
  recInstance: number,
  fileBytes: readonly number[],
): number[] {
  return escherAtom(recType, recInstance, [
    ...new Array<number>(16).fill(0), // rgbUid1
    0xff, // tag
    ...fileBytes,
  ]);
}

/** [MS-XLS] 2.5.163 OfficeArtClientAnchorSheet: a flags word, then the top-left and bottom-right corner cells, each a column, a 1/1024ths-of-cell-width X offset, a row, and a 1/256ths-of-cell-height Y offset. */
export function clientAnchorSheet(
  colL: number,
  dxL: number,
  rwT: number,
  dyT: number,
  colR: number,
  dxR: number,
  rwB: number,
  dyB: number,
): number[] {
  return escherAtom(0xf010, 0x0, [
    ...u16(0), // flags: fMove/fSize both clear
    ...u16(colL),
    ...u16(dxL),
    ...u16(rwT),
    ...u16(dyT),
    ...u16(colR),
    ...u16(dxR),
    ...u16(rwB),
    ...u16(dyB),
  ]);
}

/** [MS-ODRAW] OfficeArtFSP: shape id then a flags DWORD, with the shape's own type carried in the record HEADER's recInstance (an MSOSPT value) rather than in this body. */
export function spAtom(
  shapeType: number,
  spid: number,
  flags: number,
): number[] {
  return escherAtom(0xf00a, shapeType, [...u32(spid), ...u32(flags)]);
}

/** [MS-ODRAW] OfficeArtFOPTE: opid (property id, with fBid/fComplex already folded in by the caller) then a 4-byte op value -- one property per call, concatenated by the caller into an Opt atom's own body. */
export function foptEntry(opid: number, op: number): number[] {
  return [...u16(opid), ...u32(op)];
}

/** [MS-ODRAW] OfficeArtFOPT: recInstance carries the property COUNT, per that record's own spec -- derived here from `entries.length` so a fixture never states it separately from the entries it actually holds. */
export function optAtom(entries: readonly (readonly number[])[]): number[] {
  const body = entries.flatMap((entry) => entry);
  return escherAtom(0xf00b, entries.length, body);
}
