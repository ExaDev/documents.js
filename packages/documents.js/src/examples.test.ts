// Golden-file guard and regenerator for the committed example JSON in examples/. Each example is a real, populated instance of one of this package's pivot models (a ContentDocument per variant, plus a LayoutDocument and a full DocumentTree), produced by reading a real minimal test fixture through the same reader or conversion the public API uses. They exist as documentation: open one and you can see the pivot shape for that format without reverse-engineering it from a schema.
//
// Two modes:
//  - default (`pnpm test`): reads each committed examples/*.json and asserts it
// parses against its own $schema with the expected shape. Catches a reader or schema change that would leave the committed files stale or invalid.
//  - regen (`GENERATE_EXAMPLES=1 pnpm vitest run src/examples.test.ts`): re-runs
// every reader and conversion and overwrites examples/*.json with the current output. Run this whenever a reader or the layout engine changes the pivot shape, then commit the diff alongside the change that prompted it.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ContentDocument, DocumentTree } from "document-schema.js";
import {
  contentDocumentWithSchema,
  documentFromJson,
  documentTreeWithSchema,
} from "document-schema.js";
import { decodePackage as decodeOoxmlPackage } from "ooxml.js";
import { decodePackage as decodeOdfPackage } from "odf.js";
import {
  docxToPdf,
  odgToPdf,
  odfToPdf,
  odsToPdf,
  pptxToPdf,
} from "./convert/convert";
import { readDocxContent } from "./ooxml/docx/read";
import { readPptxContent } from "./ooxml/pptx/read";
import { readOdpContent } from "./odf/odp/read";
import { readOdsContent } from "./odf/ods/read";
import { readOdgContent } from "./odf/odg/read";
import { readOdfFormulaContent } from "./odf/formula/read";
import { minimalDocxBytes } from "./test-support/docx";
import { minimalPptxBytes } from "./test-support/pptx";
import { minimalOdpBytes } from "./test-support/odp";
// gridOdsBytes rather than minimalOdsBytes: minimalOdsBytes's rows carry no explicit style:row-height, so odf.js resolves heightPt as 0 and the resulting ContentDocument fails ContentDocumentSchema's heightPt > 0 invariant. gridOdsBytes is the next most representative ods fixture (three columns, three rows, gridlines and headers enabled, explicit row heights) and reads into valid content.
import { gridOdsBytes } from "./test-support/ods";
import { minimalOdgBytes } from "./test-support/odg";
import { FRACTION_FORMULA, odfFormulaBytes } from "./test-support/odf";

const EXAMPLES_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "examples",
);
const REGEN = process.env.GENERATE_EXAMPLES === "1";

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(resolve(EXAMPLES_DIR, name), "utf8"));
}

function writeJson(name: string, value: unknown): void {
  mkdirSync(EXAMPLES_DIR, { recursive: true });
  writeFileSync(
    resolve(EXAMPLES_DIR, name),
    `${JSON.stringify(value, null, 2)}\n`,
  );
}

// In regen mode the value is stamped with its $schema and written; either way the test then parses the file now on disk back through documentFromJson, so regen mode validates exactly what it wrote and default mode validates exactly what is committed. The asserted $schema kind and (for content docs) variant catch a file that is structurally wrong or was regenerated from the wrong fixture.
function assertContentExample(name: string, document: ContentDocument): void {
  if (REGEN) {
    writeJson(name, contentDocumentWithSchema(document));
  }
  const result = documentFromJson(readJson(name));
  if (result.kind !== "ContentDocument") {
    throw new Error(
      `${name}: expected ContentDocument schema, got ${result.kind}`,
    );
  }
  expect(result.value.kind, `${name}: variant`).toBe(document.kind);
}

function assertPackageExample(name: string, pkg: DocumentTree): void {
  if (REGEN) {
    writeJson(name, documentTreeWithSchema(pkg));
  }
  const result = documentFromJson(readJson(name));
  expect(result.kind, `${name}: schema`).toBe("DocumentTree");
}

