#!/usr/bin/env node
// Generates this package's gitignored real-producer .rtf corpus under test/corpus/, ready for `pnpm test:corpus` (the package shipped no corpus layer at all before this). The producer is LibreOffice's own RTF export filter: each fixture is authored as a flat-ODT source and converted headlessly through `soffice --convert-to rtf`, so every corpus file is genuine application output rather than hand-authored control words -- exactly the "never been exercised against real application output" gap this package's own README names. Run from the package root: `node scripts/generate-corpus.mjs` (soffice at /opt/homebrew/bin/soffice or SOFFICE in the environment; overwrites test/corpus/ wholesale). The regenerated corpus.test.ts carries each fixture's expectations, authored beside the fixture's construction here.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(packageRoot, "test", "corpus");
const soffice = process.env.SOFFICE ?? "/opt/homebrew/bin/soffice";

const NS =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ' +
  'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" ' +
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" ' +
  'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" ' +
  'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" ' +
  'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" ' +
  'xmlns:xlink="http://www.w3.org/1999/xlink"';

const FIXTURES = [
  {
    name: "plain",
    body: "<text:p>Corpus plain paragraph.</text:p>",
    expect: { text: ["Corpus plain paragraph."] },
  },
  {
    name: "runs",
    body:
      "<text:p>" +
      '<text:span text:style-name="B">bold run</text:span> and ' +
      '<text:span text:style-name="I">italic run</text:span> and ' +
      '<text:span text:style-name="U">underlined run</text:span>' +
      "</text:p>",
    expect: {
      runs: [
        { text: "bold run", bold: true },
        { text: "italic run", italic: true },
        { text: "underlined run", underline: true },
      ],
    },
  },
  {
    name: "colour",
    body: '<text:p><text:span text:style-name="RED">red text</text:span></text:p>',
    expect: { runs: [{ text: "red text", color: { r: 1, g: 0, b: 0 } }] },
  },
  {
    name: "headings",
    body:
      '<text:h text:outline-level="1">Chapter One</text:h>' +
      '<text:h text:outline-level="2">Section A</text:h>' +
      "<text:p>Body under the section.</text:p>",
    expect: {
      headings: [
        { text: "Chapter One", level: 1 },
        { text: "Section A", level: 2 },
      ],
    },
  },
  {
    name: "lists",
    body:
      '<text:list text:style-name="L1"><text:list-item><text:p>bullet one</text:p></text:list-item><text:list-item><text:p>bullet two</text:p></text:list-item></text:list>' +
      '<text:list text:style-name="L2"><text:list-item><text:p>step one</text:p></text:list-item><text:list-item><text:p>step two</text:p></text:list-item></text:list>',
    expect: {
      listItems: ["bullet one", "bullet two", "step one", "step two"],
    },
  },
  {
    name: "table",
    body:
      '<table:table table:name="T1">' +
      "<table:table-column/><table:table-column/>" +
      "<table:table-row>" +
      "<table:table-cell><text:p>alpha</text:p></table:table-cell>" +
      "<table:table-cell><text:p>beta</text:p></table:table-cell>" +
      "</table:table-row>" +
      "<table:table-row>" +
      "<table:table-cell><text:p>gamma</text:p></table:table-cell>" +
      "<table:table-cell><text:p>delta</text:p></table:table-cell>" +
      "</table:table-row>" +
      "</table:table>",
    expect: {
      tables: [{ rows: 2, cells: ["alpha", "beta", "gamma", "delta"] }],
    },
  },
  {
    name: "multiple-paragraphs",
    body:
      "<text:p>First paragraph.</text:p>" +
      "<text:p>Second paragraph.</text:p>" +
      "<text:p>Third paragraph.</text:p>",
    expect: { paragraphs: 3, text: ["First paragraph.", "Third paragraph."] },
  },
  {
    name: "alignment",
    body: '<text:p text:style-name="CENTER">Centred text.</text:p>',
    expect: { text: ["Centred text."], centered: "Centred text." },
  },
];

const AUTOSTYLES =
  " <office:automatic-styles>" +
  '<style:style style:name="B" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style>' +
  '<style:style style:name="I" style:family="text"><style:text-properties fo:font-style="italic"/></style:style>' +
  '<style:style style:name="U" style:family="text"><style:text-properties style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"/></style:style>' +
  '<style:style style:name="RED" style:family="text"><style:text-properties fo:color="#ff0000"/></style:style>' +
  '<style:style style:name="CENTER" style:family="paragraph"><style:paragraph-properties fo:text-align="center"/></style:style>' +
  '<text:list-style style:name="L1"><text:list-level-style-bullet text:level="1" text:bullet-char="•"><style:list-level-properties text:min-label-width="0.5cm"/></text:list-level-style-bullet></text:list-style>' +
  '<text:list-style style:name="L2"><text:list-level-style-number text:level="1" style:num-format="1"><style:list-level-properties text:min-label-width="0.5cm"/></text:list-level-style-number></text:list-style>' +
  " </office:automatic-styles>";

function fodt(body) {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n<office:document ' +
    NS +
    ' office:version="1.3" office:mimetype="application/vnd.oasis.opendocument.text">\n' +
    AUTOSTYLES +
    "\n <office:body><office:text>" +
    body +
    "</office:text></office:body>\n</office:document>"
  );
}

