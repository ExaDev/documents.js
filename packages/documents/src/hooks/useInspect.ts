import { useMutation } from '@tanstack/react-query';
import type { DocumentFormat } from 'documents.js';

import { getRpcClient } from '../rpc/client';
import type { Diagnostic } from '../shared/diagnostics';

export interface InspectResult {
  pageCount: number;
  itemKindCounts: Record<string, number>;
  metadata: {
    title?: string;
    author?: string;
    subject?: string;
    keywords?: string[];
    createdIso?: string;
    modifiedIso?: string;
    producer?: string;
  };
  diagnostics: readonly Diagnostic[];
}

async function inspectPdfBytes(bytes: Uint8Array<ArrayBuffer>, diagnostics: readonly Diagnostic[] = []): Promise<InspectResult> {
  const inspected = await getRpcClient().pdf.inspect({ bytes });
  return { ...inspected, diagnostics };
}

// Structural inspection (page count, item-kind breakdown, metadata) only ever runs on PDF bytes -- this is the shared entry point for that, used directly by the Convert page, which already has PDF bytes on hand from its own preview conversion and would otherwise pay for a redundant conversion via useInspectDocument below.
export function useInspectPdfBytes() {
  return useMutation({
    mutationFn: (bytes: Uint8Array<ArrayBuffer>) => inspectPdfBytes(bytes),
  });
}

export interface InspectDocumentInput {
  format: DocumentFormat;
  bytes: Uint8Array<ArrayBuffer>;
}

// Every documents.js format can render to PDF (see convert.tsx's own preview rationale) -- inspecting a non-PDF source is therefore "convert it to PDF, then run the same structural inspector on the result", reusing the app's existing convert-to-a-common-representation approach rather than inventing a second, format-specific notion of "structure" for every source format. Used by the Inspect page, which -- unlike Convert -- has no PDF bytes already in hand, so the conversion's own diagnostics (e.g. a font substitution) are surfaced too, not just the inspection result.
export function useInspectDocument() {
  return useMutation({
    mutationFn: async ({ format, bytes }: InspectDocumentInput): Promise<InspectResult> => {
      if (format === 'pdf') return inspectPdfBytes(bytes);
      const converted = await getRpcClient().convert({ source: format, targetFormat: 'pdf', bytes });
      return inspectPdfBytes(converted.document.bytes, converted.diagnostics);
    },
  });
}
