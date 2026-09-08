import type {
  ContentCellValue,
  ContentDocument,
  ContentSheet,
  ContentSheetCell,
  ContentSheetColumn,
  ContentSheetPrintSettings,
  ContentSheetRow,
  DefinitionsTable,
  LayoutMetadata,
} from "document-schema.js";
import type { Package, XmlPart } from "../../model/package";
import type { XmlElement, XmlNode } from "../../model/node";
import { el, txt } from "../../xml/fragment";
import { encodeXmlText } from "../../xml/entities";
import { POINTS_PER_INCH } from "../shared/units";
import { cellReference, rangeReference } from "document-schema.js";
import {
  buildPrintAreaValue,
  buildPrintTitlesValue,
  XLNM_PRINT_AREA,
  XLNM_PRINT_TITLES,
} from "./defined-names";
import type { CellNumberFormat } from "./number-format";
import {
  BOOLEAN_NUMBER_FORMAT,
  currencyNumberFormat,
  DATE_NUMBER_FORMAT,
  DATE_TIME_NUMBER_FORMAT,
  PERCENTAGE_NUMBER_FORMAT,
  TIME_NUMBER_FORMAT,
} from "./number-format";
import { DEFAULT_HEADER_FOOTER_MARGIN_PT } from "./print-settings";
import {
  isoDateTimeToSerial,
  isoDateToSerial,
  isoTimeToSerial,
} from "./serial";
import { SharedStringTable } from "./shared-strings";
import {
  CellFormatTable,
  DEFAULT_CELL_FORMAT_INDEX,
  GENERAL_NUM_FMT_ID,
  RESERVED_BORDER_INDICES,
  RESERVED_FILL_INDICES,
} from "./styles";
import {
  COLUMN_WIDTH_CHARS_DECIMAL_PLACES,
  ptToColumnWidthChars,
} from "./units";
import {
  pageSizeToPaperSizeCode,
  ptToUniversalMeasure,
  writeXmlBool,
} from "./util";
import {
  buildConditionalFormattingElements,
  DxfTable,
} from "./conditional-format";
import { buildDataValidationsElement } from "./data-validation";
import { buildThreadedCommentsRoot, sheetHasComments } from "./comments-write";
import {
  buildGeneralDefinedNameElements,
  buildTablePart,
  collectNamedRangeEntries,
  collectTableEntries,
  type TableEntry,
} from "./definitions-write";
import {
  buildSheetDrawing,
  CT_CHART,
  CT_DRAWING,
  newDrawingCounters,
} from "./drawings-write";

// ContentDocument (kind: 'spreadsheet') -> Package: the first genuinely NEW xlsx package this ecosystem writes from scratch, rather than decoding/re-encoding an existing one -- every part below is constructed directly via xml/fragment.ts's el/txt, matching typed/xlsx/content.ts's own readXlsxContent as its read-side inverse: writing everything that reader reads, through the same number-format vocabulary that reader classifies (see renderCellValue and typed/xlsx/number-format.ts's own write-side section), and honestly re-approximating the one lossy conversion left on the way in (column-width characters). ContentSheetCell.comment now survives a round trip too, via the threaded-comments part comments-write.ts builds (see buildWorksheetPart's own note below). The reader's own drawing rows -- chart graphic frames (embeddedObjects) and pictures (images), typed/xlsx/drawings.ts -- now have a real write side too (ExaDev/documents.js#973, typed/xlsx/drawings-write.ts): every image and chart embedded object a sheet carries writes back out as a real xdr:oneCellAnchor in a genuine xl/drawings/drawingN.xml, plus xl/media/imageN.<ext> or xl/charts/chartN.xml as appropriate. The workbook's own definitions table (general defined names and Table/List objects, typed/xlsx/definitions.ts on the read side) closes the same way, via the optional `definitions` passed in BuildXlsxContentOptions (typed/xlsx/definitions-write.ts) -- flattenTree itself still cannot carry that table (it is a tree-only facility, document-schema.js's own rule), so buildXlsxPackage (typed/document-tree.ts) threads it through as this separate option rather than through the flattened ContentDocument. See typed/xlsx/content.test.ts and typed/xlsx/build.test.ts for the real-LibreOffice round-trip verification this pairing is built and tested against.
//
// This is the flat, content-level half of the xlsx write pair: buildXlsxPackage (typed/document-tree.ts) is the primary name, flattening a tree-form DocumentTree (styles-table refs materialised away) and handing the result straight to this function.

const SML_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL_NS =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG_RELS_NS =
  "http://schemas.openxmlformats.org/package/2006/relationships";
const CONTENT_TYPES_NS =
  "http://schemas.openxmlformats.org/package/2006/content-types";
const CORE_PROPS_NS =
  "http://schemas.openxmlformats.org/package/2006/metadata/core-properties";
const DC_NS = "http://purl.org/dc/elements/1.1/";
const DCTERMS_NS = "http://purl.org/dc/terms/";
const XSI_NS = "http://www.w3.org/2001/XMLSchema-instance";
const EXTENDED_PROPS_NS =
  "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties";

const CT_WORKBOOK =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml";
const CT_STYLES =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml";
const CT_SHARED_STRINGS =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml";
const CT_WORKSHEET =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml";
const CT_CORE_PROPS =
  "application/vnd.openxmlformats-package.core-properties+xml";
const CT_EXTENDED_PROPS =
  "application/vnd.openxmlformats-officedocument.extended-properties+xml";
const CT_THREADED_COMMENTS = "application/vnd.ms-excel.threadedcomments+xml";
const CT_TABLE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml";

const REL_OFFICE_DOCUMENT = `${REL_NS}/officeDocument`;
const REL_CORE_PROPS = `${PKG_RELS_NS}/metadata/core-properties`;
const REL_EXTENDED_PROPS = `${REL_NS}/extended-properties`;
const REL_WORKSHEET = `${REL_NS}/worksheet`;
const REL_STYLES = `${REL_NS}/styles`;
const REL_SHARED_STRINGS = `${REL_NS}/sharedStrings`;
// Matches typed/xlsx/comments.ts's own REL_THREADED_COMMENTS exactly -- the read side already reads whatever this writer emits under this relationship type, so the two must stay identical.
const REL_THREADED_COMMENTS =
  "http://schemas.microsoft.com/office/2017/10/relationships/threadedComment";
