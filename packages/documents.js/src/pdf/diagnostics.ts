// The parser's three-tier failure policy (throw / recover-with-diagnostic / degrade-with-diagnostic -- see the implementation plan's Step 7.5): a hand-written parser measured in low thousands of lines cannot match a mature library's robustness against adversarial or mis-generated real-world input, so it must be explicit about which tier each situation falls into rather than silently picking one. This module is the shared vocabulary every other src/pdf/* read-side module reports through.

export type PdfDiagnosticSeverity = 'info' | 'warning';

export interface PdfDiagnostic {
  // A stable, namespaced code (e.g. 'pdf/xref-recovered', 'char/unmapped-encoding', 'image/unsupported-filter') -- callers are expected to branch on this, not on `message`, which is free text for humans.
  readonly code: string;
  readonly severity: PdfDiagnosticSeverity;
  readonly message: string;
  readonly pageIndex?: number;
}

// Recover/degrade-tier issues are reported through a sink rather than thrown, so a single malformed xref entry or an unsupported image filter degrades that one element rather than aborting the whole document. A no-op sink is a legitimate choice for a caller that doesn't want diagnostics.
export type PdfDiagnosticSink = (diagnostic: PdfDiagnostic) => void;

export const NOOP_DIAGNOSTIC_SINK: PdfDiagnosticSink = () => {
  /* discards every diagnostic -- the deliberate default for a caller that doesn't want them */
};

// The throw tier: a file that cannot be meaningfully processed at all (missing %PDF- header, no resolvable /Root even after recovery, a configured resource limit exceeded). Carries the same `code` vocabulary as PdfDiagnostic so a caller can distinguish failure reasons programmatically, not just by message text.
export class PdfParseError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'PdfParseError';
    this.code = code;
  }
}

// /Encrypt present -- thrown rather than attempting decryption, even for the common empty-user-password case (a genuine v1.1+ project: MD5/RC4/SHA-256/AES-CBC plus the PDF standard security handler's own key-derivation algorithms). A distinct subclass so a caller can catch this specific, expected case (and say so plainly to a user) without conflating it with a genuinely malformed file.
export class PdfEncryptedError extends PdfParseError {
  constructor(message = 'this PDF is encrypted and unsupported') {
    super('pdf/encrypted', message);
    this.name = 'PdfEncryptedError';
  }
}
