import type {
  ContentDefinedName,
  ContentDocument,
  ContentSheet,
  DefinitionsTable,
  LayoutMetadata,
} from "document-schema.js";
import type { Package, XmlPart } from "../../model/package";
import type { XmlElement, XmlNode } from "../../model/node";
import { el, txt } from "../../xml/fragment";
import { encodeXmlText } from "../../xml/entities";
import {
  buildPrintAreaValue,
  buildPrintTitlesValue,
  XLNM_PRINT_AREA,
  XLNM_PRINT_TITLES,
} from "./defined-names";
import {} from "./number-format";
import {} from "./serial";
import { SharedStringTable } from "./shared-strings";
import {
  CellFormatTable,
  DEFAULT_FONT_INDEX,
  GENERAL_NUM_FMT_ID,
  RESERVED_BORDER_INDICES,
  RESERVED_FILL_INDICES,
  assertNeverDeclaredFillKind,
} from "./styles";
import {} from "./units";
import { writeXmlBool } from "./util";
import { DxfTable } from "./conditional-format-write";
import { buildThreadedCommentsRoot, sheetHasComments } from "./comments-write";
import {
  buildNameDefinedNameElements,
  buildTablePart,
  collectTableEntries,
  type TableEntry,
} from "./definitions-write";
import {
  buildSheetDrawing,
  CT_CHART,
  CT_DRAWING,
  newDrawingCounters,
} from "./drawings-write";
import type { WorksheetRelationship } from "./build-worksheet";
import { buildWorksheetPart, buildWorksheetRelsPart } from "./build-worksheet";

// ContentDocument (kind: 'spreadsheet') -> Package: the first genuinely NEW xlsx package this ecosystem writes from scratch, rather than decoding/re-encoding an existing one — every part below is constructed directly via xml/fragment.ts's el/txt, matching typed/xlsx/content.ts's own readXlsxContent as its read-side inverse: writing everything that reader reads, through the same number-format vocabulary that reader classifies (see renderCellValue and typed/xlsx/number-format.ts's own write-side section), and honestly re-approximating the one lossy conversion left on the way in (column-width characters). ContentSheetCell.comment now survives a round trip too, via the threaded-comments part comments-write.ts builds (see buildWorksheetPart's own note below). The reader's own drawing rows — chart graphic frames (embeddedObjects) and pictures (images), typed/xlsx/drawings.ts — now have a real write side too (ExaDev/documents.js#973, typed/xlsx/drawings-write.ts): every image and chart embedded object a sheet carries writes back out as a real xdr:oneCellAnchor in a genuine xl/drawings/drawingN.xml, plus xl/media/imageN.<ext> or xl/charts/chartN.xml as appropriate. The workbook's own defined names now ride the ContentDocument's names field both ways (typed/xlsx/defined-names.ts's readWorkbookNames, definitions-write.ts's buildNameDefinedNameElements), and its table/List objects still ride the tree-only definitions table (typed/xlsx/definitions.ts on the read side, the optional `definitions` passed in BuildXlsxContentOptions on the write side) — flattenTree cannot carry that table (it is a tree-only facility, document-schema.js's own rule), so buildXlsxPackage (typed/document-tree.ts) threads it through as this separate option rather than through the flattened ContentDocument. See typed/xlsx/content.test.ts and typed/xlsx/build.test.ts for the real-LibreOffice round-trip verification this pairing is built and tested against.
//
// This is the flat, content-level half of the xlsx write pair: buildXlsxPackage (typed/document-tree.ts) is the primary name, flattening a tree-form DocumentTree (styles-table refs materialised away) and handing the result straight to this function.

export const SML_NS =
  "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
export const REL_NS =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
export const PKG_RELS_NS =
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
// Matches typed/xlsx/comments.ts's own REL_THREADED_COMMENTS exactly — the read side already reads whatever this writer emits under this relationship type, so the two must stay identical.
const REL_THREADED_COMMENTS =
  "http://schemas.microsoft.com/office/2017/10/relationships/threadedComment";