// Matches typed/xlsx/drawings.ts's own DRAWING_REL_SUFFIX and typed/xlsx/definitions.ts's own TABLE_REL_SUFFIX -- the read side resolves a worksheet's drawing/table parts by relationship TYPE alone, never by r:id, so these must stay identical to what those readers match against.
const REL_DRAWING = `${REL_NS}/drawing`;
const REL_TABLE = `${REL_NS}/table`;

// 0-based indices of the last column (XFD, the 16384th) and the last row (the 1,048,576th) -- the current OOXML worksheet size limits, used as rowBreaks/colBreaks' own <brk max="..."> extent (the full width/height of the sheet the break spans), per ECMA-376 Part 1 SS18.3.1.2's own min/max attribute semantics documented in print-settings.ts's readManualBreaks.
const MAX_COLUMN_INDEX = 16383;
const MAX_ROW_INDEX = 1048575;

function xmlDeclaration(): XmlNode {
  return {
    type: "declaration",
    attributes: [
      { name: "version", value: "1.0" },
      { name: "encoding", value: "UTF-8" },
      { name: "standalone", value: "yes" },
    ],
  };
}

function xmlPart(root: XmlElement): XmlPart {
  return { kind: "xml", nodes: [xmlDeclaration(), root] };
}

// --- [Content_Types].xml -----------------------------------------------------------------------------------------

const IMAGE_CONTENT_TYPES: Readonly<Record<"png" | "jpeg" | "gif", string>> = {
  png: "image/png",
  jpeg: "image/jpeg",
  gif: "image/gif",
};

function buildContentTypesPart(
  sheetCount: number,
  commentedSheetIndices: readonly number[],
  drawingSheetIndices: readonly number[],
  chartPartNames: readonly string[],
  tablePartNames: readonly string[],
  usedImageFormats: ReadonlySet<"png" | "jpeg" | "gif">,
): XmlPart {
  const overrides: XmlElement[] = [
    el("Override", { PartName: "/xl/workbook.xml", ContentType: CT_WORKBOOK }),
    el("Override", { PartName: "/xl/styles.xml", ContentType: CT_STYLES }),
    el("Override", {
      PartName: "/xl/sharedStrings.xml",
      ContentType: CT_SHARED_STRINGS,
    }),
  ];
  for (let index = 0; index < sheetCount; index++) {
    overrides.push(
      el("Override", {
        PartName: `/xl/worksheets/sheet${index + 1}.xml`,
        ContentType: CT_WORKSHEET,
      }),
    );
  }
  for (const index of commentedSheetIndices) {
    overrides.push(
      el("Override", {
        PartName: `/xl/threadedComments/threadedComment${index + 1}.xml`,
        ContentType: CT_THREADED_COMMENTS,
      }),
    );
  }
  for (const index of drawingSheetIndices) {
    overrides.push(
      el("Override", {
        PartName: `/xl/drawings/drawing${index + 1}.xml`,
        ContentType: CT_DRAWING,
      }),
    );
  }
  for (const partName of chartPartNames) {
    overrides.push(
      el("Override", { PartName: `/${partName}`, ContentType: CT_CHART }),
    );
  }
  for (const partName of tablePartNames) {
    overrides.push(
      el("Override", { PartName: `/${partName}`, ContentType: CT_TABLE }),
    );
  }
  overrides.push(
    el("Override", {
      PartName: "/docProps/core.xml",
      ContentType: CT_CORE_PROPS,
    }),
  );
  overrides.push(
    el("Override", {
      PartName: "/docProps/app.xml",
      ContentType: CT_EXTENDED_PROPS,
    }),
  );
  const mediaDefaults = [...usedImageFormats].map((format) =>
    el("Default", {
      Extension: format,
      ContentType: IMAGE_CONTENT_TYPES[format],
    }),
  );
  const root = el("Types", { xmlns: CONTENT_TYPES_NS }, [
    el("Default", {
      Extension: "rels",
      ContentType: "application/vnd.openxmlformats-package.relationships+xml",
    }),
    el("Default", { Extension: "xml", ContentType: "application/xml" }),
    ...mediaDefaults,
    ...overrides,
  ]);
  return xmlPart(root);
}

// --- _rels/.rels and xl/_rels/workbook.xml.rels -------------------------------------------------------------------

function buildPackageRelsPart(): XmlPart {
  const root = el("Relationships", { xmlns: PKG_RELS_NS }, [
    el("Relationship", {
      Id: "rId1",
      Type: REL_OFFICE_DOCUMENT,
      Target: "xl/workbook.xml",
    }),
    el("Relationship", {
      Id: "rId2",
      Type: REL_CORE_PROPS,
      Target: "docProps/core.xml",
    }),
    el("Relationship", {
      Id: "rId3",
      Type: REL_EXTENDED_PROPS,
      Target: "docProps/app.xml",
    }),
  ]);
  return xmlPart(root);
}

function worksheetRelId(sheetIndex: number): string {
  return `rId${sheetIndex + 1}`;
}

function buildWorkbookRelsPart(sheetCount: number): XmlPart {
  const relationships: XmlElement[] = [];
  for (let index = 0; index < sheetCount; index++) {
    relationships.push(
      el("Relationship", {
        Id: worksheetRelId(index),
        Type: REL_WORKSHEET,
        Target: `worksheets/sheet${index + 1}.xml`,
      }),
    );
  }
  relationships.push(
    el("Relationship", {
      Id: `rId${sheetCount + 1}`,
      Type: REL_STYLES,
      Target: "styles.xml",
    }),
  );
  relationships.push(
    el("Relationship", {
      Id: `rId${sheetCount + 2}`,
      Type: REL_SHARED_STRINGS,
      Target: "sharedStrings.xml",
    }),
  );
  const root = el("Relationships", { xmlns: PKG_RELS_NS }, relationships);
  return xmlPart(root);
}

// --- xl/workbook.xml (sheets list + sheet-scoped Print_Area/Print_Titles defined names) --------------------------

