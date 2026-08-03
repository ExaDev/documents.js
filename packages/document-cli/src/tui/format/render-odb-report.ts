import { readFile, writeFile } from 'node:fs/promises';
import {
  buildDocxPackage,
  buildOdtPackage,
  convertWordprocessingToLayout,
  createFontMeasurer,
  createFontRegistry,
  encodePackage,
  readOdbReportContent,
  writePdf,
  type ContentDocument,
  type ProvidedFont,
} from 'documents.js';
import { decodePackage, encodePackage as encodeOdfPackage } from 'odf.js';
import { loadProvidedFonts } from '../../runtime/fonts.js';
import type { Diagnostic, OdbOpenDocument } from '../state/types.js';
import { detectFormat } from './detect-format.js';

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

// docx and odt mirror open-document.ts's own saveDocumentTo/from-package.ts's buildBytesForTarget shape: build a fresh package through the matching buildXPackage, encode it with that format's own codec. pdf mirrors export-pdf.ts's own toPdfOptions -- the identical diagnostic-shaping this TUI already uses for every other document-to-pdf export -- except the font registry is createFontRegistry rather than createDocumentFontRegistry, since a rendered report has no source package of its own to extract embedded fonts from (documents.js's own markdownToPdf makes the identical choice for the identical reason).
function renderReportBytes(content: ContentDocument, format: 'docx' | 'odt' | 'pdf', fonts: readonly ProvidedFont[], options: RenderOdbReportOptions): Uint8Array<ArrayBuffer> {
  if (format === 'docx') {
    return encodePackage(buildDocxPackage(content));
  }
  if (format === 'odt') {
    return encodeOdfPackage(buildOdtPackage(content));
  }
  if (content.kind !== 'wordprocessing') {
    throw new Error('readOdbReportContent returned a non-wordprocessing ContentDocument');
  }
  const registry = createFontRegistry({
    fonts,
    onSubstitution: (substitution) => {
      const requested = `${substitution.requestedFamily}${substitution.requestedBold ? ' bold' : ''}${substitution.requestedItalic ? ' italic' : ''}`;
      options.onDiagnostic({ severity: 'info', message: `No "${requested}" face available; drew it in "${substitution.resolvedFamily}"` });
    },
  });
  const { document: layout, formulas } = convertWordprocessingToLayout(content, { measurer: createFontMeasurer(registry) });
  return writePdf(layout, {
    signal: options.signal,
    onSubstitution: (substitution, context) => {
      options.onDiagnostic({ severity: 'info', message: `Substituted "${substitution.to}" for "${substitution.from}"`, pageIndex: context.pageIndex });
    },
    formulas,
    fonts: registry,
  });
}

// Reached from the report list's own Enter handler, via the odbReportRender screen: an OdbOpenDocument carries no decoded Package of its own (readOdbTables/readOdbForms/readOdbReports were each already resolved to their own plain values at open time and the Package thrown away -- see state/types.ts's own OdbOpenDocument doc comment), so this re-reads and re-decodes doc.path (always a real string for .odb, unlike every editable format) before resolving the named report through the identical readOdbReportContent -> {docx,odt,pdf} pipeline the odb-render-report CLI command uses. Never mutates the open document: a rendered report is an independent output file, not an edit to the .odb, which is exactly why this lives beside exportToPdf as its own pipeline rather than going through the reducer.
export async function renderOdbReportTo(doc: OdbOpenDocument, destinationPath: string, options: RenderOdbReportOptions): Promise<void> {
  const format = detectFormat(destinationPath);
  if (!isReportRenderTargetFormat(format)) {
    throw new Error(`Cannot tell whether to render "${options.reportName}" as docx, odt, or pdf from '${destinationPath}' -- give the destination one of those three extensions`);
  }
  const fonts = await loadProvidedFonts(options.fontFiles ?? [], { signal: options.signal });
  const pkg = decodePackage(new Uint8Array(await readFile(doc.path)));
  const content = readOdbReportContent(pkg, { report: options.reportName });
  const bytes = renderReportBytes(content, format, fonts, options);
  await writeFile(destinationPath, bytes);
}
