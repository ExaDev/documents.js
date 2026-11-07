// Measures the two memory factors in src/content-projection/memory-budget.ts (bytes per byte of XML part, transient and retained) on synthetic parts, through the built package.
//
// Run `pnpm build` first, then `node scripts/measure-memory-factors.mjs`. Each synthetic package is written to a temporary file and processed in a child process. The pass is first bisected for the smallest V8 old-space limit the child survives, so garbage the collector would not have left uncollected under pressure is not counted. The pass is then run once more at that limit, and the child reports the growth of its high-water resident set size over the size just before the pass. That growth is the peak the pass cost, V8 heap and external memory alike: Node holds a large decoded string and every inflated part outside the V8 heap, so a heap limit alone would not see most of what a part costs. The child also forces a collection and reports how much heap is still held, which is the retained cost. Both are divided by the part's uncompressed size, and the largest of each across the synthetic parts is printed; the constants are those values rounded up to a whole number.
//
// A synthetic part cannot stand for every real one. Cells with short numeric values and cells with long shared-string text sit at the two ends of bytes per retained unit, so both are measured, as is prose; a package whose parts cost more per byte than the larger would exceed the budget it was admitted under.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";

const encoder = new TextEncoder();
const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const CELL_COLUMNS = 8;

function xlsxPackage(rows, textLength) {
  const text = "w".repeat(textLength);
  const cells = (row) =>
    Array.from({ length: CELL_COLUMNS }, (_, column) => {
      const ref = `${String.fromCharCode(65 + column)}${row}`;
      return column % 2 === 0
        ? `<c r="${ref}" t="s"><v>${row % 100}</v></c>`
        : `<c r="${ref}"><v>${row * column}.5</v></c>`;
    }).join("");
  const sheet = `<worksheet xmlns="${NS}"><sheetData>${Array.from({ length: rows }, (_, i) => `<row r="${i + 1}">${cells(i + 1)}</row>`).join("")}</sheetData></worksheet>`;
  const strings = `<sst xmlns="${NS}">${Array.from({ length: 100 }, (_, i) => `<si><t>${text}${i}</t></si>`).join("")}</sst>`;
  const types = `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`;
  const workbook = `<workbook xmlns="${NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const rels = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/></Relationships>`;
  return {
    bytes: zipSync({
      "[Content_Types].xml": encoder.encode(types),
      "xl/workbook.xml": encoder.encode(workbook),
      "xl/_rels/workbook.xml.rels": encoder.encode(rels),
      "xl/worksheets/sheet1.xml": encoder.encode(sheet),
      "xl/sharedStrings.xml": encoder.encode(strings),
    }),
    xmlBytes: encoder.encode(sheet + strings).length,
  };
}

// Words repeat across a vocabulary, as prose does, so the projection keeps a realistic number of distinct units.
const VOCABULARY = 20_000;

