import { z } from 'zod';

// The semantic half of this package's two-layer math model. A formula is stored as two co-equal authoritative layers, joined in ContentFormulaSchema (src/content.ts): presentation -- a verbatim LaTeX string a renderer serialises exactly as stored, never re-derived from semantics -- and content -- a MathExpression tree from this module, which a computer can evaluate. Neither layer is stored derived from the other: string-to-tree lowering is total (any input at least degrades to an `unparsed` node), tree-to-string rendering is partial (some trees have no conventional linear form), and storage takes the recoverable side of that asymmetry by carrying both verbatim. The atomic pair-edit rule the whole design serves: editing one layer must never silently mutate the other, and any canonical/normalised form used to match or diff the two is a derived view computed at comparison time, never written back into either layer. This module holds only schemas and structural type guards, no lowering or rendering logic -- those live in the packages that produce and consume formulas.

// -- Exact rationals --

// Canonical encodings for the two halves of an exact rational, as decimal-integer strings rather than JS numbers: Number loses integer exactness above 2^53, and exactness is the entire point of carrying rationals here (unit-conversion chains and quantity equality stay bit-exact when every step is integer arithmetic over canonical strings). The patterns enforce the canonical spellings directly -- numerator '0' or a signed integer with no leading zeros and no '-0', denominator a positive integer with no leading zeros -- so every value that validates has exactly one spelling and string equality is value equality within each half. Lowest terms (2/4 reduced to 1/2) is a producer convention the shape cannot check; cross-multiplying two rationals is the exact comparison for producers that skip the reduction step.
const CANONICAL_SIGNED_INTEGER = /^(0|-?[1-9]\d*)$/;
const CANONICAL_POSITIVE_INTEGER = /^[1-9]\d*$/;

const EXACT_RATIONAL_FIELDS = {
  numerator: z.string().regex(CANONICAL_SIGNED_INTEGER), // carries the rational's sign; '0' is the unique zero
  denominator: z.string().regex(CANONICAL_POSITIVE_INTEGER), // strictly positive, so the sign lives on the numerator alone and each rational has one valid shape
};

// An exact rational number. Plain integers are the denominator-'1' case; there is deliberately no separate integer node, since one numeric leaf keeps the grammar closed and every consumer's arithmetic uniform.
export const ExactRationalSchema = z.object(EXACT_RATIONAL_FIELDS);
export type ExactRational = z.infer<typeof ExactRationalSchema>;

// -- Dimensions --

// The seven SI base quantities (SI Brochure order), the axes every derived quantity's dimension is expressed over. Closed on purpose: adding a base dimension is a schema-level change, not something a document may do locally, and the current seven cover every SI-coherent quantity.
export const SI_BASE_DIMENSIONS = [
  'length',
  'mass',
  'time',
  'electricCurrent',
  'thermodynamicTemperature',
  'amountOfSubstance',
  'luminousIntensity',
] as const;
export type SiBaseDimension = (typeof SI_BASE_DIMENSIONS)[number];

// A dimension as exponents over the SI bases, one entry per base with a non-zero exponent -- speed is { length: 1, time: -1 }, force { length: 1, mass: 1, time: -2 }, and an omitted key means exponent zero. Exponents are integers because every SI-coherent derived quantity is an integer product of base quantities. {} is the dimensionless vector (radian, count, a per-unit ratio).
export const DimensionVectorSchema = z.partialRecord(z.enum(SI_BASE_DIMENSIONS), z.number().int());
export type DimensionVector = z.infer<typeof DimensionVectorSchema>;

// -- Units --

// One entry in a document's unit registry (SymbolTableSchema.units below). Units are referenced everywhere else by their id only, so this entry is the single place a unit's meaning is carried. ids are namespaced ('si:metre', 'imperial:foot', 'psu:pu-power') with the prefix before the first ':' naming the registry the definition belongs to; symbols are the unit's own short written form ('m', 'ft'). The registry is document-carried data, not a table shipped inside this package: this package defines the shapes, and each producer registers the units its quantities actually use, SI ones included, under the 'si:' namespace. Conversion is exact by construction: factorToSi/offsetToSi are exact rationals relating this unit to the coherent SI unit of the same dimension via si_value = value * factorToSi + offsetToSi (linear units such as the foot carry factor 381/1250 and no offset; affine scales such as degree Celsius carry factor 1 and offset 5463/20; compound dimensions convert against the coherent SI product, e.g. the foot-per-second against m/s). Compound quantities reference one registered unit id ('si:metre-per-second') rather than composing units inside an expression -- unit algebra (multiplying dimensions, chaining conversions) happens over these entries' dimension vectors and exact factors, which is where the exact-rational representation pays off.
export const MathUnitSchema = z.object({
  id: z.string(), // namespaced registry id, e.g. 'si:metre', 'imperial:foot'
  symbol: z.string(), // the unit's own short written form, e.g. 'm', 'ft'
  name: z.string().optional(), // full human name, e.g. 'metre'
  dimension: DimensionVectorSchema, // exponents over the SI bases; {} means dimensionless
  factorToSi: ExactRationalSchema, // exact scale to the coherent SI unit of this unit's own dimension
  offsetToSi: ExactRationalSchema.optional(), // exact affine shift for scales whose zero differs from SI's (temperature scales); absent means zero
  context: z.string().optional(), // id of the normalisation context (below) this unit exists inside, set only on domain-normalised units
});
export type MathUnit = z.infer<typeof MathUnitSchema>;

