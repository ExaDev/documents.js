// The pdf -> X conversion family and this package's read-only entry point: every pdfTo* function lives here rather than in convert.ts so that a consumer importing documents.js/read (package.json's explicit ./read export onto this module) gets a module graph that excludes every X-to-PDF renderer and therefore every vendored font asset -- the same split pdf-codec made with its own ./read entry. convert.ts holds both directions in one module, so its graph statically contains the write path; each pdfTo* function below forwards to convertDocumentFromPdf (src/convert/composition.ts, the composition engine's read half), which resolves and runs exactly the plan convertDocument('pdf', target, ...) would -- identical executors, identical routes (a route out of pdf never re-enters pdf), no forked behaviour. src/read-graph.test.ts walks this module's static import graph across the workspace boundary into pdf-codec's own source and fails the build if the write path or a font asset becomes reachable.
//
// readDocumentMetadata is defined here too (#744), owning its dispatch through the read-only codec half (src/codecs/read.ts: CONTENT_READERS for the eleven content formats, readDocumentLayout for pdf) rather than the both-directions registry -- whose write halves import writePdf from the pdf-codec root barrel and would drag the write path, and pdf-codec's vendored font assets, back into this entry's graph. The root barrel re-exports it from here unchanged (one definition, one identity, the same arrangement the pdfTo* family already has). Its xlsx branch no longer renders a preview PDF: the old xlsxToPdf-then-readPdf path reported facts about the render rather than the workbook -- createdIso/modifiedIso stamped at the render moment for a file carrying none of its own (buildOdsPackage's default systemClock, which is why the old test for that case needed fake timers), and a producer naming the preview PDF's writer. A workbook that does declare its own dcterms:created/dcterms:modified keeps reporting them exactly as before (the render path never overwrote a source timestamp either), app.xml's Application still arrives as creator, and producer stays unset per the schema's own rule that it is a PDF-only concept no semantic reader ever sets. setDocumentMetadata -- the write-side sibling -- stays in src/metadata/write.ts, which has no graph constraint to satisfy.

import type { DocumentTree, LayoutMetadata } from "document-schema.js";
import type { PdfDiagnosticSink } from "pdf-codec";
import { convertDocumentFromPdf } from "./composition";
import type { CsvWriteOptions, SvgWriteOptions } from "./convert";
import type { DocumentFormat } from "./port";
import { CONTENT_READERS, readDocumentLayout } from "../codecs/read";

export interface ReadDocumentMetadataOptions {
  readonly signal?: AbortSignal;
}

// Pulls a LayoutMetadata out of any DocumentFormat's bytes. Both dispatch halves already carry each format's own cancellation policy (a one-time throwIfAborted for the synchronous single-pass readers, straight signal-forwarding for pdf, matching odtToDocx's own reasoning in convert.ts for the identical shape of read).
export function readDocumentMetadata(
  format: DocumentFormat,
  bytes: Uint8Array<ArrayBuffer>,
  options?: ReadDocumentMetadataOptions,
): LayoutMetadata {
  if (format === "pdf") {
    return readDocumentLayout(bytes, { signal: options?.signal }).metadata;
  }
  return CONTENT_READERS[format](bytes, { signal: options?.signal }).metadata;
}

export interface PdfToDocumentOptions {
  readonly signal?: AbortSignal;
  readonly sink?: PdfDiagnosticSink;
  // Called exactly once, synchronously, with the DocumentTree (the readPdf-produced layout, and the reconstructed content built from it) this conversion built internally, before the function returns its bytes -- see convert.ts's DocumentToPdfOptions.onDocument for the mirrored X-to-PDF side of this same side channel.
  readonly onDocument?: (pkg: DocumentTree) => void;
}

// Forwards to convertDocumentFromPdf (src/convert/composition.ts).
export function pdfToDocx(
  bytes: Uint8Array<ArrayBuffer>,
  options?: PdfToDocumentOptions,
): Uint8Array<ArrayBuffer> {
  return convertDocumentFromPdf("docx", bytes, options);
}

