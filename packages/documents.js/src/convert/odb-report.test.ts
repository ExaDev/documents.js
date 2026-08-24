import { decodePackage } from "odf.js";
import { readPdf } from "pdf-codec";
import { describe, expect, it } from "vitest";
import { openDocx } from "../edit/docx/editor";
import { openOdt } from "../edit/odt/editor";
import { readOdpContent } from "../odf/odp/read";
import { readOdbReportContent } from "../odb/report/content";
import { minimalOdpBytes } from "../test-support/odp";
import { formAndReportOdbPackage } from "../test-support/odb-fixture";
import { odbReportToDocx, odbReportToOdt, odbReportToPdf } from "./convert";

// The real end-to-end proof for odbReportToDocx/odbReportToOdt/odbReportToPdf: readOdbReportContent(formAndReportOdbPackage()) is the identical real report content.test.ts already verifies band-by-band (real Report Builder bands, groups, and hand-computed SUM totals over a genuine Firebird-backed .odb) -- these tests check that content survives being dispatched to real docx/odt/pdf bytes, not the report-rendering logic itself.

function salesReportContent() {
  return readOdbReportContent(formAndReportOdbPackage());
}

describe("odbReportToDocx", () => {
  it("writes a real docx whose tables carry the report title, a detail row, and the grand total", () => {
    const bytes = odbReportToDocx(salesReportContent());
    const editor = openDocx(bytes);
    const tables = editor.tables();

    expect(tables[0]?.cell(0, 0).text).toBe("Sales by region");
    const detailRow = tables.find(
      (table) => table.cell(0, 0).text === "Acme Ltd",
    );
    expect(detailRow?.cell(0, 1).text).toBe("1200.5");
    const reportFooter = tables[tables.length - 1];
    expect(reportFooter?.cell(0, 0).text).toBe("Grand total:");
    expect(reportFooter?.cell(0, 1).text).toBe("6100.75");
  });

  it("reports a construct-level math diagnostic through onMathDiagnostic if one ever fires (none expected for plain report text)", () => {
    let fired = false;
    odbReportToDocx(salesReportContent(), {
      onMathDiagnostic: () => {
        fired = true;
      },
    });
    expect(fired).toBe(false);
  });
});

describe("odbReportToOdt", () => {
  it("writes a real odt whose tables carry the report title, a detail row, and the grand total", () => {
    const bytes = odbReportToOdt(salesReportContent());
    const editor = openOdt(bytes);
    const tables = editor.tables();

    expect(tables[0]?.cell(0, 0).text).toBe("Sales by region");
    const detailRow = tables.find(
      (table) => table.cell(0, 0).text === "Acme Ltd",
    );
    expect(detailRow?.cell(0, 1).text).toBe("1200.5");
    const reportFooter = tables[tables.length - 1];
    expect(reportFooter?.cell(0, 0).text).toBe("Grand total:");
    expect(reportFooter?.cell(0, 1).text).toBe("6100.75");
  });
});

describe("odbReportToPdf", () => {
  it("writes real PDF bytes carrying the report title as document metadata and at least one page", () => {
    const bytes = odbReportToPdf(salesReportContent());
    const layout = readPdf(bytes);

    expect(layout.metadata.title).toBe("Sales by region");
    expect(layout.pages.length).toBeGreaterThan(0);
  });

  it("reports a font substitution through onFontSubstitution when a run requests a family pdf-codec resolves via its vendored Carlito substitute", () => {
    // renderOdbReportContent's own runs carry no explicit fontFamily at all, which resolves cleanly through the standard 14 with no substitution event at all (pdf-codec's own font-registry.ts never calls onSubstitution for that fallback -- only for a family-regular match or a vendored substitute) -- so this forces the vendored-substitute path deterministically (Calibri -> Carlito), to prove options.fonts/onFontSubstitution genuinely reach a real FontRegistry through odbReportToPdf's DocumentToPdfOptions (the identical type docxToPdf/odtToPdf/markdownToPdf already use), not merely that the option compiles.
    const content = salesReportContent();
    if (content.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing ContentDocument");
    }
    const firstParagraph = content.sections[0]?.blocks.find(
      (block) => block.kind === "table",
    )?.rows[0]?.cells[0]?.blocks[0];
    if (
      firstParagraph?.kind !== "paragraph" ||
      firstParagraph.runs[0] === undefined
    ) {
      throw new Error(
        "expected the report header band to carry at least one run",
      );
    }
    firstParagraph.runs[0].fontFamily = "Calibri";

    const substitutions: string[] = [];
    odbReportToPdf(content, {
      onFontSubstitution: (substitution) =>
        substitutions.push(substitution.requestedFamily),
    });
    expect(substitutions).toContain("Calibri");
  });

  it("throws when given a non-wordprocessing ContentDocument", () => {
    const presentation = readOdpContent(decodePackage(minimalOdpBytes()));
    expect(() => odbReportToPdf(presentation)).toThrow(/wordprocessing/);
  });
});
