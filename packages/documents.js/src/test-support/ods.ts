import type { Package, XmlElement } from "odf.js";
import {
  bytesToBase64,
  decodePackage,
  el,
  encodePackage,
  ODF_MEDIA_TYPES,
  txt,
} from "odf.js";

// Never imported by src/index.ts and never reaches dist/. Predates edit/ods/* (this package's own live-view ods editor, added later -- see createOds/OdsEditor there): this fixture is still hand-authored ODF XML assembled directly via odf.js's own el/txt fragment builders and serialized via odf.js's own encodePackage, kept exactly as-is rather than rebuilt through the editor, since its whole point is an INDEPENDENT construction path for readOdsContent's own tests -- building the fixture through the very editor that createOds/OdsSheet/OdsCell also drive would make a read-side regression and a write-side regression capable of silently cancelling each other out. Shape choices exercise the same real-shape ground truth odf.js's own src/typed/ods/read.test.ts fixture already verified against genuine LibreOffice 26.2 output: explicit column widths, a hidden column, mixed office:value-type cells (string/float/boolean), a merged cell, and print settings (page size, gridlines/headers, page order) resolved through table:table -> style:style[family="table"] -> style:master-page-name -> style:master-page -> style:page-layout.

function enc(s: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(s);
}

function stylesXmlPart(): Package["parts"][string] {
  return {
    kind: "xml",
    nodes: [
      el("office:document-styles", {}, [
        el("office:automatic-styles", {}, [
          el("style:page-layout", { "style:name": "PM1" }, [
            el("style:page-layout-properties", {
              "fo:page-width": "400pt",
              "fo:page-height": "300pt",
              "style:print": "grid headers",
              "style:print-page-order": "ttb",
            }),
          ]),
        ]),
        el("office:master-styles", {}, [
          el("style:master-page", {
            "style:name": "Default",
            "style:page-layout-name": "PM1",
          }),
        ]),
      ]),
    ],
  };
}

// One sheet, "Data": column A (index 0, 3cm wide) and column B (index 1, hidden). A header row (string cells) then a data row mixing a string, a float, and a boolean, plus a merged 2x1 cell anchored at row 2 (0-based) demonstrating table:number-columns-spanned/table:covered-table-cell.
function buildFixturePackage(): Package {
  const columnA = el("table:table-column", { "table:style-name": "ColA" });
  const columnB = el("table:table-column", {
    "table:style-name": "ColB",
    "table:visibility": "collapse",
  });

  const headerRow = el("table:table-row", {}, [
    el("table:table-cell", { "office:value-type": "string" }, [
      el("text:p", {}, [txt("Name")]),
    ]),
    el("table:table-cell", { "office:value-type": "string" }, [
      el("text:p", {}, [txt("Amount")]),
    ]),
  ]);
  const dataRow = el("table:table-row", {}, [
    el("table:table-cell", { "office:value-type": "string" }, [
      el("text:p", {}, [txt("Acme")]),
    ]),
    el(
      "table:table-cell",
      { "office:value-type": "float", "office:value": "123.45" },
      [el("text:p", {}, [txt("123.45")])],
    ),
  ]);
  const mergedRow = el("table:table-row", {}, [
    el(
      "table:table-cell",
      { "table:number-columns-spanned": "2", "office:value-type": "string" },
      [el("text:p", {}, [txt("Merged")])],
    ),
    el("table:covered-table-cell"),
  ]);

  const table = el(
    "table:table",
    { "table:name": "Data", "table:style-name": "DataTable" },
    [columnA, columnB, headerRow, dataRow, mergedRow],
  );

  const contentXml: Package["parts"][string] = {
    kind: "xml",
    nodes: [
      el("office:document-content", {}, [
        el("office:automatic-styles", {}, [
          el(
            "style:style",
            { "style:name": "ColA", "style:family": "table-column" },
            [
              el("style:table-column-properties", {
                "style:column-width": "3cm",
              }),
            ],
          ),
          el(
            "style:style",
            { "style:name": "ColB", "style:family": "table-column" },
            [
              el("style:table-column-properties", {
                "style:column-width": "2cm",
              }),
            ],
          ),
          // table:table's own print-settings master page is a DIRECT attribute of its style:style[family="table"] element -- confirmed by odf.js's own readOdsContent (readPrintSettings calls attrValue(tableStyleElement, 'style:master-page-name') on the style element itself, never a nested style:table-properties child), unlike odp's own draw:master-page-name which sits directly on draw:page instead.
          el("style:style", {
            "style:name": "DataTable",
            "style:family": "table",
            "style:master-page-name": "Default",
          }),
        ]),
        el("office:body", {}, [el("office:spreadsheet", {}, [table])]),
      ]),
    ],
  };

  const metaXml: Package["parts"][string] = {
    kind: "xml",
    nodes: [
      el("office:document-meta", {}, [
        el("office:meta", {}, [el("dc:title", {}, [txt("My Spreadsheet")])]),
      ]),
    ],
  };

  return {
    parts: {
      mimetype: {
        kind: "binary",
        base64: bytesToBase64(enc(ODF_MEDIA_TYPES.ods)),
      },
      "content.xml": contentXml,
      "styles.xml": stylesXmlPart(),
      "meta.xml": metaXml,
    },
  };
}

