import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Package } from "../../model/package";
import type { XmlElement } from "../../model/node";
import { el, txt } from "../../xml/fragment";
import { bytesToBase64 } from "byte-codec";
import { parsePackage } from "../../package-io/read";
import { readOds, readOdsContent } from "./read";

// This suite reads real, unmodified LibreOffice 26.2-generated .ods fixtures (src/typed/ods/fixtures/*.ods, built via a headless UNO Basic macro driving the SAME UNO calls the Calc UI itself uses — Format > Columns > Width, Format > Rows > Height, Format > Print Areas, Format > Page Style's Sheet tab — never hand-edited afterwards) rather than programmatically reconstructing the expected XML shapes, mirroring readOdtContent's own established convention: this reader's own design brief is explicit that print-settings attribute names and the repeat-row/repeat-column mechanism must each be proven against genuine producer output, not just this package's own idea of what that output looks like. A handful of narrow scope-boundary/hazard-proof tests at the end use small, synthetic, hand-built packages instead (via el/txt), since a genuinely million-row repeat isn't something worth shipping as a binary fixture when the exact real repeat count is already established (typed/shared/a1.test.ts, citing a real LibreOffice-shipped .ots template).

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function loadFixture(name: string): Package {
  const bytes = new Uint8Array(readFileSync(join(FIXTURES_DIR, name)));
  return parsePackage(bytes);
}