function buildDefinedNameElements(
  sheets: readonly ContentSheet[],
): XmlElement[] {
  const elements: XmlElement[] = [];
  sheets.forEach((sheet, sheetIndex) => {
    const { printRange, repeatRows, repeatColumns } = sheet.printSettings;
    if (printRange !== undefined) {
      const value = buildPrintAreaValue(sheet.name, printRange);
      elements.push(
        el(
          "definedName",
          { name: XLNM_PRINT_AREA, localSheetId: String(sheetIndex) },
          [txt(encodeXmlText(value))],
        ),
      );
    }
    if (repeatRows !== undefined || repeatColumns !== undefined) {
      const value = buildPrintTitlesValue(
        sheet.name,
        repeatRows,
        repeatColumns,
      );
      if (value !== undefined) {
        elements.push(
          el(
            "definedName",
            { name: XLNM_PRINT_TITLES, localSheetId: String(sheetIndex) },
            [txt(encodeXmlText(value))],
          ),
        );
      }
    }
  });
  return elements;
}

function buildWorkbookPart(
  sheets: readonly ContentSheet[],
  generalDefinedNameElements: readonly XmlElement[],
): XmlPart {
  const sheetElements = sheets.map((sheet, index) =>
    el("sheet", {
      name: encodeXmlText(sheet.name),
      sheetId: String(index + 1),
      "r:id": worksheetRelId(index),
    }),
  );
  const children: XmlElement[] = [el("sheets", {}, sheetElements)];
  const definedNameElements = [
    ...buildDefinedNameElements(sheets),
    ...generalDefinedNameElements,
  ];
  if (definedNameElements.length > 0) {
    children.push(el("definedNames", {}, definedNameElements));
  }
  const root = el("workbook", { xmlns: SML_NS, "xmlns:r": REL_NS }, children);
  return xmlPart(root);
}

// --- xl/sharedStrings.xml -------------------------------------------------------------------------------------

function buildSharedStringsPart(sharedStrings: SharedStringTable): XmlPart {
  const entries = sharedStrings.entries();
  const siElements = entries.map((value) =>
    // xml:space="preserve" unconditionally -- confirmed as real producers' own convention (typed/xlsx/content.test.ts's own kitchen-sink fixture writes it on every single <t>, regardless of whether that particular string actually has significant leading/trailing whitespace), simpler and always-safe to match rather than conditionally detecting it per string.
    el("si", {}, [
      el("t", { "xml:space": "preserve" }, [txt(encodeXmlText(value))]),
    ]),
  );
  const root = el(
    "sst",
    {
      xmlns: SML_NS,
      count: String(entries.length),
      uniqueCount: String(entries.length),
    },
    siElements,
  );
  return xmlPart(root);
}

// --- xl/styles.xml: the minimal font/border scaffolding real Excel/LibreOffice require, plus the interned fills/borders/cell formats ---