// A domain normalisation context: the declared base a family of quantities has been divided by, per-unit systems being the canonical example (a power study normalised against 100 MVA and 11 kV bases). A normalised quantity is dimensionless in SI terms, so its unit entry carries this context's id and the base definition lives here -- the thing a consumer needs to de-normalise back to SI units. bases lists the normalisation quantities as unit ids with their exact base values; ids are namespaced like unit ids ('psu:100mva-11kv').
export const MathNormalisationContextSchema = z.object({
  id: z.string(),
  bases: z.array(
    z.object({
      unit: z.string(), // registry id of the base quantity's unit, e.g. 'si:volt-ampere'
      value: ExactRationalSchema, // the exact base value in that unit, e.g. 100 (MVA)
    }),
  ),
});
export type MathNormalisationContext = z.infer<typeof MathNormalisationContextSchema>;

// -- The symbol table --

// One curation entry: what a single written symbol means. The key is the pair (glyph, scope) -- the written form plus the region of the document it is distinct in -- because the same glyph legitimately names different quantities in different scopes ('m' for mass in one section, metres in another). The payload is the reference side: id is what a MathExpression 'sym' node points at, quantityKind links the symbol into a quantity vocabulary ('si:mass'), preferredUnit is a unit-registry id, and definitionSource records where the definition came from (document prose, a citation, a standard). (glyph, scope) uniqueness is a producer convention the array shape cannot enforce; consumers building a lookup should treat duplicates as a curatorial error, not silently pick one. Entries are presentation-inert by construction -- they describe what a symbol means, never how any formula renders.
export const MathSymbolEntrySchema = z.object({
  glyph: z.string(), // the written form as it appears in presentation, e.g. 'U', 'm_e'
  scope: z.string(), // the disambiguating scope path, e.g. 'document', 'sections/2'
  id: z.string(), // canonical symbol id, what MathExpression 'sym' nodes reference, e.g. 'symbols:voltage'
  quantityKind: z.string().optional(), // quantity vocabulary id, e.g. 'si:mass'
  preferredUnit: z.string().optional(), // unit-registry id this symbol's quantities are most naturally expressed in
  definitionSource: z.string().optional(), // where the definition came from: a prose anchor, citation, or standard
});
export type MathSymbolEntry = z.infer<typeof MathSymbolEntrySchema>;

// The document-level symbol table: the curation layer that makes a document's equations computable, and the unit registry those equations resolve against. Carried on every ContentDocument arm as the optional `symbolTable` field (src/content.ts) so a formula's expressions stay small -- they reference symbols and units by id, and the definitions live here once per document. A standalone value on purpose: one document's table is importable into another, which is how curated meaning travels without dragging the formulas along.
export const SymbolTableSchema = z.object({
  symbols: z.array(MathSymbolEntrySchema),
  units: z.array(MathUnitSchema), // the unit registry: every unit any 'qty' in this document references, SI ones included
  contexts: z.array(MathNormalisationContextSchema).optional(), // domain normalisation contexts, present only when the document uses normalised units
});
export type SymbolTable = z.infer<typeof SymbolTableSchema>;

// -- The two layers' carrying shapes --

// The rendering-authoritative layer's whole content: the formula's LaTeX, stored verbatim. An object around one field rather than a bare string so the layer can grow sibling fields (alternative notations, rendering hints) without another format change; a renderer serialises this string exactly as it stands and never re-emits it from the semantic layer.
export const MathPresentationSchema = z.object({
  latex: z.string(),
});
export type MathPresentation = z.infer<typeof MathPresentationSchema>;

