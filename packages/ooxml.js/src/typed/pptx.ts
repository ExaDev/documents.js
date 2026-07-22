import { z } from 'zod';
import type { Package } from '../model/package';
import { elementsWithTag, textContent } from './util';

export const SlideSchema = z.object({
  index: z.number().int(),
  text: z.string(),
});
export type Slide = z.infer<typeof SlideSchema>;

export const PptxPresentationSchema = z.object({
  slides: z.array(SlideSchema),
});
export type PptxPresentation = z.infer<typeof PptxPresentationSchema>;

const SLIDE_PATH = /^ppt\/slides\/slide(\d+)\.xml$/;

// Lossy projection of a generic OOXML Package into an ergonomic slide model. This walks the PresentationML slide parts (ppt/slides/slideN.xml, in numeric order) and concatenates DrawingML `a:t` text runs per slide. It is a one-way read of the meaningful constructs only, not a round-trip path: information not modelled here is dropped, and a `PptxPresentation` cannot be written back to a package.
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
    const text = elementsWithTag(part.nodes, 'a:t')
      .map(textContent)
      .join('');
    found.push({ index, text });
  }
  found.sort((a, b) => a.index - b.index);
  return { slides: found };
}