// <fonts> and the two reserved <fills> entries (index 0 "none", index 1 Excel's mandatory gray125) plus the empty reserved <borders> entry (index 0) are fixed scaffolding, confirmed against multiple independent references as the source of Excel's "we found a problem with some content" repair prompt when a hand-rolled writer omits them. On top of that scaffolding this writer now emits the real solid fills and real per-edge borders the cells themselves carried, interned by CellFormatTable alongside the number formats.
//
// The variable parts come straight from the CellFormatTable the worksheets filled: one <numFmt> per custom code interned (and NO <numFmts> element at all when nothing was, which is what keeps a workbook of ordinary numbers and strings byte-identical to what this writer produced before number formats existed), one <fill> per distinct solid background, one <border> per distinct edge set, and one <xf> per cell-format index -- index 0 always being the General + no-decoration default. <dxfs> is the same story for conditionalFormatting rule styling: one <dxf> per DxfTable.intern call the worksheets made (also NO <dxfs> element at all when a workbook has no styled conditional-format rule), populated by the very same per-sheet build pass, which is why buildXlsxPackageFromContent's own worksheets-before-styles ordering note below applies to dxfTable exactly as it already does to cellFormats.
//
// CT_Stylesheet's own required child element ORDER (ECMA-376 Part 1 SS18.8.39): numFmts?, fonts?, fills?, borders?, cellStyleXfs?, cellXfs?, cellStyles?, dxfs?, ... -- numFmts FIRST, before the fonts element that used to lead this part, and dxfs right after cellStyles (confirmed against real-producer-validation-and-cellis.xlsx's own styles.xml, which places its <dxfs> there, immediately before its <colors> element this writer does not emit).
function buildStylesPart(
  cellFormats: CellFormatTable,
  dxfTable: DxfTable,
): XmlPart {
  const children: XmlElement[] = [];

  const declarations = cellFormats.declarations();
  if (declarations.length > 0) {
    const numFmtElements = declarations.map((declaration) =>
      el("numFmt", {
        numFmtId: String(declaration.id),
        formatCode: encodeXmlText(declaration.code),
      }),
    );
    children.push(
      el("numFmts", { count: String(numFmtElements.length) }, numFmtElements),
    );
  }

  const fillDeclarations = cellFormats.fillDeclarations();
  const fillElements = fillDeclarations.map((fill) => {
    switch (fill.kind) {
      case "none":
        return el("fill", {}, [el("patternFill", { patternType: "none" })]);
      case "gray125":
        return el("fill", {}, [el("patternFill", { patternType: "gray125" })]);
      case "solid": {
        // Excel's solid-fill convention: the visible cell colour is the pattern's fgColor, with bgColor indexed="64" (the documented "no separate background" sentinel) -- the exact inverse of readFillBackground, which reads fgColor as the solid-fill colour.
        return el("fill", {}, [
          el("patternFill", { patternType: "solid" }, [
            el("fgColor", { rgb: `FF${fill.rgb}` }),
            el("bgColor", { indexed: "64" }),
          ]),
        ]);
      }
      case "pattern": {
        // A genuine two-colour pattern fill (ExaDev/documents.js#951): fgColor is the colour the pattern's strokes are drawn in, bgColor the colour its gaps show through -- each emitted only when the ContentCellFill actually stated it, left absent (Excel's own "automatic" default) otherwise.
        const children: XmlElement[] = [];
        if (fill.fgRgb !== undefined) {
          children.push(el("fgColor", { rgb: `FF${fill.fgRgb}` }));
        }
        if (fill.bgRgb !== undefined) {
          children.push(el("bgColor", { rgb: `FF${fill.bgRgb}` }));
        }
        return el("fill", {}, [
          el("patternFill", { patternType: fill.patternType }, children),
        ]);
      }
    }
  });

  const borderDeclarations = cellFormats.borderDeclarations();
  const borderElements = borderDeclarations.map((border) => {
    const edgeElements: XmlElement[] = [];
    for (const edge of ["left", "right", "top", "bottom"] as const) {
      const present = border.edges[edge];
      if (present !== undefined) {
        edgeElements.push(
          el(edge, { style: present.style }, [
            el("color", { rgb: `FF${present.rgb}` }),
          ]),
        );
      } else {
        edgeElements.push(el(edge));
      }
    }
    edgeElements.push(el("diagonal"));
    return el("border", {}, edgeElements);
  });

  children.push(
    el("fonts", { count: "1" }, [
      el("font", {}, [el("sz", { val: "11" }), el("name", { val: "Calibri" })]),
    ]),
    el("fills", { count: String(fillElements.length) }, fillElements),
    el("borders", { count: String(borderElements.length) }, borderElements),
    el("cellStyleXfs", { count: "1" }, [
      el("xf", { numFmtId: "0", fontId: "0", fillId: "0", borderId: "0" }),
    ]),
  );

  const xfRecords = cellFormats.cellFormatRecords();
  const xfElements = xfRecords.map((record) => {
    const attrs: Record<string, string> = {
      numFmtId: String(record.numFmtId),
      fontId: "0",
      fillId: String(record.fillId),
      borderId: String(record.borderId),
      xfId: "0",
    };
    if (record.numFmtId !== GENERAL_NUM_FMT_ID) {
      // CT_Xf/@applyNumberFormat tells a consumer to honour this xf's OWN numFmtId rather than the one it would otherwise inherit from the cell style it is based on (xfId). Real producers differ here -- Excel writes it on every formatted xf, LibreOffice omits it entirely and relies on numFmtId alone (see this directory's own kitchen-sink fixture, whose six formatted xfs carry no applyNumberFormat at all) -- so this writer emits the explicit form, which cannot be misread by either: LibreOffice 26.2 renders every format below correctly with it present (verified), and Excel's own inheritance rule makes it the unambiguous spelling.
      attrs.applyNumberFormat = writeXmlBool(true);
    }
    // Each apply* flag mirrors applyNumberFormat: it tells a consumer to honour this xf's OWN fillId/borderId/alignment rather than the one inherited from the cell style it is based on. Set next to the id that drives it so what triggers the flag stays local to the line.
    if (record.fillId !== RESERVED_FILL_INDICES.none) {
      attrs.applyFill = writeXmlBool(true);
    }
    if (record.borderId !== RESERVED_BORDER_INDICES.empty) {
      attrs.applyBorder = writeXmlBool(true);
    }
    const xfChildren: XmlElement[] = [];
    if (record.alignment !== undefined) {
      attrs.applyAlignment = writeXmlBool(true);
      const alignmentAttrs: Record<string, string> = {};
      if (record.alignment.horizontal !== undefined) {
        alignmentAttrs.horizontal = record.alignment.horizontal;
      }
      // verticalAlignment 'middle' writes back as the xlsx token 'center' it round-trips from; 'top' maps directly, and 'bottom' (the documented default) writes no vertical attribute at all, exactly as the reader leaves it unread.
      if (record.alignment.vertical === "top") {
        alignmentAttrs.vertical = "top";
      } else if (record.alignment.vertical === "middle") {
        alignmentAttrs.vertical = "center";
      }
      xfChildren.push(el("alignment", alignmentAttrs));
    }
    return el("xf", attrs, xfChildren);
  });
  children.push(
    el("cellXfs", { count: String(xfElements.length) }, xfElements),
  );

  children.push(
    el("cellStyles", { count: "1" }, [
      el("cellStyle", { name: "Normal", xfId: "0", builtinId: "0" }),
    ]),
  );

  const dxfElements = dxfTable.dxfElements();
  if (dxfElements.length > 0) {
    children.push(
      el("dxfs", { count: String(dxfElements.length) }, [...dxfElements]),
    );
  }

  return xmlPart(el("styleSheet", { xmlns: SML_NS }, children));
}

// --- docProps/core.xml and docProps/app.xml -------------------------------------------------------------------

function buildCorePropertiesPart(metadata: LayoutMetadata): XmlPart {
  const children: XmlElement[] = [];
  if (metadata.title !== undefined) {
    children.push(el("dc:title", {}, [txt(encodeXmlText(metadata.title))]));
  }
  if (metadata.author !== undefined) {
    children.push(el("dc:creator", {}, [txt(encodeXmlText(metadata.author))]));
  }
  if (metadata.subject !== undefined) {
    children.push(el("dc:subject", {}, [txt(encodeXmlText(metadata.subject))]));
  }
  if (metadata.keywords !== undefined && metadata.keywords.length > 0) {
    children.push(
      el("cp:keywords", {}, [txt(encodeXmlText(metadata.keywords.join(", ")))]),
    );
  }
  if (metadata.createdIso !== undefined) {
    children.push(
      el("dcterms:created", { "xsi:type": "dcterms:W3CDTF" }, [
        txt(encodeXmlText(metadata.createdIso)),
      ]),
    );
  }
  if (metadata.modifiedIso !== undefined) {
    children.push(
      el("dcterms:modified", { "xsi:type": "dcterms:W3CDTF" }, [
        txt(encodeXmlText(metadata.modifiedIso)),
      ]),
    );
  }
  const root = el(
    "cp:coreProperties",
    {
      "xmlns:cp": CORE_PROPS_NS,
      "xmlns:dc": DC_NS,
      "xmlns:dcterms": DCTERMS_NS,
      "xmlns:xsi": XSI_NS,
    },
    children,
  );
  return xmlPart(root);
}

function buildAppPropertiesPart(metadata: LayoutMetadata): XmlPart {
  const children: XmlElement[] = [];
  if (metadata.creator !== undefined) {
    children.push(
      el("Application", {}, [txt(encodeXmlText(metadata.creator))]),
    );
  }
  const root = el("Properties", { xmlns: EXTENDED_PROPS_NS }, children);
  return xmlPart(root);
}

