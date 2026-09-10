#!/usr/bin/env node
// Generates this package's gitignored real-producer xlsx-drawing corpus under test/corpus/, ready for `pnpm test:corpus` -- the corpus gate src/typed/xlsx/drawings.ts itself states ("Real-producer verification is outstanding"). The producer is LibreOffice's own Calc Office Open XML export: each fixture is a flat-ODS spreadsheet authored with a cell-embedded image (declared column widths and row heights, varied anchor cells and frame sizes), converted headlessly through `soffice --convert-to xlsx`, so the drawing part's anchor markup and the worksheet grid it resolves against are both genuine application output rather than hand-built ECMA-376. Run from the package root: `node scripts/generate-xlsx-drawing-corpus.mjs` (soffice at /opt/homebrew/bin/soffice or SOFFICE in the environment; overwrites test/corpus/ wholesale).
//
// One producer boundary this corpus deliberately does not cover: Calc never emits an xdr:absoluteAnchor (its export normalises every drawing to twoCellAnchor spellings -- verified empirically against both cell-embedded and sheet-level frames), so the absoluteAnchor re-basing path keeps its hand-built unit fixtures as its only verification; that gap is stated in the package README rather than papered over.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(packageRoot, "test", "corpus");
const soffice = process.env.SOFFICE ?? "/opt/homebrew/bin/soffice";

// A 2x2 solid-red PNG (CRC-correct; LibreOffice's libpng silently drops a bad-IHDR-CRC picture).
const TINY_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4z8AARAwQCgAf7gP9i18U1AAAAABJRU5ErkJggg==";

const NS =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ' +
  'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" ' +
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" ' +
  'xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" ' +
  'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"';

// One fixture: the anchor cell (row/column indices), the frame's cm size, and the sheet's own declared column widths (cm) and row heights (cm) the anchor geometry resolves against.
const FIXTURES = [
  {
    name: "origin-anchor",
    row: 0,
    column: 0,
    widthCm: 4,
    heightCm: 3,
    columnWidthsCm: [3, 3, 3],
    rowHeightsCm: [1, 1, 1],
    expect: { anchorRow: 0, anchorColumn: 0 },
  },
  {
    name: "mid-sheet-anchor",
    row: 2,
    column: 1,
    widthCm: 4,
    heightCm: 3,
    columnWidthsCm: [3, 2.5, 3.5, 3],
    rowHeightsCm: [1, 1.25, 0.75, 1],
    expect: { anchorRow: 2, anchorColumn: 1 },
  },
  {
    name: "wide-frame",
    row: 1,
    column: 0,
    widthCm: 6,
    heightCm: 2,
    columnWidthsCm: [2, 2, 2, 2, 2],
    rowHeightsCm: [1, 1, 1],
    expect: { anchorRow: 1, anchorColumn: 0 },
  },
];

function fixtureFods(fixture) {
  const columns = fixture.columnWidthsCm
    .map(
      (cm) =>
        `<table:table-column table:style-name="col${fixture.columnWidthsCm.indexOf(cm)}"/>`,
    )
    .join("");
  // The column/row declared sizes ride on automatic styles, one per distinct width.
  const colStyles = [...new Set(fixture.columnWidthsCm)]
    .map(
      (cm, i) =>
        `<style:style style:name="col${fixture.columnWidthsCm.indexOf(cm)}" style:family="table-column"><style:table-column-properties style:column-width="${cm}cm"/></style:style>`,
    )
    .join("");
  const rowStyles = [...new Set(fixture.rowHeightsCm)]
    .map(
      (cm) =>
        `<style:style style:name="row${fixture.rowHeightsCm.indexOf(cm)}" style:family="table-row"><style:table-row-properties style:row-height="${cm}cm"/></style:style>`,
    )
    .join("");
  const rows = fixture.rowHeightsCm
    .map((cm, r) => {
      const cells = fixture.columnWidthsCm
        .map((_, c) => {
          const label = `<text:p>r${r}c${c}</text:p>`;
          const image =
            r === fixture.row && c === fixture.column
              ? `<draw:frame draw:name="I" text:anchor-type="as-char" svg:width="${fixture.widthCm}cm" svg:height="${fixture.heightCm}cm"><draw:image><office:binary-data>${TINY_PNG}</office:binary-data></draw:image></draw:frame>`
              : "";
          return `<table:table-cell>${label}${image}</table:table-cell>`;
        })
        .join("");
      return `<table:table-row table:style-name="row${fixture.rowHeightsCm.indexOf(cm)}">${cells}</table:table-row>`;
    })
    .join("");
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    `<office:document ${NS} office:version="1.3" office:mimetype="application/vnd.oasis.opendocument.spreadsheet">\n` +
    " <office:automatic-styles>" +
    colStyles +
    rowStyles +
    " </office:automatic-styles>\n" +
    " <office:body><office:spreadsheet>" +
    '<table:table table:name="S1">' +
    columns +
    rows +
    "</table:table>" +
    " </office:spreadsheet></office:body>\n</office:document>"
  );
}