describe("readOdsContent: anchored drawings (synthetic packages — the scope boundaries and group flattening real LibreOffice output does not exercise)", () => {
  // Only the PNG magic-byte signature matters to sniffImageFormat — the rest is arbitrary filler, matching typed/draw/shapes.test.ts's own convention.
  const PNG_SIGNATURE_BYTES: readonly number[] = Array.from(
    "\x89PNG\r\n\x1a\n",
    (c) => c.charCodeAt(0),
  );
  const pngBase64 = bytesToBase64(
    new Uint8Array([...PNG_SIGNATURE_BYTES, 0, 0, 0, 0]),
  );

  function imageFrame(attrs: Readonly<Record<string, string>>): XmlElement {
    return el("draw:frame", attrs, [
      el("draw:image", { "xlink:href": "Pictures/img.png" }),
    ]);
  }

  function drawingPackage(table: XmlElement): Package {
    return {
      parts: {
        "content.xml": {
          kind: "xml",
          nodes: [
            el("office:document-content", {}, [
              el("office:body", {}, [el("office:spreadsheet", {}, [table])]),
            ]),
          ],
        },
        "Pictures/img.png": { kind: "binary", base64: pngBase64 },
      },
    };
  }

  const frameBox = {
    "svg:x": "10pt",
    "svg:y": "20pt",
    "svg:width": "100pt",
    "svg:height": "50pt",
  };

  it("resolves the anchor cell from the running cursor, so a frame in a cell after a repeated run still reports its real column index", () => {
    const row = el("table:table-row", {}, [
      el("table:table-cell", { "table:number-columns-repeated": "5" }),
      el("table:table-cell", {}, [imageFrame(frameBox)]),
    ]);
    const table = el("table:table", { "table:name": "Sheet1" }, [
      el("table:table-row", { "table:number-rows-repeated": "3" }, []),
      row,
    ]);
    const { sheets } = readOdsContent(drawingPackage(table));
    expect(sheets[0]?.images[0]).toMatchObject({
      anchorRow: 3,
      anchorColumn: 5,
      offsetXPt: 10,
      offsetYPt: 20,
    });
  });

  it("walks through a draw:g group, composing the group's own draw:transform onto the frame exactly as walkDrawShapes does for a slide", () => {
    const group = el("draw:g", { "draw:transform": "translate(5pt 7pt)" }, [
      imageFrame(frameBox),
    ]);
    const table = el("table:table", { "table:name": "Sheet1" }, [
      el("table:table-row", {}, [el("table:table-cell", {}, [group])]),
    ]);
    const { sheets } = readOdsContent(drawingPackage(table));
    expect(sheets[0]?.images[0]).toMatchObject({
      anchorRow: 0,
      anchorColumn: 0,
      offsetXPt: 15,
      offsetYPt: 27,
    });
  });

  it("reads an embedded Writer document (a wordprocessing OLE object) through the shared dispatch, its sections intact — the ods->odt half of the symmetric embedding edge", () => {
    const objectFrame = el("draw:frame", frameBox, [
      el("draw:object", { "xlink:href": "./Object 1" }),
    ]);
    const table = el("table:table", { "table:name": "Sheet1" }, [
      el("table:table-row", {}, [el("table:table-cell", {}, [objectFrame])]),
    ]);
    const pkg = drawingPackage(table);
    pkg.parts["Object 1/content.xml"] = {
      kind: "xml",
      nodes: [
        el("office:document-content", {}, [
          el("office:body", {}, [
            el("office:text", {}, [el("text:p", {}, [txt("Embedded note.")])]),
          ]),
        ]),
      ],
    };
    const { sheets } = readOdsContent(pkg);
    const embedded = sheets[0]?.embeddedObjects?.[0];
    expect(embedded?.objectKind).toBe("wordprocessing");
    if (embedded?.document.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing ContentDocument");
    }
    expect(embedded.document.sections[0]?.blocks[0]).toMatchObject({
      kind: "paragraph",
      runs: [{ text: "Embedded note." }],
    });
  });

  it("skips a frame ContentSheet has nowhere to carry — a floating text box (no `shapes` array) and a bare vector primitive (no `vectors` array)", () => {
    const textBox = el("draw:frame", frameBox, [
      el("draw:text-box", {}, [el("text:p", {}, [txt("floating")])]),
    ]);
    const rect = el("draw:rect", frameBox);
    const table = el("table:table", { "table:name": "Sheet1" }, [
      el("table:table-row", {}, [el("table:table-cell", {}, [textBox, rect])]),
    ]);
    const { sheets } = readOdsContent(drawingPackage(table));
    expect(sheets[0]?.images).toEqual([]);
    expect(sheets[0]?.embeddedObjects).toBeUndefined();
  });

  it("skips a frame with no resolvable geometry at all, matching readDrawFrame's own documented inherited-positioning boundary", () => {
    const table = el("table:table", { "table:name": "Sheet1" }, [
      el("table:table-row", {}, [el("table:table-cell", {}, [imageFrame({})])]),
    ]);
    expect(readOdsContent(drawingPackage(table)).sheets[0]?.images).toEqual([]);
  });

  it("reads an anchored image from a cell that also has real content, without disturbing that cell's own value", () => {
    const cell = el("table:table-cell", { "office:value-type": "string" }, [
      el("text:p", {}, [txt("has a picture")]),
      imageFrame(frameBox),
    ]);
    const table = el("table:table", { "table:name": "Sheet1" }, [
      el("table:table-row", {}, [cell]),
    ]);
    const { sheets } = readOdsContent(drawingPackage(table));
    expect(sheets[0]?.cells[0]?.displayText).toBe("has a picture");
    expect(sheets[0]?.images[0]).toMatchObject({
      anchorRow: 0,
      anchorColumn: 0,
    });
  });
});