// --- xl/worksheets/sheetN.xml ------------------------------------------------------------------------------------

function computeDimension(sheet: ContentSheet): string {
  let maxRow = 0;
  let maxColumn = 0;
  let hasAny = false;
  for (const cell of sheet.cells) {
    hasAny = true;
    maxRow = Math.max(maxRow, cell.row);
    maxColumn = Math.max(maxColumn, cell.column);
  }
  for (const column of sheet.columns) {
    hasAny = true;
    maxColumn = Math.max(maxColumn, column.index);
  }
  for (const row of sheet.rows) {
    hasAny = true;
    maxRow = Math.max(maxRow, row.index);
  }
  return hasAny
    ? rangeReference({
        startRow: 0,
        startColumn: 0,
        endRow: maxRow,
        endColumn: maxColumn,
      })
    : "A1";
}

function buildColsElement(
  columns: readonly ContentSheetColumn[],
): XmlElement | undefined {
  if (columns.length === 0) {
    return undefined;
  }
  // One <col min max> range per ContentSheetColumn, min=max=that single column -- the honest inverse of readColumns' own "one entry per <col> element, never per repeated position" policy: this writer never attempts to re-merge adjacent same-width columns back into a wider range, which would be a real optimization but isn't needed for a correct, valid file. widthPt is optional (a column entry can exist purely to declare `hidden`, with no declared size at all) -- width/customWidth are only written when a real width is present, matching ECMA-376's own optional CT_Col@width/@customWidth rather than fabricating a zero-width column.
  const colElements = columns.map((column) => {
    const attrs: Record<string, string> = {
      min: String(column.index + 1),
      max: String(column.index + 1),
    };
    if (column.widthPt !== undefined) {
      attrs.width = ptToColumnWidthChars(column.widthPt).toFixed(
        COLUMN_WIDTH_CHARS_DECIMAL_PLACES,
      );
      attrs.customWidth = "true";
    }
    if (column.hidden === true) {
      attrs.hidden = "true";
    }
    return el("col", attrs);
  });
  return el("cols", {}, colElements);
}

interface RenderedCellValue {
  // ST_CellType, absent for the "this cell holds a number" case (an absent t and t="n" are identical, and every temporal/percentage/currency value below is a number as far as the wire format is concerned).
  type?: string;
  content: string;
  // The number format this value must be DISPLAYED through, interned by the caller into the workbook's own cell-format table. Absent means General, i.e. cellXfs index 0.
  format?: CellNumberFormat;
}

// xlsx has no distinct CELL TYPE for a percentage, an amount of money, a date, or a time -- every one of them is an ordinary number whose meaning lives entirely in the number format its style points at, which is exactly how typed/xlsx/content.ts recovers them on the way in. So this writer says what it means the same way a real producer does: it renders the value as a bare number and asks for the matching format from typed/xlsx/number-format.ts's own write-side vocabulary, which the CellFormatTable interns into a real <numFmt>/<xf> pair.
//
// ST_CellType's rare t="d" ISO-8601 variant is deliberately NOT used for the temporal kinds, even though it would carry their string spelling verbatim: real Excel does not render it as a date at all, and it is a SINGLE combined date-and-time type, so writing all three temporal kinds through it collapses them onto one indistinguishable wire form that reads back as 'dateTime' whatever went in. A serial plus a date/time/dateTime format is both what real files carry and what keeps the three kinds distinguishable.
function renderCellValue(
  value: ContentCellValue,
  isFormulaResult: boolean,
  sharedStrings: SharedStringTable,
): RenderedCellValue | undefined {
  switch (value.kind) {
    case "string":
      return renderString(value.value, isFormulaResult, sharedStrings);
    case "number":
      return { content: String(value.value) };
    case "percentage":
      // The stored value stays the raw fraction ContentCellValue carries (0.4256), which is what a percent-formatted cell holds in every real file -- the x100 is the format's job, not the value's.
      return { content: String(value.value), format: PERCENTAGE_NUMBER_FORMAT };
    case "currency":
      return {
        content: String(value.value),
        format: currencyNumberFormat(value.currency),
      };
    case "boolean":
      return {
        type: "b",
        content: value.value ? "1" : "0",
        format: BOOLEAN_NUMBER_FORMAT,
      };
    case "date":
      return renderTemporal(
        isoDateToSerial(value.value),
        value.value,
        DATE_NUMBER_FORMAT,
        isFormulaResult,
        sharedStrings,
      );
    case "time":
      return renderTemporal(
        isoTimeToSerial(value.value),
        value.value,
        TIME_NUMBER_FORMAT,
        isFormulaResult,
        sharedStrings,
      );
    case "dateTime":
      return renderTemporal(
        isoDateTimeToSerial(value.value),
        value.value,
        DATE_TIME_NUMBER_FORMAT,
        isFormulaResult,
        sharedStrings,
      );
    case "error":
      return { type: "e", content: encodeXmlText(value.value) };
    case "empty":
      return undefined;
  }
}

function renderString(
  text: string,
  isFormulaResult: boolean,
  sharedStrings: SharedStringTable,
): RenderedCellValue {
  if (isFormulaResult) {
    // A formula's own cached string result is written literally (t="str"), never shared-string indexed -- shared strings are ECMA-376's own convention for literal, non-formula text cells only; a formula's cached text result is written inline instead, mirroring exactly how typed/xlsx/content.ts's readCellValue reads the two cases apart.
    return { type: "str", content: encodeXmlText(text) };
  }
  return { type: "s", content: String(sharedStrings.intern(text)) };
}

// A temporal value whose ISO spelling could not be converted to a serial at all -- a value that is not the canonical ContentCellValue spelling (see typed/xlsx/serial.ts), or one naming a moment with no serial (a date before the epoch, an impossible calendar day, an hour past 23) -- degrades to an ordinary text cell carrying that original string VERBATIM. Writing a fabricated or clamped serial would silently turn an unreadable value into a plausible wrong one; writing the text keeps every character the caller supplied, visibly as text.
function renderTemporal(
  serial: number | undefined,
  iso: string,
  format: CellNumberFormat,
  isFormulaResult: boolean,
  sharedStrings: SharedStringTable,
): RenderedCellValue {
  if (serial === undefined) {
    return renderString(iso, isFormulaResult, sharedStrings);
  }
  return { content: String(serial), format };
}

