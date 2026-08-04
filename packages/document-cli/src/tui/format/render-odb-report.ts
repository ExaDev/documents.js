import { readFile, writeFile } from 'node:fs/promises';
import { decodeOdbPackage, odbReportToDocx, odbReportToOdt, odbReportToPdf, readOdbReportContent } from 'documents.js';
import { loadProvidedFonts } from '../../runtime/fonts.js';
import type { Diagnostic, OdbOpenDocument } from '../state/types.js';
import { detectFormat } from './detect-format.js';
import { toPdfOptions } from './export-pdf.js';

export interface RenderOdbReportOptions {
  readonly reportName: string;
  readonly signal?: AbortSignal;
  readonly onDiagnostic: (diagnostic: Diagnostic) => void;
  // Local font files to make available to a pdf render, in the order the user gave them -- the same shape (and the same reasoning) as ExportToPdfOptions.fontFiles in export-pdf.ts. Unused for a docx/odt target: neither runs a layout engine or resolves a typeface.
  readonly fontFiles?: readonly string[];
}

const REPORT_RENDER_TARGET_FORMATS: Readonly<Record<'docx' | 'odt' | 'pdf', true>> = { docx: true, odt: true, pdf: true };

function isReportRenderTargetFormat(format: string | undefined): format is 'docx' | 'odt' | 'pdf' {
  return format !== undefined && format in REPORT_RENDER_TARGET_FORMATS;
}

// Reached from the report list's own Enter handler, via the odbReportRender screen: an OdbOpenDocument carries no decoded Package of its own (readOdbTables/readOdbForms/readOdbReports were each already resolved to their own plain values at open time and the Package thrown away -- see state/types.ts's own OdbOpenDocument doc comment), so this re-reads and re-decodes doc.path (always a real string for .odb, unlike every editable format) before resolving the named report through the identical readOdbReportContent -> {docx,odt,pdf} pipeline the odb-render-report CLI command uses (documents.js's own odbReportToDocx/odbReportToOdt/odbReportToPdf). Never mutates the open document: a rendered report is an independent output file, not an edit to the .odb, which is exactly why this lives beside exportToPdf as its own pipeline rather than going through the reducer.
export async function renderOdbReportTo(doc: OdbOpenDocument, destinationPath: string, options: RenderOdbReportOptions): Promise<void> {
  const format = detectFormat(destinationPath);
  if (!isReportRenderTargetFormat(format)) {
    throw new Error(`Cannot tell whether to render "${options.reportName}" as docx, odt, or pdf from '${destinationPath}' -- give the destination one of those three extensions`);
  }
  const fonts = await loadProvidedFonts(options.fontFiles ?? [], { signal: options.signal });
  const pkg = decodeOdbPackage(new Uint8Array(await readFile(doc.path)));
  const content = readOdbReportContent(pkg, { report: options.reportName });
  const bytes = format === 'docx' ? odbReportToDocx(content) : format === 'odt' ? odbReportToOdt(content) : odbReportToPdf(content, toPdfOptions(options, fonts));
  await writeFile(destinationPath, bytes);
}
