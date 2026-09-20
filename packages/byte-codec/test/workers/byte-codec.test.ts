import { describe, expect, it } from 'vitest';
import { concatBytes, crc32, decodeText, deflate, inflate } from '../../src';

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

  // decodeText is the one place a runtime difference could hide rather than throw: TextDecoder's legacy single-byte and UTF-16 support comes from the host's ICU build, so an implementation that delegated to it would decode these same bytes differently here than under Node. Each case below is one the module decodes itself.
  it('decodes windows-1252 bytes without a TextDecoder that supports the label', () => {
    const result = decodeText(Uint8Array.of(0x63, 0x61, 0x66, 0xe9));
    expect(result.text).toBe('café');
    expect(result.encoding).toBe('windows-1252');
    expect(result.confidence).toBe('low');
  });

  it('decodes UTF-16LE behind its own byte order mark', () => {
    const bytes = Uint8Array.of(0xff, 0xfe, 0x68, 0x00, 0x69, 0x00);
    expect(decodeText(bytes).text).toBe('hi');
  });

  it('decodes UTF-32BE, which the Encoding Standard has no label for at all', () => {
    const bytes = Uint8Array.of(0x00, 0x00, 0xfe, 0xff, 0x00, 0x00, 0x00, 0x68);
    expect(decodeText(bytes).text).toBe('h');
  });

  it('refuses bytes that are not text', () => {
    expect(() => decodeText(Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x00))).toThrow(
      /not text/,
    );
  });
});
