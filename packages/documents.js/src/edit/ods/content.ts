import type { ContentDocument, ContentSheetCell } from "document-schema.js";
import type { Package } from "odf.js";
import { resolveMetadataTimestamps } from "../../model/metadata";
import type { ClockPort } from "../../ports/clock";
import { systemClock } from "../../ports/clock";
import { OdsEditor } from "./editor";
import { createEmptyOdsPackage } from "./scaffold";
import type { OdsSheet } from "./sheet";

// clock resolves content.metadata's own createdIso/modifiedIso the same way createOds does (src/model/metadata.ts's resolveMetadataTimestamps) -- systemClock by default, never overwriting a createdIso/modifiedIso the source content already carried.
export interface BuildOdsPackageOptions {
  readonly clock?: ClockPort;
}

// ContentDocument -> a fresh ods Package, built entirely through the same edit/ods/* live-view primitives a caller would use by hand -- the ods-side counterpart to buildOdtPackage/buildOdpPackage (src/edit/odt/content.ts, src/edit/odp/content.ts). pdfToOds (src/convert/convert.ts) calls this directly, feeding it a best-effort ContentDocument from reconstructSpreadsheet (src/layout/reconstruct.ts) -- the same role buildOdtPackage/buildOdpPackage/buildOdgPackage already play for pdfToOdt/pdfToOdp/pdfToOdg. It is equally usable standalone by any caller holding a spreadsheet ContentDocument from elsewhere (most naturally, one that came from readOdsContent itself, or -- since xlsxToOds/xlsxToPdf compose through this exact function -- ooxml.js's readXlsxContent).
//
// printSettings.pageSize/margins/gridlines/headers/pageOrder now round-trip for real, via OdsSheet.printSettings (src/edit/ods/print-settings.ts) -- ContentSheetPrintSettingsSchema requires this field on every sheet, and reconstructSpreadsheet's own gridline-lattice detection genuinely needs the recovered gridlines/headers/pageSize signal to survive a real write-then-reread round trip to be verifiable at all. printRange/scale/fitToPages/repeatRows/repeatColumns/manualBreaks (the remaining, all-optional ContentSheetPrintSettings fields, none of which reconstructSpreadsheet ever sets) are still not written, matching print-settings.ts's own documented boundary.
//
// ContentSheetColumn.widthPt/ContentSheetRow.heightPt now round-trip too, via OdsSheet.setColumnWidth/setRowHeight (src/edit/ods/column-row.ts) -- discovered as a genuine, severity-escalating gap while composing xlsxToPdf (src/convert/convert.ts), not merely tidied up in passing: an explicit-but-unstyled column/row (the previous behaviour) reads back at widthPt/heightPt 0, and src/layout/sheets.ts's own resolveAxis treats that explicit zero as authoritative rather than falling back to a sane default, collapsing every cell in a rebuilt sheet onto the same physical position the moment that sheet is ever laid out again (xlsxToPdf's own xlsxToOds -> odsToPdf hop does exactly that) -- a previously "cosmetic when reopened in a real app" gap that becomes real data corruption once buildOdsPackage's own output stops being only ever a terminal deliverable. See column-row.ts's own top-of-file note for the full account.
//
// Column/row HIDDEN state (ContentSheetColumn/Row.hidden) now round-trips too, via OdsSheet.setColumnHidden/setRowHidden (table:visibility, independent of width/height styling -- see column-row.ts's own top-of-file note on why the two never collide).
//
// ContentSheetImage now writes a real floating draw:frame (OdsSheet.addImage, src/edit/ods/floating.ts), and ContentSheet.embeddedObjects writes a real embedded ODF formula sub-object for every objectKind === 'formula' entry (OdsSheet.addEmbeddedObject) -- every OTHER objectKind (wordprocessing/presentation/spreadsheet/drawing) is still a documented, bounded gap, mirroring buildOdtPackage's own identical narrowing for a 'drawing' embeddedObject block: embedding one would mean writing that document's own package as a nested OLE sub-object, and no writer for that exists anywhere in this codebase. Images/embeddedObjects are written LAST, after every column/row width/height/hidden call for this sheet, so a ContentSheetImage's own anchorRow/anchorColumn resolves its absolute position against the sheet's real, final column/row sizing rather than whatever it happened to declare at some earlier point in this loop.
export function buildOdsPackage(
  content: ContentDocument,
  options?: BuildOdsPackageOptions,
): Package {
  if (content.kind !== "spreadsheet") {
    throw new Error("buildOdsPackage requires a spreadsheet ContentDocument");
  }
  const clock = options?.clock ?? systemClock;
  const metadata = resolveMetadataTimestamps(content.metadata, clock);
  const editor = new OdsEditor(createEmptyOdsPackage({ metadata }));
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
    for (const column of sheet.columns) {
      // widthPt is optional (document-schema.js 2.0.0) precisely because not every producer behind a spreadsheet ContentDocument knows a column's own width -- ooxml.js's readXlsxContent genuinely omits it for an unstyled xlsx column, unlike odf.js's own readOds, which always resolves a concrete number (0 when unstyled). Skip the write entirely rather than inventing a width: appendCell above already individuated this column via OdsSheet.cell(), which now stamps a real DEFAULT_COLUMN_WIDTH_PT-equivalent style on any column it touches for the first time (column-row.ts's own ensureColumnDefaultWidth) -- so an omitted widthPt here reads back at that same real default, never a fabricated/ambiguous 0.
      if (column.widthPt !== undefined) {
        odsSheet.setColumnWidth(column.index, column.widthPt);
      }
      if (column.hidden === true) {
        odsSheet.setColumnHidden(column.index, true);
      }
    }
    for (const row of sheet.rows) {
      if (row.heightPt !== undefined) {
        odsSheet.setRowHeight(row.index, row.heightPt);
      }
      if (row.hidden === true) {
        odsSheet.setRowHidden(row.index, true);
      }
    }
    for (const image of sheet.images) {
      odsSheet.addImage(image);
    }
    for (const embeddedObject of sheet.embeddedObjects ?? []) {
      odsSheet.addEmbeddedObject(embeddedObject);
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
  // Merged ranges: readOdsContent never emits a ContentSheetCell for a position covered by another cell's own merge (see its own read.ts comment -- "nothing to emit" for a covered cell), so every entry in sheet.cells is, by construction, a genuine anchor or an unmerged cell; mergeCells only needs to run for the ones that actually carry a span.
  const rowSpan = cell.rowSpan ?? 1;
  const colSpan = cell.colSpan ?? 1;
  if (rowSpan > 1 || colSpan > 1) {
    odsSheet.mergeCells(cell.row, cell.column, rowSpan, colSpan);
  }
}