// Matches typed/xlsx/drawings.ts's own DRAWING_REL_SUFFIX and typed/xlsx/definitions.ts's own TABLE_REL_SUFFIX — the read side resolves a worksheet's drawing/table parts by relationship TYPE alone, never by r:id, so these must stay identical to what those readers match against.
const REL_DRAWING = `${REL_NS}/drawing`;
const REL_TABLE = `${REL_NS}/table`;

// 0-based indices of the last column (XFD, the 16384th) and the last row (the 1,048,576th) — the current OOXML worksheet size limits, used as rowBreaks/colBreaks' own <brk max="..."> extent (the full width/height of the sheet the break spans), per ECMA-376 Part 1 SS18.3.1.2's own min/max attribute semantics documented in print-settings.ts's readManualBreaks.
export const MAX_COLUMN_INDEX = 16383;
export const MAX_ROW_INDEX = 1048575;

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

export function xmlPart(root: XmlElement): XmlPart {
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

// --- xl/workbook.xml (sheets list + the document's own names + sheet-scoped Print_Area/Print_Titles defined names) ---

// The (name, localSheetId) identity of one emitted definedName, the key the two emission passes reconcile against: a workbook never carries two definedNames of the same name and scope, so a derived print name whose (name, scope) the names array already carries verbatim is a second spelling of the one fact, derived only when the array does not carry it. localSheetId is typed as a plain number, never undefined, because both call sites below only ever look up a sheet-scoped print name's own (numeric) sheet index — an unscoped name's key (the `@` with nothing after it, matching definitions-write.ts's own buildNameDefinedNameElements, which populates carriedNames) is added there but never looked up through this function, so an undefined branch here would have no caller to observe it.
function definedNameKey(name: string, localSheetId: number): string {
  return `${name}@${localSheetId}`;
}

function buildDefinedNameElements(
  sheets: readonly ContentSheet[],
  carriedNames: ReadonlySet<string>,
): XmlElement[] {
  const elements: XmlElement[] = [];
  sheets.forEach((sheet, sheetIndex) => {
    const { printRange, repeatRows, repeatColumns } = sheet.printSettings;
    if (
      printRange !== undefined &&
      !carriedNames.has(definedNameKey(XLNM_PRINT_AREA, sheetIndex))
    ) {
      const value = buildPrintAreaValue(sheet.name, printRange);
      elements.push(
        el(
          "definedName",
          { name: XLNM_PRINT_AREA, localSheetId: String(sheetIndex) },
          [txt(encodeXmlText(value))],
        ),
      );
    }
    // No repeatRows/repeatColumns presence guard ahead of this call: buildPrintTitlesValue itself returns undefined when neither is present, and the value check below skips that, so a separate presence spelling stated the same fact twice.
    if (!carriedNames.has(definedNameKey(XLNM_PRINT_TITLES, sheetIndex))) {
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
  names: readonly ContentDefinedName[],
): XmlPart {
  const sheetElements = sheets.map((sheet, index) =>
    el("sheet", {
      name: encodeXmlText(sheet.name),
      sheetId: String(index + 1),
      "r:id": worksheetRelId(index),
    }),
  );
  const children: XmlElement[] = [el("sheets", {}, sheetElements)];
  // The document's own names array writes back VERBATIM and in its own order — the file's own definedName order is the only order a same-format round trip can hope to reproduce, and the array's refersTo (a multi-area print range, a quoted sheet name) is the higher-fidelity spelling of exactly the two _xlnm print names a structured printRange/repeatRows can restate. The print-settings derivation then fills in only what the array does not carry: a hand-built document stating a structured printRange with no matching names entry still gets its reserved definedName.
  const carriedNames = new Set<string>();
  const nameElements = buildNameDefinedNameElements(names, carriedNames);
  const definedNameElements = [
    ...nameElements,
    ...buildDefinedNameElements(sheets, carriedNames),
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
    // xml:space="preserve" unconditionally — confirmed as real producers' own convention (typed/xlsx/content.test.ts's own kitchen-sink fixture writes it on every single <t>, regardless of whether that particular string actually has significant leading/trailing whitespace), simpler and always-safe to match rather than conditionally detecting it per string.
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

// <fonts> and the two reserved <fills> entries (index 0 "none", index 1 Excel's mandatory gray125) plus the empty reserved <borders> entry (index 0) are fixed scaffolding, confirmed against multiple independent references as the source of Excel's "we found a problem with some content" repair prompt when a hand-rolled writer omits them. On top of that scaffolding this writer now emits the real per-cell fonts, real solid fills, and real per-edge borders the cells themselves carried, interned by CellFormatTable alongside the number formats.
//
// The variable parts come straight from the CellFormatTable the worksheets filled: one <numFmt> per custom code interned (and NO <numFmts> element at all when nothing was, which is what keeps a workbook of ordinary numbers and strings byte-identical to what this writer produced before number formats existed), one <font> per distinct cell font (the DEFAULT_FONT Calibri-11 entry always at index 0, one further entry per font that genuinely differs), one <fill> per distinct solid background, one <border> per distinct edge set, and one <xf> per cell-format index — index 0 always being the General + default-font + no-decoration default. <dxfs> is the same story for conditionalFormatting rule styling: one <dxf> per DxfTable.intern call the worksheets made (also NO <dxfs> element at all when a workbook has no styled conditional-format rule), populated by the very same per-sheet build pass, which is why buildXlsxPackageFromContent's own worksheets-before-styles ordering note below applies to dxfTable exactly as it already does to cellFormats.
//
// CT_Stylesheet's own required child element ORDER (ECMA-376 Part 1 SS18.8.39): numFmts?, fonts?, fills?, borders?, cellStyleXfs?, cellXfs?, cellStyles?, dxfs?, ... — numFmts FIRST, before the fonts element that used to lead this part, and dxfs right after cellStyles (confirmed against real-producer-validation-and-cellis.xlsx's own styles.xml, which places its <dxfs> there, immediately before its <colors> element this writer does not emit).
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
        // Excel's solid-fill convention: the visible cell colour is the pattern's fgColor, with bgColor indexed="64" (the documented "no separate background" sentinel) — the exact inverse of readFillBackground, which reads fgColor as the solid-fill colour.
        return el("fill", {}, [
          el("patternFill", { patternType: "solid" }, [
            el("fgColor", { rgb: `FF${fill.rgb}` }),
            el("bgColor", { indexed: "64" }),
          ]),
        ]);
      }
      case "pattern": {
        // A genuine two-colour pattern fill (ExaDev/documents.js#951): fgColor is the colour the pattern's strokes are drawn in, bgColor the colour its gaps show through — each emitted only when the ContentCellFill actually stated it, left absent (Excel's own "automatic" default) otherwise.
        const patternChildren: XmlElement[] = [];
        if (fill.fgRgb !== undefined) {
          patternChildren.push(el("fgColor", { rgb: `FF${fill.fgRgb}` }));
        }
        if (fill.bgRgb !== undefined) {
          patternChildren.push(el("bgColor", { rgb: `FF${fill.bgRgb}` }));
        }
        return el("fill", {}, [
          el("patternFill", { patternType: fill.patternType }, patternChildren),
        ]);
      }
    }
    return assertNeverDeclaredFillKind(fill);
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

  const fontElements = cellFormats.fontDeclarations().map((font) => {
    const fontChildren: XmlElement[] = [];
    if (font.bold === true) {
      fontChildren.push(el("b"));
    }
    if (font.italic === true) {
      fontChildren.push(el("i"));
    }
    if (font.strike === true) {
      fontChildren.push(el("strike"));
    }
    if (font.underline === true) {
      fontChildren.push(el("u", { val: "single" }));
    }
    if (font.colorRgb !== undefined) {
      fontChildren.push(el("color", { rgb: `FF${font.colorRgb}` }));
    }
    fontChildren.push(el("sz", { val: font.sz }));
    fontChildren.push(el("name", { val: encodeXmlText(font.name) }));
    return el("font", {}, fontChildren);
  });

  children.push(
    el("fonts", { count: String(fontElements.length) }, fontElements),
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
      fontId: String(record.fontId),
      fillId: String(record.fillId),
      borderId: String(record.borderId),
      xfId: "0",
    };
    if (record.numFmtId !== GENERAL_NUM_FMT_ID) {
      // CT_Xf/@applyNumberFormat tells a consumer to honour this xf's OWN numFmtId rather than the one it would otherwise inherit from the cell style it is based on (xfId). Real producers differ here — Excel writes it on every formatted xf, LibreOffice omits it entirely and relies on numFmtId alone (see this directory's own kitchen-sink fixture, whose six formatted xfs carry no applyNumberFormat at all) — so this writer emits the explicit form, which cannot be misread by either: LibreOffice 26.2 renders every format below correctly with it present (verified), and Excel's own inheritance rule makes it the unambiguous spelling.
      attrs.applyNumberFormat = writeXmlBool(true);
    }
    // Each apply* flag mirrors applyNumberFormat: it tells a consumer to honour this xf's OWN fontId/fillId/borderId/alignment rather than the one inherited from the cell style it is based on. Set next to the id that drives it so what triggers the flag stays local to the line.
    if (record.fontId !== DEFAULT_FONT_INDEX) {
      attrs.applyFont = writeXmlBool(true);
    }
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

// --- entry point -----------------------------------------------------------------------------------------------

export interface BuildXlsxContentOptions {
  // A workbook's Table/List objects — the tree reader's own root-level facility (typed/document-tree.ts's readXlsx/typed/xlsx/definitions.ts), passed straight through by buildXlsxPackage since flattenTree itself drops the table on the way down (document-schema.js's own rule — the flat ContentDocument structurally cannot carry it). A caller driving this flat entry point directly may also supply one. Defined names are NOT this option's concern: they ride the ContentDocument's own names field both ways, so supplying them here is no longer possible.
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

  // Table entries carry a globally unique, workbook-scoped id (CT_Table/@id) assigned once here in definitions order, then grouped by the sheet they belong to — typed/xlsx/definitions.ts's own readTableEntries records exactly that `sheet` field for this reason.
  const tableEntries: readonly (TableEntry & { readonly id: number })[] =
    collectTableEntries(options?.definitions).map((entry, index) => ({
      ...entry,
      id: index + 1,
    }));

  const commentedSheetIndices: number[] = [];
  const drawingSheetIndices: number[] = [];
  const chartPartNames: string[] = [];
  const tablePartNames: string[] = [];
  const usedImageFormats = new Set<"png" | "jpeg" | "gif">();
  let extraParts: Package["parts"] = {};
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
      extraParts = { ...extraParts, ...drawing.extraParts };
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
  // No optional chain or ?? fallback on the extras lookup: sheetExtras is index-aligned with the very sheets this map walks (both derive from the one sheets array), so the lookup always resolves and the fallbacks were dead spellings — the non-null assertion is the same index-invariant spelling parseFlow's own stack top uses.
  const worksheetParts = sheets.map((sheet, index) => {
    const extras = sheetExtras[index]!;
    return buildWorksheetPart(
      sheet,
      sharedStrings,
      cellFormats,
      dxfTable,
      extras.drawingRelId,
      extras.tableRelIds,
    );
  });

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
    "xl/workbook.xml": buildWorkbookPart(sheets, document.names ?? []),
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
