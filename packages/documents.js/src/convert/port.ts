// The conversion behaviour modelled as a swappable port/contract, not a hard-wired function -- this workspace's standing "portable runtime and storage boundaries" convention, even though the only implementation today (local.ts) is entirely synchronous under the hood. `convert()` itself stays async and takes a mandatory abort signal regardless of that: it's a portability contract for a future non-local adapter (a remote conversion service, say), not a reflection of the local implementation's own synchronicity.

export type DocumentFormat = 'docx' | 'pptx' | 'odt' | 'odp' | 'ods' | 'pdf';

export interface DocumentPayload {
  readonly format: DocumentFormat;
  readonly bytes: Uint8Array<ArrayBuffer>;
}

export interface Diagnostic {
  readonly severity: 'info' | 'warning';
  readonly code: string;
  readonly message: string;
  readonly pageIndex?: number;
}

export interface ConversionRequest {
  readonly source: DocumentPayload;
  readonly targetFormat: DocumentFormat;
}

export interface ConversionResult {
  readonly document: DocumentPayload;
  // Diagnostics are for expected, scoped-out-of-v1 degradations (a font substitution, an unsupported PDF filter) -- anything that would actually corrupt output throws instead of becoming a silently-swallowed diagnostic.
  readonly diagnostics: readonly Diagnostic[];
}

export interface DocumentConverter {
  readonly contractVersion: number;
  readonly conversions: readonly { readonly source: DocumentFormat; readonly target: DocumentFormat }[];
  convert(request: ConversionRequest, options: { readonly signal: AbortSignal }): Promise<ConversionResult>;
}
