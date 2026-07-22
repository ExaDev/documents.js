import { z } from 'zod';
import type { Package } from '../model/package';
import type { XmlElement } from '../model/node';
import { elementsWithTag, textContent } from './util';

export const RunSchema = z.object({
  text: z.string(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
});
export type Run = z.infer<typeof RunSchema>;

export const ParagraphSchema = z.object({
  runs: z.array(RunSchema),
});
export type Paragraph = z.infer<typeof ParagraphSchema>;

export const DocxDocumentSchema = z.object({
  paragraphs: z.array(ParagraphSchema),
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

function readParagraph(paragraph: XmlElement): Paragraph {
  return { runs: elementsWithTag(paragraph.children, 'w:r').map(readRun) };
}

// Lossy projection of a generic OOXML Package into an ergonomic WordprocessingML document model. This walks the `word/document.xml` body for `w:p` paragraphs, each paragraph for `w:r` runs, and each run for `w:t` text (concatenated), exposing the common bold and italic run-property toggles. It is a one-way read of the meaningful constructs only, not a round-trip path: information not modelled here is dropped, and a `DocxDocument` cannot be written back to a package.
export function readDocx(pkg: Package): DocxDocument {
  const part = pkg.parts['word/document.xml'];
  if (part === undefined) {
    throw new Error('readDocx: package has no word/document.xml part');
  }
  if (part.kind !== 'xml') {
    throw new Error('readDocx: word/document.xml is not an XML part');
  }
  return { paragraphs: elementsWithTag(part.nodes, 'w:p').map(readParagraph) };
}
