// Raw-HTML-in-markdown recognition. CommonMark does not require raw HTML to be balanced, well-formed, or even to name a real element -- an html_block/html_inline node carries its literal HTML text verbatim and is never parsed as markup. So this module is a bounded RECOGNISER (does a tag start here, and where does it end?), not an HTML parser, and pulls in no HTML-parsing dependency of any kind.
//
// Both halves live here: the inline half (CommonMark 0.31.2, "Raw HTML"), consumed by src/inline/inline.ts, and the block half (0.31.2, "HTML blocks") -- seven kinds of block, each defined by a start condition and a matching end condition -- consumed by src/block/block.ts. They share the open-tag/closing-tag grammar below, which is exactly why the block half belongs in this module rather than in src/block/: block start condition 7 IS "a complete open tag or closing tag, alone on its line", so restating that grammar there would be a second copy of the hardest part of this file.

// spec 0.31.2, "Raw HTML" grammar, transcribed clause by clause:
//
// tag name                 -- an ASCII letter followed by zero or more ASCII letters, digits, or hyphens attribute name           -- an ASCII letter, `_`, or `:`, followed by zero or more ASCII letters, digits, `_`, `.`, `:`, or `-` unquoted attribute value -- a nonempty run excluding whitespace, `"`, `'`, `=`, `<`, `>`, and backtick attribute value spec     -- optional whitespace, `=`, optional whitespace, then an unquoted/single-quoted/double-quoted value attribute                -- whitespace, an attribute name, and an optional value spec open tag                 -- `<`, tag name, zero or more attributes, optional whitespace, optional `/`, `>` closing tag              -- `</`, tag name, optional whitespace, `>` HTML comment             -- `<!-->`, `<!--->`, or `<!--` ... `-->` (the two degenerate forms are new in 0.31.x) processing instruction   -- `<?` ... `?>` declaration              -- `<!`, an ASCII letter, characters other than `>`, `>` CDATA section            -- `<![CDATA[` ... `]]>`
//
// The spec's own wording for the whitespace inside a tag is "spaces, tabs, and up to one line ending"; `\s` here is marginally laxer (it also admits a form feed and a second line ending). That laxity is unreachable for inline content, because a blank line ends the containing block before any inline scanning happens -- so a second line ending can never appear inside one inline tag to begin with.
const TAG_NAME = '[A-Za-z][A-Za-z0-9-]*';
const ATTRIBUTE_NAME = '[a-zA-Z_:][a-zA-Z0-9:._-]*';
const UNQUOTED_VALUE = '[^"\'=<>`\\x00-\\x20]+';
const SINGLE_QUOTED_VALUE = "'[^']*'";
const DOUBLE_QUOTED_VALUE = '"[^"]*"';
const ATTRIBUTE_VALUE = `(?:${UNQUOTED_VALUE}|${SINGLE_QUOTED_VALUE}|${DOUBLE_QUOTED_VALUE})`;
const ATTRIBUTE_VALUE_SPEC = `(?:\\s*=\\s*${ATTRIBUTE_VALUE})`;
const ATTRIBUTE = `(?:\\s+${ATTRIBUTE_NAME}${ATTRIBUTE_VALUE_SPEC}?)`;
const OPEN_TAG = `<${TAG_NAME}${ATTRIBUTE}*\\s*/?>`;
const CLOSING_TAG = `</${TAG_NAME}\\s*>`;
const HTML_COMMENT = '<!-->|<!--->|<!--[\\s\\S]*?-->';
const PROCESSING_INSTRUCTION = '<\\?[\\s\\S]*?\\?>';
const DECLARATION = '<![A-Za-z][^>]*>';
const CDATA_SECTION = '<!\\[CDATA\\[[\\s\\S]*?\\]\\]>';

const HTML_TAG_PATTERN = new RegExp(`^(?:${OPEN_TAG}|${CLOSING_TAG}|${HTML_COMMENT}|${PROCESSING_INSTRUCTION}|${DECLARATION}|${CDATA_SECTION})`);

