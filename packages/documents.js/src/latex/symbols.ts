import type { ContentDocument, MathSymbolEntry } from "document-schema.js";
import type { LatexDiagnostic } from "./diagnostics";

// The symbol-table half of the lowering: the map from LaTeX's written symbol commands to the glyphs a symbol table keys on, the id-minting scheme that keeps a formula's `sym` references resolvable, and the conservative prose scanner that seeds a document's table from its own defining sentences. The symbol table is the curation layer the schema defines (document-schema.js src/math.ts): presentation-inert, never consulted by rendering, and the thing that makes a lowered equation computable -- a `sym` node is a reference, and this module is where references acquire targets.

// A LaTeX symbol command to its single written glyph, the form the symbol table's own `glyph` field expects ("the written form as it appears in presentation"). temml hands symbol commands through as mathord/textord nodes whose text is the raw command ('\\alpha', '\\infty'); the table keys on what a reader actually sees, so the map is to the Unicode character. Greek (both cases, plus the variant letters), the letterlike symbols, and the few common blackboard/structural glyphs engineers actually write -- anything outside the map degrades to an `unparsed` node rather than entering the table under a command name no human wrote.
const COMMAND_GLYPHS: Readonly<Record<string, string>> = {
  "\\alpha": "α",
  "\\beta": "β",
  "\\gamma": "γ",
  "\\delta": "δ",
  "\\epsilon": "ε",
  "\\varepsilon": "ε",
  "\\zeta": "ζ",
  "\\eta": "η",
  "\\theta": "θ",
  "\\vartheta": "ϑ",
  "\\iota": "ι",
  "\\kappa": "κ",
  "\\lambda": "λ",
  "\\mu": "μ",
  "\\nu": "ν",
  "\\xi": "ξ",
  "\\pi": "π",
  "\\varpi": "ϖ",
  "\\rho": "ρ",
  "\\varrho": "ϱ",
  "\\sigma": "σ",
  "\\varsigma": "ς",
  "\\tau": "τ",
  "\\upsilon": "υ",
  "\\phi": "φ",
  "\\varphi": "φ",
  "\\chi": "χ",
  "\\psi": "ψ",
  "\\omega": "ω",
  "\\Gamma": "Γ",
  "\\Delta": "Δ",
  "\\Theta": "Θ",
  "\\Lambda": "Λ",
  "\\Xi": "Ξ",
  "\\Pi": "Π",
  "\\Sigma": "Σ",
  "\\Upsilon": "Υ",
  "\\Phi": "Φ",
  "\\Psi": "Ψ",
  "\\Omega": "Ω",
  "\\infty": "∞",
  "\\partial": "∂",
  "\\nabla": "∇",
  "\\ell": "ℓ",
  "\\hbar": "ℏ",
  "\\Re": "ℜ",
  "\\Im": "ℑ",
  "\\aleph": "ℵ",
};

// The written glyph a symbol-command text carries, or undefined for a command outside the map. A plain (non-command) character is its own glyph and passes through unchanged.
export function glyphOfSymbolText(text: string): string | undefined {
  if (!text.startsWith("\\")) {
    return text;
  }
  return COMMAND_GLYPHS[text];
}

// The id a table entry for this glyph gets when nobody curated one: 'symbols:' plus the glyph itself. Deliberately the same scheme for every producer in this package (the prose scanner below, the lowering's auto-minting), so an entry seeded from prose and a reference auto-minted from a formula converge on one id instead of minting two spellings of the same symbol -- a curated table can override the id, and then every lookup goes through the curated entry, because minting only happens for glyphs the table does not already carry.
export function mintedSymbolId(glyph: string): string {
  return `symbols:${glyph}`;
}

// Glyph-to-id resolution state shared by one lowering run and the table it feeds. `curated` is the lookup over the table the caller supplied (or the prose-seeded table the markdown pass built); `minted` accumulates entries for glyphs no table entry covers, returned to the caller to merge so every `sym` reference the lowering emitted resolves against the resulting table. Duplicate glyphs in a supplied table are a curatorial error the schema declines to enforce; this resolver takes the FIRST entry per glyph deterministically rather than picking silently among them, so a lowering is reproducible either way.
export class SymbolResolver {
  private readonly curated = new Map<string, string>();
  private readonly minted = new Map<string, MathSymbolEntry>();

  constructor(entries: readonly MathSymbolEntry[]) {
    for (const entry of entries) {
      if (!this.curated.has(entry.glyph)) {
        this.curated.set(entry.glyph, entry.id);
      }
    }
  }

  // Whether the caller-curated table already carries this glyph -- the lowering's only consultation of the table's JUDGEMENT (as opposed to its id mapping): a scripted form the table curates as one symbol is one symbol, and exponentiation stands down.
  isCurated(glyph: string): boolean {
    return this.curated.has(glyph);
  }

