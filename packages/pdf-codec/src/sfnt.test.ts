import { describe, expect, it } from 'vitest';
import { f2dot14, hasBytes, i16, i32, parseSfnt, sfntTableBytes, u16, u24, u32, u8 } from './sfnt';
import { caladeaRegularBytes, carlitoRegularBytes } from './test-support/fonts';

describe('parseSfnt against the real vendored fonts', () => {
  it("reads Carlito Regular's whole table directory", () => {
    const font = parseSfnt(carlitoRegularBytes());
    expect(font).toBeDefined();
    expect(font!.tables.size).toBe(17);
    for (const tag of ['cmap', 'glyf', 'head', 'hhea', 'hmtx', 'loca', 'maxp', 'name', 'post', 'OS/2']) {
      expect(font!.tables.has(tag)).toBe(true);
    }
  });

  it('slices out a table whose bytes really are that table', () => {
    const font = parseSfnt(carlitoRegularBytes());
    const head = sfntTableBytes(font!, 'head');
    expect(head).toBeDefined();
    expect(head!.length).toBe(font!.tables.get('head')?.length);
    expect(u32(head!, 12)).toBe(0x5f0f3cf5); // the head table's own magic number, at the offset only a real head table has it
    expect(sfntTableBytes(font!, 'CFF ')).toBeUndefined(); // a glyf-flavoured font carries no CFF table
  });

  it('reads a glyf-flavoured font of each vendored family', () => {
    expect(parseSfnt(caladeaRegularBytes())?.tables.size).toBe(18);
  });
});

// A table directory with `numTables` records, each pointing at `tableOffset`/`tableLength`, for the malformed-container cases below. Written to the spec's own layout (ISO/IEC 14496-22 clause 4.2) rather than derived from this module's reader.
function buildDirectory(options: { sfntVersion: number; numTables: number; tag: string; tableOffset: number; tableLength: number; totalLength: number }): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(options.totalLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, options.sfntVersion);
  view.setUint16(4, options.numTables);
  for (let i = 0; i < options.tag.length; i++) {
    bytes[12 + i] = options.tag.charCodeAt(i);
  }
  view.setUint32(12 + 8, options.tableOffset);
  view.setUint32(12 + 12, options.tableLength);
  return bytes;
}

describe('parseSfnt rejects a container it cannot read', () => {
  it('returns undefined for bytes too short to hold a directory header', () => {
    expect(parseSfnt(new Uint8Array(0))).toBeUndefined();
    expect(parseSfnt(new Uint8Array(11))).toBeUndefined();
  });

  it('returns undefined for a version tag that is not a single-font sfnt', () => {
    const collection = buildDirectory({ sfntVersion: 0x74746366, numTables: 1, tag: 'head', tableOffset: 28, tableLength: 54, totalLength: 128 }); // 'ttcf', a TrueType Collection: several directories behind a header this reader does not walk
    expect(parseSfnt(collection)).toBeUndefined();
    const notAFont = buildDirectory({ sfntVersion: 0x25504446, numTables: 1, tag: 'head', tableOffset: 28, tableLength: 54, totalLength: 128 }); // '%PDF'
    expect(parseSfnt(notAFont)).toBeUndefined();
  });

  it('returns undefined when numTables claims more records than the file holds', () => {
    const overclaimed = buildDirectory({ sfntVersion: 0x00010000, numTables: 4096, tag: 'head', tableOffset: 28, tableLength: 54, totalLength: 128 });
    expect(parseSfnt(overclaimed)).toBeUndefined();
  });

  it('returns undefined for a record whose tag is not printable ASCII', () => {
    const bytes = buildDirectory({ sfntVersion: 0x00010000, numTables: 1, tag: 'head', tableOffset: 28, tableLength: 54, totalLength: 128 });
    bytes[13] = 0x00;
    expect(parseSfnt(bytes)).toBeUndefined();
  });
});

