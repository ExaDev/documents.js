import { describe, expect, it } from 'vitest';
import { NOOP_DIAGNOSTIC_SINK, PdfEncryptedError, PdfParseError, PdfPasswordRequiredError } from './diagnostics';

describe('PdfParseError', () => {
  it('carries a stable code alongside the human-readable message', () => {
    const error = new PdfParseError('pdf/no-root', 'no resolvable /Root');
    expect(error.code).toBe('pdf/no-root');
    expect(error.message).toBe('no resolvable /Root');
    expect(error.name).toBe('PdfParseError');
    expect(error).toBeInstanceOf(Error);
  });
});

describe('PdfEncryptedError', () => {
  it('is a PdfParseError with the pdf/encrypted code and a clear default message', () => {
    const error = new PdfEncryptedError();
    expect(error).toBeInstanceOf(PdfParseError);
    expect(error.code).toBe('pdf/encrypted');
    expect(error.message).toContain('encrypted');
  });

  it('accepts a custom message while keeping the same code', () => {
    const error = new PdfEncryptedError('custom message');
    expect(error.message).toBe('custom message');
    expect(error.code).toBe('pdf/encrypted');
  });
});

describe('PdfPasswordRequiredError', () => {
  it('is a PdfParseError with its own pdf/password-required code', () => {
    const error = new PdfPasswordRequiredError();
    expect(error).toBeInstanceOf(PdfParseError);
    expect(error.code).toBe('pdf/password-required');
    expect(error.name).toBe('PdfPasswordRequiredError');
    expect(error.message).toContain('password');
  });

  // The two encryption errors have to stay distinguishable in both directions: catching one must never catch the other, since "supply the password" and "this tool cannot read this at all" are different things to tell a user.
  it('is not interchangeable with PdfEncryptedError', () => {
    expect(new PdfPasswordRequiredError()).not.toBeInstanceOf(PdfEncryptedError);
    expect(new PdfEncryptedError()).not.toBeInstanceOf(PdfPasswordRequiredError);
  });

  it('accepts a custom message while keeping the same code', () => {
    const error = new PdfPasswordRequiredError('custom message');
    expect(error.message).toBe('custom message');
    expect(error.code).toBe('pdf/password-required');
  });
});

describe('NOOP_DIAGNOSTIC_SINK', () => {
  it('accepts a diagnostic without throwing or returning anything observable', () => {
    expect(() => {
      NOOP_DIAGNOSTIC_SINK({ code: 'pdf/xref-recovered', severity: 'warning', message: 'test' });
    }).not.toThrow();
  });
});
