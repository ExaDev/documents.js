// Round-trip-only styleId/indent/font constants this package's XHTML read and write sides share, matching markdown-codec's own src/shared/style-constants.ts values exactly (not re-exported from it -- a cross-format-codec dependency would be the wrong direction, see README Architecture) so a document round-tripped between the two families' own conventions reads consistently rather than landing on two different arbitrary spellings of the same fact.

// A thematic break/horizontal rule: document-schema.js's ContentBlock union has no dedicated kind for one, so it lowers to an empty-runs paragraph carrying this styleId as its only marker -- markdown-codec's own established mapping for the identical gap.
export const HORIZONTAL_RULE_STYLE_ID = "HorizontalRule";

// A blockquote's own contained paragraphs: the division construct pair carries the container boundary and exact nesting depth; this styleId plus indentLeftPt (below, per level) is the materialised formatting a consumer that ignores constructs still sees.
export const QUOTE_STYLE_ID = "Quote";
export const QUOTE_INDENT_PT = 36;

// A code span or <pre> block's own ContentRun.fontFamily -- a genuinely monospace font every mainstream Word/LibreOffice install carries, matching this whole family's "standard, not invented" font-naming convention (documents.js's own standard-14 substitution) and markdown-codec's identical choice for the same construct.
export const MONOSPACE_FONT_FAMILY = "Courier New";

// A definition list's <dd> body: indented under its <dt> term, the same per-level unit blockquote uses, since document-schema.js has no dedicated definition-list construct either.
export const DEFINITION_BODY_INDENT_PT = 36;
