import type { Comment, DocxExtras, Footnote, NumberingDefinitions, NumberingLevel } from 'documents.js';

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

// Headers and footers share the identical shape once read (`readonly string[]`, each entry one part's own concatenated text) -- one function renders either, labelled by the caller.
function headerOrFooterSection(label: string, values: readonly string[]): readonly string[] {
  if (values.length === 0) {
    return [];
  }
  return [label, ...values.map((text, index) => `${indent(1)}[${index + 1}] ${text}`)];
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
    headerOrFooterSection('headers', extras.headers),
    headerOrFooterSection('footers', extras.footers),
    numberingSection(extras.numbering),
  ];
  const nonEmptySections = sections.filter((section) => section.length > 0);
  if (nonEmptySections.length === 0) {
    return ['This document carries no comments, footnotes, headers, footers, or numbering definitions.'];
  }
  // A blank line between sections, never before the first one -- readable as a CLI report and as a flat ListView row list alike (a blank row renders as an empty line either way).
  return nonEmptySections.flatMap((section, index) => (index === 0 ? section : ['', ...section]));
}