describe("readOdsContent: repeat-count hazards (synthetic packages — proving this reader never materializes a huge repeated run, real confirmed counts from typed/shared/a1.test.ts)", () => {
  // A real LibreOffice-shipped .ots template's own trailing empty rows carry table:number-rows-repeated="1016575" (confirmed in typed/shared/a1.test.ts, from /Applications/LibreOffice.app/Contents/Resources/template/common/wizard/styles/*.ots) — reused here verbatim rather than re-deriving a fresh huge fixture, since the real count is already established ground truth.
  const HUGE_ROW_REPEAT = 1016575;
  const HUGE_COLUMN_REPEAT = 1024; // a1.test.ts's own "real trailing-repeated-cell block" example.

  function buildHugeRepeatPackage(): Package {
    const headerRow = el("table:table-row", {}, [
      el("table:table-cell", { "office:value-type": "string" }, [
        el("text:p", {}, [txt("Header")]),
      ]),
    ]);
    const hugeEmptyRow = el(
      "table:table-row",
      { "table:number-rows-repeated": String(HUGE_ROW_REPEAT) },
      [
        el("table:table-cell", {
          "table:number-columns-repeated": String(HUGE_COLUMN_REPEAT),
        }),
      ],
    );
    const table = el("table:table", { "table:name": "Big" }, [
      el("table:table-column", {
        "table:number-columns-repeated": String(HUGE_COLUMN_REPEAT),
      }),
      headerRow,
      hugeEmptyRow,
    ]);
    return {
      parts: {
        "content.xml": {
          kind: "xml",
          nodes: [
            el("office:document-content", {}, [
              el("office:body", {}, [el("office:spreadsheet", {}, [table])]),
            ]),
          ],
        },
      },
    };
  }

  it("does not allocate one ContentSheetCell per repeated empty position: a >1,000,000-row repeat block yields exactly one real cell", () => {
    const { sheets } = readOdsContent(buildHugeRepeatPackage());
    expect(sheets[0]?.cells).toHaveLength(1);
    expect(sheets[0]?.cells[0]).toMatchObject({
      row: 0,
      column: 0,
      value: { kind: "string", value: "Header" },
      displayText: "Header",
    });
  });

  it("does not allocate one ContentSheetRow per repeated row: only the two real table:table-row XML elements are represented", () => {
    const { sheets } = readOdsContent(buildHugeRepeatPackage());
    expect(sheets[0]?.rows).toHaveLength(2);
    expect(sheets[0]?.rows[1]?.index).toBe(1); // the huge repeat block's own STARTING row index, not a materialized count.
  });

  it("does not allocate one ContentSheetColumn per repeated column: a 1024-column repeat block yields exactly one column entry", () => {
    const { sheets } = readOdsContent(buildHugeRepeatPackage());
    expect(sheets[0]?.columns).toHaveLength(1);
    expect(sheets[0]?.columns[0]?.index).toBe(0);
  });

  it("completes in well under a second, confirming no O(repeatCount) work happened at all", () => {
    const maxDurationMs = 1000;
    const start = performance.now();
    readOdsContent(buildHugeRepeatPackage());
    expect(performance.now() - start).toBeLessThan(maxDurationMs);
  });
});

describe("readOdsContent: error and fallback paths (synthetic packages — not something real LibreOffice output can exercise)", () => {
  it("reads an empty sheets array for a package with no content.xml at all", () => {
    const result = readOdsContent({ parts: {} });
    expect(result.sheets).toEqual([]);
    expect(result.metadata).toEqual({});
  });

  it("reads an empty sheets array for a package with no office:spreadsheet at all", () => {
    const pkg: Package = {
      parts: {
        "content.xml": {
          kind: "xml",
          nodes: [el("office:document-content", {}, [el("office:body")])],
        },
      },
    };
    expect(readOdsContent(pkg).sheets).toEqual([]);
  });

  it("skips a table:table with no table:name at all, rather than fabricating one", () => {
    const pkg: Package = {
      parts: {
        "content.xml": {
          kind: "xml",
          nodes: [
            el("office:document-content", {}, [
              el("office:body", {}, [
                el("office:spreadsheet", {}, [
                  el("table:table", {}, [el("table:table-row")]),
                ]),
              ]),
            ]),
          ],
        },
      },
    };
    expect(readOdsContent(pkg).sheets).toEqual([]);
  });

  it("reads a table:table with no rows/columns at all as a sheet with empty arrays, not a throw", () => {
    const pkg: Package = {
      parts: {
        "content.xml": {
          kind: "xml",
          nodes: [
            el("office:document-content", {}, [
              el("office:body", {}, [
                el("office:spreadsheet", {}, [
                  el("table:table", { "table:name": "Empty" }),
                ]),
              ]),
            ]),
          ],
        },
      },
    };
    const { sheets } = readOdsContent(pkg);
    expect(sheets).toHaveLength(1);
    expect(sheets[0]).toMatchObject({
      name: "Empty",
      cells: [],
      columns: [],
      rows: [],
    });
  });
});

