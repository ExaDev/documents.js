import { byteAt, uint16At, uint32At } from "../bytes/view";
import { packetByPrefixId, type WpdPrefixPacket } from "../container/prefix";
import { decodeWordString } from "./characters";

// -- Native OLE objects, per WPFF Prefix Packet Type 64 (0x40) "Graphics Filename" and Packet Type 112 (0x70) "OLE Object Descriptor" --
//
// An image box whose function-level override names IMAGE content (stream/box.ts's type 3) resolves to a Graphics Filename packet (type 0x40). When that packet's index flags state child prefix IDs (bit 0 -- the documented meaning of the flags byte every packet's index entry carries), its data opens with the child list: "[number of child IDs] [ID 1 (type=0x6F, 0x70, or 0x71)] ... [ID n] [tag 1] ... [tag n] [graphics filename]". A 0x6F child is the Graphics Cached File Data packet, whose whole payload is a graphics file's bytes (a WPG, or a straight raster -- the WPG decode path lives in stream/wpg.ts); a 0x70 child is the OLE Object Descriptor; a 0x71 child is OLE Object Data, of which the SDK says only "No documentation will be provided for this packet" -- this reader skips it and says so rather than guessing at an undocumented layout.
//
// The descriptor (0x70) is the one packet that states where an OLE object's bytes actually are, and its own leading marker states the generation: "WPWin7.0/OLE 2.0 Prefix Information Marker" for an OLE 2 object, whose null-terminated wordstring "will be 7-8 characters and the null terminator indicating the ole stream" -- the name of a stream inside the compound wrapper's PerfectOffice_OBJECTS storage -- and "WPWin6.0/OLE 1.0 Prefix Information Marker" for an OLE 1 object, whose wordstring "contains all Ole 1 data (any size)" inline. So the two spellings need different carriers: the OLE 2 bytes live in the wrapper (container.ts collects them), the OLE 1 bytes in the packet itself. A bare WP 6.x file has no wrapper at all, which is exactly why the OLE 1 spelling exists.
//
// What this module deliberately does NOT do is decode those bytes. A native OLE payload is an OLE server's own stream rather than a nested document package -- the identical boundary ooxml.js draws for a classic OLE1 payload with no Package stream, which stays opaque there too. This package carries the bytes (as a package attachment in the tree form) and names them; interpreting them would mean understanding every OLE server's own on-disk format.
//
// https://github.com/OneWingedShark/WordPerfect/blob/master/doc/SDK_Help/FileFormats/WPFF_PrefixPkt33-64.htm https://github.com/OneWingedShark/WordPerfect/blob/master/doc/SDK_Help/FileFormats/WPFF_PrefixPkt83-255.htm

export const PACKET_TYPE_GRAPHICS_FILENAME = 0x40;
export const PACKET_TYPE_GRAPHICS_CACHED_FILE_DATA = 0x6f;
export const PACKET_TYPE_OLE_OBJECT_DESCRIPTOR = 0x70;
export const PACKET_TYPE_OLE_OBJECT_DATA = 0x71;

// The index-flags bit that states a packet's data opens with child prefix IDs -- the same documented flags byte src/container/prefix.ts records on every packet, named here because the Graphics Filename packet is the one this reader walks children of.
const PACKET_FLAG_CHILD_IDS = 0x01;

// The descriptor packet's two documented markers. The SDK's own bracket notation gives "<marker> x 44" while each printed string is 42 characters -- so the field is the string, its terminating null, and one pad byte, and this reader compares the 42 characters and steps over all 44. The marker's generation word ("7.0/OLE 2.0" or "6.0/OLE 1.0") is the whole distinction between the two payload spellings this module routes between.
const OLE2_MARKER = "WPWin7.0/OLE 2.0 Prefix Information Marker";
const OLE1_MARKER = "WPWin6.0/OLE 1.0 Prefix Information Marker";
const MARKER_SIZE = 44;

// The descriptor's fixed head after the marker, per the SDK's size notation: {version} (4 bytes, "3 for WordPerfect 7"), [extra data] (2, boolean "True if data follows"), [reserved] (2), [link options] (2, 0-3 Always/OnSave/OnCall/OnClose), [reserved] (2), {pfxFlags} (4, bit flags none/empty/icon/link-broken), {Object Number} (4, zero-based). Only the marker and the object number are read past: none of the other fields changes where the payload is, and an OLE 1 object -- which names no stream -- needs the object number for its fallback name.
const DESCRIPTOR_VERSION_FIELD = 4;
const DESCRIPTOR_WORD_FIELDS = 2 * 4;
const DESCRIPTOR_PFX_FLAGS_FIELD = 4;
const DESCRIPTOR_OBJECT_NUMBER_FIELD = 4;
const DESCRIPTOR_FIXED_HEAD_SIZE =
  DESCRIPTOR_VERSION_FIELD +
  DESCRIPTOR_WORD_FIELDS +
  DESCRIPTOR_PFX_FLAGS_FIELD +
  DESCRIPTOR_OBJECT_NUMBER_FIELD;

