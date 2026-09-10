import { describe, expect, it } from "vitest";
import type { WpdPrefixPacket } from "../container/prefix";
import {
  PACKET_TYPE_GRAPHICS_FILENAME,
  PACKET_TYPE_OLE_OBJECT_DATA,
  PACKET_TYPE_OLE_OBJECT_DESCRIPTOR,
  readGraphicsChildIds,
  readOleDescriptor,
  readOleObject,
} from "./ole";

// The descriptor packet's fixed head assembled the way WPFF PrefixPkt83-255's own field table lays it out: the 44-byte marker, {version}, [extra data], [reserved], [link options], [reserved], {pfxFlags}, {Object Number}, then the payload wordstring. Every test descriptor below is built from that one field table, so each expectation is checkable against the page it cites without a real file to hand.
function descriptorPacket(
  marker: string,
  objectNumber: number,
  payload: readonly number[],
): Uint8Array {
  const markerBytes = [
    ...Array.from(marker, (character) => character.charCodeAt(0)),
    0,
    0, // the marker field is 44 bytes and the string with its null is 43, so one pad byte follows
  ];
  const fixedHead = [
    3,
    0,
    0,
    0, // {version} = 3, "for WordPerfect 7"
    0,
    0, // [extra data] = false
    0,
    0, // [reserved]
    0,
    0, // [link options] = Always
    0,
    0, // [reserved]
    0,
    0,
    0,
    0, // {pfxFlags} = none
    objectNumber & 0xff,
    (objectNumber >>> 8) & 0xff,
    (objectNumber >>> 16) & 0xff,
    (objectNumber >>> 24) & 0xff, // {Object Number}, zero-based
  ];
  return new Uint8Array([...markerBytes, ...fixedHead, ...payload]);
}

// A null-terminated WP word string of ASCII (character set 0), the shape the descriptor's payload wordstring takes.
function wordStringBytes(value: string): number[] {
  return [
    ...[...value].flatMap((character) => [character.charCodeAt(0) & 0xff, 0]),
    0,
    0,
  ];
}

function packet(
  prefixId: number,
  packetType: number,
  bytes: Uint8Array,
  flags = 0,
): WpdPrefixPacket {
  return {
    prefixId,
    packetType,
    flags,
    useCount: 1,
    hiddenCount: 0,
    offset: 0,
    bytes,
  };
}

describe("readOleDescriptor", () => {
  it("reads an OLE 2 descriptor's marker and the stream name its wordstring states", () => {
    const descriptor = readOleDescriptor(
      descriptorPacket(
        "WPWin7.0/OLE 2.0 Prefix Information Marker",
        0,
        wordStringBytes("OLE10"),
      ),
    );
    expect(descriptor).toEqual({ ole2: true, streamName: "OLE10" });
  });

  it("reads an OLE 1 descriptor's marker and zero-based object number", () => {
    const descriptor = readOleDescriptor(
      descriptorPacket(
        "WPWin6.0/OLE 1.0 Prefix Information Marker",
        4,
        [0xd0, 0xcf, 0x11, 0xe0],
      ),
    );
    expect(descriptor).toEqual({ ole2: false, objectNumber: 4 });
  });

  it("answers undefined for bytes too short to hold the marker and fixed head", () => {
    expect(
      readOleDescriptor(new Uint8Array([0x57, 0x50, 0x57, 0x69, 0x6e])),
    ).toBeUndefined();
  });

  it("answers undefined for a marker that is neither documented string", () => {
    expect(
      readOleDescriptor(
        descriptorPacket("WPWin9.0/OLE 4.0 Prefix Information Marker", 0, []),
      ),
    ).toBeUndefined();
  });

  it("answers undefined for an OLE 2 descriptor whose wordstring names no stream", () => {
    expect(
      readOleDescriptor(
        descriptorPacket(
          "WPWin7.0/OLE 2.0 Prefix Information Marker",
          0,
          [0, 0],
        ),
      ),
    ).toBeUndefined();
  });
});

