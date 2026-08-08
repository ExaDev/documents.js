import { describe, expect, it } from 'vitest';

import { collectTransferableBuffers } from './transferables';

describe('collectTransferableBuffers', () => {
  it('finds a top-level Uint8Array', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(collectTransferableBuffers({ bytes })).toEqual([bytes.buffer]);
  });

  it('finds Uint8Arrays nested inside objects and arrays', () => {
    const first = new Uint8Array([1]);
    const second = new Uint8Array([2]);
    const message = { document: { bytes: first }, chapters: [{ bytes: second }] };
    expect(collectTransferableBuffers(message)).toEqual([first.buffer, second.buffer]);
  });

  it('returns an empty array when there is nothing to transfer', () => {
    expect(collectTransferableBuffers({ source: 'docx', targetFormat: 'pdf' })).toEqual([]);
  });

  it('ignores primitives, null, and non-Uint8Array values', () => {
    expect(collectTransferableBuffers('docx')).toEqual([]);
    expect(collectTransferableBuffers(null)).toEqual([]);
    expect(collectTransferableBuffers(42)).toEqual([]);
  });
});
