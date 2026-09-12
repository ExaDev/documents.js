import { bytesToBase64 } from "documents.js";
import { el, encodePackage, type Package } from "odf.js";

// A hand-authored, minimal .odb: one report bound directly to one table (rpt:command-type "table", so no saved-query indirection is involved), whose sole detail-band field is bound to a column holding two CJK characters. Neither report styling nor any format in this family ever states an explicit font family on a report's own runs (documents.js's src/odb/report/render.ts: "nothing here sets a font"), so a real font substitution can never be exercised through odb_render_report -- but a WinAnsi CHARACTER substitution can, since it depends only on the rendered text, not on styling. This fixture exists to prove odb_render_report's pdf branch genuinely threads onSubstitution/fonts through to a real render, the same way convert.test.ts's Calibri run proves convert_document's identical wiring. Mirrors odf.js's own src/typed/odb/read.test.ts fixture-building convention (databaseContentPart/binaryPart) and documents.js's own src/odb/read.test.ts, rather than going through LibreOffice.
//
// META-INF/manifest.xml carries a genuine manifest:manifest root and nothing else: odf.js's readOdbInventory locates forms/queries/reports purely from content.xml's own db: registry, with no manifest involvement at all -- but documents.js's own readOdbTables (src/odb/read.ts) unconditionally calls odf.js's readManifest to check whether "database/script" is itself declared as an XML sub-document there, and readManifest throws outright if no manifest:manifest part exists at all. No manifest:file-entry is needed for that check to pass, though: an entry it finds NOTHING for is treated identically to "not classified as XML", which is the correct, honest answer here regardless.

export const CHAR_SUB_REPORT_NAME = "CharSubReport";

// The root wrapper element's own tag -- read by nothing: odf.js's readOdbInventory locates office:database by walking rootElement(nodes)'s CHILDREN looking for "office:body", never checking the root's own tag first. Still named "office:document-content" (the genuine ODF wrapper tag, matching every other odf.js typed content part) rather than left arbitrary, since this fixture's own stated purpose is producing genuinely representative package shapes -- see this constant's own direct test in odb-char-substitution-fixture.test.ts.
const CONTENT_ROOT_TAG = "office:document-content";

// odf.js's readManifest requires this exact value to be present (any non-undefined string satisfies its own "is manifest:version there at all" check), never a specific version number -- kept as the real OASIS ODF 1.3 manifest version rather than an arbitrary placeholder for the same representative-shape reason as CONTENT_ROOT_TAG above, and checked directly in odb-char-substitution-fixture.test.ts.
const MANIFEST_VERSION = "1.3";

function databaseContentPart(databaseChildren: ReturnType<typeof el>[]) {
  return {
    kind: "xml" as const,
    nodes: [
      el(CONTENT_ROOT_TAG, {}, [
        el("office:body", {}, [el("office:database", {}, databaseChildren)]),
      ]),
    ],
  };
}

// No manifest:file-entry children at all -- see this file's own top-of-file note on why documents.js's readOdbTables only needs a genuine manifest:manifest root to exist, never a listing of every part.
function manifestPart() {
  return {
    kind: "xml" as const,
    nodes: [
      el("manifest:manifest", { "manifest:version": MANIFEST_VERSION }, []),
    ],
  };
}

function binaryPart(text: string) {
  return {
    kind: "binary" as const,
    base64: bytesToBase64(new TextEncoder().encode(text)),
  };
}

// A single table, T(A INTEGER, B VARCHAR(20)), one row whose B column is two CJK characters neither standard-14 PDF font can represent directly.
const HSQLDB_SCRIPT = [
  "CREATE MEMORY TABLE T(A INTEGER,B VARCHAR(20))",
  "INSERT INTO T VALUES(1,'中文')",
].join("\n");

// office:report/@rpt:command="T" + @rpt:command-type="table" resolves straight to `SELECT * FROM "T"` (src/odb/report/source.ts's own table-command branch) -- one rpt:detail band, one bound field control (field:[B]) printing column B verbatim.
const REPORT_CONTENT = {
  kind: "xml" as const,
  nodes: [
    el("office:document-content", {}, [
      el("office:body", {}, [
        el(
          "office:report",
          { "rpt:command": "T", "rpt:command-type": "table" },
          [
            el("rpt:detail", {}, [
              el("table:table", { "table:name": "Detail" }, [
                el("table:table-row", {}, [
                  el("table:table-cell", {}, [
                    el("text:p", {}, [
                      el("rpt:formatted-text", { "rpt:formula": "field:[B]" }, [
                        el("rpt:report-element", {}, [
                          el("rpt:report-component", {
                            "draw:name": "Formatted field",
                          }),
                        ]),
                      ]),
                    ]),
                  ]),
                ]),
              ]),
            ]),
          ],
        ),
      ]),
    ]),
  ],
};

function buildPackage(): Package {
  return {
    parts: {
      "content.xml": databaseContentPart([
        el("db:data-source", {}, [
          el("db:connection-data", {}, [
            el("db:connection-resource", {
              "xlink:href": "sdbc:embedded:hsqldb",
              "xlink:type": "simple",
            }),
          ]),
        ]),
        el("db:reports", {}, [
          el("db:component", {
            "db:name": CHAR_SUB_REPORT_NAME,
            "xlink:href": "reports/Obj1",
          }),
        ]),
      ]),
      "database/script": binaryPart(HSQLDB_SCRIPT),
      "reports/Obj1/content.xml": REPORT_CONTENT,
      "META-INF/manifest.xml": manifestPart(),
    },
  };
}

export function charSubstitutionOdbBytes(): Uint8Array<ArrayBuffer> {
  return encodePackage(buildPackage());
}
