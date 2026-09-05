// Unwraps and wraps an OLE Package stream: the packaging Word and PowerPoint wrap an embedded file in before storing it as the 'Package' stream of a classic compound-file embed (word|ppt/embeddings/oleObject1.bin), and the same packaging rtf-codec builds when it embeds a document as an RTF \object's \objdata. The layout is the [MS-OLEDS] OLENativeStream family's Packager spelling -- the same field run oletools' OleNativeStream(package=True) and officeparser both parse in the real-world corpus, verified against both implementations rather than against the spec text alone (the spec documents the \1Ole10Native variant, whose only difference is a leading native-data-size uint32 the Package stream omits): a uint16 header word, the label and source path as null-terminated strings, 8 opaque bytes, the temp path as a null-terminated string, then the packaged file's byte count and the file bytes. After the file bytes real producers may append wide-character repeats of the paths; the file's extent is fixed by its declared size, so that tail is ignored. writeOlePackage is the mirror of readOlePackage, exactly as cfb/write.ts's writeCompoundFile is the mirror of cfb/read.ts's readCompoundFile.
//
// The uint16 header word carries no constraint: producers write 0x0002, but neither the spec nor the reverse-engineered corpus documents an invariant, and the two reference implementations read past it without checking -- so this reader treats it as opaque for the same reason ([MS-OLEDS] gives OLEVersion the same "any value, MUST be ignored on receipt" licence).

// Thrown when bytes claiming to be a Package stream do not parse as one: a string that never terminates, or a declared file size the remaining bytes cannot fill. A distinct class so a consumer can catch packaging failure by name, exactly as it catches compound-file structural failure.
export class OlePackageFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OlePackageFormatError";
  }
}

export interface OlePackage {
  readonly label: string;
  readonly sourcePath: string;
  readonly tempPath: string;
  readonly fileBytes: Uint8Array<ArrayBuffer>;
}

// Reads one null-terminated string starting at offset, returning its bytes' end (the position after the null). The strings are producer-locale ANSI; decoding as windows-1252 keeps every byte's glyph rather than corrupting high bytes, and no consumer of this package branches on their content.
const ANSI_DECODER = new TextDecoder("windows-1252");

function readZeroTerminated(
  bytes: Uint8Array<ArrayBuffer>,
  offset: number,
  fieldName: string,
): { readonly value: string; readonly next: number } {
  let end = offset;
  while (end < bytes.length && bytes[end] !== 0) {
    end++;
  }
  if (end >= bytes.length) {
    throw new OlePackageFormatError(
      `Package stream ends inside its ${fieldName} string with no terminator`,
    );
  }
  return {
    value: ANSI_DECODER.decode(bytes.subarray(offset, end)),
    next: end + 1,
  };
}

// Parses a Package stream into its descriptive strings and the packaged file's bytes. Throws OlePackageFormatError on any structural shortfall -- loud failure, never a truncated file that looks complete.
export function readOlePackage(bytes: Uint8Array<ArrayBuffer>): OlePackage {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2; // the opaque header word
  const label = readZeroTerminated(bytes, offset, "label");
  offset = label.next;
  const sourcePath = readZeroTerminated(bytes, offset, "source path");
  offset = sourcePath.next;
  offset += 8; // opaque (widely believed to be a FILETIME; nothing downstream reads it)
  const tempPath = readZeroTerminated(bytes, offset, "temp path");
  offset = tempPath.next;
  if (offset + 4 > bytes.length) {
    throw new OlePackageFormatError(
      "Package stream ends before its packaged file size field",
    );
  }
  const fileByteCount = view.getUint32(offset, true);
  offset += 4;
  if (offset + fileByteCount > bytes.length) {
    throw new OlePackageFormatError(
      `Package stream declares ${fileByteCount} packaged-file bytes but holds only ${bytes.length - offset}`,
    );
  }
  return {
    label: label.value,
    sourcePath: sourcePath.value,
    tempPath: tempPath.value,
    fileBytes: bytes.slice(offset, offset + fileByteCount),
  };
}

// Thrown when an OlePackage's own descriptive strings cannot be written, as distinct from OlePackageFormatError (bytes that fail to parse as a Package stream). A single class so a caller catches packaging-write failure by name, matching the CompoundFileWriteError/CompoundFileFormatError and PropertySetWriteError/PropertySetFormatError split elsewhere in this package.
export class OlePackageWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OlePackageWriteError";
  }
}

// The label/sourcePath/tempPath fields decode as windows-1252 on read (readZeroTerminated's ANSI_DECODER above), but encoding an arbitrary string back to windows-1252 would need the full codepage table this package deliberately does not carry -- the identical trade-off oleps/write.ts makes for VT_LPSTR, resolved there by writing VT_LPWSTR (UTF-16LE) unconditionally instead. There is no Unicode variant of these three fields to fall back on: the Package stream layout fixes them as single-byte null-terminated strings, so the only encoding this writer can honestly produce is the ASCII subset where "windows-1252 byte" and "character code" already agree, and a caller naming a real embedded file with a non-ASCII label/path throws rather than silently mojibake-ing it.
function asciiZeroTerminated(
  value: string,
  fieldName: string,
): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(value.length + 1); // +1 for the terminator, already zero from the Uint8Array's own zero-fill
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code > 0x7f) {
      throw new OlePackageWriteError(
        `Package stream's ${fieldName} contains a character (U+${code.toString(16).padStart(4, "0")}) outside ASCII; encoding it to an arbitrary windows-1252 byte would need a full codepage table this package does not carry`,
      );
    }
    bytes[index] = code;
  }
  return bytes;
}

// Writes a Package stream's bytes from the same shape readOlePackage returns -- the mirror of readOlePackage, exactly as writeCompoundFile is the mirror of readCompoundFile: readOlePackage(writeOlePackage(pkg)) round-trips pkg. The header word carries no known constraint (see readOlePackage's own comment on it) and is written as 0x0002, the value real producers use; the 8 opaque bytes between sourcePath and tempPath are written as zero, since nothing that reads a Package stream is known to depend on their content.
export function writeOlePackage(pkg: OlePackage): Uint8Array<ArrayBuffer> {
  const labelBytes = asciiZeroTerminated(pkg.label, "label");
  const sourcePathBytes = asciiZeroTerminated(pkg.sourcePath, "source path");
  const tempPathBytes = asciiZeroTerminated(pkg.tempPath, "temp path");
  const totalLength =
    2 + // the opaque header word
    labelBytes.length +
    sourcePathBytes.length +
    8 + // opaque
    tempPathBytes.length +
    4 + // packaged file's byte count
    pkg.fileBytes.length;
  const out = new Uint8Array(totalLength);
  const view = new DataView(out.buffer);
  let offset = 0;
  view.setUint16(offset, 0x0002, true);
  offset += 2;
  out.set(labelBytes, offset);
  offset += labelBytes.length;
  out.set(sourcePathBytes, offset);
  offset += sourcePathBytes.length;
  offset += 8; // opaque, left zero
  out.set(tempPathBytes, offset);
  offset += tempPathBytes.length;
  view.setUint32(offset, pkg.fileBytes.length, true);
  offset += 4;
  out.set(pkg.fileBytes, offset);
  return out;
}