// A minimal but structurally authentic ods package (mimetype part first and stored, a real office:document-content with a hidden column, mixed value-type cells, a merged cell, and print settings resolved from a real master-page/page-layout chain) -- enough to round-trip through decodePackage and readOdsContent without needing a real LibreOffice-exported binary.
export function minimalOdsBytes(): Uint8Array<ArrayBuffer> {
  return encodePackage(buildFixturePackage());
}

export function minimalOdsPackage(): Package {
  return decodePackage(minimalOdsBytes());
}

// A second, purpose-built fixture for pdfToOds's own round-trip test (src/convert/convert.test.ts): three real, fully visible columns (unlike minimalOdsBytes's own hidden column B, whose zero rendered width collapses two of its own gridline boundaries onto the same x position) and three rows, with gridlines AND headers explicitly enabled via style:print="grid headers" -- so odsToPdf actually draws the LayoutLine lattice reconstructSpreadsheet's own gridline-detection path (src/layout/reconstruct.ts) needs something real to find, rather than falling through to its text-clustering path. Every row carries an explicit style:row-height, unlike minimalOdsBytes's own rows: odf.js's own readRowLayout (typed/ods/read.ts) resolves a row with no table:style-name to heightPt 0 (a genuinely measured "no explicit height was ever set" reading, not a fallback guess), and src/layout/sheets.ts's own resolveAxis then uses that literal 0 rather than substituting DEFAULT_ROW_HEIGHT_PT -- an explicit ContentSheetRow entry always wins over the fallback, by design, the same way an explicitly hidden row does. A real LibreOffice-authored spreadsheet always writes an explicit row-height style, so this fixture does too.
function buildGridFixturePackage(): Package {
  function columnStyle(name: string): XmlElement {
    return el(
      "style:style",
      { "style:name": name, "style:family": "table-column" },
      [el("style:table-column-properties", { "style:column-width": "2cm" })],
    );
  }
  function stringCell(value: string): XmlElement {
    return el("table:table-cell", { "office:value-type": "string" }, [
      el("text:p", {}, [txt(value)]),
    ]);
  }

  const columns = [
    el("table:table-column", { "table:style-name": "GridColA" }),
    el("table:table-column", { "table:style-name": "GridColB" }),
    el("table:table-column", { "table:style-name": "GridColC" }),
  ];
  const rowAttrs = { "table:style-name": "GridRow" };
  const headerRow = el("table:table-row", rowAttrs, [
    stringCell("Alpha"),
    stringCell("Beta"),
    stringCell("Gamma"),
  ]);
  const dataRow1 = el("table:table-row", rowAttrs, [
    stringCell("One"),
    stringCell("Two"),
    stringCell("Three"),
  ]);
  const dataRow2 = el("table:table-row", rowAttrs, [
    stringCell("Four"),
    stringCell("Five"),
    stringCell("Six"),
  ]);
  const table = el(
    "table:table",
    { "table:name": "Grid", "table:style-name": "GridTable" },
    [...columns, headerRow, dataRow1, dataRow2],
  );

  const contentXml: Package["parts"][string] = {
    kind: "xml",
    nodes: [
      el("office:document-content", {}, [
        el("office:automatic-styles", {}, [
          columnStyle("GridColA"),
          columnStyle("GridColB"),
          columnStyle("GridColC"),
          el(
            "style:style",
            { "style:name": "GridRow", "style:family": "table-row" },
            [el("style:table-row-properties", { "style:row-height": "0.6cm" })],
          ),
          el("style:style", {
            "style:name": "GridTable",
            "style:family": "table",
            "style:master-page-name": "GridDefault",
          }),
        ]),
        el("office:body", {}, [el("office:spreadsheet", {}, [table])]),
      ]),
    ],
  };

  const stylesXml: Package["parts"][string] = {
    kind: "xml",
    nodes: [
      el("office:document-styles", {}, [
        el("office:automatic-styles", {}, [
          el("style:page-layout", { "style:name": "GridPM1" }, [
            el("style:page-layout-properties", {
              "fo:page-width": "400pt",
              "fo:page-height": "300pt",
              "style:print": "grid headers",
              "style:print-page-order": "ttb",
            }),
          ]),
        ]),
        el("office:master-styles", {}, [
          el("style:master-page", {
            "style:name": "GridDefault",
            "style:page-layout-name": "GridPM1",
          }),
        ]),
      ]),
    ],
  };

  const metaXml: Package["parts"][string] = {
    kind: "xml",
    nodes: [
      el("office:document-meta", {}, [
        el("office:meta", {}, [el("dc:title", {}, [txt("Grid Spreadsheet")])]),
      ]),
    ],
  };

  return {
    parts: {
      mimetype: {
        kind: "binary",
        base64: bytesToBase64(enc(ODF_MEDIA_TYPES.ods)),
      },
      "content.xml": contentXml,
      "styles.xml": stylesXml,
      "meta.xml": metaXml,
    },
  };
}