// Where a formula came from and what has touched it since: source names the origin (a format part path such as 'odf:content.xml#Object1', or a pipeline stage such as 'lowered:latex'), pageRef locates it in the source document when the source is paginated, and editTrail is the append-only audit log in producer-defined detail (who edited, when, what changed) -- free-form strings because this is annotation for humans and provenance tooling, not an input to computation.
export const MathProvenanceSchema = z.object({
  source: z.string(),
  pageRef: z.string().optional(),
  editTrail: z.array(z.string()),
});
export type MathProvenance = z.infer<typeof MathProvenanceSchema>;

// A measured quantity's uncertainty, GUM-style: magnitude is the +/- half-width as an exact rational, expressed in the quantity's own unit unless unit overrides it (rare, but an uncertainty quoted in a percentage unit while the value is absolute is a real convention). coverageFactor is the k the magnitude was expanded by (k = 2 for the usual approximate 95 % interval) -- a stated convention factor, so a plain number rather than an exact rational.
export const MathUncertaintySchema = z.object({
  magnitude: ExactRationalSchema,
  unit: z.string().optional(), // registry id; absent means the quantity's own unit
  coverageFactor: z.number().positive().optional(), // k factor the magnitude was expanded by; absent means k = 1 (standard uncertainty)
});
export type MathUncertainty = z.infer<typeof MathUncertaintySchema>;

// -- The expression grammar: non-recursive variants --

// The grammar is closed -- these variants plus the recursive ones below are the whole node vocabulary -- and extensible: domain semantics enter through the namespaced operator registry ('app' below) and new node kinds are schema versions, not local extensions.

export const MathNumSchema = z.object({
  kind: z.literal('num'),
  ...EXACT_RATIONAL_FIELDS,
});
export type MathNum = z.infer<typeof MathNumSchema>;

export const MathQtySchema = z.object({
  kind: z.literal('qty'),
  value: ExactRationalSchema, // the measured or exact value, itself rational so unit chains over it stay exact
  unit: z.string(), // unit-registry id this quantity is expressed in, e.g. 'si:metre'
  uncertainty: MathUncertaintySchema.optional(),
});
export type MathQty = z.infer<typeof MathQtySchema>;

// A named symbol, referenced by table id rather than written form: the symbol table owns glyph-to-meaning curation, and an expression that embedded glyphs would duplicate it. id resolves lexically -- a 'sum'/'prod' binder whose binder name matches shadows the table entry inside that binder's body (the bound variable is local), and otherwise the id is looked up in the document's symbolTable. An id matching neither is a dangling reference, detectable by a consumer walking the expression against the table, not by this grammar alone.
export const MathSymSchema = z.object({
  kind: z.literal('sym'),
  id: z.string(), // symbol-table id, or a binder-local name within the binder that introduced it
});
export type MathSym = z.infer<typeof MathSymSchema>;

// The first-class fallback: source LaTeX this grammar could not cover, so a coverage gap stays visible data instead of becoming a parse failure. Anything can degrade to this node; nothing below it is interpreted.
export const MathUnparsedSchema = z.object({
  kind: z.literal('unparsed'),
  latex: z.string(), // the verbatim source construct that resisted lowering
});
export type MathUnparsed = z.infer<typeof MathUnparsedSchema>;

// -- The expression grammar: recursive variants --

// Operator application. operator is a namespaced registry id -- 'math:divide', 'math:sqrt' for the core arithmetic registry every reference consumer of this grammar implements, a domain prefix for a domain registry ('physics:planck', room for later registries) -- with everything about the operator (its arity, argument order, semantics) owned by the registry its prefix names, not restated here. args is variadic for the same reason: the registry defines how many arguments mean what.
export interface MathApp {
  kind: 'app';
  operator: string;
  args: MathExpression[];
}

// Shared shape of the two binder variants (MathSum/MathProd below): binder is the bound variable's own name, lexically scoped to this binder's body (it shadows same-id symbol-table entries there); lower/upper are the bounds as full expressions -- a set-membership lower bound such as i element-of S is itself an 'app', and bounds referencing a table symbol (an infinity entry, say) are 'sym' nodes; body is the summand/product the binder ranges over.
export interface MathSum {
  kind: 'sum';
  binder: string;
  lower: MathExpression;
  upper: MathExpression;
  body: MathExpression;
}

export interface MathProd {
  kind: 'prod';
  binder: string;
  lower: MathExpression;
  upper: MathExpression;
  body: MathExpression;
}

// A matrix as rows of expressions -- nested arrays rather than a flat array plus row/column counts, so the shape is its own dimension statement and the only invariant left to check is that every row has the same number of columns (enforced on both validation paths below). Entry order is row-major, the universal convention.
export interface MathMatrix {
  kind: 'matrix';
  rows: MathExpression[][];
}

