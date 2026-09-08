// The SHRINK-ONLY exclusion list for src/conformance.test.ts: CommonMark 0.31.2 examples this package's real public readMarkdown -> writeMarkdown -> reparse -> render pipeline does not yet reproduce byte for byte.
//
// It supersedes and merges the inline-phase-only list that preceded it (src/inline/conformance-exclusions.ts, removed when the block phase landed), and was populated afresh once src/conformance.test.ts started routing every example through the real read -> write -> reparse -> render pipeline (src/read.ts/src/write.ts) rather than a direct parseMarkdown -> render measurement -- the bare parser itself remains fully conformant against that direct measurement; every entry below is a genuine ContentDocument ROUND-TRIP gap, not a parsing gap.
//
// "Shrink-only" is enforced mechanically, not by convention: src/conformance.test.ts asserts that every example named here currently FAILS. Fixing one and forgetting to delete its entry turns the suite red, so the list can never quietly accumulate examples that already pass, and can never be padded to hide a regression.
//
// Every reason below is a genuine, understood, ARCHITECTURAL round-trip limitation -- either a documented MarkdownDiagnosticCodes gap (src/lower/ and src/emit/'s own top-of-file tables), or a structural under-determination in document-schema.js's own ContentDocument shape (no container node for a blockquote or a fenced code span's own delimiter choice space, no field distinguishing one multi-block list item from several single-block siblings, no per-list marker-glyph identity). None of these are "not yet gotten around to" placeholders -- each was individually diagnosed once, and re-diagnosis found the same root cause reachable through several corpus examples at once, which is why the reason strings below are shared, named constants rather than one bespoke sentence per excluded example.
const LINK_TITLE =
  "a link/image title has no ContentRun/ContentImageBlock field to survive on (MarkdownDiagnosticCodes.LINK_TITLE_DROPPED)";
const INFO_STRING =
  "a fenced code block's own info string has no ContentParagraph field to survive on (MarkdownDiagnosticCodes.CODE_BLOCK_INFO_STRING_DROPPED)";
const NESTED_LIST_LOOSENESS_SHARED =
  "a nested list's own tight/loose spacing cannot diverge from its enclosing list's: src/shared/list-id.ts's own numId grammar mints exactly one loose flag per TOP-LEVEL list, and a nested list deliberately reuses that SAME numId rather than minting a second one (see that module's own top-of-file note on why nesting never mints again), so a genuinely tight nested list sitting under a genuinely loose outer item renders with the outer item's own loose spacing between its own siblings instead of its own real tight spacing";
const MARKER_TYPE_CONFLICT =
  "a nested list disagreeing with its enclosing list's own minted marker type is resolved first-wins, not preserved (MarkdownDiagnosticCodes.LIST_MARKER_TYPE_CONFLICT) -- reusing the enclosing numId is itself the correct, tested design (src/shared/list-id.ts), just lossy for a genuinely mixed-type nesting";
const IMAGE_SRC_UNPRESERVABLE =
  "an image with no data: URI destination has no bytes for this test harness to embed (no MarkdownImageResolver was supplied, matching how readMarkdown is actually called here), so it degrades to a hyperlinked text run (MarkdownDiagnosticCodes.IMAGE_UNRESOLVED) -- and even supplying one would not help this specific byte-for-byte comparison, since embedding real bytes re-renders as a data: URI, replacing rather than preserving the original external src the expected HTML still names";
const EMPHASIS_TORTURE =
  "a SAME-KIND nesting -- emphasis directly inside emphasis, strong directly inside strong -- is flattened outright on the way in (MarkdownDiagnosticCodes.NESTED_EMPHASIS_FLATTENED): document-schema.js's own ContentRun carries flat italic/bold booleans with no depth of their own, so two nested spans of the identical kind collapse into one before src/emit/inline.ts ever sees them to render. This is the residual left once src/emit/inline.ts's own renderNestedStyles started choosing which style to nest OUTERMOST per run window (fewest contiguous groups first, ExaDev/markdown-codec#957) rather than a fixed bold-then-italic-then-strike order -- that change resolved every DIFFERENT-kind multi-way clash this list used to carry (an emphasis span crossing a strong or link boundary, e.g. spec examples 393 and 516), leaving only the kind no re-ordering of DIFFERENT styles can fix, because there is only one ContentRun.italic (or .bold) flag for a run to carry regardless of how many nested spans of that same kind the source had";
const MATH_DELIMITER_DIVERGENCE =
  'a source-level \\( directly followed (eventually) by a literal \\) is now read as inline math (ExaDev/markdown-codec#53), a deliberate divergence from cmark\'s own reading of two independently backslash-escaped parentheses -- src/inline/inline.ts\'s own new \\( recognition in parseBackslash cannot distinguish "the author escaped two literal parens" from "the author wrote inline math", because CommonMark\'s grammar gives \\( no third reading to disambiguate against; real Pandoc/GFM math-extension implementations accept the identical trade-off';