export function gridOdsBytes(): Uint8Array<ArrayBuffer> {
  return encodePackage(buildGridFixturePackage());
}

export function gridOdsPackage(): Package {
  return decodePackage(gridOdsBytes());
}

// A third fixture, purpose-built for the ods<->xlsx cross-format bridge's own round-trip tests (src/convert/bridges.test.ts): three explicitly-widthed columns (3cm/4cm/2cm) and every office:value-type ODS distinguishes on one row each -- string, float, boolean, percentage, currency, date, time -- plus a formula cell (table:formula carried verbatim, never evaluated by either side of the bridge) and a genuine 2-column merge. This is deliberately the richest of the three ods.ts fixtures: xlsx write support (ooxml.js's buildXlsxPackageFromContent) is new to the ecosystem, so the bridge's own tests need real, independently-authored ground truth to check against, not a fixture built through the very editor (createOds) the bridge composes with on its own write-back hop.
function buildRichFixturePackage(): Package {
  const columns = [
    el("table:table-column", { "table:style-name": "RichColA" }),
    el("table:table-column", { "table:style-name": "RichColB" }),
    el("table:table-column", { "table:style-name": "RichColC" }),
  ];
  const headerRow = el("table:table-row", {}, [
    el("table:table-cell", { "office:value-type": "string" }, [
      el("text:p", {}, [txt("Name")]),
    ]),
    el("table:table-cell", { "office:value-type": "string" }, [
      el("text:p", {}, [txt("Amount")]),
    ]),
    el("table:table-cell", { "office:value-type": "string" }, [
      el("text:p", {}, [txt("Active")]),
    ]),
  ]);
  const dataRow = el("table:table-row", {}, [
    el("table:table-cell", { "office:value-type": "string" }, [
      el("text:p", {}, [txt("Widget")]),
    ]),
    el(
      "table:table-cell",
      { "office:value-type": "float", "office:value": "42.5" },
      [el("text:p", {}, [txt("42.5")])],
    ),
    el(
      "table:table-cell",
      { "office:value-type": "boolean", "office:boolean-value": "true" },
      [el("text:p", {}, [txt("TRUE")])],
    ),
  ]);
  const typedRow = el("table:table-row", {}, [
    el(
      "table:table-cell",
      { "office:value-type": "percentage", "office:value": "0.15" },
      [el("text:p", {}, [txt("15%")])],
    ),
    el(
      "table:table-cell",
      {
        "office:value-type": "currency",
        "office:value": "9.99",
        "office:currency": "USD",
      },
      [el("text:p", {}, [txt("$9.99")])],
    ),
    el(
      "table:table-cell",
      { "office:value-type": "date", "office:date-value": "2026-01-15" },
      [el("text:p", {}, [txt("2026-01-15")])],
    ),
  ]);
  const timeAndFormulaRow = el("table:table-row", {}, [
    el(
      "table:table-cell",
      { "office:value-type": "time", "office:time-value": "PT14H30M00S" },
      [el("text:p", {}, [txt("14:30")])],
    ),
    el(
      "table:table-cell",
      {
        "office:value-type": "float",
        "office:value": "85",
        "table:formula": "of:=[.B2]*2",
      },
      [el("text:p", {}, [txt("85")])],
    ),
  ]);
  const mergedRow = el("table:table-row", {}, [
    el(
      "table:table-cell",
      { "table:number-columns-spanned": "2", "office:value-type": "string" },
      [el("text:p", {}, [txt("Merged Cell")])],
    ),
    el("table:covered-table-cell"),
  ]);

  const table = el(
    "table:table",
    { "table:name": "Rich", "table:style-name": "RichTable" },
    [...columns, headerRow, dataRow, typedRow, timeAndFormulaRow, mergedRow],
  );

  const contentXml: Package["parts"][string] = {
    kind: "xml",
    nodes: [
      el("office:document-content", {}, [
        el("office:automatic-styles", {}, [
          el(
            "style:style",
            { "style:name": "RichColA", "style:family": "table-column" },
            [
              el("style:table-column-properties", {
                "style:column-width": "3cm",
              }),
            ],
          ),
          el(
            "style:style",
            { "style:name": "RichColB", "style:family": "table-column" },
            [
              el("style:table-column-properties", {
                "style:column-width": "4cm",
              }),
            ],
          ),
          el(
            "style:style",
            { "style:name": "RichColC", "style:family": "table-column" },
            [
              el("style:table-column-properties", {
                "style:column-width": "2cm",
              }),
            ],
          ),
          el("style:style", {
            "style:name": "RichTable",
            "style:family": "table",
            "style:master-page-name": "RichDefault",
          }),
        ]),
        el("office:body", {}, [el("office:spreadsheet", {}, [table])]),
      ]),
    ],
  };

  const stylesXml: Package["parts"][string] = {
    kind: "xml",
    nodes: [
      el("office:document-styles", {}, [
        el("office:automatic-styles", {}, [
          el("style:page-layout", { "style:name": "RichPM1" }, [
            el("style:page-layout-properties", {
              "fo:page-width": "400pt",
              "fo:page-height": "300pt",
              "style:print": "grid headers",
              "style:print-page-order": "ttb",
            }),
          ]),
        ]),
        el("office:master-styles", {}, [
          el("style:master-page", {
            "style:name": "RichDefault",
            "style:page-layout-name": "RichPM1",
          }),
        ]),
      ]),
    ],
  };

  const metaXml: Package["parts"][string] = {
    kind: "xml",
    nodes: [
      el("office:document-meta", {}, [
        el("office:meta", {}, [el("dc:title", {}, [txt("Rich Spreadsheet")])]),
      ]),
    ],
  };

  return {
    parts: {
      mimetype: {
        kind: "binary",
        base64: bytesToBase64(enc(ODF_MEDIA_TYPES.ods)),
      },
      "content.xml": contentXml,
      "styles.xml": stylesXml,
      "meta.xml": metaXml,
    },
  };
}