// The ods residue rows (ExaDev/documents.js#769): recalculation semantics are not content, so table:calculation-settings and the non-content parts quarantine at the package tier.
describe("readOdsContent: residue rows", () => {
  function residueSpreadsheetPackage(
    children: readonly XmlElement[],
    extraParts: Record<string, Package["parts"][string]> = {},
  ): Package {
    return {
      parts: {
        "content.xml": {
          kind: "xml",
          nodes: [
            el("office:document-content", {}, [
              el("office:body", {}, [el("office:spreadsheet", {}, children)]),
            ]),
          ],
        },
        ...extraParts,
      },
    };
  }

  it("quarantines table:calculation-settings at the package tier, keyed calculation-settings", () => {
    const pkg = residueSpreadsheetPackage([
      el(
        "table:calculation-settings",
        {
          "table:case-sensitive": "false",
          "table:automatic-find-labels": "false",
        },
        [
          el("table:null-date", {
            "table:value-type": "date",
            "table:date-value": "1899-12-30",
          }),
        ],
      ),
      el("table:table", { "table:name": "Sheet1" }, [el("table:table-row")]),
    ]);
    const { source } = readOdsContent(pkg);
    expect(source?.["calculation-settings"]?.format).toBe("ods");
    expect(source?.["calculation-settings"]?.xml).toContain(
      "<table:calculation-settings",
    );
    expect(source?.["calculation-settings"]?.xml).toContain("<table:null-date");
  });

  it("quarantines a non-content XML part at the package tier keyed by its part path, spliced onto readOds's root", () => {
    const pkg = residueSpreadsheetPackage(
      [el("table:table", { "table:name": "Sheet1" }, [el("table:table-row")])],
      {
        "settings.xml": {
          kind: "xml",
          nodes: [el("office:document-settings")],
        },
      },
    );
    const { source } = readOdsContent(pkg);
    expect(source?.["settings.xml"]?.format).toBe("ods");
    expect(readOds(pkg).source?.["settings.xml"]?.xml).toContain(
      "<office:document-settings",
    );
  });

  it("quarantines the REAL kitchen-sink fixture's own calculation-settings, settings.xml, and manifest.rdf", () => {
    const { source } = readOdsContent(loadFixture("kitchen-sink.ods"));
    expect(Object.keys(source ?? {}).sort()).toEqual([
      "calculation-settings",
      "manifest.rdf",
      "settings.xml",
    ]);
    expect(source?.["calculation-settings"]?.xml).toContain(
      "table:calculation-settings",
    );
  });

  it("never quarantines an embedded sub-document's own parts — sheet-formula.ods's Math object rides the semantic channel alone", () => {
    const { source } = readOdsContent(loadFixture("sheet-formula.ods"));
    expect(
      Object.keys(source ?? {}).every((key) => !key.startsWith("Object ")),
    ).toBe(true);
  });

  it("quarantines a vendor-extension element at the spreadsheet level, keyed by its own tag", () => {
    const pkg = residueSpreadsheetPackage([
      el("table:table", { "table:name": "Sheet1" }, [el("table:table-row")]),
      el("loext:some-extension", {}, [el("loext:child")]),
    ]);
    const { source } = readOdsContent(pkg);
    expect(source?.["loext:some-extension"]?.format).toBe("ods");
    expect(source?.["loext:some-extension"]?.xml).toContain("<loext:child");
  });

  // Real LibreOffice Calc output writes calcext:conditional-formats as the last child of each table:table, never as a child of office:spreadsheet — the placement the conditional-format.ods fixture below pins.
  it("quarantines a vendor-extension element inside a table:table, keyed by its own tag, concatenating same-tag occurrences across tables", () => {
    const pkg = residueSpreadsheetPackage([
      el("table:table", { "table:name": "Sheet1" }, [
        el("table:table-row"),
        el("calcext:conditional-formats", {}, [
          el("calcext:conditional-format", {
            "calcext:target-range-address": "Sheet1.A1:Sheet1.B2",
          }),
        ]),
      ]),
      el("table:table", { "table:name": "Sheet2" }, [
        el("table:table-row"),
        el("calcext:conditional-formats", {}, [
          el("calcext:conditional-format", {
            "calcext:target-range-address": "Sheet2.A1:Sheet2.A1",
          }),
        ]),
      ]),
    ]);
    const { source } = readOdsContent(pkg);
    expect(source?.["calcext:conditional-formats"]?.format).toBe("ods");
    expect(source?.["calcext:conditional-formats"]?.xml).toContain(
      "Sheet1.A1:Sheet1.B2",
    );
    expect(source?.["calcext:conditional-formats"]?.xml).toContain(
      "Sheet2.A1:Sheet2.A1",
    );
  });
});