// The corpus harness: reads each converted .rtf through this package's own reader and asserts the manifest's expectations against the recovered ContentDocument. Regenerated by the script alongside the fixtures -- the whole test/corpus/ layer is local-only by the family's convention, and the script is the committed source of truth.
const CORPUS_TEST = `import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readRtfContent } from "../../src/index";

const MANIFEST = JSON.parse(
  readFileSync(join(import.meta.dirname, "manifest.json"), "utf8"),
) as readonly {
  file: string;
  expect: Record<string, unknown>;
}[];

describe("rtf corpus (LibreOffice-produced RTF)", () => {
  for (const { file, expect: e } of MANIFEST) {
    it(file + " reads back what its flat-ODT source authored", () => {
      const text = new TextDecoder().decode(
        new Uint8Array(readFileSync(join(import.meta.dirname, file))),
      );
      const { document } = readRtfContent(text);
      if (document.kind !== "wordprocessing") {
        throw new Error("expected a wordprocessing document");
      }
      const blocks = document.sections[0]!.blocks;
      const paragraphs = blocks.filter(
        (b): b is Extract<typeof b, { kind: "paragraph" }> =>
          b.kind === "paragraph",
      );
      const wholeText = paragraphs
        .flatMap((p) => p.runs.map((r) => r.text))
        .join(" ")
        .replace(/\\s+/g, " ")
        .trim();
      if (Array.isArray(e.text)) {
        for (const needle of e.text as string[]) {
          expect(wholeText).toContain(needle);
        }
      }
      if (typeof e.paragraphs === "number") {
        expect(paragraphs).toHaveLength(e.paragraphs);
      }
      if (Array.isArray(e.runs)) {
        const all = paragraphs.flatMap((p) => p.runs);
        for (const want of e.runs as {
          text: string;
          bold?: boolean;
          italic?: boolean;
          underline?: boolean;
          color?: { r: number; g: number; b: number };
        }[]) {
          const run = all.find((r) => r.text === want.text);
          expect(run, "run " + want.text + " recovered").toBeDefined();
          if (want.bold !== undefined) expect(run!.bold ?? false).toBe(want.bold);
          if (want.italic !== undefined)
            expect(run!.italic ?? false).toBe(want.italic);
          if (want.underline !== undefined)
            expect(run!.underline ?? false).toBe(want.underline);
          if (want.color !== undefined) {
            expect(run!.color, "colour on " + want.text).toBeDefined();
            expect(run!.color!.r).toBeCloseTo(want.color.r, 1);
            expect(run!.color!.g).toBeCloseTo(want.color.g, 1);
            expect(run!.color!.b).toBeCloseTo(want.color.b, 1);
          }
        }
      }
      if (Array.isArray(e.headings)) {
        for (const want of e.headings as { text: string; level: number }[]) {
          const heading = paragraphs.find(
            (p) => p.runs.map((r) => r.text).join("") === want.text,
          );
          expect(heading, "heading " + want.text).toBeDefined();
          expect(heading!.headingLevel).toBe(want.level);
        }
      }
      if (Array.isArray(e.listItems)) {
        for (const item of e.listItems as string[]) {
          const para = paragraphs.find(
            (p) => p.runs.map((r) => r.text).join("") === item,
          );
          expect(para, "list item " + item).toBeDefined();
          expect(para!.list, "membership on " + item).toBeDefined();
        }
      }
      if (Array.isArray(e.tables)) {
        const tables = blocks.filter(
          (b): b is Extract<typeof b, { kind: "table" }> => b.kind === "table",
        );
        expect(tables).toHaveLength((e.tables as unknown[]).length);
        for (const [ti, want] of (
          e.tables as { rows: number; cells: string[] }[]
        ).entries()) {
          const table = tables[ti]!;
          expect(table.rows).toHaveLength(want.rows);
          const cells = table.rows.flatMap((r) => r.cells);
          expect(
            cells.map((c) =>
              c.blocks
                .map((b) =>
                  b.kind === "paragraph"
                    ? b.runs.map((r) => r.text).join("")
                    : "",
                )
                .join(""),
            ),
          ).toEqual(want.cells);
        }
      }
      if (typeof e.centered === "string") {
        const para = paragraphs.find(
          (p) => p.runs.map((r) => r.text).join("") === e.centered,
        );
        expect(para, "centred paragraph " + e.centered).toBeDefined();
        expect(para!.alignment).toBe("center");
      }
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
  const src = join(staging, fixture.name + ".fodt");
  writeFileSync(src, fodt(fixture.body));
  execFileSync(
    soffice,
    [
      "--headless",
      "--norestore",
      "--convert-to",
      "rtf",
      "--outdir",
      staging,
      src,
    ],
    { stdio: "pipe" },
  );
  rmSync(src, { force: true });
  writeFileSync(
    join(outDir, fixture.name + ".rtf"),
    readFileSync(join(staging, fixture.name + ".rtf")),
  );
  manifest.push({ file: fixture.name + ".rtf", expect: fixture.expect });
}
rmSync(staging, { recursive: true, force: true });

writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
writeFileSync(join(outDir, "corpus.test.ts"), CORPUS_TEST);
console.log("rtf corpus: " + manifest.length + " fixtures under test/corpus/");
