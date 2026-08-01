import type { Package } from 'odf.js';
import type { ContentSheetCell } from 'document-content-model';
import type { ContentDocument } from '../../model/content';
import { createOds } from './editor';
import type { OdsSheet } from './sheet';

// ContentDocument -> a fresh ods Package, built entirely through the same edit/ods/* live-view primitives a caller would use by hand -- the ods-side counterpart to buildOdtPackage/buildOdpPackage (src/edit/odt/content.ts, src/edit/odp/content.ts). pdfToOds (src/convert/convert.ts) calls this directly, feeding it a best-effort ContentDocument from reconstructSpreadsheet (src/layout/reconstruct.ts) -- the same role buildOdtPackage/buildOdpPackage/buildOdgPackage already play for pdfToOdt/pdfToOdp/pdfToOdg. It is equally usable standalone by any caller holding a spreadsheet ContentDocument from elsewhere (most naturally, one that came from readOdsContent itself).
//
// printSettings.pageSize/margins/gridlines/headers/pageOrder now round-trip for real, via OdsSheet.printSettings (src/edit/ods/print-settings.ts) -- ContentSheetPrintSettingsSchema requires this field on every sheet, and reconstructSpreadsheet's own gridline-lattice detection genuinely needs the recovered gridlines/headers/pageSize signal to survive a real write-then-reread round trip to be verifiable at all. printRange/scale/fitToPages/repeatRows/repeatColumns/manualBreaks (the remaining, all-optional ContentSheetPrintSettings fields, none of which reconstructSpreadsheet ever sets) are still not written, matching print-settings.ts's own documented boundary.
//
// ContentSheetColumn/ContentSheetRow (per-column width/hidden, per-row height/hidden), ContentSheetImage, and embeddedObjects are still deliberately NOT written here -- OdsSheet's own scope (address.ts, sheet.ts, print-settings.ts) is cell access, merged ranges, and print settings, with no column-width/row-height/image API of its own to drive from. A documented, bounded gap, mirroring this codebase's own established precedent (buildOdtPackage's identical image/colSpan-write gaps): every cell's own value/formula/displayText, merged ranges (via OdsSheet.mergeCells), and now print settings, all build faithfully; a rebuilt sheet's own column widths/row heights fall back to whatever OdsEditor.addSheet's own scaffolded defaults are, not the source sheet's own.
export function buildOdsPackage(content: ContentDocument): Package {
  if (content.kind !== 'spreadsheet') {
    throw new Error('buildOdsPackage requires a spreadsheet ContentDocument');
  }
  const editor = createOds();
  if (content.sheets.length > 0) {
    // createOds()'s own scaffolded default sheet is a placeholder for the "nothing to build yet" case -- discard it in favour of the source's own real sheets, mirroring odp/content.ts's identical "addTextBox's own placeholder paragraph is discarded in favour of the shape's real content" pattern. An empty content.sheets array (a degenerate but valid spreadsheet ContentDocument) keeps the scaffold's own single empty sheet instead, since a genuinely openable .ods needs at least one.
    editor.removeSheetAt(0);
  }
  for (const sheet of content.sheets) {
    const odsSheet = editor.addSheet(sheet.name);
    odsSheet.printSettings = sheet.printSettings;
    for (const cell of sheet.cells) {
      appendCell(odsSheet, cell);
    }
  }
  return editor.toPackage();
}

function appendCell(odsSheet: OdsSheet, cell: ContentSheetCell): void {
  const odsCell = odsSheet.cell(cell.row, cell.column);
  odsCell.value = cell.value;
  if (cell.formula !== undefined) {
    odsCell.formula = cell.formula;
  }
  // A cell's own runs (genuinely mixed inline formatting -- ContentSheetCellSchema's own "rare" case) take priority over its plain displayText when present, reusing OdsCell.setStyledRuns' own odt/OdtRun-backed machinery; every other cell just gets its source displayText verbatim -- always preferred over `value`'s own generic default formatting (set as a side effect of the `value =` line above), since ContentSheetCell.displayText is REQUIRED and already the format's own authoritative rendered string, not a guess this function has to make.
  if (cell.runs !== undefined && cell.runs.length > 0) {
    odsCell.setStyledRuns(cell.runs);
  } else {
    odsCell.displayText = cell.displayText;
  }
  // Merged ranges: readOds never emits a ContentSheetCell for a position covered by another cell's own merge (see its own read.ts comment -- "nothing to emit" for a covered cell), so every entry in sheet.cells is, by construction, a genuine anchor or an unmerged cell; mergeCells only needs to run for the ones that actually carry a span.
  const rowSpan = cell.rowSpan ?? 1;
  const colSpan = cell.colSpan ?? 1;
  if (rowSpan > 1 || colSpan > 1) {
    odsSheet.mergeCells(cell.row, cell.column, rowSpan, colSpan);
  }
}
