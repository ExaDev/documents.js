import type { LayoutMetadata } from "documents.js";

// The one place a `LayoutMetadata` value turns into human-readable lines, shared by the `metadata`/`pdf-inspect` commands and the TUI's own `metadata` screen -- the same relationship `docx-extras-format.ts` has to `docx-extras` and the TUI's own `docxExtras` screen, and for the same reason: several call sites need the identical "only the fields actually present, one per line" rendering, and duplicating it would drift the moment one of them changed the wording.

// Every field `LayoutMetadata` carries, in the fixed display order every caller of this module renders them in.
const METADATA_KEYS: readonly (keyof LayoutMetadata)[] = [
  "title",
  "author",
  "subject",
  "keywords",
  "creator",
  "producer",
  "createdIso",
  "modifiedIso",
];

function isPresent<T>(
  entry: readonly [string, T | undefined],
): entry is readonly [string, T] {
  return entry[1] !== undefined;
}

// Checks typeof value === 'string', not Array.isArray(value) -- Array.isArray's own lib.es5.d.ts signature (`arg is any[]`) can't narrow a `readonly string[]` out of the else branch (a readonly array isn't assignable to the mutable `any[]` the predicate names, so TypeScript can't exclude it), leaving `value` typed `string | readonly string[]` there regardless of how the check is written. Testing the `string` arm directly narrows correctly in both branches.
export function formatMetadataValue(value: string | readonly string[]): string {
  return typeof value === "string" ? value : value.join(", ");
}

// Every field the metadata actually carries, in METADATA_KEYS's own fixed order -- keywords survives as its own array rather than being pre-joined, so a caller that wants the raw value (as opposed to formatMetadataValue's display string) still has it.
export function presentMetadataEntries(
  metadata: LayoutMetadata,
): readonly (readonly [string, string | readonly string[]])[] {
  const entries: readonly (readonly [
    string,
    string | readonly string[] | undefined,
  ])[] = METADATA_KEYS.map((key) => [key, metadata[key]] as const);
  return entries.filter(isPresent);
}

// One "key: value" line per field actually present, in METADATA_KEYS's own fixed order -- an empty array means the document carries no metadata at all, which every caller of this module renders as its own "no metadata" message rather than an empty section.
export function formatMetadataLines(
  metadata: LayoutMetadata,
): readonly string[] {
  return presentMetadataEntries(metadata).map(
    ([key, value]) => `${key}: ${formatMetadataValue(value)}`,
  );
}
