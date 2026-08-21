// Style-string constants and small string-shape helpers src/lower and src/emit both need to agree on exactly -- kept in one place rather than duplicated on each side, since a drift between the two (src/lower writing "Heading1" while src/emit expects "heading-1", say) would silently break every round trip through ContentDocument.

// docx's own built-in heading style name convention, mirrored here exactly per this package's own mapping table (see src/lower/lower.ts's top-of-file note) -- the same string shape odf.js's readOdt already uses for its own text:h -> styleId mapping (see that package's own readParagraphOrHeading).
const HEADING_STYLE_PREFIX = 'Heading';

export function headingStyleId(level: number): string {
  return `${HEADING_STYLE_PREFIX}${String(level)}`;
}

// ATX/setext both cap at six `#`/two underline characters -- the ceiling of this vocabulary's own "Heading{N}" spelling. Kept exported so a sibling package building or validating heading styleIds against this vocabulary has the same bound; src/emit/emit.ts's own write-side clamping goes through document-schema.js's clampHeadingLevel (the same 1-6 range, defined once at the schema) rather than through this constant.
export const MAX_HEADING_STYLE_LEVEL = 6;

const HEADING_STYLE_ID_PATTERN = /^Heading([0-9]+)$/;

// Parses a "Heading{N}" styleId back to its numeric level, for ANY positive N -- not just 1-6. A markdown-produced heading's own styleId is always <=6 (ATX/setext both cap there -- src/block/block.ts's headingLevelOf), but ContentDocument is a shared cross-format pivot: a paragraph built directly, or one that arrived via odt's own readOutlineLevel (which has no upper bound at all), may legitimately carry "Heading7" or deeper. Returns undefined for anything that is not this exact shape.
export function parseHeadingStyleId(styleId: string): number | undefined {
  const match = HEADING_STYLE_ID_PATTERN.exec(styleId);
  const levelText = match?.[1];
  if (levelText === undefined) {
    return undefined;
  }
  const level = Number.parseInt(levelText, 10);
  return Number.isInteger(level) && level > 0 ? level : undefined;
}

// A real Word built-in style name (not invented for this package) for a blockquote paragraph -- see src/lower/lower.ts's own mapping table entry.
export const QUOTE_STYLE_ID = 'Quote';

// Not a real Word built-in style, but a stable, documented convention this package's own lower/emit pair agrees on for a fenced/indented code block -- there is no docx built-in style for "code", so this name is this package's own.
export const CODE_BLOCK_STYLE_ID = 'CodeBlock';

// Ditto for a thematic break, lowered as an otherwise-empty paragraph rather than ContentPageBreak (see src/lower/lower.ts's own top-of-file note on why).
export const HORIZONTAL_RULE_STYLE_ID = 'HorizontalRule';

// Ditto for a block of preserved raw HTML.
export const HTML_PREFORMATTED_STYLE_ID = 'HTMLPreformatted';

// Ditto for a $$...$$ display-math block (ExaDev/markdown-codec#53) -- preserved raw LaTeX text, not converted to MathML by this package (see src/lower/lower.ts's own top-of-file note).
export const MATH_BLOCK_STYLE_ID = 'MathBlock';

// A code span/code block's own ContentRun.fontFamily -- a genuinely monospace font every mainstream Word/LibreOffice install carries, matching this whole family's own "standard, not invented" font-naming convention (see documents.js's own standard-14 substitution).
export const MONOSPACE_FONT_FAMILY = 'Courier New';

// An inline math run's own ContentRun.fontFamily marker (ExaDev/markdown-codec#53), the identical opportunistic-reuse trick MONOSPACE_FONT_FAMILY already plays for a code span -- a real Word/LibreOffice math font (the one Word itself uses for OOXML equation runs), not an invented sentinel, so a run genuinely styled this way for an unrelated reason degrades exactly as gracefully as a genuinely-monospace non-code-span run already does. Load-bearing, not cosmetic: escapeMarkdownText (src/emit/inline.ts) backslash-escapes every literal '(' and ')' in ORDINARY text, so an inline math run's own \( \) delimiters cannot be recovered by pattern-matching the written-out text after the fact (that was tried and reverted -- any ordinary parenthetical remark escapes to the identical \(...\) shape and would be misrecognised as math on reparse); this marker is what lets src/emit/inline.ts's own renderLeaf single out a genuine preserved-math run and skip escaping for that one run only.
export const MATH_INLINE_FONT_MARKER = 'Cambria Math';

// Points per level of blockquote nesting src/lower/src/emit agree on for ContentParagraph.indentLeftPt -- 0.5in, a common real-world blockquote/list indent increment (matching, e.g., Word's own default list-indent step). document-schema.js's own indentLeftPt carries no "this many quote levels" semantic of its own, so SOME fixed per-level unit has to be picked for the two directions to agree; this is that choice, made once, here.
export const QUOTE_INDENT_PT = 36;

// GFM task-list checkbox glyphs this package's own lowering/emission pair uses to carry a task item's checked state through ContentParagraph's own flat run-of-text model -- document-schema.js's ContentListMembership has no per-item checked field at all (see src/shared/list-id.ts's own top-of-file note), so the state has to live in the paragraph's own text instead. Matches Pandoc's own docx/HTML writer convention for the identical problem (BALLOT BOX / BALLOT BOX WITH X), not an invented glyph pair.
export const TASK_CHECKBOX_UNCHECKED = '☐'; // BALLOT BOX
export const TASK_CHECKBOX_CHECKED = '☒'; // BALLOT BOX WITH X