// The package examples come from real conversion runs: each variant's onDocument callback hands back the tree-form DocumentTree (decomposed content with the layout pass's frames stamped onto its own nodes, plus the pages array and the minted styles table) the conversion built, which is the README's own recommended way to obtain the intermediate pivot model. The pdf-codec LayoutDocument no longer has a committed example: it stopped being a schema-serialised pivot when the item family demoted to pdf-codec (a LayoutDocument is that codec's own read/write artefact now, with no $schema-stamped JSON envelope to validate a golden against).
function capturePackage(
  convert: (onDocument: (pkg: DocumentTree) => void) => Uint8Array<ArrayBuffer>,
): DocumentTree {
  let captured: DocumentTree | undefined;
  convert((pkg) => {
    captured = pkg;
  });
  if (!captured) {
    throw new Error("conversion did not invoke onDocument");
  }
  return captured;
}

const DOCX_PACKAGE = capturePackage((onDocument) =>
  docxToPdf(minimalDocxBytes(), { onDocument }),
);

describe("examples", () => {
  // wordprocessing covers docx, odt, and markdown -- they all read into the identical wordprocessing-variant ContentDocument (the README documents this shared pivot). docx is the representative source here.
  it("wordprocessing.content.json (from docx)", () => {
    assertContentExample(
      "wordprocessing.content.json",
      readDocxContent(decodeOoxmlPackage(minimalDocxBytes())),
    );
  });

  it("presentation.content.json (from pptx)", () => {
    assertContentExample(
      "presentation.content.json",
      readPptxContent(decodeOoxmlPackage(minimalPptxBytes())),
    );
  });

  it("spreadsheet.content.json (from ods)", () => {
    assertContentExample(
      "spreadsheet.content.json",
      readOdsContent(decodeOdfPackage(gridOdsBytes())),
    );
  });

  it("drawing.content.json (from odg)", () => {
    assertContentExample(
      "drawing.content.json",
      readOdgContent(decodeOdfPackage(minimalOdgBytes())),
    );
  });

  it("formula.content.json (from a standalone .odf)", () => {
    assertContentExample(
      "formula.content.json",
      readOdfFormulaContent(
        decodeOdfPackage(odfFormulaBytes(FRACTION_FORMULA)),
      ),
    );
  });

  // One tree-form package golden per variant, each captured from the variant's own to-pdf conversion so the committed tree carries real frames, real pages, and (where the fixture's formatting repeats) a real minted styles table. wordprocessing covers docx, odt, and markdown (the shared variant); the formula entry comes from the special-case odfToPdf, whose single ContentFormula child and one A4 page is the one tree shape with no container grouping.
  it("wordprocessing.package.json (docxToPdf tree + pages)", () => {
    assertPackageExample("wordprocessing.package.json", DOCX_PACKAGE);
  });

  it("presentation.package.json (pptxToPdf tree + pages)", () => {
    assertPackageExample(
      "presentation.package.json",
      capturePackage((onDocument) =>
        pptxToPdf(minimalPptxBytes(), { onDocument }),
      ),
    );
  });

  it("spreadsheet.package.json (odsToPdf tree + pages)", () => {
    assertPackageExample(
      "spreadsheet.package.json",
      capturePackage((onDocument) => odsToPdf(gridOdsBytes(), { onDocument })),
    );
  });

  it("drawing.package.json (odgToPdf tree + pages)", () => {
    assertPackageExample(
      "drawing.package.json",
      capturePackage((onDocument) =>
        odgToPdf(minimalOdgBytes(), { onDocument }),
      ),
    );
  });

  it("formula.package.json (odfToPdf tree + page)", () => {
    assertPackageExample(
      "formula.package.json",
      capturePackage((onDocument) =>
        odfToPdf(odfFormulaBytes(FRACTION_FORMULA), { onDocument }),
      ),
    );
  });

  // odp reads into the same presentation variant as pptx and is not one of the five committed examples, but exercising it here confirms the second source format still resolves -- guarding against an odp reader regression that the pptx-sourced example alone would not surface.
  it("odp still reads into the presentation variant", () => {
    expect(readOdpContent(decodeOdfPackage(minimalOdpBytes())).kind).toBe(
      "presentation",
    );
  });
});