function buildCellElement(
  cell: ContentSheetCell,
  sharedStrings: SharedStringTable,
  cellFormats: CellFormatTable,
): XmlElement {
  const children: XmlNode[] = [];
  const rendered = renderCellValue(
    cell.value,
    cell.formula !== undefined,
    sharedStrings,
  );
  // The cell's own decoration (background/borders/alignment/verticalAlignment) is interned INTO the same cellXfs index as its number format, so two cells sharing both format and decoration share one <xf> entry exactly as a real producer's own output does. An undecorated cell passes no decoration through, landing on the same xf an identical-format undecorated cell already did before decoration existed.
  const decoration =
    cell.background !== undefined ||
    cell.borders !== undefined ||
    cell.alignment !== undefined ||
    cell.verticalAlignment !== undefined
      ? {
          background: cell.background,
          borders: cell.borders,
          alignment: cell.alignment,
          verticalAlignment: cell.verticalAlignment,
        }
      : undefined;
  const format = rendered?.format;
  const styleIndex =
    format === undefined && decoration === undefined
      ? DEFAULT_CELL_FORMAT_INDEX
      : cellFormats.intern(
          format ?? { kind: "builtin", id: GENERAL_NUM_FMT_ID },
          decoration,
        );
  const attrs: Record<string, string> = {
    r: cellReference(cell.row, cell.column),
    s: String(styleIndex),
  };
  if (cell.formula !== undefined) {
    children.push(el("f", {}, [txt(encodeXmlText(cell.formula))]));
  }
  if (rendered !== undefined) {
    if (rendered.type !== undefined) {
      attrs.t = rendered.type;
    }
    children.push(el("v", {}, [txt(rendered.content)]));
  }
  return el("c", attrs, children);
}

function buildSheetDataElement(
  sheet: ContentSheet,
  sharedStrings: SharedStringTable,
  cellFormats: CellFormatTable,
): XmlElement {
  const cellsByRow = new Map<number, ContentSheetCell[]>();
  for (const cell of sheet.cells) {
    const existing = cellsByRow.get(cell.row);
    if (existing === undefined) {
      cellsByRow.set(cell.row, [cell]);
    } else {
      existing.push(cell);
    }
  }
  const rowInfoByIndex = new Map<number, ContentSheetRow>();
  for (const row of sheet.rows) {
    rowInfoByIndex.set(row.index, row);
  }
  const rowIndices = Array.from(
    new Set<number>([...cellsByRow.keys(), ...rowInfoByIndex.keys()]),
  ).sort((a, b) => a - b);

  const rowElements = rowIndices.map((rowIndex) => {
    const cells = (cellsByRow.get(rowIndex) ?? [])
      .slice()
      .sort((a, b) => a.column - b.column);
    const rowInfo = rowInfoByIndex.get(rowIndex);
    const attrs: Record<string, string> = { r: String(rowIndex + 1) };
    if (rowInfo !== undefined) {
      if (rowInfo.heightPt !== undefined) {
        attrs.ht = String(rowInfo.heightPt);
        attrs.customHeight = "true";
      }
      if (rowInfo.hidden === true) {
        attrs.hidden = "true";
      }
    }
    return el(
      "row",
      attrs,
      cells.map((cell) => buildCellElement(cell, sharedStrings, cellFormats)),
    );
  });
  return el("sheetData", {}, rowElements);
}

function buildMergeCellsElement(
  cells: readonly ContentSheetCell[],
): XmlElement | undefined {
  const merges = cells.filter(
    (cell) => (cell.colSpan ?? 1) > 1 || (cell.rowSpan ?? 1) > 1,
  );
  if (merges.length === 0) {
    return undefined;
  }
  const mergeCellElements = merges.map((cell) => {
    const endRow = cell.row + (cell.rowSpan ?? 1) - 1;
    const endColumn = cell.column + (cell.colSpan ?? 1) - 1;
    return el("mergeCell", {
      ref: rangeReference({
        startRow: cell.row,
        startColumn: cell.column,
        endRow,
        endColumn,
      }),
    });
  });
  return el(
    "mergeCells",
    { count: String(mergeCellElements.length) },
    mergeCellElements,
  );
}

function buildSheetPrElement(settings: ContentSheetPrintSettings): XmlElement {
  return el("sheetPr", {}, [
    el("pageSetUpPr", {
      fitToPage: writeXmlBool(settings.fitToPages !== undefined),
    }),
  ]);
}

function buildPrintOptionsElement(
  settings: ContentSheetPrintSettings,
): XmlElement {
  return el("printOptions", {
    gridLines: writeXmlBool(settings.gridlines),
    headings: writeXmlBool(settings.headers),
  });
}

function ptToInches(pt: number): string {
  return String(pt / POINTS_PER_INCH);
}

function buildPageMarginsElement(
  settings: ContentSheetPrintSettings,
): XmlElement {
  const margins = settings.margins;
  return el("pageMargins", {
    left: ptToInches(margins.leftPt),
    right: ptToInches(margins.rightPt),
    top: ptToInches(margins.topPt),
    bottom: ptToInches(margins.bottomPt),
    header: ptToInches(DEFAULT_HEADER_FOOTER_MARGIN_PT),
    footer: ptToInches(DEFAULT_HEADER_FOOTER_MARGIN_PT),
  });
}

function buildPageSetupElement(
  settings: ContentSheetPrintSettings,
): XmlElement {
  const attrs: Record<string, string> = {};
  const paperCode = pageSizeToPaperSizeCode(settings.pageSize);
  if (paperCode !== undefined) {
    attrs.paperSize = paperCode;
  } else {
    attrs.paperWidth = ptToUniversalMeasure(settings.pageSize.widthPt);
    attrs.paperHeight = ptToUniversalMeasure(settings.pageSize.heightPt);
  }
  // scale/fitToWidth/fitToHeight are written together regardless of which mode sheetPr/pageSetUpPr@fitToPage actually selects -- matching real producer output (see this directory's own kitchen-sink fixture, where LibreOffice writes all three unconditionally, only one pair of them ever meaningfully honoured).
  attrs.scale = String(settings.scalePercent ?? 100);
  attrs.fitToWidth = String(settings.fitToPages?.width ?? 1);
  attrs.fitToHeight = String(settings.fitToPages?.height ?? 1);
  attrs.pageOrder = settings.pageOrder;
  // ContentSheetPrintSettings carries no explicit print-orientation field of its own -- PageSize's own width-vs-height already encodes it (a landscape page style's own recorded width exceeds its height), the same relationship typed/xlsx/print-settings.ts's own readPageSize swaps back on the way in when pageSetup@orientation="landscape" is present, so this is a real, non-fabricated derivation, not an assumption.
  attrs.orientation =
    settings.pageSize.widthPt > settings.pageSize.heightPt
      ? "landscape"
      : "portrait";
  return el("pageSetup", attrs);
}

