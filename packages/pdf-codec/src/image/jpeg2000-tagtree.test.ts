import { describe, expect, it } from 'vitest';
import { Jpeg2000ParseError } from './jpeg2000-errors';
import { PacketBitReader, TagTree } from './jpeg2000-tagtree';

// These two primitives are exercised end to end by every fixture in jpeg2000.test.ts -- a tag tree that disagreed with the encoder by a single bit would desynchronise the packet header and no fixture would decode at all. What follows pins the two edges that a whole-file test cannot isolate: the stuffed-bit rule at a 0xFF byte, and the resumption of a partially-determined tag tree across successive thresholds.

describe('PacketBitReader', () => {
  it('reads bits most significant first', () => {
    const reader = new PacketBitReader(Uint8Array.from([0b10110010, 0b01000000]), 0, 2);
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(() => reader.readBit())).toEqual([1, 0, 1, 1, 0, 0, 1, 0]);
    expect(reader.readBits(2)).toBe(1);
  });

  it('takes only seven bits from the byte after a 0xFF', () => {
    // ISO/IEC 15444-1 B.10.1: the byte following 0xFF carries a stuffed zero in its most significant bit, so a header can never contain a 0xFF 0x90-or-above marker sequence.
    const reader = new PacketBitReader(Uint8Array.from([0xff, 0b01010101]), 0, 2);
    expect(Array.from({ length: 8 }, () => reader.readBit())).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
    expect(Array.from({ length: 7 }, () => reader.readBit())).toEqual([1, 0, 1, 0, 1, 0, 1]);
  });

  it('rejects a byte after 0xFF whose stuffed bit is set', () => {
    const reader = new PacketBitReader(Uint8Array.from([0xff, 0x90]), 0, 2);
    for (let i = 0; i < 8; i++) {
      reader.readBit();
    }
    expect(() => reader.readBit()).toThrow(Jpeg2000ParseError);
  });

  it('discards the stuffed byte as well as the part-read one when aligning', () => {
    const plain = new PacketBitReader(Uint8Array.from([0x12, 0x34, 0x56]), 0, 3);
    plain.readBit();
    plain.alignToByte();
    expect(plain.offset).toBe(1);

    const stuffed = new PacketBitReader(Uint8Array.from([0xff, 0x00, 0x56]), 0, 3);
    for (let i = 0; i < 8; i++) {
      stuffed.readBit();
    }
    stuffed.alignToByte();
    // Both the 0xFF and the byte carrying its stuffed bit belong to the header.
    expect(stuffed.offset).toBe(2);
  });

  it('yields zero bits past the end rather than reading outside its own range', () => {
    const reader = new PacketBitReader(Uint8Array.from([0xff]), 0, 0);
    expect(Array.from({ length: 16 }, () => reader.readBit())).toEqual(Array.from({ length: 16 }, () => 0));
  });
});

describe('TagTree', () => {
  it('decodes a single-node tree one threshold at a time', () => {
    // A lone leaf holding the value 3 is coded as three zeros raising the lower bound to 3, then a one fixing it there. That is exactly the shape the zero-bit-plane field of a packet header takes.
    const reader = new PacketBitReader(Uint8Array.from([0b00010000]), 0, 1);
    const tree = new TagTree(1, 1);
    expect(tree.decode(reader, 0, 0, 1)).toBe(false);
    expect(tree.decode(reader, 0, 0, 2)).toBe(false);
    expect(tree.decode(reader, 0, 0, 3)).toBe(false);
    expect(tree.decode(reader, 0, 0, 4)).toBe(true);
    expect(tree.valueAt(0, 0)).toBe(3);
  });

  it('shares a parent node between two leaves so its value is coded only once', () => {
    // Two leaves holding 1 and 2. Their shared root holds the smaller, 1, coded as a zero then a one; leaf 0 then adds a bare one (it equals the root), and leaf 1 a zero then a one (it is one greater). Five bits in total: 0 1 1 0 1.
    const reader = new PacketBitReader(Uint8Array.from([0b01101000]), 0, 1);
    const tree = new TagTree(2, 1);
    expect(tree.decode(reader, 0, 0, 1)).toBe(false);
    expect(tree.decode(reader, 0, 0, 2)).toBe(true);
    expect(tree.valueAt(0, 0)).toBe(1);
    // The root is already determined, so nothing more is read for it on the second leaf's own path.
    expect(tree.decode(reader, 1, 0, 1)).toBe(false);
    expect(tree.decode(reader, 1, 0, 2)).toBe(false);
    expect(tree.decode(reader, 1, 0, 3)).toBe(true);
    expect(tree.valueAt(1, 0)).toBe(2);
  });

  it('builds a level hierarchy that halves both axes until a single root remains', () => {
    // A 5x3 tree needs levels of 5x3, 3x2, 2x1 and 1x1: a decode has to walk all four, and any miscount would index outside the node array.
    const reader = new PacketBitReader(Uint8Array.from([0xff, 0x00, 0x00, 0x00, 0x00, 0x00]), 0, 6);
    const tree = new TagTree(5, 3);
    // Every node on the path answers "yes, this value" at the first opportunity, so the leaf is determined at threshold 1 with value 0.
    expect(tree.decode(reader, 4, 2, 1)).toBe(true);
    expect(tree.valueAt(4, 2)).toBe(0);
  });
});
