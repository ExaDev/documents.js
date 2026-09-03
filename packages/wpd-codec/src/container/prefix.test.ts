import { describe, expect, it } from "vitest";
import { WpdFormatError } from "../errors";
import { genericHeaderBytes } from "../test-support/generic-header";
import { readFileHeader } from "./header";
import {
  PACKET_TYPE_DESIRED_FONT_DESCRIPTOR,
  readPrefixPackets,
  readTypefaceName,
} from "./prefix";

function packetsOfGenericHeader() {
  const bytes = genericHeaderBytes();
  return readPrefixPackets(bytes, readFileHeader(bytes));
}

describe("readPrefixPackets", () => {
  // The SDK's generic-header example states in prose that this prefix carries "the 5 default indexes and associated packets" and that the document area begins at 718. Five index slots of fourteen bytes fill 512..582, the first being the index header, so four real packets follow -- and their sizes and pointers must tile 582..718 exactly with no gap.
  it("reads the four packets of the SDK's own generic header example", () => {
    // Compared without each packet's own bytes, which the next test checks by length; an index record and the packet data it points at are two separate claims.
    expect(
      packetsOfGenericHeader().map((packet) => ({
        prefixId: packet.prefixId,
        packetType: packet.packetType,
        flags: packet.flags,
        useCount: packet.useCount,
        hiddenCount: packet.hiddenCount,
        offset: packet.offset,
      })),
    ).toEqual([
      {
        prefixId: 1,
        packetType: 0x55,
        flags: 0x00,
        useCount: 1,
        hiddenCount: 0,
        offset: 582,
      },
      {
        prefixId: 2,
        packetType: 0x25,
        flags: 0x09,
        useCount: 1,
        hiddenCount: 0,
        offset: 660,
      },
      {
        prefixId: 3,
        packetType: 0x30,
        flags: 0x0b,
        useCount: 2,
        hiddenCount: 0,
        offset: 666,
      },
      {
        prefixId: 4,
        packetType: 0x5e,
        flags: 0x08,
        useCount: 1,
        hiddenCount: 0,
        offset: 706,
      },
    ]);
  });

  it("gives each packet exactly the bytes its index's size field claims", () => {
    expect(
      packetsOfGenericHeader().map((packet) => packet.bytes.length),
    ).toEqual([78, 6, 40, 12]);
  });

  // Prefix IDs are 1-based over the index entries that follow the header, not 0-based over the whole index block. Two independent facts in the example prove it: the Default Initial Font & Size packet (type 0x25) names child prefix ID 1, which has to be the Desired Font Descriptor rather than itself, and the document area's Global On style code names prefix ID 3, which has to be the Normal Style packet (type 0x30) rather than the font descriptor.
  it("numbers prefix IDs from 1 over the entries following the index header", () => {
    const packets = packetsOfGenericHeader();
    const styleDataPacket = packets.find((packet) => packet.prefixId === 3);
    expect(styleDataPacket?.packetType).toBe(0x30);
  });

  it("rejects an index whose packet pointer runs past the end of the file", () => {
    const bytes = genericHeaderBytes();
    // The first index's {ptr to data packet} long sits at 526 + 10.
    bytes[536] = 0xff;
    bytes[537] = 0xff;
    expect(() => readPrefixPackets(bytes, readFileHeader(bytes))).toThrow(
      WpdFormatError,
    );
  });

  it("rejects an index block whose header flags byte is not 2", () => {
    const bytes = genericHeaderBytes();
    bytes[512] = 7;
    expect(() => readPrefixPackets(bytes, readFileHeader(bytes))).toThrow(
      WpdFormatError,
    );
  });
});

describe("readTypefaceName", () => {
  // The example's Desired Font Descriptor carries primary family ID 0x0911 (TimesRoman in the SDK's own family enumeration), font type 0x8B (TrueType), source file type 0x14 (.DRS), and a 54-byte typeface name -- "Times New Roman Regular" as a WP word string, followed by the three empty strings the descriptor's four-string name field always ends with.
  it("reads the typeface family from the SDK example's font descriptor", () => {
    const descriptor = packetsOfGenericHeader().find(
      (packet) => packet.packetType === PACKET_TYPE_DESIRED_FONT_DESCRIPTOR,
    );
    expect(descriptor).toBeDefined();
    expect(readTypefaceName(descriptor?.bytes ?? new Uint8Array())).toBe(
      "Times New Roman Regular",
    );
  });

  it("returns undefined for a packet too short to hold a descriptor's fixed fields", () => {
    expect(readTypefaceName(new Uint8Array(10))).toBeUndefined();
  });
});