function buildBreaksElements(settings: ContentSheetPrintSettings): {
  rowBreaks?: XmlElement;
  colBreaks?: XmlElement;
} {
  const manualBreaks = settings.manualBreaks;
  if (manualBreaks === undefined) {
    return {};
  }
  const result: { rowBreaks?: XmlElement; colBreaks?: XmlElement } = {};
  if (manualBreaks.rows.length > 0) {
    const breaks = manualBreaks.rows.map((id) =>
      el("brk", {
        id: String(id),
        min: "0",
        max: String(MAX_COLUMN_INDEX),
        man: "1",
      }),
    );
    result.rowBreaks = el(
      "rowBreaks",
      { count: String(breaks.length), manualBreakCount: String(breaks.length) },
      breaks,
    );
  }
  if (manualBreaks.columns.length > 0) {
    const breaks = manualBreaks.columns.map((id) =>
      el("brk", {
        id: String(id),
        min: "0",
        max: String(MAX_ROW_INDEX),
        man: "1",
      }),
    );
    result.colBreaks = el(
      "colBreaks",
      { count: String(breaks.length), manualBreakCount: String(breaks.length) },
      breaks,
    );
  }
  return result;
}

interface WorksheetRelationship {
  readonly id: string;
  readonly type: string;
  readonly target: string;
}

// A worksheet part only ever needs its own .rels when something on the sheet relates to a sibling part outside xl/worksheets/ -- a commented cell (sheetHasComments, comments-write.ts), a drawing layer carrying at least one image or chart (typed/xlsx/drawings-write.ts), or a Table/List object anchored to it (typed/xlsx/definitions-write.ts) -- addressed by the SAME relative-target convention typed/xlsx/util.ts's own resolveRelTarget already resolves back through.
function buildWorksheetRelsPart(
  relationships: readonly WorksheetRelationship[],
): XmlPart {
  const root = el(
    "Relationships",
    { xmlns: PKG_RELS_NS },
    relationships.map((rel) =>
      el("Relationship", { Id: rel.id, Type: rel.type, Target: rel.target }),
    ),
  );
  return xmlPart(root);
}

// CT_Worksheet's own required child element ORDER (ECMA-376 Part 1 SS18.3.1.99): sheetPr?, dimension?, sheetViews?, sheetFormatPr?, cols*, sheetData, ..., mergeCells?, conditionalFormatting*, dataValidations?, ..., printOptions?, pageMargins?, pageSetup?, headerFooter?, rowBreaks?, colBreaks?, ..., drawing?, ..., tableParts?, extLst? -- every element this writer emits follows that relative order (sheetViews and headerFooter are both skipped entirely: pure UI/print-preview state this package's own content model carries no data for), confirmed against real-producer-validation-and-cellis.xlsx's own emitted order: mergeCells (this fixture has none), conditionalFormatting, dataValidations, printOptions/pageMargins/pageSetup. drawing (typed/xlsx/drawings-write.ts) and tableParts (typed/xlsx/definitions-write.ts) both sit past colBreaks, drawing first, matching CT_Worksheet's own sequence.
function buildWorksheetPart(
  sheet: ContentSheet,
  sharedStrings: SharedStringTable,
  cellFormats: CellFormatTable,
  dxfTable: DxfTable,
  drawingRelId: string | undefined,
  tableRelIds: readonly string[],
): XmlPart {
  const children: XmlElement[] = [
    buildSheetPrElement(sheet.printSettings),
    el("dimension", { ref: computeDimension(sheet) }),
  ];

  const colsElement = buildColsElement(sheet.columns);
  if (colsElement !== undefined) {
    children.push(colsElement);
  }

  children.push(buildSheetDataElement(sheet, sharedStrings, cellFormats));

  const mergeCellsElement = buildMergeCellsElement(sheet.cells);
  if (mergeCellsElement !== undefined) {
    children.push(mergeCellsElement);
  }

  children.push(
    ...buildConditionalFormattingElements(
      sheet.conditionalFormats ?? [],
      dxfTable,
    ),
  );

  const dataValidationsElement = buildDataValidationsElement(
    sheet.dataValidations ?? [],
  );
  if (dataValidationsElement !== undefined) {
    children.push(dataValidationsElement);
  }

  children.push(
    buildPrintOptionsElement(sheet.printSettings),
    buildPageMarginsElement(sheet.printSettings),
    buildPageSetupElement(sheet.printSettings),
  );

  const { rowBreaks, colBreaks } = buildBreaksElements(sheet.printSettings);
  if (rowBreaks !== undefined) {
    children.push(rowBreaks);
  }
  if (colBreaks !== undefined) {
    children.push(colBreaks);
  }

  if (drawingRelId !== undefined) {
    children.push(el("drawing", { "r:id": drawingRelId }));
  }

  if (tableRelIds.length > 0) {
    children.push(
      el(
        "tableParts",
        { count: String(tableRelIds.length) },
        tableRelIds.map((relId) => el("tablePart", { "r:id": relId })),
      ),
    );
  }

  const root = el("worksheet", { xmlns: SML_NS, "xmlns:r": REL_NS }, children);
  return xmlPart(root);
}

// --- entry point -----------------------------------------------------------------------------------------------

export interface BuildXlsxContentOptions {
  // A workbook's general defined names and Table/List objects -- the tree reader's own root-level facility (typed/document-tree.ts's readXlsx/typed/xlsx/definitions.ts), passed straight through by buildXlsxPackage since flattenTree itself drops the table on the way down (document-schema.js's own rule -- the flat ContentDocument structurally cannot carry it). A caller driving this flat entry point directly may also supply one.
  readonly definitions?: DefinitionsTable;
}