// Matches an inline HTML tag starting at `start` (which must be the `<`), returning its literal source text, or undefined when what follows is not a tag at all -- a bare `<` is ordinary text, never an error.
export function matchHtmlTag(text: string, start: number): string | undefined {
  if (text.charAt(start) !== '<') {
    return undefined;
  }
  const match = HTML_TAG_PATTERN.exec(text.slice(start));
  return match === null ? undefined : match[0];
}

// --- HTML blocks (spec 0.31.2, "HTML blocks") ---

// The seven kinds of HTML block, numbered exactly as the spec numbers them so a `htmlBlockType` field carried on a block node reads directly against the spec text rather than against a local renaming.
export type HtmlBlockType = 1 | 2 | 3 | 4 | 5 | 6 | 7;

// spec 0.31.2, condition 6's own tag list, verbatim and in the spec's own order. Note `search` (added in 0.31.x) and `menuitem` (never a real HTML element, but in the list regardless) -- this is a fixed literal list the spec states, not "block-level HTML elements" as any HTML specification would define them, so it is transcribed rather than derived.
const HTML_BLOCK_TAG_NAMES = [
  'address', 'article', 'aside', 'base', 'basefont', 'blockquote', 'body', 'caption', 'center', 'col', 'colgroup', 'dd', 'details', 'dialog', 'dir', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'frame', 'frameset', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'header', 'hr', 'html', 'iframe', 'legend', 'li', 'link', 'main', 'menu', 'menuitem', 'nav', 'noframes', 'ol', 'optgroup', 'option', 'p', 'param', 'search', 'section', 'summary', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'title', 'tr', 'track', 'ul',
];

// Start conditions 1-7, transcribed clause by clause from the spec section of the same name. Index 0 is unused so the array index IS the spec's own condition number.
const HTML_BLOCK_START_PATTERNS: readonly RegExp[] = [
  /^(?!)/,
  /^<(?:pre|script|style|textarea)(?:[ \t]|>|$)/i,
  /^<!--/,
  /^<\?/,
  /^<![A-Za-z]/,
  /^<!\[CDATA\[/,
  new RegExp(`^</?(?:${HTML_BLOCK_TAG_NAMES.join('|')})(?:[ \\t]|/?>|$)`, 'i'),
  new RegExp(`^(?:${OPEN_TAG}|${CLOSING_TAG})[ \\t]*$`, 'i'),
];

// End conditions 1-5 only: conditions 6 and 7 end at a blank line instead, which is a property of the FOLLOWING line rather than of the line's own text, so the block parser tests that itself (see src/block/block.ts's own continuation rule for an html block) rather than looking for a pattern that cannot exist here.
const HTML_BLOCK_END_PATTERNS: readonly RegExp[] = [
  /^(?!)/,
  /<\/(?:pre|script|style|textarea)>/i,
  /-->/,
  /\?>/,
  />/,
  /\]\]>/,
];

const HTML_BLOCK_TYPES: readonly HtmlBlockType[] = [1, 2, 3, 4, 5, 6, 7];
const LAST_HTML_BLOCK_TYPE = 7;

// The first start condition `line` meets, or undefined when it meets none. `interruptsParagraph` suppresses condition 7 alone: spec 0.31.2 says an HTML block of type 7 "may not interrupt a paragraph", so that one condition is unavailable when there is an open paragraph the block would have to break.
export function matchHtmlBlockStart(line: string, interruptsParagraph: boolean): HtmlBlockType | undefined {
  if (!line.startsWith('<')) {
    return undefined;
  }
  for (const type of HTML_BLOCK_TYPES) {
    if (type === LAST_HTML_BLOCK_TYPE && interruptsParagraph) {
      continue;
    }
    const pattern = HTML_BLOCK_START_PATTERNS[type];
    if (pattern?.test(line) === true) {
      return type;
    }
  }
  return undefined;
}

// Whether `line` meets the end condition for an already-open block of `type`. Types 6 and 7 always answer false here -- they end at a blank line, which is not a property of this line's own text (see HTML_BLOCK_END_PATTERNS above).
export function matchesHtmlBlockEnd(line: string, type: HtmlBlockType): boolean {
  return HTML_BLOCK_END_PATTERNS[type]?.test(line) === true;
}
