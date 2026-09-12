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

// -- General WP Text (Packet Type 8 / 0x08), per WPFF_PrefixPkt0-32.htm --
//
// "[number of text blocks] {relative offset of first text block within packet} {size of 1st text block} ... {size of last text block} <text data for 1st block> x 1st block size ... <text data for last block> x last block size" -- one or more anonymous text-block regions, each a document-area function-code stream this package's own tokeniser and fold can read exactly as they read the main document area. The blocks are laid out consecutively starting at the stated offset with no gap between them (the layout's own field order states data immediately following data, with no per-block offset of its own beyond the first), so their concatenation is simply the one contiguous span from the first block's offset to the sum of every block's stated size past it -- returned as a single view rather than split back into blocks, since nothing here needs the boundary between them.
//
// This is the packet a header, footer, footnote, endnote, or box caption's own text lives in -- and, per WPFF_DF-BOX.htm's own PID list, the packet a box's TEXT or EQUATION content resolves to as well, once the box function's own override names which prefix ID holds it (stream/box.ts).
export const PACKET_TYPE_GENERAL_WP_TEXT = 0x08;

export function readGeneralWpTextBlocks(
  bytes: Uint8Array,
): Uint8Array | undefined {
  // uint16At throws (via byteAt) rather than returning undefined for a read that runs past bytes' own end, caught below -- so neither the block count, the first block offset, nor any one size word in the loop below needs a separate room check ahead of reading it. A dedicated sizesEnd > bytes.length guard used to sit ahead of the loop, checking room for every size word the loop is about to read in one go -- but unlike the text-block header guard style.ts's readStyleBeginBlock still needs (which checks room for a field the loop never reads), this guard's own threshold (4 + blockCount * 2) is exactly the byte offset the loop's own last iteration already requires, so a bytes.length short of it makes that same iteration throw in precisely the place the guard would have rejected it -- no input can tell the removed guard from the throw it deferred to.
  try {
    const blockCount = uint16At(bytes, 0);
    const firstBlockOffset = uint16At(bytes, 2);
    if (blockCount === 0) {
      return undefined;
    }
    let totalSize = 0;
    for (let index = 0; index < blockCount; index += 1) {
      totalSize += uint16At(bytes, 4 + index * 2);
    }
    const end = firstBlockOffset + totalSize;
    // No separate firstBlockOffset < 0 guard is needed: uint16At only ever answers an unsigned 16-bit value, so firstBlockOffset can never be negative in the first place.
    if (end > bytes.length) {
      return undefined;
    }
    return bytes.subarray(firstBlockOffset, end);
  } catch {
    return undefined;
  }
}

// "The typeface name is made up for four separate null word-terminated strings: 1st string = typeface family (such as Times or Swiss), 2nd string = attributes (such as Bold, Italic, or Bold Italic), 3rd string = name prefix ... 4th string = name extension." Only the first is returned: it is the one a ContentRun's fontFamily wants, and the attributes string duplicates information the document's own Attribute On/Off functions already carry.
export function readTypefaceName(packet: Uint8Array): string | undefined {
  // uint16At throws (via byteAt) rather than returning undefined for a read that runs past packet's own end, caught below -- so the name-length word itself needs no separate room check ahead of reading it.
  try {
    const nameLength = uint16At(packet, TYPEFACE_NAME_LENGTH_OFFSET);
    // No separate bound against packet's own remaining length is needed here: decodeWordString already stops the moment it runs off the real end of `packet`, regardless of how many words it is asked for, so nameLength alone (converted from a byte count to a word count) is exactly as safe a bound as intersecting it with the packet's own remaining length would be.
    const { text } = decodeWordString(
      packet,
      TYPEFACE_NAME_OFFSET,
      Math.floor(nameLength / 2),
    );
    return text.length > 0 ? text : undefined;
  } catch {
    return undefined;
  }
}
