// Builds a conforming WordPerfect 6.x file around a given document area, so a reader test can state a byte sequence from the specification's own field tables and read it back through the real container, prefix, and tokeniser path rather than calling the fold directly.
//
// The layout it emits is exactly the one WPFF Document Structure describes and its generic-header example demonstrates: a 16-byte header, a 496-byte extended header, an index area of 14-byte records whose first is the index header, the packet data, then the document area.

import { WPD_INDEX_RECORD_SIZE } from "../container/prefix";

const PREFIX_HEADER_SIZE = 512;
const FILE_ID = [0xff, 0x57, 0x50, 0x43];

export interface WpdPacketSpec {
  readonly packetType: number;
  readonly flags?: number;
  readonly bytes: Uint8Array;
}

function putUint16(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
}

function putUint32(bytes: Uint8Array, offset: number, value: number): void {
  putUint16(bytes, offset, value & 0xffff);
  putUint16(bytes, offset + 2, (value >>> 16) & 0xffff);
}

export function buildWpdFile(
  documentArea: readonly number[],
  packets: readonly WpdPacketSpec[] = [],
): Uint8Array {
  // The index area holds one record per packet plus the index header.
  const indexAreaSize = (packets.length + 1) * WPD_INDEX_RECORD_SIZE;
  const packetDataStart = PREFIX_HEADER_SIZE + indexAreaSize;
  const packetDataSize = packets.reduce(
    (total, packet) => total + packet.bytes.length,
    0,
  );
  const documentAreaStart = packetDataStart + packetDataSize;
  const fileSize = documentAreaStart + documentArea.length;

  const bytes = new Uint8Array(fileSize);
  bytes.set(FILE_ID, 0);
  putUint32(bytes, 4, documentAreaStart);
  bytes[8] = 1; // product type: WordPerfect
  bytes[9] = 0x0a; // file type: WordPerfect document
  bytes[10] = 2; // major version: the 6.x-X6 lineage
  bytes[11] = 1; // minor version
  putUint16(bytes, 12, 0); // not encrypted
  putUint16(bytes, 14, PREFIX_HEADER_SIZE); // pointer to the index area
  putUint32(bytes, 16, 5); // the documented reserved long at the head of the extended header
  putUint32(bytes, 20, fileSize);

  bytes[PREFIX_HEADER_SIZE] = 2; // index header flags
  putUint16(bytes, PREFIX_HEADER_SIZE + 2, packets.length + 1);

  let packetOffset = packetDataStart;
  packets.forEach((packet, index) => {
    const recordOffset =
      PREFIX_HEADER_SIZE + (index + 1) * WPD_INDEX_RECORD_SIZE;
    bytes[recordOffset] = packet.flags ?? 0;
    bytes[recordOffset + 1] = packet.packetType;
    putUint16(bytes, recordOffset + 2, 1); // use count
    putUint16(bytes, recordOffset + 4, 0); // hidden count
    putUint32(bytes, recordOffset + 6, packet.bytes.length);
    putUint32(bytes, recordOffset + 10, packetOffset);
    bytes.set(packet.bytes, packetOffset);
    packetOffset += packet.bytes.length;
  });

  bytes.set(documentArea, documentAreaStart);
  return bytes;
}

// A variable-length multi-byte function, assembled the way WPFF Document Structure lays one out: gate, subgroup, size, flags, optional prefix IDs, non-deletable size, non-deletable data, deletable data, size, gate.
export function variableFunction(options: {
  readonly group: number;
  readonly subgroup: number;
  readonly prefixIds?: readonly number[];
  readonly nonDeletable?: readonly number[];
  readonly deletable?: readonly number[];
}): number[] {
  const prefixIds = options.prefixIds ?? [];
  const nonDeletable = options.nonDeletable ?? [];
  const deletable = options.deletable ?? [];
  const prefixIdBytes = prefixIds.length === 0 ? 0 : 1 + prefixIds.length * 2;
  const size = 10 + prefixIdBytes + nonDeletable.length + deletable.length;

  const bytes: number[] = [
    options.group,
    options.subgroup,
    size & 0xff,
    (size >>> 8) & 0xff,
    prefixIds.length === 0 ? 0 : 0x80,
  ];
  if (prefixIds.length > 0) {
    bytes.push(prefixIds.length);
    for (const prefixId of prefixIds) {
      bytes.push(prefixId & 0xff, (prefixId >>> 8) & 0xff);
    }
  }
  bytes.push(nonDeletable.length & 0xff, (nonDeletable.length >>> 8) & 0xff);
  bytes.push(...nonDeletable, ...deletable);
  bytes.push(size & 0xff, (size >>> 8) & 0xff, options.group);
  return bytes;
}

// A Desired Font Descriptor packet (type 0x55): the twenty-four fixed bytes the SDK's Packet Type 32 layout defines, then the typeface name as a null-terminated WP word string of ASCII (character set 0).
export function fontDescriptorPacket(typeface: string): WpdPacketSpec {
  const nameWords = [...typeface].map((character) => character.charCodeAt(0));
  const nameLength = (nameWords.length + 1) * 2;
  const bytes = new Uint8Array(24 + nameLength);
  putUint16(bytes, 22, nameLength);
  nameWords.forEach((word, index) => {
    putUint16(bytes, 24 + index * 2, word);
  });
  return { packetType: 0x55, bytes };
}

// A word (short) as its two little-endian document-area bytes.
export function word(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff];
}

// An End-of-Line group function (0xD0) carrying embedded subfunctions. The group's own non-deletable region is not the subfunction list directly: it opens with "[size of deletable subfunction data]", then the deletable subfunctions, then the non-deletable ones -- so this builder writes a zero-length deletable half and the given records after it.
export function eolFunction(options: {
  readonly subgroup: number;
  readonly embedded?: readonly number[];
}): number[] {
  return variableFunction({
    group: 0xd0,
    subgroup: options.subgroup,
    nonDeletable: [...word(0), ...(options.embedded ?? [])],
  });
}

// One embedded subfunction, gated by its own code at both ends the way every multi-byte function is.
export function embeddedSubfunction(
  code: number,
  payload: readonly number[],
): number[] {
  return [code, ...payload, code];
}

// An Extended Document Summary packet (type 0x12): one "[size] [tag] [type] [name] [data]" group per field, with the name written as the bare null terminator the SDK's "optional" name reduces to.
export function summaryPacket(
  fields: readonly {
    readonly tag: number;
    readonly type: number;
    readonly data: readonly number[];
  }[],
): WpdPacketSpec {
  const groups = fields.flatMap((field) => {
    const nameTerminator = word(0);
    const size = 6 + nameTerminator.length + field.data.length;
    return [
      ...word(size),
      ...word(field.tag),
      ...word(field.type),
      ...nameTerminator,
      ...field.data,
    ];
  });
  return { packetType: 0x12, bytes: new Uint8Array(groups) };
}

// A null-terminated WP word string of ASCII (character set 0), the shape every text field in a packet takes.
export function wordString(value: string): number[] {
  return [
    ...[...value].flatMap((character) => word(character.charCodeAt(0))),
    ...word(0),
  ];
}

// The ASCII characters of a string as document-area bytes. Only characters the single-byte range carries literally (33 through 127) go through unchanged: a space is the Soft Space function 0x80, not byte 0x20, which is the international shorthand for the sharp s.
export function text(value: string): number[] {
  return [...value].map((character) => {
    const code = character.charCodeAt(0);
    return code === 0x20 ? 0x80 : code;
  });
}
