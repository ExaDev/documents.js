import type {
  ContentSheetPrintSettings,
  Margins,
  PageSize,
} from "document-schema.js";
import { PAGE_SIZE_LETTER } from "document-schema.js";
import type { XmlElement } from "../../model/node";
import { attr, childrenWithTag } from "../util";
import { POINTS_PER_INCH } from "../shared/units";
import type { SheetDefinedNames } from "./defined-names";
import { parsePrintAreaValue, parsePrintTitlesValue } from "./defined-names";
import {
  paperSizeCodeToPageSize,
  parseUniversalMeasureToPt,
  readXmlBool,
} from "./util";

// Reads a worksheet's own <pageSetup>/<printOptions>/<pageMargins>/<rowBreaks>/<colBreaks>, plus its sheet-scoped _xlnm.Print_Area/_xlnm.Print_Titles defined names (see defined-names.ts), into a ContentSheetPrintSettings. Every attribute name and structural shape below was confirmed against real LibreOffice output (typed/xlsx/content.test.ts's own kitchen-sink.xlsx fixture, itself a genuine LibreOffice xlsx-export of odf.js's own kitchen-sink.ods -- see that test file's own top-of-file note), not assumed from memory.

// Excel's own "Normal" margin preset -- the fallback used only when a worksheet has no <pageMargins> element at all (real producers always write one; this covers a hand-built or minimally-conformant xlsx). Confirmed via multiple independent references (e.g. XlsxWriter's own Page Setup documentation, which documents Excel's Normal/Wide/Narrow presets identically): top/bottom 0.75in, left/right 0.7in, header/footer 0.3in. This module models only top/right/bottom/left (Margins has no header/footer fields of its own); the header/footer distance is not read at all -- ContentSheetPrintSettings has no field for it.
const DEFAULT_MARGINS: Margins = {
  topPt: 0.75 * POINTS_PER_INCH,
  rightPt: 0.7 * POINTS_PER_INCH,
  bottomPt: 0.75 * POINTS_PER_INCH,
  leftPt: 0.7 * POINTS_PER_INCH,
};

// The SAME Normal-preset header/footer distance (0.3in), exported for typed/xlsx/build.ts -- pageMargins' header/footer attributes are REQUIRED by CT_PageMargins even though ContentSheetPrintSettings has no field to source a real value from, so the writer needs this identical constant rather than inventing its own.
export const DEFAULT_HEADER_FOOTER_MARGIN_PT = 0.3 * POINTS_PER_INCH;

// fitToWidth/fitToHeight both default to 1 per ECMA-376's own CT_PageSetup when the attribute is absent but fitToPage mode is active.
const DEFAULT_FIT_TO_PAGES = 1;

// pageSetup@orientation ("portrait" | "landscape" | "default", ECMA-376's own default being "default" i.e. printer-decided, treated here as portrait) tells a reader whether the paper size it just resolved (via paperSize code or explicit paperWidth/paperHeight, both of which are defined in the paper's own PORTRAIT dimensions) needs its width/height swapped to reflect the sheet's actual printed orientation -- confirmed necessary for round-trip consistency with this module's own write side, which derives pageSetup@orientation the opposite direction (from whether widthPt > heightPt) in typed/xlsx/build.ts.
function applyOrientation(
  pageSize: PageSize,
  pageSetup: XmlElement | undefined,
): PageSize {
  const orientation =
    pageSetup === undefined ? undefined : attr(pageSetup, "orientation");
  if (orientation !== "landscape") {
    return pageSize;
  }
  return { widthPt: pageSize.heightPt, heightPt: pageSize.widthPt };
}

function readPageSize(pageSetup: XmlElement | undefined): PageSize {
  if (pageSetup === undefined) {
    return PAGE_SIZE_LETTER;
  }
  const paperSize = attr(pageSetup, "paperSize");
  const byCode =
    paperSize === undefined ? undefined : paperSizeCodeToPageSize(paperSize);
  if (byCode !== undefined) {
    return applyOrientation(byCode, pageSetup);
  }
  const paperWidth = attr(pageSetup, "paperWidth");
  const paperHeight = attr(pageSetup, "paperHeight");
  const widthPt =
    paperWidth === undefined
      ? undefined
      : parseUniversalMeasureToPt(paperWidth);
  const heightPt =
    paperHeight === undefined
      ? undefined
      : parseUniversalMeasureToPt(paperHeight);
  return widthPt === undefined || heightPt === undefined
    ? PAGE_SIZE_LETTER
    : applyOrientation({ widthPt, heightPt }, pageSetup);
}

// xlsx's own <pageMargins> is always expressed in inches (unitless numeric attribute values, per ECMA-376 CT_PageMargins) -- unlike <pageSetup>'s paperWidth/paperHeight, which carry an explicit ST_PositiveUniversalMeasure unit suffix.
function readMargins(pageMargins: XmlElement | undefined): Margins {
  if (pageMargins === undefined) {
    return DEFAULT_MARGINS;
  }
  const top = attr(pageMargins, "top");
  const right = attr(pageMargins, "right");
  const bottom = attr(pageMargins, "bottom");
  const left = attr(pageMargins, "left");
  return {
    topPt:
      top === undefined ? DEFAULT_MARGINS.topPt : Number(top) * POINTS_PER_INCH,
    rightPt:
      right === undefined
        ? DEFAULT_MARGINS.rightPt
        : Number(right) * POINTS_PER_INCH,
    bottomPt:
      bottom === undefined
        ? DEFAULT_MARGINS.bottomPt
        : Number(bottom) * POINTS_PER_INCH,
    leftPt:
      left === undefined
        ? DEFAULT_MARGINS.leftPt
        : Number(left) * POINTS_PER_INCH,
  };
}

