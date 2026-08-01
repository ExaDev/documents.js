import { describe, expect, it } from 'vitest';
import { ByteWriter, concatBytes } from './writer';

describe('ByteWriter', () => {
  it('concatenates many small writes in order', () => {
    const writer = new ByteWriter();
    writer.writeByte(1);
    writer.writeBytes(new Uint8Array([2, 3]));
    writer.writeAscii('!'); // 0x21
    expect(writer.length).toBe(4);
    expect(writer.toBytes()).toEqual(new Uint8Array([1, 2, 3, 0x21]));
  });

  it('ignores an empty write', () => {
    const writer = new ByteWriter();
    writer.writeBytes(new Uint8Array([]));
    expect(writer.length).toBe(0);
    expect(writer.toBytes()).toEqual(new Uint8Array([]));
  });
});

describe('concatBytes', () => {
  it('joins chunks into one contiguous array', () => {
    expect(concatBytes([new Uint8Array([1, 2]), new Uint8Array([]), new Uint8Array([3])])).toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });

  it('returns an empty array for no chunks', () => {
    expect(concatBytes([])).toEqual(new Uint8Array([]));
  });
});
