import { describe, expect, it } from 'vitest';
import { concatBytes, crc32, deflate, inflate } from '../../src';

// Proves byte-codec's primitives execute inside a Cloudflare Workers isolate (workerd, via @cloudflare/vitest-pool-workers) with no Node-only APIs. Every primitive here -- CRC-32 (a pure integer fold), deflate/inflate (fflate, pure JS), concatBytes -- is deliberately Node-free; if any touched node:fs/Buffer/process the workerd isolate would throw rather than these passing. This is the runtime complement to attw's static module-resolution check.
describe('byte-codec under the Cloudflare Workers runtime', () => {
  it('crc32 computes over bytes (no Node Buffer, no fs)', () => {
    // The standard CRC-32/ISO check value for "123456789" is 0xCBF43926; >>> 0 normalises whatever signedness crc32 returns to unsigned.
    const result = crc32(new TextEncoder().encode('123456789'));
    expect(result >>> 0).toBe(0xcbf43926);
  });

  it('deflate -> inflate round-trips through fflate', () => {
    const bytes = new TextEncoder().encode('hello from workerd');
    expect(inflate(deflate(bytes))).toEqual(bytes);
  });

  it('concatBytes joins chunks', () => {
    const enc = new TextEncoder();
    expect(concatBytes([enc.encode('a'), enc.encode('bc')])).toEqual(enc.encode('abc'));
  });
});
