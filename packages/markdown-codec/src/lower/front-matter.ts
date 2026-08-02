// Leading YAML front matter -> a flat-scalar-only subset of document-schema.js's LayoutMetadata, stripped before block parsing (ReadMarkdownOptions.frontMatter's own comment) -- a line of exactly '---', a run of lines, a closing line of exactly '---' or '...'. This is NOT a real YAML or TOML parser: it recognises exactly one shape, `key: value` lines (plus one array special case for `keywords`), and maps five known keys onto LayoutMetadata's own fields. `producer` is never set here -- that field is PDF-writer-only per document-schema.js's own LayoutMetadata schema comment, and front matter has no equivalent concept to map from regardless. Every OTHER key is reported through the sink (MarkdownDiagnosticCodes.FRONT_MATTER_KEY_UNMAPPED) and dropped; a line that is not `key: value` at all (a nested mapping, a block list, a multi-line scalar) is silently skipped rather than partially interpreted, since genuinely parsing those shapes is exactly the "real YAML/TOML parser" this module deliberately is not.

import type { LayoutMetadata } from 'document-schema.js';
import type { MarkdownDiagnosticSink } from '../diagnostics/diagnostics';
import { MarkdownDiagnosticCodes, NOOP_MARKDOWN_DIAGNOSTIC_SINK } from '../diagnostics/diagnostics';

const LEADING_DELIMITER_PATTERN = /^---[ \t]*$/;
const CLOSING_DELIMITER_PATTERN = /^(?:---|\.\.\.)[ \t]*$/;
const KEY_VALUE_LINE_PATTERN = /^([A-Za-z_][A-Za-z0-9_-]*):[ \t]*(.*)$/;
const LINE_ENDING_PATTERN = /\r\n|\n|\r/;

export interface FrontMatterResult {
  readonly metadata: LayoutMetadata;
  readonly rest: string;
}

function parseScalar(raw: string): string {
  const trimmed = raw.trim();
  const isDoubleQuoted = trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"');
  const isSingleQuoted = trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'");
  return isDoubleQuoted || isSingleQuoted ? trimmed.slice(1, -1) : trimmed;
}

// `keywords: [a, b, c]` (YAML flow-sequence syntax, still a single "flat" line) or a bare comma-separated fallback -- both are scalars-in-one-line, matching this module's own "flat-scalar-only" scope; a YAML block sequence (`keywords:` followed by indented `- a` lines) is a multi-line shape this module does not parse at all.
function parseKeywordList(raw: string): readonly string[] {
  const trimmed = raw.trim();
  const inner = trimmed.startsWith('[') && trimmed.endsWith(']') ? trimmed.slice(1, -1) : trimmed;
  return inner
    .split(',')
    .map((item) => parseScalar(item))
    .filter((item) => item.length > 0);
}

// Extracts a leading front matter block from `source`, returning the flat-scalar subset it maps and the remainder of the document for parseMarkdown to read as ordinary CommonMark/GFM. Returns an empty metadata object and the source UNCHANGED when there is no leading '---' line, or when a leading '---' line has no matching closing delimiter at all (a bare '---' with nothing closing it is CommonMark's own thematic-break-then-paragraph reading of the same bytes, not front matter).
export function extractFrontMatter(source: string, sink: MarkdownDiagnosticSink = NOOP_MARKDOWN_DIAGNOSTIC_SINK): FrontMatterResult {
  const lines = source.split(LINE_ENDING_PATTERN);
  const firstLine = lines[0];
  if (firstLine === undefined || !LEADING_DELIMITER_PATTERN.test(firstLine)) {
    return { metadata: {}, rest: source };
  }

  let closingIndex = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (CLOSING_DELIMITER_PATTERN.test(lines[index] ?? '')) {
      closingIndex = index;
      break;
    }
  }
  if (closingIndex === -1) {
    return { metadata: {}, rest: source };
  }

  const metadata: { title?: string; author?: string; subject?: string; keywords?: string[]; creator?: string; createdIso?: string } = {};
  for (let index = 1; index < closingIndex; index += 1) {
    const line = lines[index] ?? '';
    if (line.trim().length === 0) {
      continue;
    }
    const match = KEY_VALUE_LINE_PATTERN.exec(line);
    const key = match?.[1];
    const value = match?.[2];
    if (key === undefined || value === undefined) {
      continue;
    }
    switch (key) {
      case 'title':
        metadata.title = parseScalar(value);
        break;
      case 'author':
        metadata.author = parseScalar(value);
        break;
      case 'subject':
        metadata.subject = parseScalar(value);
        break;
      case 'creator':
        metadata.creator = parseScalar(value);
        break;
      case 'date':
        metadata.createdIso = parseScalar(value);
        break;
      case 'keywords':
        metadata.keywords = [...parseKeywordList(value)];
        break;
      default:
        sink({ code: MarkdownDiagnosticCodes.FRONT_MATTER_KEY_UNMAPPED, severity: 'info', message: `front matter key "${key}" has no LayoutMetadata equivalent and was dropped`, line: index + 1 });
    }
  }

  return { metadata, rest: lines.slice(closingIndex + 1).join('\n') };
}
