// Leading YAML front matter -> a flat-scalar-only subset of document-schema.js's LayoutMetadata, stripped before block parsing (ReadMarkdownOptions.frontMatter's own comment) -- a line of exactly '---', a run of lines, a closing line of exactly '---' or '...'. This is NOT a real YAML or TOML parser: it recognises exactly one shape, `key: value` lines (plus one array special case for `keywords`), and maps every LayoutMetadata field that a front-matter line can meaningfully carry (STRING_FIELD_SETTERS, plus `keywords` and `direction`, below) onto LayoutMetadata's own fields. `producer` is never set here -- that field is PDF-writer-only per document-schema.js's own LayoutMetadata schema comment, and front matter has no equivalent concept to map from regardless. Every OTHER key is reported through the sink (MarkdownDiagnosticCodes.FRONT_MATTER_KEY_UNMAPPED) and dropped; a line that is not `key: value` at all (a nested mapping, a block list, a multi-line scalar) is silently skipped rather than partially interpreted, since genuinely parsing those shapes is exactly the "real YAML/TOML parser" this module deliberately is not.
//
// Extending this to a genuine YAML/TOML engine was weighed against extending the flat-scalar recogniser and rejected: LayoutMetadata itself (document-schema.js's own schema) is a flat bag of scalars plus one array (`keywords`) and one two-member enum (`direction`) -- nothing in it needs a real parser's block-mapping, anchor, or multi-document support, and this package's own README states its whole bet as "hand-write the format instead of wrapping a third-party library" (enforced elsewhere by eslint `no-restricted-imports` against markdown-parsing libraries specifically). Pulling in a YAML dependency to parse a shape this module can already fully enumerate would trade a zero-dependency, exhaustively-testable recogniser for a general-purpose parser this package would still only ever feed flat `key: value` lines.

import type { LayoutMetadata, TextDirection } from "document-schema.js";
import type { MarkdownDiagnosticSink } from "../diagnostics/diagnostics";
import {
  MarkdownDiagnosticCodes,
  NOOP_MARKDOWN_DIAGNOSTIC_SINK,
} from "../diagnostics/diagnostics";
import { LINE_ENDING_PATTERN } from "../shared/line-ending";

const LEADING_DELIMITER_PATTERN = /^---[ \t]*$/;
const CLOSING_DELIMITER_PATTERN = /^(?:---|\.\.\.)[ \t]*$/;
const KEY_VALUE_LINE_PATTERN = /^([A-Za-z_][A-Za-z0-9_-]*):[ \t]*(.*)$/;

type MutableLayoutMetadata = {
  -readonly [K in keyof LayoutMetadata]?: LayoutMetadata[K];
};

// Every front-matter key this module recognises, as a setter closed over its own LayoutMetadata field -- a function per key rather than a plain string-keyed lookup table, so assigning the parsed scalar into `metadata` never needs an index-signature cast (each closure already knows its own field's real type). Covers the complete set of STRING-VALUED LayoutMetadata fields (document-schema.js) minus `producer` (PDF-writer-only, no front-matter equivalent); `keywords` (array) and `direction` (two-member enum) are handled separately below, since neither is a bare scalar assignment. `date`/`modified`/`lastPrinted` keep the shorter, front-matter-conventional spellings src/emit/front-matter.ts already used for `date` <-> createdIso; the rest use the LayoutMetadata field name verbatim since there is no shorter convention to prefer.
const STRING_FIELD_SETTERS: Record<
  string,
  (metadata: MutableLayoutMetadata, value: string) => void
> = {
  title: (metadata, value) => {
    metadata.title = value;
  },
  author: (metadata, value) => {
    metadata.author = value;
  },
  subject: (metadata, value) => {
    metadata.subject = value;
  },
  creator: (metadata, value) => {
    metadata.creator = value;
  },
  date: (metadata, value) => {
    metadata.createdIso = value;
  },
  modified: (metadata, value) => {
    metadata.modifiedIso = value;
  },
  lastPrinted: (metadata, value) => {
    metadata.lastPrintedIso = value;
  },
  language: (metadata, value) => {
    metadata.language = value;
  },
  publisher: (metadata, value) => {
    metadata.publisher = value;
  },
  contributor: (metadata, value) => {
    metadata.contributor = value;
  },
  rights: (metadata, value) => {
    metadata.rights = value;
  },
  identifier: (metadata, value) => {
    metadata.identifier = value;
  },
  comments: (metadata, value) => {
    metadata.comments = value;
  },
  company: (metadata, value) => {
    metadata.company = value;
  },
  manager: (metadata, value) => {
    metadata.manager = value;
  },
};