describe("readOdsContent: named expressions (synthetic packages — the declarations real fixture output leaves empty)", () => {
  function namedExpressionsPackage(named: XmlElement): Package {
    return {
      parts: {
        "content.xml": {
          kind: "xml",
          nodes: [
            el("office:document-content", {}, [
              el("office:body", {}, [
                el("office:spreadsheet", {}, [
                  el("table:named-expressions", {}, [named]),
                ]),
              ]),
            ]),
          ],
        },
      },
    };
  }

  it("reads a table:named-range into a definitions entry keyed by its name, carrying its range and base cell verbatim", () => {
    const pkg = namedExpressionsPackage(
      el("table:named-range", {
        "table:name": "TotalSales",
        "table:base-cell-address": "$'Q1 Sheet'.$A$1",
        "table:cell-range-address": "$'Q1 Sheet'.$B$2:.$D$6",
      }),
    );
    const document = readOdsContent(pkg);
    expect(document.definitions).toEqual({
      "named-range:TotalSales": {
        kind: "namedRange",
        name: "TotalSales",
        cellRangeAddress: "$'Q1 Sheet'.$B$2:.$D$6",
        baseCellAddress: "$'Q1 Sheet'.$A$1",
      },
    });
  });

  it("reads a table:named-expression into its own entry kind, carrying the expression verbatim", () => {
    const pkg = namedExpressionsPackage(
      el("table:named-expression", {
        "table:name": "Growth",
        "table:base-cell-address": "$Sheet2.$A$1",
        "table:expression": "of:=[.B2]/[.B1]",
      }),
    );
    const document = readOdsContent(pkg);
    expect(document.definitions).toEqual({
      "named-expression:Growth": {
        kind: "namedExpression",
        name: "Growth",
        expression: "of:=[.B2]/[.B1]",
        baseCellAddress: "$Sheet2.$A$1",
      },
    });
  });

  it("leaves definitions absent for the empty table:named-expressions element every real fixture carries", () => {
    const pkg: Package = {
      parts: {
        "content.xml": {
          kind: "xml",
          nodes: [
            el("office:document-content", {}, [
              el("office:body", {}, [
                el("office:spreadsheet", {}, [el("table:named-expressions")]),
              ]),
            ]),
          ],
        },
      },
    };
    expect(readOdsContent(pkg).definitions).toBeUndefined();
  });

  it("carries the definitions table onto the assembled package root", () => {
    const pkg = namedExpressionsPackage(
      el("table:named-range", {
        "table:name": "R",
        "table:cell-range-address": ".A1",
      }),
    );
    expect(readOds(pkg).definitions).toEqual(readOdsContent(pkg).definitions);
  });
});