// The corpus harness: reads each converted .xlsx through this package's own package decode + spreadsheet reader and asserts the image's anchor cell and frame against what the fods source authored. Regenerated by the script alongside the fixtures -- the whole test/corpus/ layer is local-only by the family's convention, and the script is the committed source of truth.
const CORPUS_TEST = `import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decodePackage, readXlsxContent } from "../../src/index";

interface Fixture {
  file: string;
  expect: {
    anchorRow: number;
    anchorColumn: number;
    widthCm: number;
    heightCm: number;
  };
}

const MANIFEST = JSON.parse(
  readFileSync(join(import.meta.dirname, "manifest.json"), "utf8"),
) as readonly Fixture[];

// Points per centimetre, matching the generator's authoring unit; the tolerance absorbs Calc's cm-to-EMU rounding.
const PT_PER_CM = 72 / 2.54;

describe("xlsx drawing corpus (LibreOffice-produced Calc output)", () => {
  for (const { file, expect: e } of MANIFEST) {
    it(file + " resolves its picture anchor and frame against the producer grid", () => {
      const bytes = new Uint8Array(readFileSync(join(import.meta.dirname, file)));
      const content = readXlsxContent(decodePackage(bytes));
      if (content.kind !== "spreadsheet") {
        throw new Error("expected a spreadsheet document");
      }
      const images = content.sheets[0]!.images;
      expect(images, "sheet pictures recovered").toHaveLength(1);
      const image = images[0]!;
      expect(image.anchorRow).toBe(e.anchorRow);
      expect(image.anchorColumn).toBe(e.anchorColumn);
      // The producer's own a:ext in the drawing part states the frame in EMU; the reader's grid-derived frame must agree with the authored cm within the cm-to-EMU rounding (1pt tolerance covers 32k EMU of drift).
      expect(image.widthPt).toBeCloseTo(e.widthCm * PT_PER_CM, 0);
      expect(image.heightPt).toBeCloseTo(e.heightCm * PT_PER_CM, 0);
    });
  }
});
`;

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
const staging = join(outDir, ".staging");
mkdirSync(staging, { recursive: true });

const manifest = [];
for (const fixture of FIXTURES) {
  const src = join(staging, fixture.name + ".fods");
  writeFileSync(src, fixtureFods(fixture));
  execFileSync(
    soffice,
    [
      "--headless",
      "--norestore",
      "--convert-to",
      "xlsx",
      "--outdir",
      staging,
      src,
    ],
    { stdio: "pipe" },
  );
  rmSync(src, { force: true });
  writeFileSync(
    join(outDir, fixture.name + ".xlsx"),
    readFileSync(join(staging, fixture.name + ".xlsx")),
  );
  manifest.push({
    file: fixture.name + ".xlsx",
    expect: {
      anchorRow: fixture.expect.anchorRow,
      anchorColumn: fixture.expect.anchorColumn,
      widthCm: fixture.widthCm,
      heightCm: fixture.heightCm,
    },
  });
}
rmSync(staging, { recursive: true, force: true });

writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
writeFileSync(join(outDir, "corpus.test.ts"), CORPUS_TEST);
console.log(
  "xlsx drawing corpus: " + manifest.length + " fixtures under test/corpus/",
);
