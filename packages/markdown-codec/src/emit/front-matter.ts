// LayoutMetadata -> a leading YAML front matter block, the structural inverse of src/lower/front-matter.ts. Emits exactly the same five keys that side reads (title/author/subject/keywords/date<-createdIso/creator) and nothing else -- `producer` and `modifiedIso` have no front matter key of their own in this package's own mapping and are never emitted, matching the read side's own scope exactly.

import type { LayoutMetadata } from 'document-schema.js';

// A scalar needs quoting when it would otherwise be misread as something else: a leading '-'/'?'/'#'/'!'/'&'/'*' or a colon-plus-space anywhere collides with YAML's own block-mapping/sequence/comment/anchor/alias syntax.
const NEEDS_QUOTING_PATTERN = /^[-?#!&*"'@`|>[\]{}%]|: |:$/;

function emitScalar(value: string): string {
  if (!NEEDS_QUOTING_PATTERN.test(value) && value.trim() === value && value.length > 0) {
    return value;
  }
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

export function emitFrontMatter(metadata: LayoutMetadata): string | undefined {
  const lines: string[] = [];
  if (metadata.title !== undefined) {
    lines.push(`title: ${emitScalar(metadata.title)}`);
  }
  if (metadata.author !== undefined) {
    lines.push(`author: ${emitScalar(metadata.author)}`);
  }
  if (metadata.subject !== undefined) {
    lines.push(`subject: ${emitScalar(metadata.subject)}`);
  }
  if (metadata.creator !== undefined) {
    lines.push(`creator: ${emitScalar(metadata.creator)}`);
  }
  if (metadata.createdIso !== undefined) {
    lines.push(`date: ${emitScalar(metadata.createdIso)}`);
  }
  if (metadata.keywords !== undefined && metadata.keywords.length > 0) {
    lines.push(`keywords: [${metadata.keywords.map((keyword) => emitScalar(keyword)).join(', ')}]`);
  }
  if (lines.length === 0) {
    return undefined;
  }
  return ['---', ...lines, '---'].join('\n');
}
