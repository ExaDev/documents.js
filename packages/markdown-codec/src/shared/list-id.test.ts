import { describe, expect, it } from 'vitest';
import { createNumIdMintState, mintedListType, mintListNumId, parseListNumId } from './list-id';

describe('mintListNumId / parseListNumId', () => {
  it('mints a monotonically increasing, never-reused id per call', () => {
    const state = createNumIdMintState();
    expect(mintListNumId(state, { type: 'bullet', task: false, loose: false })).toBe('md1:bullet');
    expect(mintListNumId(state, { type: 'bullet', task: false, loose: false })).toBe('md2:bullet');
  });

  it('omits the start suffix at the default start (1), includes it otherwise', () => {
    const state = createNumIdMintState();
    expect(mintListNumId(state, { type: 'ordered', start: 1, task: false, loose: false })).toBe('md1:ordered');
    expect(mintListNumId(state, { type: 'ordered', start: 3, task: false, loose: false })).toBe('md2:ordered@3');
  });

  it('appends +task and +loose suffixes independently', () => {
    const state = createNumIdMintState();
    expect(mintListNumId(state, { type: 'bullet', task: true, loose: false })).toBe('md1:bullet+task');
    expect(mintListNumId(state, { type: 'bullet', task: false, loose: true })).toBe('md2:bullet+loose');
    expect(mintListNumId(state, { type: 'ordered', start: 5, task: true, loose: true })).toBe('md3:ordered@5+task+loose');
  });

  it('parses every minted shape back losslessly', () => {
    expect(parseListNumId('md1:bullet')).toEqual({ type: 'bullet', start: undefined, task: false, loose: false });
    expect(parseListNumId('md2:ordered@3')).toEqual({ type: 'ordered', start: 3, task: false, loose: false });
    expect(parseListNumId('md3:bullet+task')).toEqual({ type: 'bullet', start: undefined, task: true, loose: false });
    expect(parseListNumId('md3:ordered@5+task+loose')).toEqual({ type: 'ordered', start: 5, task: true, loose: true });
  });

  it('returns undefined for a cross-format numId this package never minted', () => {
    expect(parseListNumId('list1')).toBeUndefined();
    expect(parseListNumId('3')).toBeUndefined();
    expect(mintedListType('list1')).toBeUndefined();
  });

  it('mintedListType reads back just the type without the rest', () => {
    expect(mintedListType('md1:ordered@7+task')).toBe('ordered');
  });
});
