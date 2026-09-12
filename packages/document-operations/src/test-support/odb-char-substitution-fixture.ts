import { bytesToBase64 } from "documents.js";
import { el, encodePackage, type Package } from "odf.js";

// A hand-authored, minimal .odb: one report bound directly to one table (rpt:command-type "table", so no saved-query indirection is involved), whose sole detail-band field is bound to a column holding two CJK characters. Neither report styling nor any format in this family ever states an explicit font family on a report's own runs (documents.js's src/odb/report/render.ts: "nothing here sets a font"), so a real font substitution can never be exercised through odb_render_report -- but a WinAnsi CHARACTER substitution can, since it depends only on the rendered text, not on styling. This fixture exists to prove odb_render_report's pdf branch genuinely threads onSubstitution/onFontSubstitution/fonts through to a real render, the same way convert.test.ts's Calibri run proves convert_document's identical wiring. Mirrors odf.js's own src/typed/odb/read.test.ts fixture-building convention (databaseContentPart/manifestPart/binaryPart) and documents.js's own src/odb/read.test.ts, rather than going through LibreOffice.

export const CHAR_SUB_REPORT_NAME = "CharSubReport";

function databaseContentPart(databaseChildren: ReturnType<typeof el>[]) {
  return {
    kind: "xml" as const,
    nodes: [
      el("office:document-content", {}, [
        el("office:body", {}, [el("office:database", {}, databaseChildren)]),
      ]),
    ],
  };
}

function manifestPart(
  entries: readonly { readonly fullPath: string; readonly mediaType: string }[],
) {
  const fileEntries = entries.map((entry) =>
    el("manifest:file-entry", {
      "manifest:full-path": entry.fullPath,
      "manifest:media-type": entry.mediaType,
    }),
  );
  return {
    kind: "xml" as const,
    nodes: [
      el("manifest:manifest", { "manifest:version": "1.3" }, fileEntries),
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
      "META-INF/manifest.xml": manifestPart([
        { fullPath: "/", mediaType: "application/vnd.oasis.opendocument.base" },
        { fullPath: "content.xml", mediaType: "text/xml" },
        { fullPath: "database/script", mediaType: "" },
        { fullPath: "reports/Obj1/content.xml", mediaType: "text/xml" },
      ]),
    },
  };
}

export function charSubstitutionOdbBytes(): Uint8Array<ArrayBuffer> {
  return encodePackage(buildPackage());
}
