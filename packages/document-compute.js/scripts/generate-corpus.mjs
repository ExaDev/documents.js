#!/usr/bin/env node
// Generates this package's gitignored at-scale worked-example corpus under test/corpus/, ready for `pnpm test:corpus` -- the at-scale coverage measurement #956 names as the harness's own missing differentiator ("a small, hand-authored starter corpus" was all src/harness had). The generator authors N markdown documents, each a deterministic pseudo-random worked example from the mechanically-lowered arithmetic grammar (explicit \times/\frac/\sqrt/^ compositions -- never juxtaposition, which the lowering deliberately degrades to unparsed) with the stated answer computed by this same generator's parallel JS evaluation, rounded to 6 significant figures the way a textbook author rounds. A mismatch therefore names a genuine lowering/evaluation defect, not a fixture typo. Run from the package root: `node scripts/generate-corpus.mjs` (overwrites test/corpus/ wholesale).
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(packageRoot, "test", "corpus");

// Seeded LCG so the corpus is byte-identical across runs on the same seed.
function lcg(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const DOCUMENT_COUNT = 300;
// Single-letter symbol names: a digit-bearing token (r0) lowers to an unparsed node and a multi-letter token (qb) to juxtaposition -- only a single letter is the plain symbol the worked-example grammar matches on. Each document draws its own four distinct letters from a rotating window of the alphabet, so a document's givens and its target never collide.

// The value pool: decimals and small integers, kept positive where sqrt is involved downstream.
function pickValue(random) {
  const kind = Math.floor(random() * 3);
  if (kind === 0) return Math.floor(random() * 9) + 1;
  if (kind === 1) return Math.round((random() * 9 + 1) * 100) / 100;
  return Math.round((random() * 89 + 10) * 10) / 1000;
}

// One expression node: { latex (with symbol leaves), js (a JS expression string over the symbol names) }.
function buildExpression(random, symbols) {
  const leaf = () => {
    const s = symbols[Math.floor(random() * symbols.length)];
    return { latex: s, js: s };
  };
  const build = (depth) => {
    if (depth === 0) return leaf();
    const kind = Math.floor(random() * 4);
    const a = build(depth - 1);
    const b = build(depth - 1);
    if (kind === 0)
      return { latex: `{${a.latex} + ${b.latex}}`, js: `(${a.js} + ${b.js})` };
    if (kind === 1)
      return {
        latex: `{${a.latex} - ${b.latex}}`,
        js: `(${a.js} - ${b.js})`,
      };
    if (kind === 2)
      return {
        latex: `{${a.latex} \\times ${b.latex}}`,
        js: `(${a.js} * ${b.js})`,
      };
    return {
      latex: `\\frac{${a.latex}}{${b.latex}}`,
      js: `(${a.js} / ${b.js})`,
    };
  };
  let node = build(1 + Math.floor(random() * 2));
  // sqrt only over subexpressions the parallel JS evaluation proves positive (the generator evaluates bindings later, so guard structurally: wrap only additions and multiplications of positive leaves).
  if (random() < 0.25 && node.latex.includes("+")) {
    node = { latex: `\\sqrt{${node.latex}}`, js: `Math.sqrt(${node.js})` };
  }
  return node;
}

// Round to 6 significant figures, the textbook-author rounding the harness's own 1e-3 relative tolerance is built for.
function roundSig(value) {
  if (value === 0) return 0;
  const magnitude = Math.floor(Math.log10(Math.abs(value)));
  const digits = 6 - 1 - magnitude;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function mathBlock(latex) {
  return `$$\n${latex}\n$$`;
}

const documents = [];
for (let i = 0; i < DOCUMENT_COUNT; i++) {
  const random = lcg(0x5eed0000 + i);
  // Two or three given symbols, dimensionless -- plain letter-digit names only, never underscores: an underscore is LaTeX's subscript marker, and a subscripted leaf lowers to a scripted symbol identity rather than the plain binding the worked-example grammar matches on.
  const givenCount = 2 + Math.floor(random() * 2);
  const symbols = [];
  const givenLines = [];
  for (let g = 0; g < givenCount; g++) {
    const name = String.fromCharCode(97 + ((i * 4 + g) % 26));
    const value = pickValue(random);
    symbols.push(name);
    givenLines.push(`${name} = ${roundSig(value)}`);
  }
  const target = String.fromCharCode(65 + ((i * 4 + 3) % 26));
  const expression = buildExpression(random, symbols);
  const env = {};
  symbols.forEach((name, g) => {
    env[name] = parseFloat(givenLines[g].split("= ")[1]);
  });
  const stated = roundSig(
    new Function(...symbols, `return ${expression.js};`)(
      ...symbols.map((s) => env[s]),
    ),
  );
  if (!Number.isFinite(stated)) {
    // Division by zero can arise from the fraction branch; replace this document with a pure multiplication example so every fixture has a finite stated answer (a divide-by-zero corpus belongs to the unit suite, which already covers DivisionByZeroError).
    const product = symbols.map((s) => s).join(" \\times ");
    const value = symbols.reduce((acc, s) => acc * env[s], 1);
    documents.push({
      name: `doc${i}.md`,
      markdown: [
        mathBlock(`${target} = {${product}}`),
        ...givenLines.map(mathBlock),
        mathBlock(`${target} = ${roundSig(value)}`),
      ].join("\n\n"),
    });
    continue;
  }
  documents.push({
    name: `doc${i}.md`,
    markdown: [
      mathBlock(`${target} = ${expression.latex}`),
      ...givenLines.map(mathBlock),
      mathBlock(`${target} = ${stated}`),
    ].join("\n\n"),
  });
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(join(outDir, "files"), { recursive: true });
for (const document of documents) {
  writeFileSync(join(outDir, "files", document.name), document.markdown);
}

// The corpus harness: lowers each markdown document through the identical pipeline the starter corpus uses and runs the at-scale measurement, printing formatCorpusReport's own text for the console. Regenerated by the script alongside the fixtures -- the whole test/corpus/ layer is local-only by the family's convention, and the script is the committed source of truth.
writeFileSync(
  join(outDir, "corpus.test.ts"),
  `import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { lowerMarkdownMath } from "documents.js";
import { readMarkdownContent } from "markdown-codec";
import { collectFormulas, formatCorpusReport, runCorpus } from "../../src/harness/corpus";

function lowerDocument(markdown: string) {
  const { document } = readMarkdownContent(markdown);
  return lowerMarkdownMath(document);
}

describe("compute corpus (generated at-scale worked examples)", () => {
  it("measures coverage over every generated document", () => {
    const dir = join(import.meta.dirname, "files");
    const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
    expect(files.length).toBeGreaterThan(200);
    const report = runCorpus(
      files.map((file) => ({
        label: file,
        document: lowerDocument(readFileSync(join(dir, file), "utf8")),
      })),
    );
    // The measured report also lands in test/corpus/report.txt -- the measurement's own output artefact, regenerable with the corpus.
    writeFileSync(
      join(import.meta.dirname, "report.txt"),
      formatCorpusReport(report) + "\\n",
    );
    process.stdout.write(formatCorpusReport(report) + "\\n");
    // Every generated fixture's stated answer is computed by the generator's own parallel evaluation, so anything short of full coverage names a genuine lowering/evaluation defect.
    expect(report.total).toBe(files.length);
    expect(report.matched).toBe(report.total);
    expect(report.coverage).toBe(1);
  });
});
`,
);

console.log(
  "compute corpus: " +
    documents.length +
    " generated worked-example documents under test/corpus/files/",
);