  // The id a `sym` node for this glyph references: the curated table's entry when one exists, else a freshly minted entry recorded for the caller to merge. Binder-local names (a `sum`/`prod` bound variable) are resolved by the lowering itself before it gets here -- they shadow the table inside the binder's body and never mint entries, because the bound variable's identity is lexical, not curated.
  resolve(glyph: string): string {
    const curatedId = this.curated.get(glyph);
    if (curatedId !== undefined) {
      return curatedId;
    }
    const existing = this.minted.get(glyph);
    if (existing !== undefined) {
      return existing.id;
    }
    const id = mintedSymbolId(glyph);
    this.minted.set(glyph, { glyph, scope: "document", id });
    return id;
  }

  // Every glyph this run minted an entry for, in first-mint order -- merge-ready for the document's symbolTable alongside whatever the caller already curated (dedup by glyph is the caller's: this list never contains a glyph the curated entries carried).
  mintedEntries(): readonly MathSymbolEntry[] {
    return [...this.minted.values()];
  }
}

// -- Symbol definitions from document prose --

// The shape a prose-defined symbol's written form may take: one Latin or Greek letter, optionally with an underscore subscript run ("R", "m_e", "x_1", "α"). A whole word ("where the resistance is...") does not match -- multi-letter runs are words, not symbols, and excluding them is most of what keeps this scanner conservative.
const PROSE_SYMBOL_PATTERN = /[A-Za-zΑ-ω](?:_[A-Za-z0-9]+)?/;

// Sentence-level definition patterns, the two forms technical prose actually writes: "where R is the resistance per unit length" and "let x be the voltage". The verb set is deliberately small (is/are/be/denotes/denote/represents/stands for) -- "where R varies..." is not a definition, and matching it would mint a wrong quantity identity, which is precisely the failure precision-over-recall is here to avoid. Matches are case-insensitive on the keyword and verb only; the symbol itself is case-sensitive because R and r are different quantities.
const PROSE_DEFINITION_PATTERNS: readonly RegExp[] = [
  /\bwhere\s+([^\s,.;:]+)\s+(?:is|are|denotes?|represents?|stands\s+for)\b/i,
  /\blet\s+([^\s,.;:]+)\s+(?:be|denote|represent|stand\s+for)\b/i,
];

// Rough sentence segmentation for the scanner: split at sentence-ending punctuation followed by whitespace or end of text. Deliberately rough -- a definition sentence mis-split at an abbreviation at worst misses one definition, and a curatorial pass over the table is where that gets fixed, not a grammar model here.
function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

// Scans a wordprocessing document's own prose for symbol definitions and seeds table entries from them -- the "where equations acquire computability at all" half of the pipeline: a symbol the prose defines gets a table entry (with the defining sentence recorded as its definitionSource), and a formula's reference to that glyph then resolves to the curated entry instead of an auto-mint. Conservative by construction: only the two sentence-level where/let forms, only single-letter(+optional subscript) symbol shapes, and every hit is reported through the sink so a caller can audit what was seeded. No quantityKind or preferredUnit is ever inferred -- prose says what a symbol is in words, and mapping those words onto a quantity vocabulary is curation this package does not attempt.
export function extractSymbolDefinitionsFromProse(
  document: ContentDocument,
  sink?: (diagnostic: LatexDiagnostic) => void,
): MathSymbolEntry[] {
  if (document.kind !== "wordprocessing") {
    return [];
  }
  const entries: MathSymbolEntry[] = [];
  const seen = new Set<string>();
  for (const section of document.sections) {
    for (const block of section.blocks) {
      if (block.kind !== "paragraph") {
        continue;
      }
      const text = block.runs.map((run) => run.text).join("");
      for (const sentence of sentencesOf(text)) {
        const entry = proseDefinitionIn(sentence);
        if (entry === undefined || seen.has(entry.glyph)) {
          continue;
        }
        seen.add(entry.glyph);
        entries.push(entry);
        sink?.({
          code: "symbols/prose-definition-found",
          detail: `"${entry.glyph}" from: ${sentence}`,
        });
      }
    }
  }
  return entries;
}

// One sentence's definition, or undefined when it holds no where/let definition pattern. definitionSource carries the defining sentence itself rather than a locator: for prose-sourced definitions the sentence IS the provenance a curator needs, and a paragraph index would rot the moment the document is edited while the sentence stays findable.
function proseDefinitionIn(sentence: string): MathSymbolEntry | undefined {
  for (const pattern of PROSE_DEFINITION_PATTERNS) {
    const match = pattern.exec(sentence);
    const candidate = match?.[1];
    if (candidate === undefined) {
      continue;
    }
    if (PROSE_SYMBOL_PATTERN.exec(candidate)?.[0] !== candidate) {
      continue;
    }
    return {
      glyph: candidate,
      scope: "document",
      id: mintedSymbolId(candidate),
      definitionSource: sentence,
    };
  }
  return undefined;
}