function docxPackage(paragraphs, wordsPerParagraph) {
  const paragraph = (index) =>
    `<w:p><w:r><w:t>${Array.from({ length: wordsPerParagraph }, (_, word) => `word${(index * 7 + word) % VOCABULARY}`).join(" ")}</w:t></w:r></w:p>`;
  const body = `<w:document xmlns:w="${WORD_NS}"><w:body>${Array.from({ length: paragraphs }, (_, index) => paragraph(index)).join("")}</w:body></w:document>`;
  const types = `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
  return {
    bytes: zipSync({
      "[Content_Types].xml": encoder.encode(types),
      "word/document.xml": encoder.encode(body),
    }),
    xmlBytes: encoder.encode(body).length,
  };
}

// The subjects: an xlsx with many short cells, an xlsx with long shared strings, and a docx of ordinary prose.
const SUBJECTS = [
  {
    name: "xlsx-short-cells",
    pass: "project-xlsx",
    ...xlsxPackage(150_000, 8),
  },
  {
    name: "xlsx-long-strings",
    pass: "project-xlsx",
    ...xlsxPackage(20_000, 4_000),
  },
  { name: "docx-prose", pass: "project-docx", ...docxPackage(200_000, 25) },
  { name: "xlsx-canonical", pass: "canonicalize", ...xlsxPackage(150_000, 8) },
];

const CHILD = `
import { readFileSync } from "node:fs";
import { projectXlsxContent, projectDocxContent, canonicalizeOpcPackage } from ${JSON.stringify(new URL("../dist/index.js", import.meta.url).href)};
const [file, pass] = process.argv.slice(2);
const bytes = new Uint8Array(readFileSync(file));
const memoryBudgetBytes = 2 ** 40;
globalThis.gc();
const before = { rss: process.memoryUsage().rss, heap: process.memoryUsage().heapUsed };
let held;
if (pass === "project-xlsx") held = await projectXlsxContent(bytes, { memoryBudgetBytes });
else if (pass === "project-docx") held = await projectDocxContent(bytes, { memoryBudgetBytes });
else held = await canonicalizeOpcPackage(bytes, { memoryBudgetBytes });
// resourceUsage().maxRSS is in kilobytes.
const peakRssGrowth = process.resourceUsage().maxRSS * 1024 - before.rss;
globalThis.gc();
console.log(JSON.stringify({ peakRssGrowth, retained: process.memoryUsage().heapUsed - before.heap, kept: held !== undefined }));
`;

const work = mkdtempSync(join(tmpdir(), "measure-memory-factors-"));
const childFile = join(work, "child.mjs");
writeFileSync(childFile, CHILD);

const MIB = 1024 * 1024;
// The bisection's bounds: below the first no Node process starts, and a pass that needs more than the second has outgrown what the script can claim to measure.
const LOWEST_LIMIT_MIB = 16;
const HIGHEST_LIMIT_MIB = 16_384;
// A run at the bisected limit can fail on collector timing, so the limit is raised by this fraction until one passes.
const LIMIT_STEP = 1.05;

function runAt(file, pass, limitMib) {
  return spawnSync(
    process.execPath,
    [`--max-old-space-size=${limitMib}`, "--expose-gc", childFile, file, pass],
    { encoding: "utf8" },
  );
}

function smallestSurvivingLimitMib(file, pass) {
  let low = LOWEST_LIMIT_MIB;
  let high = HIGHEST_LIMIT_MIB;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (runAt(file, pass, middle).status === 0) high = middle;
    else low = middle + 1;
  }
  return low;
}

function measureAtSmallestLimit(file, pass) {
  for (
    let limit = smallestSurvivingLimitMib(file, pass);
    limit <= HIGHEST_LIMIT_MIB;
    limit = Math.ceil(limit * LIMIT_STEP)
  ) {
    const run = runAt(file, pass, limit);
    if (run.status === 0) {
      return { ...JSON.parse(run.stdout), limitMib: limit };
    }
  }
  throw new Error(
    `${pass} did not complete under any limit up to ${HIGHEST_LIMIT_MIB} MiB`,
  );
}

try {
  const results = [];
  for (const subject of SUBJECTS) {
    const file = join(work, `${subject.name}.zip`);
    writeFileSync(file, subject.bytes);
    const report = measureAtSmallestLimit(file, subject.pass);
    results.push({
      subject: subject.name,
      xmlBytes: subject.xmlBytes,
      limitMib: report.limitMib,
      limitPerByte: Number(
        ((report.limitMib * MIB) / subject.xmlBytes).toFixed(2),
      ),
      peakPerByte: Number((report.peakRssGrowth / subject.xmlBytes).toFixed(2)),
      retainedPerByte: Number(
        (Math.max(0, report.retained) / subject.xmlBytes).toFixed(2),
      ),
    });
  }
  console.log(JSON.stringify(results, null, 2));
  const projections = results.filter((r) => r.subject !== "xlsx-canonical");
  const retained = Math.max(...projections.map((r) => r.retainedPerByte));
  const peak = Math.max(...projections.map((r) => r.peakPerByte));
  console.log(
    `projection: transient ${Math.ceil(peak - retained)}, retained ${Math.ceil(retained)}`,
  );
  const canonical = results.find((r) => r.subject === "xlsx-canonical");
  console.log(
    `canonicalisation: transient ${Math.ceil(canonical.peakPerByte)}, retained 0`,
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}