function readPageOrder(
  pageSetup: XmlElement | undefined,
): ContentSheetPrintSettings["pageOrder"] {
  const raw =
    pageSetup === undefined ? undefined : attr(pageSetup, "pageOrder");
  // ECMA-376's own documented default for pageSetup@pageOrder, when absent, is "downThenOver".
  return raw === "overThenDown" ? "overThenDown" : "downThenOver";
}

function readManualBreaks(
  worksheet: XmlElement,
): ContentSheetPrintSettings["manualBreaks"] {
  const rowBreaksEl = childrenWithTag(worksheet, "rowBreaks")[0];
  const colBreaksEl = childrenWithTag(worksheet, "colBreaks")[0];
  const rows = rowBreaksEl === undefined ? [] : readBreakIndices(rowBreaksEl);
  const columns =
    colBreaksEl === undefined ? [] : readBreakIndices(colBreaksEl);
  return rows.length > 0 || columns.length > 0 ? { rows, columns } : undefined;
}

// Per ECMA-376 Part 1 SS18.3.1.2 (brk, CT_Break): "id" is the zero-based row/column index the break occurs immediately above/left of -- the SAME 0-based, break-precedes-this-index convention document-schema.js's own ContentSheetPrintSettings.manualBreaks already documents for its own rows/columns arrays (mirroring ODF's fo:break-before semantics), so no index translation is needed in either direction.
function readBreakIndices(container: XmlElement): number[] {
  const indices: number[] = [];
  for (const brk of childrenWithTag(container, "brk")) {
    const id = attr(brk, "id");
    const index = id === undefined ? undefined : Number.parseInt(id, 10);
    if (index !== undefined && Number.isInteger(index) && index >= 0) {
      indices.push(index);
    }
  }
  return indices;
}

export function readPrintSettings(
  worksheet: XmlElement,
  sheetIndex: number,
  definedNamesBySheet: ReadonlyMap<number, SheetDefinedNames>,
): ContentSheetPrintSettings {
  const sheetPr = childrenWithTag(worksheet, "sheetPr")[0];
  const pageSetUpPr =
    sheetPr === undefined
      ? undefined
      : childrenWithTag(sheetPr, "pageSetUpPr")[0];
  // sheetPr/pageSetUpPr@fitToPage is the ONLY reliable signal for scale-vs-fit-to-page: real producers (confirmed via LibreOffice) write both scale and fitToWidth/fitToHeight on <pageSetup> regardless of which mode is actually active, leaving whichever one is inactive as an ignored leftover value.
  const fitToPage = readXmlBool(
    pageSetUpPr === undefined ? undefined : attr(pageSetUpPr, "fitToPage"),
  );

  const pageSetup = childrenWithTag(worksheet, "pageSetup")[0];
  const pageMargins = childrenWithTag(worksheet, "pageMargins")[0];
  const printOptions = childrenWithTag(worksheet, "printOptions")[0];
  const manualBreaks = readManualBreaks(worksheet);
  const definedNames = definedNamesBySheet.get(sheetIndex);

  const settings: ContentSheetPrintSettings = {
    pageSize: readPageSize(pageSetup),
    margins: readMargins(pageMargins),
    gridlines: readXmlBool(
      printOptions === undefined ? undefined : attr(printOptions, "gridLines"),
    ),
    headers: readXmlBool(
      printOptions === undefined ? undefined : attr(printOptions, "headings"),
    ),
    pageOrder: readPageOrder(pageSetup),
  };

  if (fitToPage) {
    const fitToWidthRaw =
      pageSetup === undefined ? undefined : attr(pageSetup, "fitToWidth");
    const fitToHeightRaw =
      pageSetup === undefined ? undefined : attr(pageSetup, "fitToHeight");
    settings.fitToPages = {
      width:
        fitToWidthRaw === undefined
          ? DEFAULT_FIT_TO_PAGES
          : Number(fitToWidthRaw),
      height:
        fitToHeightRaw === undefined
          ? DEFAULT_FIT_TO_PAGES
          : Number(fitToHeightRaw),
    };
  } else {
    const scaleRaw =
      pageSetup === undefined ? undefined : attr(pageSetup, "scale");
    if (scaleRaw !== undefined) {
      const scale = Number(scaleRaw);
      if (Number.isFinite(scale)) {
        settings.scalePercent = scale;
      }
    }
  }

  if (manualBreaks !== undefined) {
    settings.manualBreaks = manualBreaks;
  }

  if (definedNames?.printArea !== undefined) {
    const range = parsePrintAreaValue(definedNames.printArea);
    if (range !== undefined) {
      settings.printRange = range;
    }
  }
  if (definedNames?.printTitles !== undefined) {
    const titles = parsePrintTitlesValue(definedNames.printTitles);
    if (titles.repeatRows !== undefined) {
      settings.repeatRows = titles.repeatRows;
    }
    if (titles.repeatColumns !== undefined) {
      settings.repeatColumns = titles.repeatColumns;
    }
  }

  return settings;
}
