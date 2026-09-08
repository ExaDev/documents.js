// LayoutMetadata -> a leading YAML front matter block, the structural inverse of src/lower/front-matter.ts. Emits every key that side reads (STRING_FIELD_SETTERS, plus `keywords` and `direction`) and nothing else -- `producer` has no front matter key of its own in this package's own mapping and is never emitted, matching the read side's own scope exactly.

import type { LayoutMetadata } from "document-schema.js";

// A scalar needs quoting when it would otherwise be misread as something else: a leading '-'/'?'/'#'/'!'/'&'/'*' or a colon-plus-space anywhere collides with YAML's own block-mapping/sequence/comment/anchor/alias syntax.
const NEEDS_QUOTING_PATTERN = /^[-?#!&*"'@`|>[\]{}%]|: |:$/;

function emitScalar(value: string): string {
  if (
    !NEEDS_QUOTING_PATTERN.test(value) &&
    value.trim() === value &&
    value.length > 0
  ) {
    return value;
  }
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

// Every string-valued LayoutMetadata field this module emits, paired with the front-matter key src/lower/front-matter.ts's own STRING_FIELD_SETTERS reads it back under -- kept as an explicit list (not derived from that module's own table) so each entry can name its own LayoutMetadata accessor with a real type instead of a string-keyed lookup.
const STRING_FIELD_ENTRIES: readonly [
  string,
  (metadata: LayoutMetadata) => string | undefined,
][] = [
  ["title", (metadata) => metadata.title],
  ["author", (metadata) => metadata.author],
  ["subject", (metadata) => metadata.subject],
  ["creator", (metadata) => metadata.creator],
  ["date", (metadata) => metadata.createdIso],
  ["modified", (metadata) => metadata.modifiedIso],
  ["lastPrinted", (metadata) => metadata.lastPrintedIso],
  ["language", (metadata) => metadata.language],
  ["publisher", (metadata) => metadata.publisher],
  ["contributor", (metadata) => metadata.contributor],
  ["rights", (metadata) => metadata.rights],
  ["identifier", (metadata) => metadata.identifier],
  ["comments", (metadata) => metadata.comments],
  ["company", (metadata) => metadata.company],
  ["manager", (metadata) => metadata.manager],
];

export function emitFrontMatter(metadata: LayoutMetadata): string | undefined {
  const lines: string[] = [];
  for (const [key, accessor] of STRING_FIELD_ENTRIES) {
    const value = accessor(metadata);
    if (value !== undefined) {
      lines.push(`${key}: ${emitScalar(value)}`);
    }
  }
  if (metadata.direction !== undefined) {
    lines.push(`direction: ${metadata.direction}`);
  }
  if (metadata.keywords !== undefined && metadata.keywords.length > 0) {
    lines.push(
      `keywords: [${metadata.keywords.map((keyword) => emitScalar(keyword)).join(", ")}]`,
    );
  }
  if (lines.length === 0) {
    return undefined;
  }
  return ["---", ...lines, "---"].join("\n");
}
