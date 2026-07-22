import { z } from 'zod';
import type { Package } from '../model/package';
import type { XmlElement } from '../model/node';
import type { Relationship } from './util';
import { attr, childrenWithTag, elementsWithTag, resolveRelationships, rootElement, textContent } from './util';

export const RunSchema = z.object({
  text: z.string(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
});
export type Run = z.infer<typeof RunSchema>;

// A paragraph's membership of a numbering definition: which list (numId) and which indentation level (ilvl, zero-based).
export const ListMembershipSchema = z.object({
  numId: z.string(),
  level: z.number(),
});
export type ListMembership = z.infer<typeof ListMembershipSchema>;

export const ParagraphSchema = z.object({
  runs: z.array(RunSchema),
  list: ListMembershipSchema.optional(),
});
export type Paragraph = z.infer<typeof ParagraphSchema>;

export const TableCellSchema = z.object({
  paragraphs: z.array(ParagraphSchema),
});
export type TableCell = z.infer<typeof TableCellSchema>;

export const TableRowSchema = z.object({
  cells: z.array(TableCellSchema),
});
export type TableRow = z.infer<typeof TableRowSchema>;

export const TableSchema = z.object({
  rows: z.array(TableRowSchema),
});
export type Table = z.infer<typeof TableSchema>;

export const HyperlinkSchema = z.object({
  text: z.string(),
  target: z.string(),
});
export type Hyperlink = z.infer<typeof HyperlinkSchema>;

export const CommentSchema = z.object({
  author: z.string().optional(),
  text: z.string(),
});
export type Comment = z.infer<typeof CommentSchema>;

export const FootnoteSchema = z.object({
  type: z.string().optional(),
  text: z.string(),
});
export type Footnote = z.infer<typeof FootnoteSchema>;

export const DocxDocumentSchema = z.object({
  paragraphs: z.array(ParagraphSchema),
  tables: z.array(TableSchema),
  hyperlinks: z.array(HyperlinkSchema),
  comments: z.array(CommentSchema),
  footnotes: z.array(FootnoteSchema),
  headers: z.array(z.string()),
  footers: z.array(z.string()),
});
export type DocxDocument = z.infer<typeof DocxDocumentSchema>;

// True when the run's `w:rPr` run-properties child contains the given toggle element (`w:b` for bold, `w:i` for italic). Presence reads as on; the `w:val` toggle attribute is not inspected, a documented lossy simplification.
function runPropertyOn(run: XmlElement, tag: string): boolean {
  const rPr = run.children.find((child): child is XmlElement => child.type === 'element' && child.tag === 'w:rPr');
  return rPr !== undefined && elementsWithTag(rPr.children, tag).length > 0;
}

function readRun(run: XmlElement): Run {
  const text = elementsWithTag(run.children, 'w:t').map(textContent).join('');
  const result: Run = { text };
  if (runPropertyOn(run, 'w:b')) {
    result.bold = true;
  }
  if (runPropertyOn(run, 'w:i')) {
    result.italic = true;
  }
  return result;
}

// Reads w:numPr from the paragraph's w:pPr properties child; undefined when the paragraph is not a list item. numId comes from the w:numId child's w:val attribute, level from w:ilvl's w:val coerced to a number (defaulting to 0 when w:ilvl is absent).
function readListMembership(paragraph: XmlElement): ListMembership | undefined {
  const pPr = childrenWithTag(paragraph, 'w:pPr')[0];
  if (pPr === undefined) {
    return undefined;
  }
  const numPr = childrenWithTag(pPr, 'w:numPr')[0];
  if (numPr === undefined) {
    return undefined;
  }
  const numIdEl = childrenWithTag(numPr, 'w:numId')[0];
  const numId = numIdEl !== undefined ? attr(numIdEl, 'w:val') : undefined;
  if (numId === undefined) {
    return undefined;
  }
  const ilvlEl = childrenWithTag(numPr, 'w:ilvl')[0];
  const ilvlVal = ilvlEl !== undefined ? attr(ilvlEl, 'w:val') : undefined;
  const level = ilvlVal !== undefined ? Number(ilvlVal) : 0;
  return { numId, level };
}

function readParagraph(paragraph: XmlElement): Paragraph {
  const result: Paragraph = { runs: elementsWithTag(paragraph.children, 'w:r').map(readRun) };
  const list = readListMembership(paragraph);
  if (list !== undefined) {
    result.list = list;
  }
  return result;
}

function readCell(cell: XmlElement): TableCell {
  return { paragraphs: childrenWithTag(cell, 'w:p').map(readParagraph) };
}

function readRow(row: XmlElement): TableRow {
  return { cells: childrenWithTag(row, 'w:tc').map(readCell) };
}

function readTable(table: XmlElement): Table {
  return { rows: childrenWithTag(table, 'w:tr').map(readRow) };
}

// text is the concatenated w:t content of the hyperlink; target resolves the r:id relationship, defaulting to an empty string for an unresolvable or absent id (a dangling hyperlink reads as a hyperlink with unknown target rather than an error).
function readHyperlink(hyperlink: XmlElement, rels: Map<string, Relationship>): Hyperlink {
  const text = elementsWithTag(hyperlink.children, 'w:t').map(textContent).join('');
  const rid = attr(hyperlink, 'r:id');
  const target = rid !== undefined ? (rels.get(rid)?.target ?? '') : '';
  return { text, target };
}

function readComment(comment: XmlElement): Comment {
  const author = attr(comment, 'w:author');
  const text = elementsWithTag(comment.children, 'w:t').map(textContent).join('');
  const result: Comment = { text };
  if (author !== undefined) {
    result.author = author;
  }
  return result;
}

function readFootnote(footnote: XmlElement): Footnote {
  const type = attr(footnote, 'w:type');
  const text = elementsWithTag(footnote.children, 'w:t').map(textContent).join('');
  const result: Footnote = { text };
  if (type !== undefined) {
    result.type = type;
  }
  return result;
}

function readComments(pkg: Package): Comment[] {
  const root = rootElement(pkg.parts['word/comments.xml']);
  if (root === undefined) {
    return [];
  }
  return childrenWithTag(root, 'w:comment').map(readComment);
}

function readFootnotes(pkg: Package): Footnote[] {
  const root = rootElement(pkg.parts['word/footnotes.xml']);
  if (root === undefined) {
    return [];
  }
  const out: Footnote[] = [];
  for (const fn of childrenWithTag(root, 'w:footnote')) {
    const type = attr(fn, 'w:type');
    if (type === 'separator' || type === 'continuationSeparator') {
      continue;
    }
    out.push(readFootnote(fn));
  }
  return out;
}

// Concatenated w:t text of every word/header*.xml or word/footer*.xml part (matched by part-key prefix); each part contributes one entry, in package-key order.
function readHeaderFooterText(pkg: Package, prefix: string): string[] {
  const out: string[] = [];
  for (const path of Object.keys(pkg.parts)) {
    if (!path.startsWith(prefix) || !path.endsWith('.xml')) {
      continue;
    }
    const part = pkg.parts[path];
    if (part === undefined || part.kind !== 'xml') {
      continue;
    }
    out.push(elementsWithTag(part.nodes, 'w:t').map(textContent).join(''));
  }
  return out;
}

// Lossy projection of a generic OOXML Package into an ergonomic WordprocessingML document model. This walks the `word/document.xml` body for `w:p` paragraphs, `w:tbl` tables, and `w:hyperlink` links; reads numbering membership from each paragraph's `w:numPr`; and pulls comments (`word/comments.xml`), footnotes (`word/footnotes.xml`, skipping separator/continuation rendering marks), and header/footer (`word/header*.xml`, `word/footer*.xml`) text from their parts. Each paragraph yields `w:r` runs whose `w:t` text is concatenated, with the common bold and italic run-property toggles exposed. It is a one-way read of the meaningful constructs only, not a round-trip path: information not modelled here is dropped (cell properties, hyperlink anchors, numbering definitions, styling, section breaks), and a `DocxDocument` cannot be written back to a package.
export function readDocx(pkg: Package): DocxDocument {
  const part = pkg.parts['word/document.xml'];
  if (part === undefined) {
    throw new Error('readDocx: package has no word/document.xml part');
  }
  if (part.kind !== 'xml') {
    throw new Error('readDocx: word/document.xml is not an XML part');
  }
  const rels = resolveRelationships(pkg, 'word/document.xml');
  return {
    paragraphs: elementsWithTag(part.nodes, 'w:p').map(readParagraph),
    tables: elementsWithTag(part.nodes, 'w:tbl').map(readTable),
    hyperlinks: elementsWithTag(part.nodes, 'w:hyperlink').map((h) => readHyperlink(h, rels)),
    comments: readComments(pkg),
    footnotes: readFootnotes(pkg),
    headers: readHeaderFooterText(pkg, 'word/header'),
    footers: readHeaderFooterText(pkg, 'word/footer'),
  };
}