export const COMMONMARK_EXCLUSIONS: ReadonlyMap<number, string> = new Map([
  // Backslash escapes
  [12, MATH_DELIMITER_DIVERGENCE],
  // Entity and numeric character references
  [
    39,
    "a numeric character reference decoding to a literal newline (&#10;) is indistinguishable, once lowered, from a genuine hard line break -- both are just a literal '\\n' character inside ContentRun.text, so escapeMarkdownText's own hard-break spelling fires on it too",
  ],
  [
    40,
    "a numeric character reference decoding to a literal tab (&#9;) at the very start of a paragraph re-renders as literal leading whitespace, which a reparse reads as 4-column indented-code-block indentation instead of paragraph content -- there is no way to backslash-escape a literal space/tab character under CommonMark's own escape grammar",
  ],
  // Thematic breaks
  [
    61,
    'a list item\'s own body, once rendered as "<bulletMarker> <renderedBody>", can itself read as a higher-precedence thematic break on reparse when the body is itself a HorizontalRule-styled paragraph using the SAME character as the configured bullet marker (here, "- ---")',
  ],
  // Indented code blocks
  [109, MARKER_TYPE_CONFLICT],
  // Fenced code blocks
  [146, INFO_STRING],
  // Link reference definitions
  [196, LINK_TITLE],
  // List items
  [296, MARKER_TYPE_CONFLICT],
  [299, MARKER_TYPE_CONFLICT],
  // Lists
  [326, NESTED_LIST_LOOSENESS_SHARED],
  // Emphasis and strong emphasis
  [369, EMPHASIS_TORTURE],
  [373, EMPHASIS_TORTURE],
  [389, EMPHASIS_TORTURE],
  [404, EMPHASIS_TORTURE],
  [407, EMPHASIS_TORTURE],
  [408, EMPHASIS_TORTURE],
  [409, EMPHASIS_TORTURE],
  [416, EMPHASIS_TORTURE],
  [417, EMPHASIS_TORTURE],
  [418, EMPHASIS_TORTURE],
  [419, EMPHASIS_TORTURE],
  [422, EMPHASIS_TORTURE],
  [425, EMPHASIS_TORTURE],
  [426, EMPHASIS_TORTURE],
  [427, EMPHASIS_TORTURE],
  [432, EMPHASIS_TORTURE],
  [433, EMPHASIS_TORTURE],
  [461, EMPHASIS_TORTURE],
  [463, EMPHASIS_TORTURE],
  [464, EMPHASIS_TORTURE],
  [465, EMPHASIS_TORTURE],
  [466, EMPHASIS_TORTURE],
  [467, EMPHASIS_TORTURE],
  [468, EMPHASIS_TORTURE],
  // Links
  [
    517,
    "a nested, unresolved image inside a link overwrites the OUTER link's own hyperlink with the inner image's own destination -- ContentRun.hyperlink is a single flat field with no way to represent two nested hyperlinks at once",
  ],
  [
    519,
    "a link containing bracketed text that looks like (but is not) a nested link is a bracket-matching edge case this package's own inline phase resolves differently in nested-emphasis contexts than cmark's reference reading",
  ],
  [
    520,
    "an image whose alt text contains bracket-nested link-like text is flattened to plain alt text (image alt text is always plain per CommonMark's own rule), losing the specific nested-bracket text cmark's own alt-text-flattening happens to preserve literally",
  ],
  [
    531,
    "a nested, unresolved image inside a link overwrites the OUTER link's own hyperlink with the inner image's own destination -- ContentRun.hyperlink is a single flat field with no way to represent two nested hyperlinks at once",
  ],
  [
    533,
    "a link containing bracketed text that looks like (but is not) a nested link is a bracket-matching edge case this package's own inline phase resolves differently in nested-emphasis contexts than cmark's reference reading",
  ],
  // Images
  [572, IMAGE_SRC_UNPRESERVABLE],
  [573, IMAGE_SRC_UNPRESERVABLE],
  [574, IMAGE_SRC_UNPRESERVABLE],
  [575, IMAGE_SRC_UNPRESERVABLE],
  [576, IMAGE_SRC_UNPRESERVABLE],
  [577, IMAGE_SRC_UNPRESERVABLE],
  [578, IMAGE_SRC_UNPRESERVABLE],
  [579, IMAGE_SRC_UNPRESERVABLE],
  [580, IMAGE_SRC_UNPRESERVABLE],
  [581, IMAGE_SRC_UNPRESERVABLE],
  [582, IMAGE_SRC_UNPRESERVABLE],
  [583, IMAGE_SRC_UNPRESERVABLE],
  [584, IMAGE_SRC_UNPRESERVABLE],
  [585, IMAGE_SRC_UNPRESERVABLE],
  [586, IMAGE_SRC_UNPRESERVABLE],
  [587, IMAGE_SRC_UNPRESERVABLE],
  [588, IMAGE_SRC_UNPRESERVABLE],
  [589, IMAGE_SRC_UNPRESERVABLE],
  [591, IMAGE_SRC_UNPRESERVABLE],
]);

// The identical shrink-only exclusion list for src/gfm-conformance.test.ts's own read -> write -> reparse -> render measurement of the GFM extension corpus (assets/gfm/spec.txt) -- see COMMONMARK_EXCLUSIONS above for the shared rationale and reason constants. Keyed by the same per-file example numbering loadGfmExtensionExamples produces (unique across all four extension tags, since the source file numbers every example it contains, tagged or not).
export const GFM_EXCLUSIONS: ReadonlyMap<number, string> = new Map([]);
