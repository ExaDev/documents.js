// Footnote-syntax primitives shared by the two phases that must agree exactly or a reference silently stops resolving against its own definition: the block phase's definition scanning (`[^label]: body`, src/block/block.ts's tryFootnoteDefinitionStart) and the inline phase's reference recognition (`[^label]`, src/inline/inline.ts). Lives beside src/inline/link.ts for the same reason that module does -- the label grammar itself is inline-shaped, while WHEN a definition is recognised is a block-structure question -- and the block phase imports from here exactly as src/block/definitions.ts already imports its own destination/title grammar from src/inline/link.ts.
//
// Footnotes are a GitHub extension BEYOND the GFM spec document itself: assets/gfm/spec.txt carries no footnote section at all (it is a snapshot of the four tagged extensions -- table, strikethrough, autolink, task list), and CommonMark 0.31.2 has no footnote concept either. The grammar below is therefore transcribed from what GitHub and Pandoc both actually accept for the marker-plus-tail-definition form, which is the shape both agree on: `[^` then an identifier carrying no whitespace and no further brackets, then `]`.
//
// Pandoc's inline note form (`^[note text here]`) is deliberately NOT recognised here: it has no GitHub analogue, and the ContentDocument mapping this package lowers onto (an anchor construct wrapping the note's own block extent, src/lower/lower.ts) has nowhere to put a note whose body sits inline in the middle of a paragraph -- exactly the run-level extent gap that already keeps the REFERENCE site from being an anchor construct of its own (see src/lower/inline.ts's own footnoteReference case).

// The identifier between `[^` and `]`: at least one character, none of them whitespace and none of them a further square bracket. Both restrictions are load-bearing rather than tidiness -- a label containing whitespace is ambiguous with ordinary bracketed prose ("[^ see above]"), and one containing a bracket cannot be scanned without a nesting rule neither GitHub nor Pandoc defines.
const FOOTNOTE_LABEL_PATTERN = /\[\^([^\s[\]]+)\]/y;

export interface FootnoteLabelMatch {
  readonly label: string;
  // Source index one past the closing `]`.
  readonly end: number;
}

// Matches `[^label]` starting at `start` (which must be the `[`), or undefined when what follows is not a footnote label at all.
export function matchFootnoteLabel(text: string, start: number): FootnoteLabelMatch | undefined {
  FOOTNOTE_LABEL_PATTERN.lastIndex = start;
  const match = FOOTNOTE_LABEL_PATTERN.exec(text);
  if (match === null) {
    return undefined;
  }
  const label = match[1];
  if (label === undefined) {
    return undefined;
  }
  return { label, end: start + match[0].length };
}

export interface FootnoteDefinitionMatch {
  readonly label: string;
  // How many characters of `lineText` the `[^label]:` marker itself occupies -- what the block phase advances its own line cursor past before the rest of the line becomes the definition's first line of content. Deliberately excludes any spaces after the colon: the block phase's own openNewBlocks skips those as ordinary leading whitespace, exactly as it does after a list item's marker.
  readonly markerLength: number;
}

// Matches a footnote DEFINITION's own opening marker (`[^label]:`) at the very start of `lineText`, which the block phase hands in already positioned at the line's first non-space character.
export function matchFootnoteDefinitionMarker(lineText: string): FootnoteDefinitionMatch | undefined {
  const match = matchFootnoteLabel(lineText, 0);
  if (match === undefined || lineText.charAt(match.end) !== ':') {
    return undefined;
  }
  return { label: match.label, markerLength: match.end + 1 };
}

// Labels are matched EXACTLY, with no case folding and no whitespace collapsing -- unlike a link label (src/inline/link.ts's normalizeLinkLabel, which implements CommonMark's own normalisation rules verbatim). There is no spec text to transcribe here: footnotes are outside both CommonMark and GFM proper, so a normalisation rule would be this package's own invention, and an exact match is the one choice that cannot silently merge two labels an author meant to keep apart. `[^Note]` and `[^note]` are therefore two distinct footnotes, and each round-trips under its own spelling.
export type FootnoteLabelSet = ReadonlySet<string>;
