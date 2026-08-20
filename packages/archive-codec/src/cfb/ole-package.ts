// Unwraps an OLE Package stream: the packaging Word and PowerPoint wrap an embedded file in before storing it as the 'Package' stream of a classic compound-file embed (word|ppt/embeddings/oleObject1.bin). The layout is the [MS-OLEDS] OLENativeStream family's Packager spelling -- the same field run oletools' OleNativeStream(package=True) and officeparser both parse in the real-world corpus, verified against both implementations rather than against the spec text alone (the spec documents the \1Ole10Native variant, whose only difference is a leading native-data-size uint32 the Package stream omits): a uint16 header word, the label and source path as null-terminated strings, 8 opaque bytes, the temp path as a null-terminated string, then the packaged file's byte count and the file bytes. After the file bytes real producers may append wide-character repeats of the paths; the file's extent is fixed by its declared size, so that tail is ignored.
//
// The uint16 header word carries no constraint: producers write 0x0002, but neither the spec nor the reverse-engineered corpus documents an invariant, and the two reference implementations read past it without checking -- so this reader treats it as opaque for the same reason ([MS-OLEDS] gives OLEVersion the same "any value, MUST be ignored on receipt" licence).

// Thrown when bytes claiming to be a Package stream do not parse as one: a string that never terminates, or a declared file size the remaining bytes cannot fill. A distinct class so a consumer can catch packaging failure by name, exactly as it catches compound-file structural failure.
export class OlePackageFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OlePackageFormatError';
  }
}

export interface OlePackage {
  readonly label: string;
  readonly sourcePath: string;
  readonly tempPath: string;
  readonly fileBytes: Uint8Array<ArrayBuffer>;
}

// Reads one null-terminated string starting at offset, returning its bytes' end (the position after the null). The strings are producer-locale ANSI; decoding as windows-1252 keeps every byte's glyph rather than corrupting high bytes, and no consumer of this package branches on their content.
const ANSI_DECODER = new TextDecoder('windows-1252');

function readZeroTerminated(bytes: Uint8Array<ArrayBuffer>, offset: number, fieldName: string): { readonly value: string; readonly next: number } {
  let end = offset;
  while (end < bytes.length && bytes[end] !== 0) {
    end++;
  }
  if (end >= bytes.length) {
    throw new OlePackageFormatError(`Package stream ends inside its ${fieldName} string with no terminator`);
  }
  return { value: ANSI_DECODER.decode(bytes.subarray(offset, end)), next: end + 1 };
}

// Parses a Package stream into its descriptive strings and the packaged file's bytes. Throws OlePackageFormatError on any structural shortfall -- loud failure, never a truncated file that looks complete.
export function readOlePackage(bytes: Uint8Array<ArrayBuffer>): OlePackage {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2; // the opaque header word
  const label = readZeroTerminated(bytes, offset, 'label');
  offset = label.next;
  const sourcePath = readZeroTerminated(bytes, offset, 'source path');
  offset = sourcePath.next;
  offset += 8; // opaque (widely believed to be a FILETIME; nothing downstream reads it)
  const tempPath = readZeroTerminated(bytes, offset, 'temp path');
  offset = tempPath.next;
  if (offset + 4 > bytes.length) {
    throw new OlePackageFormatError('Package stream ends before its packaged file size field');
  }
  const fileByteCount = view.getUint32(offset, true);
  offset += 4;
  if (offset + fileByteCount > bytes.length) {
    throw new OlePackageFormatError(`Package stream declares ${fileByteCount} packaged-file bytes but holds only ${bytes.length - offset}`);
  }
  return { label: label.value, sourcePath: sourcePath.value, tempPath: tempPath.value, fileBytes: bytes.slice(offset, offset + fileByteCount) };
}