describe('parseSfnt degrades around one unusable record', () => {
  it('drops a table whose bytes lie past the end of the file, keeping the rest of the font', () => {
    const bytes = carlitoRegularBytes();
    const damaged = new Uint8Array(bytes.length);
    damaged.set(bytes);
    // Point the first table record's length at far more bytes than the file holds.
    new DataView(damaged.buffer).setUint32(12 + 12, 0xffff_0000);
    const original = parseSfnt(bytes);
    const font = parseSfnt(damaged);
    expect(font).toBeDefined();
    expect(font!.tables.size).toBe(original!.tables.size - 1);
    // Every other table is still readable, which is the whole point of dropping one record rather than the font.
    expect(sfntTableBytes(font!, 'head')).toBeDefined();
    expect(sfntTableBytes(font!, 'glyf')).toBeDefined();
  });

  it('keeps the first of two records sharing a tag', () => {
    const bytes = new Uint8Array(12 + 16 * 2 + 8);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 0x00010000);
    view.setUint16(4, 2);
    for (const recordIndex of [0, 1]) {
      const recordOffset = 12 + 16 * recordIndex;
      for (let i = 0; i < 4; i++) {
        bytes[recordOffset + i] = 'test'.charCodeAt(i);
      }
      view.setUint32(recordOffset + 8, 12 + 32 + recordIndex * 4);
      view.setUint32(recordOffset + 12, 4);
    }
    const font = parseSfnt(bytes);
    expect(font).toBeDefined();
    expect(font!.tables.size).toBe(1);
    expect(font!.tables.get('test')?.offset).toBe(12 + 32);
  });
});

describe('big-endian primitive readers', () => {
  const bytes = Uint8Array.from([0x00, 0x80, 0xff, 0x7f, 0x12, 0x34, 0x56, 0x78, 0x40, 0x00]);

  it('reads each width at the sfnt byte order', () => {
    expect(u8(bytes, 1)).toBe(0x80);
    expect(u16(bytes, 0)).toBe(0x0080);
    expect(u16(bytes, 2)).toBe(0xff7f);
    expect(u24(bytes, 4)).toBe(0x123456);
    expect(u32(bytes, 4)).toBe(0x12345678);
  });

  it('reinterprets the signed widths correctly at and across the sign boundary', () => {
    expect(i16(bytes, 0)).toBe(0x0080);
    expect(i16(bytes, 2)).toBe(0xff7f - 0x10000);
    expect(i32(bytes, 4)).toBe(0x12345678);
    expect(i32(Uint8Array.from([0xff, 0xff, 0xff, 0xff]), 0)).toBe(-1);
    expect(i32(Uint8Array.from([0x80, 0x00, 0x00, 0x00]), 0)).toBe(-2147483648);
    expect(u32(Uint8Array.from([0xff, 0xff, 0xff, 0xff]), 0)).toBe(4294967295);
  });

  it('reads an F2Dot14 as two integer bits and fourteen fraction bits', () => {
    expect(f2dot14(bytes, 8)).toBe(1); // 0x4000
    expect(f2dot14(Uint8Array.from([0x00, 0x00]), 0)).toBe(0);
    expect(f2dot14(Uint8Array.from([0xc0, 0x00]), 0)).toBe(-1); // 0xC000
    expect(f2dot14(Uint8Array.from([0x20, 0x00]), 0)).toBe(0.5);
    expect(f2dot14(Uint8Array.from([0x7f, 0xff]), 0)).toBeCloseTo(1.999939, 6); // the format's own maximum
  });

  it('throws rather than reading past the end of the byte range it is given', () => {
    expect(() => u8(bytes, bytes.length)).toThrow(/outside/);
    expect(() => u16(bytes, bytes.length - 1)).toThrow(/outside/);
    expect(() => u24(bytes, bytes.length - 2)).toThrow(/outside/);
    expect(() => u32(bytes, bytes.length - 3)).toThrow(/outside/);
    expect(() => i16(bytes, -1)).toThrow(/outside/);
    expect(() => f2dot14(bytes, bytes.length - 1)).toThrow(/outside/);
  });
});

describe('hasBytes', () => {
  const bytes = new Uint8Array(10);

  it('accepts a range wholly inside the buffer, including an empty one at the very end', () => {
    expect(hasBytes(bytes, 0, 10)).toBe(true);
    expect(hasBytes(bytes, 9, 1)).toBe(true);
    expect(hasBytes(bytes, 10, 0)).toBe(true);
  });

  it('rejects a range that runs past the end, starts before it, or is not whole', () => {
    expect(hasBytes(bytes, 9, 2)).toBe(false);
    expect(hasBytes(bytes, -1, 1)).toBe(false);
    expect(hasBytes(bytes, 0, -1)).toBe(false);
    expect(hasBytes(bytes, 1.5, 1)).toBe(false);
    expect(hasBytes(bytes, 0, Number.NaN)).toBe(false);
  });
});