// Forwards to convertDocumentFromPdf (src/convert/composition.ts).
export function pdfToPptx(
  bytes: Uint8Array<ArrayBuffer>,
  options?: PdfToDocumentOptions,
): Uint8Array<ArrayBuffer> {
  return convertDocumentFromPdf("pptx", bytes, options);
}

// Forwards to convertDocumentFromPdf (src/convert/composition.ts).
export function pdfToOdt(
  bytes: Uint8Array<ArrayBuffer>,
  options?: PdfToDocumentOptions,
): Uint8Array<ArrayBuffer> {
  return convertDocumentFromPdf("odt", bytes, options);
}

// Forwards to convertDocumentFromPdf (src/convert/composition.ts).
export function pdfToOdp(
  bytes: Uint8Array<ArrayBuffer>,
  options?: PdfToDocumentOptions,
): Uint8Array<ArrayBuffer> {
  return convertDocumentFromPdf("odp", bytes, options);
}

// Forwards to convertDocumentFromPdf (src/convert/composition.ts).
export function pdfToOdg(
  bytes: Uint8Array<ArrayBuffer>,
  options?: PdfToDocumentOptions,
): Uint8Array<ArrayBuffer> {
  return convertDocumentFromPdf("odg", bytes, options);
}

// Forwards to convertDocumentFromPdf (src/convert/composition.ts).
export function pdfToOds(
  bytes: Uint8Array<ArrayBuffer>,
  options?: PdfToDocumentOptions,
): Uint8Array<ArrayBuffer> {
  return convertDocumentFromPdf("ods", bytes, options);
}

// Forwards to convertDocumentFromPdf (src/convert/composition.ts).
export function pdfToMarkdown(
  bytes: Uint8Array<ArrayBuffer>,
  options?: PdfToDocumentOptions,
): Uint8Array<ArrayBuffer> {
  return convertDocumentFromPdf("markdown", bytes, options);
}

// pdf bytes -> csv bytes: the reverse of csvToPdf (convert.ts) -- the pathfinder resolves this as [pdf -> ods fromPdf, ods -> csv bridge], reconstructing the pdf's tabular layout into a spreadsheet ContentDocument and then writing its lone or selected sheet as RFC 4180 text. `onDocument` reports the last hop's package under the composition engine's own "fires exactly once, on the last hop" convention: the odsToCsv bridge hop's content-only package.
export function pdfToCsv(
  bytes: Uint8Array<ArrayBuffer>,
  options?: PdfToDocumentOptions & CsvWriteOptions,
): Uint8Array<ArrayBuffer> {
  return convertDocumentFromPdf("csv", bytes, options);
}

// pdf bytes -> svg bytes: the reverse of svgToPdf (convert.ts) -- the pathfinder resolves this as a single [pdf -> svg fromPdf] hop, reconstructDrawing mapping readPdf's recovered vector items near-1:1 into a drawing ContentDocument and buildSvgText writing the six shape primitives back out. `page` selects which page of a multi-page PDF becomes the (single-page) svg, the same caller decision CsvWriteOptions.sheet holds for sheets; omitting it on a multi-page PDF throws SvgMultiPageNotSpecifiedError rather than truncating.
export function pdfToSvg(
  bytes: Uint8Array<ArrayBuffer>,
  options?: PdfToDocumentOptions & SvgWriteOptions,
): Uint8Array<ArrayBuffer> {
  return convertDocumentFromPdf("svg", bytes, options);
}

// pdf bytes -> xlsx bytes: the reverse of xlsxToPdf (convert.ts) -- the pathfinder resolves this as [pdf -> ods fromPdf, ods -> xlsx bridge], so xlsx's lack of a reconstruction path of its own never shows: the PDF is reconstructed as a spreadsheet ContentDocument by the ods reconstructor, then bridged into xlsx. `onDocument` reports the last hop's package under the composition engine's own "fires exactly once, on the last hop" convention: the odsToXlsx bridge hop's content-only package.
export function pdfToXlsx(
  bytes: Uint8Array<ArrayBuffer>,
  options?: PdfToDocumentOptions,
): Uint8Array<ArrayBuffer> {
  return convertDocumentFromPdf("xlsx", bytes, options);
}
