
import { describe, expect, it } from 'vitest';
import { minimalPptxPackage } from '../../test-support/pptx';
import { readPptxContent } from './read';

// readPptxContent is now a thin adapter over ooxml.js's own readPptx: placeholder -> layout -> master -> theme inheritance, the run-property cascade, and group-transform flattening all live upstream in ooxml.js now, with their own test coverage there. These tests exercise only the wrapping this file is actually responsible for -- ContentDocument's discriminant/formatVersion, the metadata/slides passthrough -- not the OOXML semantics readPptx itself resolves.

describe('readPptxContent', () => {
  it('wraps readPptx into a presentation ContentDocument', () => {
    const doc = readPptxContent(minimalPptxPackage());
    expect(doc.kind).toBe('presentation');
  });

  it('passes slides through from readPptx unchanged, including slide size and shape text', () => {
    const doc = readPptxContent(minimalPptxPackage());
    if (doc.kind !== 'presentation') {
      throw new Error('expected a presentation document');
    }
    expect(doc.slides).toHaveLength(1);
    expect(doc.slides[0]?.size).toEqual({ widthPt: 960, heightPt: 540 });
    const shape = doc.slides[0]?.shapes[0];
    const paragraph = shape?.blocks[0];
    expect(paragraph?.kind === 'paragraph' ? paragraph.runs[0]?.text : undefined).toBe('Slide text');
  });

  it('spreads metadata from readPptx, leaving LayoutMetadata\'s PDF-only producer field unset', () => {
    const doc = readPptxContent(minimalPptxPackage());
    // The fixture package carries no docProps/core.xml, so every field is undefined -- confirming the mapping doesn't invent a value, not merely that it round-trips one.
    expect(doc.metadata).toEqual({});
    expect(doc.metadata.producer).toBeUndefined();
  });
});