describe("readGraphicsChildIds", () => {
  it("reads the child prefix IDs a child-carrying Graphics Filename packet names", () => {
    // [number of child IDs = 2][child 3][child 4], then the tag words and filename this reader does not need to walk.
    const bytes = new Uint8Array([2, 0, 3, 0, 4, 0, 1, 0, 1, 0, 0, 0]);
    expect(
      readGraphicsChildIds(
        packet(2, PACKET_TYPE_GRAPHICS_FILENAME, bytes, 0x01),
      ),
    ).toEqual([3, 4]);
  });

  it("answers undefined when the packet's flags state no child IDs", () => {
    expect(
      readGraphicsChildIds(
        packet(2, PACKET_TYPE_GRAPHICS_FILENAME, new Uint8Array([0, 0])),
      ),
    ).toBeUndefined();
  });

  it("answers undefined for a child count that runs past the packet's own data", () => {
    expect(
      readGraphicsChildIds(
        packet(
          2,
          PACKET_TYPE_GRAPHICS_FILENAME,
          new Uint8Array([9, 0, 3, 0]),
          0x01,
        ),
      ),
    ).toBeUndefined();
  });
});

describe("readOleObject", () => {
  it("resolves an OLE 2 object's bytes from the named objects-storage stream", () => {
    const nativeBytes = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 1, 2]);
    const graphics = packet(
      2,
      PACKET_TYPE_GRAPHICS_FILENAME,
      new Uint8Array([1, 0, 3, 0, 0, 0, 0, 0]),
      0x01,
    );
    const descriptor = packet(
      3,
      PACKET_TYPE_OLE_OBJECT_DESCRIPTOR,
      descriptorPacket(
        "WPWin7.0/OLE 2.0 Prefix Information Marker",
        0,
        wordStringBytes("OLE10"),
      ),
    );
    const streams = new Map([["OLE10", nativeBytes]]);
    expect(readOleObject([graphics, descriptor], graphics, streams)).toEqual({
      name: "OLE10",
      bytes: nativeBytes,
    });
  });

  it("resolves an OLE 1 object's bytes from the descriptor packet's own payload", () => {
    const ole1Data = [0x01, 0x02, 0x03, 0x04, 0x05];
    const graphics = packet(
      2,
      PACKET_TYPE_GRAPHICS_FILENAME,
      new Uint8Array([1, 0, 3, 0, 0, 0, 0, 0]),
      0x01,
    );
    const descriptor = packet(
      3,
      PACKET_TYPE_OLE_OBJECT_DESCRIPTOR,
      descriptorPacket(
        "WPWin6.0/OLE 1.0 Prefix Information Marker",
        7,
        ole1Data,
      ),
    );
    const resolved = readOleObject([graphics, descriptor], graphics, new Map());
    expect(resolved?.name).toBe("ole1-7");
    expect(resolved !== undefined && Array.from(resolved.bytes)).toEqual(
      ole1Data,
    );
  });

  it("skips non-descriptor children and answers undefined when no descriptor is named", () => {
    const graphics = packet(
      2,
      PACKET_TYPE_GRAPHICS_FILENAME,
      new Uint8Array([1, 0, 3, 0, 0, 0, 0, 0]),
      0x01,
    );
    const dataChild = packet(3, PACKET_TYPE_OLE_OBJECT_DATA, new Uint8Array(4));
    expect(
      readOleObject([graphics, dataChild], graphics, new Map()),
    ).toBeUndefined();
  });

  it("answers undefined for an OLE 2 stream name the wrapper does not carry", () => {
    const graphics = packet(
      2,
      PACKET_TYPE_GRAPHICS_FILENAME,
      new Uint8Array([1, 0, 3, 0, 0, 0, 0, 0]),
      0x01,
    );
    const descriptor = packet(
      3,
      PACKET_TYPE_OLE_OBJECT_DESCRIPTOR,
      descriptorPacket(
        "WPWin7.0/OLE 2.0 Prefix Information Marker",
        0,
        wordStringBytes("MISSING"),
      ),
    );
    expect(
      readOleObject([graphics, descriptor], graphics, new Map()),
    ).toBeUndefined();
  });
});
