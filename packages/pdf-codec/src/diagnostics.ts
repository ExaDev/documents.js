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

// /Encrypt present, and encrypted in a way this codec cannot read at all: a non-standard security handler (/Filter other than /Standard, e.g. a public-key one), an unpublished or unrecognised /V, or a crypt filter naming a /CFM this codec does not implement. Distinct from PdfPasswordRequiredError below, which means the encryption itself IS supported and the file simply needs a password we do not have.
export class PdfEncryptedError extends PdfParseError {
  constructor(message = 'this PDF is encrypted and unsupported') {
    super('pdf/encrypted', message);
    this.name = 'PdfEncryptedError';
  }
}

// The empty user password did not verify against the /Encrypt dictionary's own /U entry, so this file genuinely requires a password to open. Deliberately its own error rather than a generic PdfEncryptedError: "this file needs a password you have not supplied" is a completely different thing to tell a user than "this file is encrypted in a way this tool cannot read", and only one of the two can be fixed by the person holding the file. Nothing in this codec accepts, prompts for, or guesses a password -- see src/encrypt.ts's own header.
export class PdfPasswordRequiredError extends PdfParseError {
  constructor(message = 'this PDF is protected by a user password, which this codec does not accept; only PDFs that open without a password (the common permissions-only case) can be read') {
    super('pdf/password-required', message);
    this.name = 'PdfPasswordRequiredError';
  }
}
