// Raw-HTML-in-markdown recognition. CommonMark does not require raw HTML to be balanced, well-formed, or even to name a real element -- an html_block/html_inline node carries its literal HTML text verbatim and is never parsed as markup. So this module is a bounded RECOGNISER (does a tag start here, and where does it end?), not an HTML parser, and pulls in no HTML-parsing dependency of any kind.
//
// Currently implements the inline half only (CommonMark 0.31.2, "Raw HTML"), consumed by src/inline/inline.ts. The block half -- CommonMark's own seven block-HTML start/end conditions -- belongs here too and will be added alongside src/block/.

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