// The descriptor packet's marker and payload location: which generation's spelling it carries, and where that generation's bytes are named.
export type WpdOleDescriptor =
  | { readonly ole2: true; readonly streamName: string }
  | { readonly ole2: false; readonly objectNumber: number };

// One recovered native OLE object: a name and the object's own bytes. The name is the OLE 2 stream's own name in the objects storage, or a deterministic fallback for an OLE 1 object (which names no stream) built from the descriptor's zero-based object number.
export interface WpdOleObject {
  readonly name: string;
  readonly bytes: Uint8Array;
}

// The child prefix IDs of a Graphics Filename packet, or undefined when the packet's index flags state no children (the no-children spelling is just the filename, so there is nothing to walk). Bounds-guarded the honest way: a child count that runs past the packet's own data is a packet that names children it does not carry, which answers undefined rather than a truncated list.
export function readGraphicsChildIds(
  packet: WpdPrefixPacket,
): number[] | undefined {
  if ((packet.flags & PACKET_FLAG_CHILD_IDS) === 0) {
    return undefined;
  }
  if (packet.bytes.length < 2) {
    return undefined;
  }
  const count = uint16At(packet.bytes, 0);
  if (2 + count * 2 > packet.bytes.length) {
    return undefined;
  }
  const childIds: number[] = [];
  for (let index = 0; index < count; index += 1) {
    childIds.push(uint16At(packet.bytes, 2 + index * 2));
  }
  return childIds;
}

// Parses an OLE Object Descriptor packet (type 0x70). Returns undefined for bytes too short to hold the marker and fixed head, or whose marker is neither of the two documented strings -- a packet that is not an OLE descriptor at all, which is the caller's signal to look for another child spelling (a WPG graphic, a raster) rather than a malformed one to diagnose separately.
export function readOleDescriptor(
  bytes: Uint8Array,
): WpdOleDescriptor | undefined {
  const payloadOffset = MARKER_SIZE + DESCRIPTOR_FIXED_HEAD_SIZE;
  if (bytes.length < payloadOffset) {
    return undefined;
  }
  let marker = "";
  for (let index = 0; index < OLE2_MARKER.length; index += 1) {
    marker += String.fromCharCode(byteAt(bytes, index));
  }
  if (marker === OLE2_MARKER) {
    const { text } = decodeWordString(
      bytes,
      payloadOffset,
      // Stryker disable next-line ArithmeticOperator: bytes IS the whole packet, so there is never real data beyond bytes.length for a larger word budget to reach -- decodeWordString's own bounds check stops at the true end of bytes regardless of how large a maxWords this expression computes, making * or + here behave identically to the correct / and -.
      (bytes.length - payloadOffset) / 2,
    );
    // "If Ole 2, wordstring will be 7-8 characters and the null terminator indicating the ole stream." An empty or missing name is a descriptor that names no stream -- nothing to resolve.
    if (text.length === 0) {
      return undefined;
    }
    return { ole2: true, streamName: text };
  }
  if (marker === OLE1_MARKER) {
    // {Object Number} is the last fixed-head field before the payload, so it ends exactly where the wordstring begins.
    const objectNumber = uint32At(
      bytes,
      payloadOffset - DESCRIPTOR_OBJECT_NUMBER_FIELD,
    );
    return { ole2: false, objectNumber };
  }
  return undefined;
}

// Resolves a native OLE object out of a box's Graphics Filename packet: walk the packet's child IDs, find the first OLE Object Descriptor (0x70) among them, and follow that descriptor's own statement of where the bytes are -- the named stream in the compound wrapper's objects storage for OLE 2, the descriptor packet's own trailing bytes for OLE 1. Returns undefined whenever the chain does not complete: no children, no descriptor child, an unreadable descriptor, or an OLE 2 stream name the wrapper does not carry (a bare WP 6.x file cannot hold one). The honest-or-nothing contract every other packet resolution here holds: no bytes are invented, and no partial object is returned.
export function readOleObject(
  packets: readonly WpdPrefixPacket[],
  graphicsPacket: WpdPrefixPacket,
  oleObjectStreams: ReadonlyMap<string, Uint8Array>,
): WpdOleObject | undefined {
  const childIds = readGraphicsChildIds(graphicsPacket);
  if (childIds === undefined) {
    return undefined;
  }
  for (const childId of childIds) {
    const child = packetByPrefixId(packets, childId);
    if (child?.packetType !== PACKET_TYPE_OLE_OBJECT_DESCRIPTOR) {
      continue;
    }
    const descriptor = readOleDescriptor(child.bytes);
    if (descriptor === undefined) {
      return undefined;
    }
    const payloadOffset = MARKER_SIZE + DESCRIPTOR_FIXED_HEAD_SIZE;
    if (descriptor.ole2) {
      const streamBytes = oleObjectStreams.get(descriptor.streamName);
      if (streamBytes === undefined) {
        return undefined;
      }
      return { name: descriptor.streamName, bytes: streamBytes };
    }
    if (child.bytes.length <= payloadOffset) {
      return undefined;
    }
    return {
      name: `ole1-${String(descriptor.objectNumber)}`,
      bytes: child.bytes.subarray(payloadOffset),
    };
  }
  return undefined;
}