export function richOdsBytes(): Uint8Array<ArrayBuffer> {
  return encodePackage(buildRichFixturePackage());
}

export function richOdsPackage(): Package {
  return decodePackage(richOdsBytes());
}

// A fourth fixture, purpose-built for the per-cell decoration wiring (ContentSheetCell's background/borders/alignment/verticalAlignment, all four added to document-schema.js's ContentSheetCellSchema and all four genuinely populated by odf.js's own readOdsContent -- see typed/shared/table.ts's readCellStyleDecoration). Deliberately hand-authored ODF XML rather than built through createOds/OdsCell, for the same independent-construction reason this module's other fixtures are: OdsCell has no decoration setter at all today, so the editor could not express this fixture even if it were the right tool.
//
// One sheet, "Decorated", one row of two cells: A1 carries a yellow fo:background-color, a full fo:border shorthand, an explicit fo:text-align="right" and style:vertical-align="top"; B1 carries only a red fo:border-bottom, with no background, no alignment, and no vertical alignment of its own -- so a single fixture exercises both the "declares everything" and the "declares exactly one edge and nothing else" branches of the layout wiring at once.
function buildDecoratedFixturePackage(): Package {
  const cellA = el(
    "table:table-cell",
    { "table:style-name": "DecoratedA", "office:value-type": "string" },
    [el("text:p", {}, [txt("A")])],
  );
  const cellB = el(
    "table:table-cell",
    { "table:style-name": "DecoratedB", "office:value-type": "string" },
    [el("text:p", {}, [txt("B")])],
  );
  const table = el(
    "table:table",
    { "table:name": "Decorated", "table:style-name": "DecoratedTable" },
    [
      el("table:table-column", { "table:style-name": "DecoratedCol" }),
      el("table:table-column", { "table:style-name": "DecoratedCol" }),
      el("table:table-row", { "table:style-name": "DecoratedRow" }, [
        cellA,
        cellB,
      ]),
    ],
  );

  const contentXml: Package["parts"][string] = {
    kind: "xml",
    nodes: [
      el("office:document-content", {}, [
        el("office:automatic-styles", {}, [
          el(
            "style:style",
            { "style:name": "DecoratedCol", "style:family": "table-column" },
            [
              el("style:table-column-properties", {
                "style:column-width": "3cm",
              }),
            ],
          ),
          el(
            "style:style",
            { "style:name": "DecoratedRow", "style:family": "table-row" },
            [el("style:table-row-properties", { "style:row-height": "1cm" })],
          ),
          el("style:style", {
            "style:name": "DecoratedTable",
            "style:family": "table",
            "style:master-page-name": "DecoratedDefault",
          }),
          el(
            "style:style",
            { "style:name": "DecoratedA", "style:family": "table-cell" },
            [
              el("style:table-cell-properties", {
                "fo:background-color": "#ffff00",
                "fo:border": "2pt solid #0000ff",
                "style:vertical-align": "top",
              }),
              el("style:paragraph-properties", { "fo:text-align": "right" }),
            ],
          ),
          el(
            "style:style",
            { "style:name": "DecoratedB", "style:family": "table-cell" },
            [
              el("style:table-cell-properties", {
                "fo:border-bottom": "1pt solid #ff0000",
              }),
            ],
          ),
        ]),
        el("office:body", {}, [el("office:spreadsheet", {}, [table])]),
      ]),
    ],
  };

  const stylesXml: Package["parts"][string] = {
    kind: "xml",
    nodes: [
      el("office:document-styles", {}, [
        el("office:automatic-styles", {}, [
          el("style:page-layout", { "style:name": "DecoratedPM1" }, [
            el("style:page-layout-properties", {
              "fo:page-width": "400pt",
              "fo:page-height": "300pt",
            }),
          ]),
        ]),
        el("office:master-styles", {}, [
          el("style:master-page", {
            "style:name": "DecoratedDefault",
            "style:page-layout-name": "DecoratedPM1",
          }),
        ]),
      ]),
    ],
  };

  return {
    parts: {
      mimetype: {
        kind: "binary",
        base64: bytesToBase64(enc(ODF_MEDIA_TYPES.ods)),
      },
      "content.xml": contentXml,
      "styles.xml": stylesXml,
    },
  };
}

export function decoratedOdsBytes(): Uint8Array<ArrayBuffer> {
  return encodePackage(buildDecoratedFixturePackage());
}

export function decoratedOdsPackage(): Package {
  return decodePackage(decoratedOdsBytes());
}
