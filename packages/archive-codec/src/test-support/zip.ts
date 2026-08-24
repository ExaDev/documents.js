// Little-endian integer readers over raw zip bytes, shared by every test that walks a zip's physical local-file-header layout rather than trusting a round trip through unzipPackage's Record (which makes no ordering promise of its own to test against). Never imported by src/index.ts and never reaches dist/ -- test-only, mirroring the same test-only, never-exported convention as this family's other test-support helpers.

export function readUint16LE(bytes: Uint8Array, offset: number): number {
  const b0 = bytes[offset];
  const b1 = bytes[offset + 1];
  if (b0 === undefined || b1 === undefined) {
    throw new Error(
      `truncated zip bytes while reading a uint16 at offset ${offset}`,
    );
  }
  return b0 | (b1 << 8);
}

export function readUint32LE(bytes: Uint8Array, offset: number): number {
  const b0 = bytes[offset];
  const b1 = bytes[offset + 1];
  const b2 = bytes[offset + 2];
  const b3 = bytes[offset + 3];
  if (
    b0 === undefined ||
    b1 === undefined ||
    b2 === undefined ||
    b3 === undefined
  ) {
    throw new Error(
      `truncated zip bytes while reading a uint32 at offset ${offset}`,
    );
  }
  return (b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)) >>> 0;
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
