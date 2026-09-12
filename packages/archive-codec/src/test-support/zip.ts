// Little-endian integer readers over raw zip bytes, shared by every test that walks a zip's physical local-file-header layout rather than trusting a round trip through unzipPackage's Record (which makes no ordering promise of its own to test against). Never imported by src/index.ts and never reaches dist/ -- test-only, mirroring the same test-only, never-exported convention as this family's other test-support helpers.

// A DataView read, not a hand-rolled undefined-checking one: DataView's own getUint16/getUint32 already throw a RangeError for an offset whose read would run past the buffer's own end, so there is no separate bounds check to hand-write (and no separate error message to keep in sync with it).

export function readUint16LE(bytes: Uint8Array, offset: number): number {
  return new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint16(offset, true);
}

export function readUint32LE(bytes: Uint8Array, offset: number): number {
  return new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint32(offset, true);
}

// Walks local file headers (signature 0x04034b50) from the start of a zip, in physical emission order, returning each entry's declared filename. This is the byte-level ordering oracle zipPackage's ordered-entries contract exists to provide: the caller supplies the order, and this proves the produced bytes carry it.
export function localFileHeaderNames(bytes: Uint8Array): string[] {
  const decoder = new TextDecoder();
  const names: string[] = [];
  let offset = 0;
  while (offset < bytes.length && readUint32LE(bytes, offset) === 0x04034b50) {
    const compressedSize = readUint32LE(bytes, offset + 18);
    const filenameLength = readUint16LE(bytes, offset + 26);
    const extraLength = readUint16LE(bytes, offset + 28);
    const nameStart = offset + 30;
    names.push(
      decoder.decode(bytes.subarray(nameStart, nameStart + filenameLength)),
    );
    offset = nameStart + filenameLength + extraLength + compressedSize;
  }
  return names;
}

// The compression method (0 = stored, 8 = deflated) of a given entry's local file header, walked in the same physical order as localFileHeaderNames. Local header layout per the ZIP application-note: signature (4 bytes), version needed (2), general-purpose flags (2), compression method (2) -- so the method field sits at byte offset 8 within each header.
export function localHeaderCompressionMethod(
  bytes: Uint8Array,
  entryIndex: number,
): number {
  let offset = 0;
  let index = 0;
  while (offset < bytes.length && readUint32LE(bytes, offset) === 0x04034b50) {
    const compressedSize = readUint32LE(bytes, offset + 18);
    const filenameLength = readUint16LE(bytes, offset + 26);
    const extraLength = readUint16LE(bytes, offset + 28);
    const nameStart = offset + 30;
    if (index === entryIndex) {
      return readUint16LE(bytes, offset + 8);
    }
    offset = nameStart + filenameLength + extraLength + compressedSize;
    index++;
  }
  throw new Error(`no local file header at entry index ${entryIndex}`);
}
