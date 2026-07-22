import { z } from 'zod';
import type { Package } from '../model/package';
import type { XmlElement } from '../model/node';
import { childrenWithTag, elementsWithTag, resolveRelationships, textContent } from './util';

export const ShapeSchema = z.object({
  text: z.string(),
});
export type Shape = z.infer<typeof ShapeSchema>;

export const PptxTableCellSchema = z.object({
  text: z.string(),
});
export type PptxTableCell = z.infer<typeof PptxTableCellSchema>;

export const PptxTableRowSchema = z.object({
  cells: z.array(PptxTableCellSchema),
});
export type PptxTableRow = z.infer<typeof PptxTableRowSchema>;

export const PptxTableSchema = z.object({
  rows: z.array(PptxTableRowSchema),
});
export type PptxTable = z.infer<typeof PptxTableSchema>;

export const SlideSchema = z.object({
  index: z.number().int(),
  text: z.string(),
  shapes: z.array(ShapeSchema),
  tables: z.array(PptxTableSchema),
  notes: z.string(),
});
export type Slide = z.infer<typeof SlideSchema>;

export const PptxPresentationSchema = z.object({
  slides: z.array(SlideSchema),
});
export type PptxPresentation = z.infer<typeof PptxPresentationSchema>;

const SLIDE_PATH = /^ppt\/slides\/slide(\d+)\.xml$/;

// Concatenate every `a:t` run inside the first `txBodyTag` child (p:txBody for shapes, a:txBody for table cells); empty string when the body or its runs are absent.
function txBodyText(parent: XmlElement, txBodyTag: string): string {
  const txBody = childrenWithTag(parent, txBodyTag)[0];
  if (txBody === undefined) {
    return '';
  }
  return elementsWithTag(txBody.children, 'a:t').map(textContent).join('');
}

function readShape(shape: XmlElement): Shape {
  return { text: txBodyText(shape, 'p:txBody') };
}

function readTableCell(cell: XmlElement): PptxTableCell {
  return { text: txBodyText(cell, 'a:txBody') };
}

function readTableRow(row: XmlElement): PptxTableRow {
  return { cells: childrenWithTag(row, 'a:tc').map(readTableCell) };
}

function readTable(table: XmlElement): PptxTable {
  return { rows: childrenWithTag(table, 'a:tr').map(readTableRow) };
}

// Resolve the slide's notesSlide through its relationships: the entry whose type ends with `/notesSlide` targets the notesSlide part, whose `a:t` runs concatenate to the speaker notes. Empty string when the slide has no notes part or the part carries no text.
function readNotes(pkg: Package, slidePath: string): string {
  const rels = resolveRelationships(pkg, slidePath);
  let notesPath: string | undefined;
  for (const rel of rels.values()) {
    if (rel.type.endsWith('/notesSlide')) {
      notesPath = rel.target;
      break;
    }
  }
  if (notesPath === undefined) {
    return '';
  }
  const part = pkg.parts[notesPath];
  if (part === undefined || part.kind !== 'xml') {
    return '';
  }
  return elementsWithTag(part.nodes, 'a:t').map(textContent).join('');
}

// Lossy projection of a generic OOXML Package into an ergonomic slide model. This walks the PresentationML slide parts (ppt/slides/slideN.xml, in numeric order) and, per slide, concatenates DrawingML `a:t` text runs for `Slide.text`, projects each `p:sp` shape's `p:txBody` text into `Slide.shapes`, projects each `a:tbl` table's `a:tr`/`a:tc` cells into `Slide.tables`, and resolves the slide's `notesSlide` relationship to concatenate speaker notes into `Slide.notes`. It is a one-way read of the meaningful constructs only, not a round-trip path: information not modelled here is dropped, and a `PptxPresentation` cannot be written back to a package.
export function readPptx(pkg: Package): PptxPresentation {
  const found: Slide[] = [];
  for (const [path, part] of Object.entries(pkg.parts)) {
    const match = SLIDE_PATH.exec(path);
    if (match === null) {
      continue;
    }
    const captured = match[1];
    if (captured === undefined) {
      continue;
    }
    if (part.kind !== 'xml') {
      continue;
    }
    const index = Number(captured);
    const text = elementsWithTag(part.nodes, 'a:t').map(textContent).join('');
    const shapes = elementsWithTag(part.nodes, 'p:sp').map(readShape);
    const tables = elementsWithTag(part.nodes, 'a:tbl').map(readTable);
    const notes = readNotes(pkg, path);
    found.push({ index, text, shapes, tables, notes });
  }
  found.sort((a, b) => a.index - b.index);
  return { slides: found };
}
