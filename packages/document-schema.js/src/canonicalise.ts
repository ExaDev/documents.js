// Canonical key ordering for structural comparison and tuple identity, ported verbatim-in-spirit from document-outline.js's src/outline/hash.ts (the recipe the promotion plan locked as "the" canonicaliser -- one implementation across the family, not a second recipe that could drift). Rebuilds every plain object with its own keys sorted ascending by UTF-16 code unit (Array.prototype.sort's default comparison -- a total, implementation-specified-stable order), preserving arrays in order and primitives as-is. This removes construction-order differences between independently built but structurally identical content. `unknown` in, `unknown` out: the output is a fresh structure safe to hand to JSON.stringify, never a mutation of the input. Plain objects (the JSON-mappable class) are rebuilt with sorted keys; arrays are copied so the output never aliases the input.
//
// Not re-exported from the package's index barrel: it exists to give src/factor-styles.ts one tuple-identity recipe, and naming it there would invite a second caller to depend on the exact sort order as an API guarantee rather than as minting's internal determinism device. The `"./*"` subpath export still makes `document-schema.js/canonicalise` importable directly, per the README's "every module is also importable directly" -- omitting it from the barrel narrows what index.ts re-exports, not what the package publishes.
export function canonicalise(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalise);
  if (isRecord(value)) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort())
      sorted[key] = canonicalise(value[key]);
    return sorted;
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Tuple identity per the promotion plan's minting rules ("tuple identity reuses stableContentHash's canonicalise-then-stringify recipe -- no second recipe"): the canonical string IS the key, so equal-valued tuples built in different key orders land on one map slot and the tie-break ordering compares the same bytes the identity does. JSON.stringify drops undefined-valued properties, so an optional field left absent and one explicitly assigned undefined collapse to the same key -- both spellings mean "field absent" in the content schemas.
export function canonicalKey(value: unknown): string {
  return JSON.stringify(canonicalise(value));
}
