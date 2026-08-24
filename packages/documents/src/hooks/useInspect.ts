import { useMutation } from "@tanstack/react-query";
import type {
  ContentDocument,
  DocumentFormat,
  DocumentTreeJson,
  LayoutDocument,
} from "documents.js";

import { getRpcClient } from "../rpc/client";
import type { Diagnostic } from "../shared/diagnostics";
import { contentSummary } from "../shared/contentCounts";

// Reads a document's content directly from bytes via the content.read RPC endpoint -- no conversion, no PDF layout pass. Used by every content-backed preview (markdown, csv, svg, docx, odt, xlsx, ods, pptx, odp, odg, odf).
export interface ReadContentInput {
  format: DocumentFormat;
  bytes: Uint8Array<ArrayBuffer>;
}

// What content.read returns across the worker boundary: the flat ContentDocument the preview components render, plus the same document in its artefact form -- the tree-form DocumentTree stamped with its release-pinned $schema URI (the artefact's version since document-schema.js 4), which the structure tree shows.
export interface ContentReadResult {
  content: ContentDocument;
  package: DocumentTreeJson;
}

export function useReadContent() {
  return useMutation({
    mutationFn: (input: ReadContentInput) => getRpcClient().content.read(input),
  });
}

// Plain mirror of pdf.inspect's own SanitizedLayoutImageAssetSchema (src/rpc/router.ts) -- LayoutImageAsset minus its unbounded base64 payload, plus an estimated byteLength in its place.
export interface SanitizedLayoutImageAsset {
  format: "png" | "jpeg";
  widthPx: number;
  heightPx: number;
  byteLength: number;
}

export type SanitizedLayoutDocument = Omit<LayoutDocument, "images"> & {
  images: Record<string, SanitizedLayoutImageAsset>;
};

interface InspectDiagnostics {
  diagnostics: readonly Diagnostic[];
}

// Structure derived from a PDF layout pass (page count, per-item-kind breakdown, the full LayoutDocument tree). Produced by pdf.inspect on the worker, consuming PDF bytes a caller already has on hand.
export interface PdfInspectResult extends InspectDiagnostics {
  backing: "pdf";
  pageCount: number;
  itemKindCounts: Record<string, number>;
  metadata: {
    title?: string;
    author?: string;
    subject?: string;
    keywords?: string[];
    creator?: string;
    createdIso?: string;
    modifiedIso?: string;
    producer?: string;
  };
  layout: SanitizedLayoutDocument;
}

// Structure derived directly from a read document (variant-aware summary + the $schema-stamped tree-form DocumentTree), produced client-side from content already on hand -- no PDF layout pass, no second RPC. Used by formats that preview their native representation rather than a PDF rendition.
export interface ContentInspectResult extends InspectDiagnostics {
  backing: "content";
  summary: readonly string[];
  package: DocumentTreeJson;
}

export type InspectResult = PdfInspectResult | ContentInspectResult;

// Constructs a content-backed InspectResult from a content.read result already on the client -- pure, synchronous, no RPC. The summary is variant-aware (sections+blocks vs sheets+cells vs ...) and counted over the flat form; the tree shows the stamped package, the document's artefact form.
export function contentInspectResult(
  read: ContentReadResult,
): ContentInspectResult {
  return {
    backing: "content",
    diagnostics: [],
    summary: contentSummary(read.content),
    package: read.package,
  };
}

async function inspectPdfBytes(
  bytes: Uint8Array<ArrayBuffer>,
  diagnostics: readonly Diagnostic[] = [],
): Promise<PdfInspectResult> {
  const inspected = await getRpcClient().pdf.inspect({ bytes });
  return { backing: "pdf", ...inspected, diagnostics };
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
    mutationFn: async ({
      format,
      bytes,
    }: InspectDocumentInput): Promise<PdfInspectResult> => {
      if (format === "pdf") return inspectPdfBytes(bytes);
      const converted = await getRpcClient().convert({
        source: format,
        targetFormat: "pdf",
        bytes,
      });
      return inspectPdfBytes(converted.document.bytes, converted.diagnostics);
    },
  });
}