// One sheet's own worksheet-level extras: which relationships it needs (comments/drawing/tables), and the r:id each one lands on for the <drawing>/<tableParts> elements buildWorksheetPart writes inline.
interface SheetExtras {
  readonly relationships: WorksheetRelationship[];
  readonly drawingRelId: string | undefined;
  readonly tableRelIds: string[];
}

function tablePartName(tableId: number): string {
  return `xl/tables/table${tableId}.xml`;
}

export function buildXlsxPackageFromContent(
  document: ContentDocument,
  options?: BuildXlsxContentOptions,
): Package {
  if (document.kind !== "spreadsheet") {
    throw new Error(
      `buildXlsxPackageFromContent: expected a ContentDocument of kind "spreadsheet", got "${document.kind}"`,
    );
  }

  const sheets = document.sheets;
  const sharedStrings = new SharedStringTable();
  const cellFormats = new CellFormatTable();
  const dxfTable = new DxfTable();
  const drawingCounters = newDrawingCounters();

  // Table entries carry a globally unique, workbook-scoped id (CT_Table/@id) assigned once here in definitions order, then grouped by the sheet they belong to -- typed/xlsx/definitions.ts's own readTableEntries records exactly that `sheet` field for this reason.
  const tableEntries: readonly (TableEntry & { readonly id: number })[] =
    collectTableEntries(options?.definitions).map((entry, index) => ({
      ...entry,
      id: index + 1,
    }));
  const generalDefinedNameElements = buildGeneralDefinedNameElements(
    collectNamedRangeEntries(options?.definitions),
  );

  const commentedSheetIndices: number[] = [];
  const drawingSheetIndices: number[] = [];
  const chartPartNames: string[] = [];
  const tablePartNames: string[] = [];
  const usedImageFormats = new Set<"png" | "jpeg" | "gif">();
  const extraParts: Package["parts"] = {};
  const sheetExtras: SheetExtras[] = sheets.map((sheet, index) => {
    const relationships: WorksheetRelationship[] = [];
    let relCounter = 0;
    const nextRelId = (): string => {
      relCounter += 1;
      return `rId${relCounter}`;
    };

    if (sheetHasComments(sheet)) {
      commentedSheetIndices.push(index);
      relationships.push({
        id: nextRelId(),
        type: REL_THREADED_COMMENTS,
        target: `../threadedComments/threadedComment${index + 1}.xml`,
      });
    }

    let drawingRelId: string | undefined;
    const drawing = buildSheetDrawing(sheet, drawingCounters);
    if (drawing !== undefined) {
      drawingSheetIndices.push(index);
      chartPartNames.push(...drawing.chartPartNames);
      for (const format of drawing.usedImageFormats) {
        usedImageFormats.add(format);
      }
      Object.assign(extraParts, drawing.extraParts);
      extraParts[`xl/drawings/drawing${index + 1}.xml`] = xmlPart(
        drawing.drawingRoot,
      );
      extraParts[`xl/drawings/_rels/drawing${index + 1}.xml.rels`] = xmlPart(
        drawing.drawingRelsRoot,
      );
      drawingRelId = nextRelId();
      relationships.push({
        id: drawingRelId,
        type: REL_DRAWING,
        target: `../drawings/drawing${index + 1}.xml`,
      });
    }

    const tableRelIds: string[] = [];
    for (const table of tableEntries) {
      if (table.sheet !== sheet.name) {
        continue;
      }
      const partName = tablePartName(table.id);
      tablePartNames.push(partName);
      extraParts[partName] = xmlPart(buildTablePart(table, table.id));
      const relId = nextRelId();
      tableRelIds.push(relId);
      relationships.push({
        id: relId,
        type: REL_TABLE,
        target: `../tables/table${table.id}.xml`,
      });
    }

    return { relationships, drawingRelId, tableRelIds };
  });

  // Building every worksheet part first, before touching xl/sharedStrings.xml or xl/styles.xml, is load-bearing: buildCellElement interns every literal string value into `sharedStrings` and every non-General number format into `cellFormats` as a side effect while it walks each sheet's cells, buildConditionalFormattingElements interns every styled conditional-format rule into `dxfTable` the same way, and buildSharedStringsPart/buildStylesPart below must all see the FULLY populated tables.
  const worksheetParts = sheets.map((sheet, index) =>
    buildWorksheetPart(
      sheet,
      sharedStrings,
      cellFormats,
      dxfTable,
      sheetExtras[index]?.drawingRelId,
      sheetExtras[index]?.tableRelIds ?? [],
    ),
  );

  const parts: Package["parts"] = {
    "[Content_Types].xml": buildContentTypesPart(
      sheets.length,
      commentedSheetIndices,
      drawingSheetIndices,
      chartPartNames,
      tablePartNames,
      usedImageFormats,
    ),
    "_rels/.rels": buildPackageRelsPart(),
    "xl/workbook.xml": buildWorkbookPart(sheets, generalDefinedNameElements),
    "xl/_rels/workbook.xml.rels": buildWorkbookRelsPart(sheets.length),
    "xl/styles.xml": buildStylesPart(cellFormats, dxfTable),
    "xl/sharedStrings.xml": buildSharedStringsPart(sharedStrings),
    "docProps/core.xml": buildCorePropertiesPart(document.metadata),
    "docProps/app.xml": buildAppPropertiesPart(document.metadata),
    ...extraParts,
  };
  worksheetParts.forEach((part, index) => {
    parts[`xl/worksheets/sheet${index + 1}.xml`] = part;
  });
  for (const index of commentedSheetIndices) {
    const sheet = sheets[index];
    if (sheet === undefined) {
      continue;
    }
    parts[`xl/threadedComments/threadedComment${index + 1}.xml`] = xmlPart(
      buildThreadedCommentsRoot(sheet),
    );
  }
  sheets.forEach((_sheet, index) => {
    const relationships = sheetExtras[index]?.relationships ?? [];
    if (relationships.length > 0) {
      parts[`xl/worksheets/_rels/sheet${index + 1}.xml.rels`] =
        buildWorksheetRelsPart(relationships);
    }
  });

  return { parts };
}
