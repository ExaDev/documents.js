import type { Comment, ContentBlock, DocxExtras, Footnote, NumberingDefinitions, NumberingLevel } from 'documents.js';

// documents.js doesn't re-export HeaderFooterPart by name (ooxml.js's own barrel doesn't either -- only DocxDocument, which already carries its shape on this field), so it's named here by indexing DocxExtras itself rather than imported directly. extras.sectionHeaderFooters (which section's default/first/even slots reference which part, by path) is real data DocxExtras carries but this formatter does not render -- it is a per-section mapping onto the parts headers/footers already list by position, not new textual content, and the position-based numbering below already tells a reader which part is which without it.
type HeaderFooterPart = DocxExtras['headerFooterParts'][number];

// The one place a docx's own comments/footnotes/headers/footers/numbering definitions turn into text, shared by the `docx-extras` command and the TUI's own `docxExtras` screen -- the same relationship `odb-structure.ts` has to `odb-forms`/`odb-reports` and to the TUI's own form/report detail screens, and for the same reason: the CLI renders these lines joined by newlines while the TUI renders one per `ListView` row, so a flat `readonly string[]` of already-indented lines is the shape that genuinely serves both without either owning the other's rendering.
//
// This module never touches a package, a file, or documents.js's readers -- it is a pure function of the `DocxExtras` value `readDocxExtras` hands back, which is what lets both layers' tests assert against real fixture-derived structure with no I/O of their own.

const INDENT = '  ';

function indent(depth: number): string {
  return INDENT.repeat(depth);
}

// Neither `Comment` nor `Footnote` (ooxml.js, re-exported by documents.js) carries an id field of its own, so both are addressed by their 1-based position in the array `readDocxExtras` returned -- the position a reader would count off while looking at the list, not any XML-internal `w:id`.
function commentLine(comment: Comment, position: number): string {
  const author = comment.author ?? '(no author)';
  return `${indent(1)}[${position}] ${author}: ${comment.text}`;
}

function footnoteLine(footnote: Footnote, position: number): string {
  const typeSuffix = footnote.type === undefined ? '' : ` (${footnote.type})`;
  return `${indent(1)}[${position}]${typeSuffix} ${footnote.text}`;
}

function commentsSection(comments: readonly Comment[]): readonly string[] {
  if (comments.length === 0) {
    return [];
  }
  return ['comments', ...comments.map((comment, index) => commentLine(comment, index + 1))];
}

function footnotesSection(footnotes: readonly Footnote[]): readonly string[] {
  if (footnotes.length === 0) {
    return [];
  }
  return ['footnotes', ...footnotes.map((footnote, index) => footnoteLine(footnote, index + 1))];
}

// A header/footer part's own text: its block flow joined the same way a paragraph's runs are (no separator between blocks would run words together, so a single space joins block boundaries), skipping the two construct-marker kinds entirely (they render nothing) and naming a textless block's kind in brackets rather than contributing nothing to the line -- document-outline.js's own outlineLeafText/blockTexts convention, reimplemented locally rather than imported: this module's own doc comment requires it stay a pure, dependency-free function, and ContentBlock (unlike OutlineLeaf) includes the marker kinds that convention never has to handle.
function blockText(block: ContentBlock): string {
  switch (block.kind) {
    case 'paragraph':
      return block.runs.map((run) => run.text).join('');
    case 'table':
      return block.rows.map((row) => row.cells.map((cell) => cell.blocks.map(blockText).join(' ')).join(' ')).join('\n');
    case 'image':
      return block.altText ?? '[image]';
    case 'pageBreak':
      return '[page-break]';
    case 'embeddedObject':
      return '[embeddedObject]';
    case 'constructStart':
    case 'constructEnd':
      return '';
  }
}

function partText(part: HeaderFooterPart): string {
  return part.blocks
    .map(blockText)
    .filter((text) => text !== '')
    .join(' ');
}

// Headers and footers share the identical rendering once read (kind-filtered from headerFooterParts, in the reader's own path-sorted order) -- one function renders either, labelled by the caller. Each line names the part's own path alongside its 1-based position -- a fact the old flat `readonly string[]` shape had no room for, and free once the part carries it.
function headerOrFooterSection(label: string, parts: readonly HeaderFooterPart[], kind: HeaderFooterPart['kind']): readonly string[] {
  const matching = parts.filter((part) => part.kind === kind);
  if (matching.length === 0) {
    return [];
  }
  return [label, ...matching.map((part, index) => `${indent(1)}[${index + 1}] ${part.path}: ${partText(part)}`)];
}

function numberingLevelLine(ilvl: string, level: NumberingLevel): string {
  const restartSuffix = level.restart === undefined ? '' : `, restarts at level ${level.restart}`;
  return `${indent(2)}level ${ilvl}: ${level.format} ${JSON.stringify(level.text)} starting at ${level.startAt}${restartSuffix}`;
}

// NumberingDefinitions is keyed by w:numId, each definition's own levels keyed by zero-based w:ilvl (both stringified -- see ooxml.js's own numbering.ts) -- levels are printed in ascending numeric order regardless of the object's own key enumeration order, since ilvl is a genuinely numeric axis even though the record itself is string-keyed.
function numberingSection(numbering: NumberingDefinitions): readonly string[] {
  const numIds = Object.keys(numbering);
  if (numIds.length === 0) {
    return [];
  }
  const lines: string[] = ['numbering'];
  for (const numId of numIds) {
    const definition = numbering[numId];
    if (definition === undefined) {
      continue;
    }
    lines.push(`${indent(1)}numId ${numId}`);
    const ilvls = Object.keys(definition.levels).sort((a, b) => Number(a) - Number(b));
    for (const ilvl of ilvls) {
      const level = definition.levels[ilvl];
      if (level === undefined) {
        continue;
      }
      lines.push(numberingLevelLine(ilvl, level));
    }
  }
  return lines;
}

export function formatDocxExtrasLines(extras: DocxExtras): readonly string[] {
  const sections: readonly (readonly string[])[] = [
    commentsSection(extras.comments),
    footnotesSection(extras.footnotes),
    headerOrFooterSection('headers', extras.headerFooterParts, 'header'),
    headerOrFooterSection('footers', extras.headerFooterParts, 'footer'),
    numberingSection(extras.numbering),
  ];
  const nonEmptySections = sections.filter((section) => section.length > 0);
  if (nonEmptySections.length === 0) {
    return ['This document carries no comments, footnotes, headers, footers, or numbering definitions.'];
  }
  // A blank line between sections, never before the first one -- readable as a CLI report and as a flat ListView row list alike (a blank row renders as an empty line either way).
  return nonEmptySections.flatMap((section, index) => (index === 0 ? section : ['', ...section]));
}