// MathExpression is recursive through app args, binder bounds/bodies, and matrix rows -- hand-written with a structural z.custom() guard below, mirroring ContentBlock's and MathMlNode's identical treatment, since z.lazy() collapses to `unknown` for recursive children in the pinned Zod version.
export type MathExpression = MathNum | MathQty | MathSym | MathApp | MathSum | MathProd | MathMatrix | MathUnparsed;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isExactRational(value: unknown): value is ExactRational {
  return (
    isRecord(value) &&
    typeof value.numerator === 'string' &&
    CANONICAL_SIGNED_INTEGER.test(value.numerator) &&
    typeof value.denominator === 'string' &&
    CANONICAL_POSITIVE_INTEGER.test(value.denominator)
  );
}

function isMathUncertainty(value: unknown): value is MathUncertainty {
  return (
    isRecord(value) &&
    isExactRational(value.magnitude) &&
    (value.unit === undefined || typeof value.unit === 'string') &&
    (value.coverageFactor === undefined || (typeof value.coverageFactor === 'number' && value.coverageFactor > 0))
  );
}

// Recursive structural guard, mirroring the per-variant Zod schemas' checks by hand (including the canonical-integer patterns and the equal-width matrix rule) so the z.custom() node validates exactly what the named schemas validate. Used via z.custom so recursive children validate without a recursive Zod schema -- the same treatment as ContentBlockSchema/ContentEmbeddedObjectSchema (src/content.ts) and MathMlNodeSchema (src/mathml.ts).
export function isMathExpression(value: unknown): value is MathExpression {
  if (!isRecord(value)) {
    return false;
  }
  const kind = value.kind;
  if (kind === 'num') {
    return (
      typeof value.numerator === 'string' &&
      CANONICAL_SIGNED_INTEGER.test(value.numerator) &&
      typeof value.denominator === 'string' &&
      CANONICAL_POSITIVE_INTEGER.test(value.denominator)
    );
  }
  if (kind === 'qty') {
    return (
      isExactRational(value.value) &&
      typeof value.unit === 'string' &&
      (value.uncertainty === undefined || isMathUncertainty(value.uncertainty))
    );
  }
  if (kind === 'sym') {
    return typeof value.id === 'string';
  }
  if (kind === 'app') {
    return typeof value.operator === 'string' && Array.isArray(value.args) && value.args.every(isMathExpression);
  }
  if (kind === 'sum' || kind === 'prod') {
    return (
      typeof value.binder === 'string' &&
      isMathExpression(value.lower) &&
      isMathExpression(value.upper) &&
      isMathExpression(value.body)
    );
  }
  if (kind === 'matrix') {
    if (!Array.isArray(value.rows)) {
      return false;
    }
    const widths = new Set<number>();
    for (const row of value.rows) {
      if (!Array.isArray(row) || !row.every(isMathExpression)) {
        return false;
      }
      widths.add(row.length);
    }
    return widths.size <= 1;
  }
  if (kind === 'unparsed') {
    return typeof value.latex === 'string';
  }
  return false;
}

export const MathExpressionSchema = z.custom<MathExpression>(isMathExpression);

// The per-variant schemas for the recursive kinds, defined after MathExpressionSchema because their child fields go through it -- matching MathMlElementSchema's own placement after MathMlNodeSchema (src/mathml.ts). The non-recursive variants' schemas sit with the leaves above.

export const MathAppSchema = z.object({
  kind: z.literal('app'),
  operator: z.string(), // namespaced operator-registry id, e.g. 'math:divide'
  args: z.array(MathExpressionSchema),
});

const BINDER_SCHEMA_FIELDS = {
  binder: z.string(),
  lower: MathExpressionSchema,
  upper: MathExpressionSchema,
  body: MathExpressionSchema,
};

// sum and prod are two variants of one shape rather than one 'binder' variant with an op field, so a consumer's exhaustive switch over the grammar distinguishes them at the discriminant like every other kind.
export const MathSumSchema = z.object({
  kind: z.literal('sum'),
  ...BINDER_SCHEMA_FIELDS,
});

export const MathProdSchema = z.object({
  kind: z.literal('prod'),
  ...BINDER_SCHEMA_FIELDS,
});

// The equal-row-width refinement is the one matrix invariant the nested-array shape cannot state structurally; it mirrors the identical check in isMathExpression's 'matrix' branch so both validation paths accept and reject the same values.
export const MathMatrixSchema = z.object({
  kind: z.literal('matrix'),
  rows: z.array(z.array(MathExpressionSchema)),
}).refine((matrix) => new Set(matrix.rows.map((row) => row.length)).size <= 1, {
  message: 'matrix rows must all have the same number of columns',
});
