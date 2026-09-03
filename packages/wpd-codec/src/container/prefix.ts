import { byteAt, sliceAt, uint16At, uint32At } from "../bytes/view";
import { WpdFormatError } from "../errors";
import { decodeWordString } from "../stream/characters";
import type { WpdFileHeader } from "./header";

// -- The prefix index and packet data areas, per WPFF Document Structure, "Index and Packet Data Areas" --
//
// "The prefix index area comes immediately after the file header. The index area contains indexes which point to data in the packet data area." A packet holds data referenced many times but not part of the document's content -- a font descriptor, a style definition, a comment's text -- and the document area reaches it through the index rather than through the packet's file offset: "This prefix index reference is called a prefix ID or PID."
//
// A prefix ID is NOT a packet type. "Prefix ID refers to the index sequence of the packet's index in the index block. Packet type refers to the purpose and structure of the packet's data ... There can be several packets with the same type value." The index header occupies the first slot, so the first real packet's prefix ID is 1 -- confirmed twice over by the SDK's own generic-header example, where a Default Initial Font & Size packet names child prefix ID 1 (the Desired Font Descriptor, the first entry) and the document's Global On style code names prefix ID 3 (the Normal Style packet, the third entry).

// Both the index header and every index entry occupy fourteen bytes: the header is <flags> <reserved> [count] <reserved x 10>, and an entry is <flags> <packet type> [use count] [hidden count] {size} {pointer}. The generic-header example pins the figure -- five slots fill 512 through 582, where its first packet's own pointer says the packet data begins.
export const WPD_INDEX_RECORD_SIZE = 14;

// "<flags> = 2" on the index header, the one documented value that distinguishes it from an entry.
const INDEX_HEADER_FLAGS = 2;

// Packet Type 85 (0x55), "Desired Font Descriptor" -- the packet a Font Face Change function names, carrying the typeface name this reader lifts onto a run's fontFamily. Same layout as Packet Type 32 (0x20), the Font Typeface Descriptor Pool.
export const PACKET_TYPE_DESIRED_FONT_DESCRIPTOR = 0x55;

export interface WpdPrefixPacket {
  // The packet's prefix ID: its 1-based sequence among the index entries following the index header. This is the number every document-area function's PID field names.
  readonly prefixId: number;
  // What the packet's data means, from the SDK's prefix packet catalogue. Deliberately a plain number rather than an enum: the catalogue runs to 255 entries, several are reserved or undocumented, and a reader that only interprets a handful of them should carry the rest faithfully rather than reject them.
  readonly packetType: number;
  // Bit 0: the packet's data begins with child prefix IDs. Bit 1: it contains WP character-set mapped text blocks. Bit 2: the maximum valid use count is 1. Bit 3: the valid use count is 1 when no functions reference it. The child-ID and text-block substructures both sit at the head of `bytes` and are not decoded here -- see the README's Remaining scope.
  readonly flags: number;
  // "The number of document functions that reference this prefix data."
  readonly useCount: number;
  // "The number of deleted document functions that reference this prefix data."
  readonly hiddenCount: number;
  // Where the packet's data begins, as an absolute file offset. Carried for diagnostics; nothing resolves a packet by offset, only by prefix ID.
  readonly offset: number;
  // The packet's data, exactly as long as its index's {size of data packet} field claims. A view onto the caller's own buffer, not a copy.
  readonly bytes: Uint8Array;
}