function isTextDirection(value: string): value is TextDirection {
  return value === "ltr" || value === "rtl";
}

export interface FrontMatterResult {
  readonly metadata: LayoutMetadata;
  readonly rest: string;
  // The original front-matter block verbatim, delimiters included, present exactly when one was found and extracted -- what a same-format writer re-emits as-is (the restorable tier) so original spellings a flat-scalar metadata mapping cannot hold (unmapped keys, quote styles, ordering) survive the round trip.
  readonly source: string | undefined;
}

function parseScalar(raw: string): string {
  const trimmed = raw.trim();
  const isDoubleQuoted =
    trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"');
  const isSingleQuoted =
    trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'");
  return isDoubleQuoted || isSingleQuoted ? trimmed.slice(1, -1) : trimmed;
}

// `keywords: [a, b, c]` (YAML flow-sequence syntax, still a single "flat" line) or a bare comma-separated fallback -- both are scalars-in-one-line, matching this module's own "flat-scalar-only" scope; a YAML block sequence (`keywords:` followed by indented `- a` lines) is a multi-line shape this module does not parse at all.
function parseKeywordList(raw: string): readonly string[] {
  const trimmed = raw.trim();
  const inner =
    trimmed.startsWith("[") && trimmed.endsWith("]")
      ? trimmed.slice(1, -1)
      : trimmed;
  return inner
    .split(",")
    .map((item) => parseScalar(item))
    .filter((item) => item.length > 0);
}

// Extracts a leading front matter block from `source`, returning the flat-scalar subset it maps and the remainder of the document for parseMarkdown to read as ordinary CommonMark/GFM. Returns an empty metadata object and the source UNCHANGED when there is no leading '---' line, or when a leading '---' line has no matching closing delimiter at all (a bare '---' with nothing closing it is CommonMark's own thematic-break-then-paragraph reading of the same bytes, not front matter).
export function extractFrontMatter(
  source: string,
  sink: MarkdownDiagnosticSink = NOOP_MARKDOWN_DIAGNOSTIC_SINK,
): FrontMatterResult {
  const lines = source.split(LINE_ENDING_PATTERN);
  const firstLine = lines[0];
  if (firstLine === undefined || !LEADING_DELIMITER_PATTERN.test(firstLine)) {
    return { metadata: {}, rest: source, source: undefined };
  }

  let closingIndex = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (CLOSING_DELIMITER_PATTERN.test(lines[index] ?? "")) {
      closingIndex = index;
      break;
    }
  }
  if (closingIndex === -1) {
    return { metadata: {}, rest: source, source: undefined };
  }

  const metadata: MutableLayoutMetadata = {};
  for (let index = 1; index < closingIndex; index += 1) {
    const line = lines[index] ?? "";
    if (line.trim().length === 0) {
      continue;
    }
    const match = KEY_VALUE_LINE_PATTERN.exec(line);
    const key = match?.[1];
    const value = match?.[2];
    if (key === undefined || value === undefined) {
      continue;
    }
    if (key === "keywords") {
      metadata.keywords = [...parseKeywordList(value)];
      continue;
    }
    if (key === "direction") {
      // An unrecognised value is not "direction has no LayoutMetadata equivalent" (it does); it is a value TextDirectionSchema's own two-member enum cannot hold, so it is silently skipped rather than reported through FRONT_MATTER_KEY_UNMAPPED (which names the key, not the value, as the reason nothing was mapped) -- matching this module's own stated policy on shapes it recognises but cannot interpret.
      const scalar = parseScalar(value);
      if (isTextDirection(scalar)) {
        metadata.direction = scalar;
      }
      continue;
    }
    const setter = STRING_FIELD_SETTERS[key];
    if (setter === undefined) {
      sink({
        code: MarkdownDiagnosticCodes.FRONT_MATTER_KEY_UNMAPPED,
        severity: "info",
        message: `front matter key "${key}" has no LayoutMetadata equivalent and was dropped from the metadata; its original spelling survives in the verbatim front-matter block this package's own writer can re-emit`,
        line: index + 1,
      });
      continue;
    }
    setter(metadata, parseScalar(value));
  }

  return {
    metadata,
    rest: lines.slice(closingIndex + 1).join("\n"),
    source: lines.slice(0, closingIndex + 1).join("\n"),
  };
}
