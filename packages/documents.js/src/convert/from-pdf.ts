// The pdf -> X conversion family and this package's read-only entry point: every pdfTo* function lives here rather than in convert.ts so that a consumer importing documents.js/read (package.json's explicit ./read export onto this module) gets a module graph that excludes every X-to-PDF renderer and therefore every vendored font asset -- the same split pdf-codec made with its own ./read entry. convert.ts holds both directions in one module, so its graph statically contains the write path; each function below forwards to convertDocumentFromPdf (src/convert/composition.ts, the composition engine's read half), which resolves and runs exactly the plan convertDocument('pdf', target, ...) would -- identical executors, identical routes (a route out of pdf never re-enters pdf), no forked behaviour. src/read-graph.test.ts walks this module's static import graph across the workspace boundary into pdf-codec's own source and fails the build if the write path or a font asset becomes reachable.

import type { DocumentPackage } from 'document-schema.js';
import type { PdfDiagnosticSink } from 'pdf-codec';
import { convertDocumentFromPdf } from './composition';
import type { CsvWriteOptions, SvgWriteOptions } from './convert';

export interface PdfToDocumentOptions {
  readonly signal?: AbortSignal;
  readonly sink?: PdfDiagnosticSink;
  // Called exactly once, synchronously, with the DocumentPackage (the readPdf-produced layout, and the reconstructed content built from it) this conversion built internally, before the function returns its bytes -- see convert.ts's DocumentToPdfOptions.onDocument for the mirrored X-to-PDF side of this same side channel.
  readonly onDocument?: (pkg: DocumentPackage) => void;
}

// Forwards to convertDocumentFromPdf (src/convert/composition.ts).
export function pdfToDocx(bytes: Uint8Array<ArrayBuffer>, options?: PdfToDocumentOptions): Uint8Array<ArrayBuffer> {
  return convertDocumentFromPdf('docx', bytes, options);
}

// Forwards to convertDocumentFromPdf (src/convert/composition.ts).
export function pdfToPptx(bytes: Uint8Array<ArrayBuffer>, options?: PdfToDocumentOptions): Uint8Array<ArrayBuffer> {
  return convertDocumentFromPdf('pptx', bytes, options);
}

// Forwards to convertDocumentFromPdf (src/convert/composition.ts).
export function pdfToOdt(bytes: Uint8Array<ArrayBuffer>, options?: PdfToDocumentOptions): Uint8Array<ArrayBuffer> {
  return convertDocumentFromPdf('odt', bytes, options);
}

// Forwards to convertDocumentFromPdf (src/convert/composition.ts).
export function pdfToOdp(bytes: Uint8Array<ArrayBuffer>, options?: PdfToDocumentOptions): Uint8Array<ArrayBuffer> {
  return convertDocumentFromPdf('odp', bytes, options);
}

// Forwards to convertDocumentFromPdf (src/convert/composition.ts).
export function pdfToOdg(bytes: Uint8Array<ArrayBuffer>, options?: PdfToDocumentOptions): Uint8Array<ArrayBuffer> {
  return convertDocumentFromPdf('odg', bytes, options);
}

// Forwards to convertDocumentFromPdf (src/convert/composition.ts).
export function pdfToOds(bytes: Uint8Array<ArrayBuffer>, options?: PdfToDocumentOptions): Uint8Array<ArrayBuffer> {
  return convertDocumentFromPdf('ods', bytes, options);
}

// Forwards to convertDocumentFromPdf (src/convert/composition.ts).
export function pdfToMarkdown(bytes: Uint8Array<ArrayBuffer>, options?: PdfToDocumentOptions): Uint8Array<ArrayBuffer> {
  return convertDocumentFromPdf('markdown', bytes, options);
}

// pdf bytes -> csv bytes: the reverse of csvToPdf (convert.ts) -- the pathfinder resolves this as [pdf -> ods fromPdf, ods -> csv bridge], reconstructing the pdf's tabular layout into a spreadsheet ContentDocument and then writing its lone or selected sheet as RFC 4180 text. `onDocument` reports the last hop's package under the composition engine's own "fires exactly once, on the last hop" convention: the odsToCsv bridge hop's content-only package.
export function pdfToCsv(bytes: Uint8Array<ArrayBuffer>, options?: PdfToDocumentOptions & CsvWriteOptions): Uint8Array<ArrayBuffer> {
  return convertDocumentFromPdf('csv', bytes, options);
}

// pdf bytes -> svg bytes: the reverse of svgToPdf (convert.ts) -- the pathfinder resolves this as a single [pdf -> svg fromPdf] hop, reconstructDrawing mapping readPdf's recovered vector items near-1:1 into a drawing ContentDocument and buildSvgText writing the six shape primitives back out. `page` selects which page of a multi-page PDF becomes the (single-page) svg, the same caller decision CsvWriteOptions.sheet holds for sheets; omitting it on a multi-page PDF throws SvgMultiPageNotSpecifiedError rather than truncating.
export function pdfToSvg(bytes: Uint8Array<ArrayBuffer>, options?: PdfToDocumentOptions & SvgWriteOptions): Uint8Array<ArrayBuffer> {
  return convertDocumentFromPdf('svg', bytes, options);
}

// pdf bytes -> xlsx bytes: the reverse of xlsxToPdf (convert.ts) -- the pathfinder resolves this as [pdf -> ods fromPdf, ods -> xlsx bridge], so xlsx's lack of a reconstruction path of its own never shows: the PDF is reconstructed as a spreadsheet ContentDocument by the ods reconstructor, then bridged into xlsx. `onDocument` reports the last hop's package under the composition engine's own "fires exactly once, on the last hop" convention: the odsToXlsx bridge hop's content-only package.
export function pdfToXlsx(bytes: Uint8Array<ArrayBuffer>, options?: PdfToDocumentOptions): Uint8Array<ArrayBuffer> {
  return convertDocumentFromPdf('xlsx', bytes, options);
}
