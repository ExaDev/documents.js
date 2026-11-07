import type { SkipReason } from "./memory-budget";

export type ProjectionFormat = "docx" | "xlsx";

/** The content categories a projection reports units and census counts under. `body` ... `charts` are docx part groups; `shared-strings` ... `workbook` are xlsx ones; `comments`, `drawings` and `charts` occur in both. */
export type ProjectionCategory =
  | "body"
  | "headers-footers"
  | "notes"
  | "comments"
  | "drawings"
  | "charts"
  | "shared-strings"
  | "sheet-names"
  | "defined-names"
  | "sheets"
  | "workbook";

/** A resolved cell. `formula` is undefined when the cell has none, and `SHARED_FORMULA` for a cell that takes its formula from a shared master. */
export interface ProjectedCell {
  readonly value: string;
  readonly formula: string | undefined;
}

/** The formula marker for a cell whose own `<f>` carries no text because it reads a shared master's. Only its presence is compared: writers expand shared formulas, and the expansion is the master's text shifted, which this projection does not recompute. */
export const SHARED_FORMULA = "\u0000shared";

/** A part the projection did not read, and why. `unparsed:` carries the error's class name. */
export interface SkippedPart {
  readonly name: string;
  readonly reason: SkipReason | `unparsed:${string}`;
}

/**
 * What a document says, reduced to comparable units that a rewrite can be held to.
 *
 * - `units`: per category, a multiset. Text categories hold whitespace-separated words, gathered per paragraph (or per string, comment or chart value) so a different split into runs cannot change them. `sheet-names` and `defined-names` hold whole names.
 * - `census`: per category, how many elements of each tracked family the parts hold, so a lost table row, footnote or empty paragraph shows even where it holds no text.
 * - `media`: a multiset of `kind:sha256` entries for the images and embedded objects the package holds.
 * - `cells` (xlsx): each non-empty cell keyed by sheet position and resolved cell reference, so a different sheet name changes nothing here.
 * - `unmodelledParts`: the parts of kinds that carry content this projection does not read, digits replaced by `N`.
 * - `skippedParts`: parts that could not be read. A projection with any is incomplete.
 */
export interface ContentProjection {
  readonly format: ProjectionFormat;
  readonly units: ReadonlyMap<ProjectionCategory, ReadonlyMap<string, number>>;
  readonly census: ReadonlyMap<ProjectionCategory, ReadonlyMap<string, number>>;
  readonly media: ReadonlyMap<string, number>;
  readonly cells: ReadonlyMap<string, ProjectedCell>;
  readonly unmodelledParts: readonly string[];
  readonly skippedParts: readonly SkippedPart[];
}

/** The options both projections take. */
export interface ProjectionOptions {
  /** The memory, in bytes, the caller allows the projection to use. Parts are skipped, and recorded as skipped, rather than risk exceeding it. */
  readonly memoryBudgetBytes: number;
}

function increment<K>(map: Map<K, number>, key: K, by = 1): void {
  map.set(key, (map.get(key) ?? 0) + by);
}

function bucketOf(
  buckets: Map<ProjectionCategory, Map<string, number>>,
  category: ProjectionCategory,
): Map<string, number> {
  let bucket = buckets.get(category);
  if (bucket === undefined) {
    bucket = new Map();
    buckets.set(category, bucket);
  }
  return bucket;
}

const WORD_SEPARATOR = /\s+/;

/** Accumulates a projection; the format-specific walkers write into it and `build` freezes it. */
export class ProjectionBuilder {
  readonly #format: ProjectionFormat;
  readonly #units = new Map<ProjectionCategory, Map<string, number>>();
  readonly #census = new Map<ProjectionCategory, Map<string, number>>();
  readonly #media = new Map<string, number>();
  readonly #cells = new Map<string, ProjectedCell>();
  readonly #unmodelled = new Set<string>();
  readonly #skipped: SkippedPart[] = [];

  constructor(format: ProjectionFormat) {
    this.#format = format;
  }

  get format(): ProjectionFormat {
    return this.#format;
  }

  /** Counts each whitespace-separated word of `text` as one unit of `category`. */
  addWords(category: ProjectionCategory, text: string): void {
    for (const word of text.split(WORD_SEPARATOR)) {
      if (word !== "") {
        this.addUnit(category, word);
      }
    }
  }

  addUnit(category: ProjectionCategory, unit: string): void {
    increment(bucketOf(this.#units, category), unit);
  }

  countFamily(category: ProjectionCategory, family: string): void {
    increment(bucketOf(this.#census, category), family);
  }

  addMedia(kind: "image" | "embedding", digest: string): void {
    increment(this.#media, `${kind}:${digest}`);
  }

  setCell(key: string, cell: ProjectedCell): void {
    this.#cells.set(key, cell);
  }

  addUnmodelled(partName: string): void {
    this.#unmodelled.add(partName.replace(/\d+/g, "N"));
  }

  skip(part: SkippedPart): void {
    this.#skipped.push(part);
  }

  /** Folds everything `other` gathered into this builder. A walker fills a scratch builder per part and merges it only when the part scanned to the end, so a part that fails halfway contributes nothing. */
  merge(other: ProjectionBuilder): void {
    for (const [category, bucket] of other.#units) {
      const target = bucketOf(this.#units, category);
      for (const [unit, count] of bucket) {
        increment(target, unit, count);
      }
    }
    for (const [category, bucket] of other.#census) {
      const target = bucketOf(this.#census, category);
      for (const [family, count] of bucket) {
        increment(target, family, count);
      }
    }
    for (const [key, count] of other.#media) {
      increment(this.#media, key, count);
    }
    for (const [key, cell] of other.#cells) {
      this.#cells.set(key, cell);
    }
  }

  build(): ContentProjection {
    return {
      format: this.#format,
      units: this.#units,
      census: this.#census,
      media: this.#media,
      cells: this.#cells,
      unmodelledParts: [...this.#unmodelled].sort(),
      skippedParts: this.#skipped,
    };
  }
}

/**
 * Text gathered in nested containers: a paragraph inside a text box inside a paragraph keeps its own buffer, and each buffer's words are counted when it closes. Counting at the container, not at each text run, is what makes a run split or merge invisible.
 */
export class TextContainers {
  readonly #builder: ProjectionBuilder;
  readonly #open: { category: ProjectionCategory; text: string }[] = [];

  constructor(builder: ProjectionBuilder) {
    this.#builder = builder;
  }

  open(category: ProjectionCategory): void {
    this.#open.push({ category, text: "" });
  }

  /** Appends to the innermost container; text with no open container is not part of any unit. */
  append(text: string): void {
    const top = this.#open[this.#open.length - 1];
    if (top !== undefined) {
      top.text += text;
    }
  }

  close(): string {
    const top = this.#open.pop();
    if (top === undefined) {
      return "";
    }
    this.#builder.addWords(top.category, top.text);
    return top.text;
  }
}
