import { describe, expect, it } from 'vitest';
import type { LayoutText } from './layout';
import { readPdf } from './read';
import { ocgPdf } from './test-support/pdf';

// Optional content (#721 phase 3): /OCProperties groups with the default configuration's visibility state, /OC membership from BDC spans (both the named-property-list and inline-dict forms) stamped onto extracted items as a layer name, and /ActualText from a marked-content property dict. The visibility state is what fixes the active bug the issue names: content an author placed in an OFF layer no longer extracts as if unconditionally visible -- the membership is now on the item for a consumer to act on.

describe('readPdf: optional content groups', () => {
  it('reads each OCG with its name and default-configuration visibility', () => {
    const doc = readPdf(ocgPdf());
    expect(doc.layers).toEqual([
      { name: 'Background', visible: false },
      { name: 'Notes', visible: true },
    ]);
  });

  it('stamps items inside a /OC BDC span with the layer name, in both property-list forms', () => {
    const doc = readPdf(ocgPdf());
    const texts = doc.pages[0]!.items.filter((i): i is LayoutText => i.kind === 'text').map((t) => ({ text: t.text, ...(t.layer !== undefined ? { layer: t.layer } : {}) }));
    expect(texts).toEqual([
      { text: 'Visible text' },
      { text: 'Hidden layer text', layer: 'Background' },
      { text: 'Form text', layer: 'Background' },
      { text: 'Annotated text', layer: 'Notes' },
      { text: 'Owned form text', layer: 'Notes' },
    ]);
  });

  it('reads /ActualText from a marked-content property dict onto the span\'s text items', () => {
    const doc = readPdf(ocgPdf());
    const annotated = doc.pages[0]!.items.find((i) => i.kind === 'text' && i.text === 'Annotated text');
    expect(annotated).toMatchObject({ actualText: 'Replacement reading' });
  });

  it('carries the outer span\'s layer into a form XObject\'s items', () => {
    const doc = readPdf(ocgPdf());
    const formText = doc.pages[0]!.items.find((i) => i.kind === 'text' && i.text === 'Form text');
    expect(formText).toMatchObject({ layer: 'Background' });
  });

  it('applies a form XObject\'s own /OC over the outer span for its items', () => {
    const doc = readPdf(ocgPdf());
    const ownedFormText = doc.pages[0]!.items.find((i) => i.kind === 'text' && i.text === 'Owned form text');
    expect(ownedFormText).toMatchObject({ layer: 'Notes' });
  });
});
