import { describe, expect, it } from 'vitest';
import { throwIfAborted } from './abort';

describe('throwIfAborted', () => {
  it('does nothing when signal is undefined', () => {
    expect(() => {
      throwIfAborted(undefined);
    }).not.toThrow();
  });

  it('does nothing when the signal has not been aborted', () => {
    const controller = new AbortController();
    expect(() => {
      throwIfAborted(controller.signal);
    }).not.toThrow();
  });

  it('throws an AbortError DOMException once the signal is aborted', () => {
    const controller = new AbortController();
    controller.abort();
    expect(() => {
      throwIfAborted(controller.signal);
    }).toThrow(DOMException);
  });
});
