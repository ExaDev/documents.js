import { BiffFormatError } from "../biff/records";

// MS-ODRAW (Escher): the binary drawing format BIFF8 embeds via its own MsoDrawing/MsoDrawingGroup records ([MS-XLS] 2.4.180/2.4.179-adjacent), read directly against [MS-ODRAW]'s own record framing rather than from memory or another implementation's header file. Every structural claim below cites the specific [MS-ODRAW] page it comes from.
//
// [MS-ODRAW] 2.2.1 OfficeArtRecordHeader (https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/5dc1b9ed-818c-436f-8a4f-905a7ebb1ba9): an 8-byte header shared by every record -- a little-endian WORD whose low nibble is `recVer` and whose remaining 12 bits are `recInstance`, then a little-endian `recType` WORD, then a little-endian `recLen` DWORD counting the bytes that follow the header (for a container, the total size of every nested record INCLUDING their own headers, not a separate wrapper size on top of them). `recVer === 0xF` is what marks a CONTAINER, whose own body is itself a sequence of child records read the same way; any other `recVer` marks an ATOM, whose body is `recLen` bytes of opaque record-specific data this module does not interpret further -- see drawing/shapes.ts and drawing/blips.ts for the atoms this package actually reads.

const HEADER_SIZE = 8;
const CONTAINER_REC_VER = 0xf;

/** One Escher atom: `recLen` bytes of record-specific data this module leaves opaque. */
export interface EscherAtom {
  readonly kind: "atom";
  readonly recInstance: number;
  readonly recType: number;
  readonly data: Uint8Array<ArrayBuffer>;
}

/** One Escher container: its own children, read the identical way, recursively. */
export interface EscherContainer {
  readonly kind: "container";
  readonly recInstance: number;
  readonly recType: number;
  readonly children: readonly EscherRecord[];
}

export type EscherRecord = EscherAtom | EscherContainer;

/**
 * Reads every top-level Escher record in `bytes`, recursing into containers.
 *
 * `bytes` is the whole concatenated Escher stream one worksheet's MsoDrawing records (or the workbook globals substream's MsoDrawingGroup records) build up in stream order -- BIFF8 splits one logical Escher byte sequence across as many of those BIFF records as it needs, and [MS-XLS] states plainly that their own data simply concatenates; nothing about the record framing itself lives at that BIFF layer, so by the time this function runs the split is already invisible.
 */
export function readEscherRecords(
  bytes: Uint8Array<ArrayBuffer>,
): readonly EscherRecord[] {
  const records: EscherRecord[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    const { record, nextOffset } = readOneRecord(bytes, offset);
    records.push(record);
    offset = nextOffset;
  }
  return records;
}

function readOneRecord(
  bytes: Uint8Array<ArrayBuffer>,
  offset: number,
): { record: EscherRecord; nextOffset: number } {
  if (offset + HEADER_SIZE > bytes.length) {
    throw new BiffFormatError(
      `Escher record header at offset ${offset} runs past the end of the ${bytes.length}-byte stream`,
    );
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const verInstance = view.getUint16(offset, true);
  const recVer = verInstance & 0xf;
  const recInstance = verInstance >> 4;
  const recType = view.getUint16(offset + 2, true);
  const recLen = view.getUint32(offset + 4, true);
  const bodyStart = offset + HEADER_SIZE;
  const bodyEnd = bodyStart + recLen;
  if (bodyEnd > bytes.length) {
    throw new BiffFormatError(
      `Escher record 0x${recType.toString(16)} at offset ${offset} declares ${recLen} bytes of body, running past the end of the ${bytes.length}-byte stream`,
    );
  }
  if (recVer === CONTAINER_REC_VER) {
    const children = readChildren(bytes, bodyStart, bodyEnd);
    return {
      record: { kind: "container", recInstance, recType, children },
      nextOffset: bodyEnd,
    };
  }
  return {
    record: {
      kind: "atom",
      recInstance,
      recType,
      data: bytes.subarray(bodyStart, bodyEnd),
    },
    nextOffset: bodyEnd,
  };
}

function readChildren(
  bytes: Uint8Array<ArrayBuffer>,
  start: number,
  end: number,
): readonly EscherRecord[] {
  const children: EscherRecord[] = [];
  let offset = start;
  while (offset < end) {
    const { record, nextOffset } = readOneRecord(bytes, offset);
    if (nextOffset > end) {
      throw new BiffFormatError(
        `Escher child record at offset ${offset} extends past its own container's declared end`,
      );
    }
    children.push(record);
    offset = nextOffset;
  }
  return children;
}

/** The first direct child of `container` with the given `recType`, container or atom alike -- undefined when none matches. */
export function firstChild(
  container: EscherContainer,
  recType: number,
): EscherRecord | undefined {
  return container.children.find((child) => child.recType === recType);
}

/** Every direct child of `container` with the given `recType`, in document order. */
export function childrenOfType(
  container: EscherContainer,
  recType: number,
): readonly EscherRecord[] {
  return container.children.filter((child) => child.recType === recType);
}

/** Recursively finds the first descendant record (depth-first, this container's own children before their children) with the given `recType` -- for a record known to appear exactly once at an unspecified depth (the Blip Store, the drawing group's own Dgg), as opposed to childrenOfType's direct-children-only contract. */
export function findDescendant(
  container: EscherContainer,
  recType: number,
): EscherRecord | undefined {
  for (const child of container.children) {
    if (child.recType === recType) {
      return child;
    }
    if (child.kind === "container") {
      const found = findDescendant(child, recType);
      if (found !== undefined) {
        return found;
      }
    }
  }
  return undefined;
}