export function readPrefixPackets(
  bytes: Uint8Array,
  header: WpdFileHeader,
): WpdPrefixPacket[] {
  const indexAreaOffset = header.indexAreaOffset;
  const headerFlags = byteAt(bytes, indexAreaOffset);
  if (headerFlags !== INDEX_HEADER_FLAGS) {
    throw new WpdFormatError(
      `The index block at offset ${indexAreaOffset} opens with flags ${headerFlags}, not the index header's documented value of ${INDEX_HEADER_FLAGS}.`,
    );
  }

  // The count includes the header itself, which is why the SDK calls the header "the first index" rather than a separate structure: a generic prefix with four packets reports five.
  const indexCount = uint16At(bytes, indexAreaOffset + 2);
  if (indexCount < 1) {
    throw new WpdFormatError(
      `The index header claims ${indexCount} indexes, but it is itself one of them.`,
    );
  }

  const packets: WpdPrefixPacket[] = [];
  for (let entry = 1; entry < indexCount; entry += 1) {
    const recordOffset = indexAreaOffset + entry * WPD_INDEX_RECORD_SIZE;
    const flags = byteAt(bytes, recordOffset);
    const packetType = byteAt(bytes, recordOffset + 1);
    const useCount = uint16At(bytes, recordOffset + 2);
    const hiddenCount = uint16At(bytes, recordOffset + 4);
    const size = uint32At(bytes, recordOffset + 6);
    const offset = uint32At(bytes, recordOffset + 10);

    // Packet Type 0 is "Index Entry Is Available or Was Deleted" -- a live slot holding nothing, whose size and pointer fields mean nothing either. It still consumes a prefix ID, so it is recorded rather than skipped: dropping it would renumber every packet after it and silently misresolve every PID the document area names.
    if (packetType === 0) {
      packets.push({
        prefixId: entry,
        packetType,
        flags,
        useCount,
        hiddenCount,
        offset,
        bytes: new Uint8Array(0),
      });
      continue;
    }

    packets.push({
      prefixId: entry,
      packetType,
      flags,
      useCount,
      hiddenCount,
      offset,
      bytes: sliceAt(bytes, offset, size),
    });
  }
  return packets;
}

// Resolves a prefix ID against a packet list. Returns undefined for an ID no index carries, which a document-area function can legitimately name after an edit deleted the packet it pointed at -- an absent packet is missing formatting, not a malformed file.
export function packetByPrefixId(
  packets: readonly WpdPrefixPacket[],
  prefixId: number,
): WpdPrefixPacket | undefined {
  return packets.find((packet) => packet.prefixId === prefixId);
}

// -- Desired Font Descriptor (Packet Type 85 / 0x55), whose layout the SDK gives under Packet Type 32 (0x20) --
//
// Six shorts, then eight bytes, then the name: [average character width (PSU)] [ascender height] [x height] [descender height] [italic adjust] [primary family ID] <scripting system> <primary character set> <width (aspect ratio)> <weight> <attributes> <general characteristics> <classification> <fill byte = 0> <font type> <font source file type> [typeface name length in bytes] [typeface name].
//
// Every one of those fields lands exactly where this arithmetic puts it in the SDK's own generic-header example: primary family ID reads 0x0911, which its family enumeration names TimesRoman; the fill byte reads 0; font type reads 0x8B (TrueType) and source file type 0x14 (.DRS), both documented values; and the name length reads 54, exactly the bytes remaining in the packet.
const TYPEFACE_NAME_LENGTH_OFFSET = 22;
const TYPEFACE_NAME_OFFSET = 24;

// "The typeface name is made up for four separate null word-terminated strings: 1st string = typeface family (such as Times or Swiss), 2nd string = attributes (such as Bold, Italic, or Bold Italic), 3rd string = name prefix ... 4th string = name extension." Only the first is returned: it is the one a ContentRun's fontFamily wants, and the attributes string duplicates information the document's own Attribute On/Off functions already carry.
export function readTypefaceName(packet: Uint8Array): string | undefined {
  if (packet.length < TYPEFACE_NAME_OFFSET) {
    return undefined;
  }
  const nameLength = uint16At(packet, TYPEFACE_NAME_LENGTH_OFFSET);
  const available = Math.min(nameLength, packet.length - TYPEFACE_NAME_OFFSET);
  if (available <= 0) {
    return undefined;
  }
  const { text } = decodeWordString(
    packet,
    TYPEFACE_NAME_OFFSET,
    Math.floor(available / 2),
  );
  return text.length > 0 ? text : undefined;
}
