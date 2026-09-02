import type {
  ContentBlock,
  ContentDocument,
  ContentFormula,
  SymbolTable,
} from "document-schema.js";
import type { EvaluationResult } from "../compute/evaluate";
import {
  runWorkedExampleSequence,
  type WorkedExampleOptions,
  type WorkedExampleOutcome,
  type WorkedExampleReport,
} from "./worked-example";

// The corpus-scale half of ExaDev/documents.js#794: extracts the already-lowered formula sequence out of a wordprocessing ContentDocument (the shape a markdown-authored worked-example document actually reads as -- markdown-codec's own $$/\( \) recognition plus documents.js's lowerMarkdownMath, per that pass's own header comment) and runs it through worked-example.ts, then aggregates the same across a whole corpus of documents into one coverage report naming, per document, exactly where its evaluation diverged from what the document itself said the answer was.
//
// Scoped to wordprocessing documents' own block flow, table cells included -- presentation/spreadsheet/drawing formulae (a docx/pptx/xlsx producer's native OMML/MathML equation, as opposed to a markdown-authored LaTeX one) are a different corpus with a different lowering path and are out of scope for this pass, matching #573/#794's own worked-example framing, which was specifically about markdown-sourced formulae.

function collectFormulasFromBlocks(
  blocks: readonly ContentBlock[],
  out: ContentFormula[],
): void {
  for (const block of blocks) {
    if (block.kind === "table") {
      for (const row of block.rows) {
        for (const cell of row.cells) {
          collectFormulasFromBlocks(cell.blocks, out);
        }
      }
      continue;
    }
    if (block.kind === "embeddedObject" && block.objectKind === "formula") {
      const embedded = block.document;
      if (embedded.kind === "formula") {
        out.push(embedded.formula);
      }
    }
  }
}

// The document-order formula sequence a wordprocessing ContentDocument carries -- empty for any other ContentDocument kind, per this module's own scope note above.
export function collectFormulas(
  document: ContentDocument,
): readonly ContentFormula[] {
  if (document.kind !== "wordprocessing") {
    return [];
  }
  const out: ContentFormula[] = [];
  for (const section of document.sections) {
    collectFormulasFromBlocks(section.blocks, out);
  }
  return out;
}

export interface CorpusDocument {
  // A caller-chosen label identifying this document in the report -- typically its file path, so a miss can be traced back to the source file without a second lookup.
  readonly label: string;
  readonly document: ContentDocument;
}

export interface CorpusDocumentReport {
  readonly label: string;
  readonly report: WorkedExampleReport;
}

export interface CorpusReport {
  readonly documents: readonly CorpusDocumentReport[];
  readonly total: number;
  readonly matched: number;
  readonly mismatched: number;
  readonly gaps: number;
  readonly unresolved: number;
  // matched / (matched + mismatched) across every document in the corpus combined -- undefined (never a fabricated 0 or 1) when nothing in the whole corpus had a resolvable stated answer.
  readonly coverage: number | undefined;
}

// Runs the worked-example harness over every document in a corpus, using each document's own symbolTable (lowerMarkdownMath seeds this from the document's prose definitions and mints an entry for every glyph nothing defined) as the evaluation context for its own formulae.
export function runCorpus(
  documents: readonly CorpusDocument[],
  options?: WorkedExampleOptions,
): CorpusReport {
  const reports = documents.map(({ label, document }): CorpusDocumentReport => {
    const symbolTable: SymbolTable = document.symbolTable ?? {
      symbols: [],
      units: [],
    };
    const formulas = collectFormulas(document);
    return {
      label,
      report: runWorkedExampleSequence(formulas, symbolTable, options),
    };
  });
  const matched = sumBy(reports, (r) => r.report.matched);
  const mismatched = sumBy(reports, (r) => r.report.mismatched);
  const gaps = sumBy(reports, (r) => r.report.gaps);
  const unresolved = sumBy(reports, (r) => r.report.unresolved);
  const total = sumBy(reports, (r) => r.report.total);
  return {
    documents: reports,
    total,
    matched,
    mismatched,
    gaps,
    unresolved,
    coverage:
      matched + mismatched === 0 ? undefined : matched / (matched + mismatched),
  };
}

function sumBy<T>(items: readonly T[], project: (item: T) => number): number {
  return items.reduce((total, item) => total + project(item), 0);
}

function formatOutcome(outcome: WorkedExampleOutcome): string {
  switch (outcome.outcome) {
    case "match":
      return `match: ${outcome.targetSymbol}`;
    case "mismatch":
      return `MISMATCH: ${outcome.targetSymbol} -- expected ${formatEvaluationResult(outcome.expected)}, got ${formatEvaluationResult(outcome.actual)}`;
    case "gap":
      return `GAP (${outcome.gap}): ${outcome.targetSymbol} -- ${outcome.message}`;
    case "unresolved":
      return `unresolved: ${outcome.targetSymbol} -- ${outcome.message}`;
  }
}

function formatEvaluationResult(value: EvaluationResult): string {
  if (value.kind === "interval") {
    return `[${value.min}, ${value.max}]`;
  }
  return `${value.magnitude}`;
}

// A plain-text rendering of a corpus report for a CLI/console consumer -- one line per document naming its own coverage, one line per non-matching outcome naming the specific gap, and a combined total. Not the only way to consume a CorpusReport (every field is public data a caller can format its own way), just the family's own convention of shipping a formatter alongside a report type that will otherwise get re-formatted slightly differently by every caller.
export function formatCorpusReport(report: CorpusReport): string {
  const lines: string[] = [];
  for (const { label, report: documentReport } of report.documents) {
    const coverageText =
      documentReport.coverage === undefined
        ? "no stated answers"
        : `${(documentReport.coverage * 100).toFixed(1)}% (${documentReport.matched}/${documentReport.matched + documentReport.mismatched})`;
    lines.push(`${label}: ${coverageText}`);
    for (const outcome of documentReport.outcomes) {
      if (outcome.outcome !== "match") {
        lines.push(`  ${formatOutcome(outcome)}`);
      }
    }
  }
  const combinedText =
    report.coverage === undefined
      ? "no stated answers in corpus"
      : `${(report.coverage * 100).toFixed(1)}% (${report.matched}/${report.matched + report.mismatched}), ${report.gaps} gap(s), ${report.unresolved} unresolved`;
  lines.push(`TOTAL: ${combinedText}`);
  return lines.join("\n");
}
