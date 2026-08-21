import { describe, expect, it } from 'vitest';
import { assemblePackage, type ContentDocument, type DocumentPackage, type SourceResidue } from 'document-schema.js';
import type { LayoutAttachment, LayoutDestination, LayoutDocument, LayoutLayer, LayoutOutlineItem, LayoutPage } from 'pdf-codec';
import { stampPdfPackageTables } from './pdf-package-tables';

// The package-table half of the PDF-side construct surfacing (#721): destinations (named plus the outline flattened depth-first with parent keys), attachments, layers, the residue table, and comment definition bodies minted under the same deterministic keys reconstruct.ts's anchor constructs reference. Everything lands on the tree the fromPdf executor assembles, because the flat ContentDocument has no root for any of it.

function packageOf(content: ContentDocument): DocumentPackage {
  return assemblePackage(content, [{ widthPt: 612, heightPt: 792 }]);
}

function wordprocessing(): ContentDocument {
  return { kind: 'wordprocessing', metadata: {}, sections: [{ pageSize: { widthPt: 612, heightPt: 792 }, margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 }, blocks: [] }] };
}

function layoutOf(extra: {
  destinations?: readonly LayoutDestination[];
  outline?: readonly LayoutOutlineItem[];
  attachments?: readonly LayoutAttachment[];
  layers?: readonly LayoutLayer[];
  source?: Record<string, SourceResidue>;
  pages?: readonly LayoutPage[];
}): LayoutDocument {
  return {
    formatVersion: 1,
    metadata: {},
    pages: [...(extra.pages ?? [])],
    images: {},
    ...(extra.destinations !== undefined ? { destinations: [...extra.destinations] } : {}),
    ...(extra.outline !== undefined ? { outline: cloneOutline(extra.outline) } : {}),
    ...(extra.attachments !== undefined ? { attachments: [...extra.attachments] } : {}),
    ...(extra.layers !== undefined ? { layers: [...extra.layers] } : {}),
    ...(extra.source !== undefined ? { source: extra.source } : {}),
  };
}

// The outline type is recursive with readonly children; rebuilding it keeps the helper's input and the LayoutDocument's own mutable-arrays shape in agreement without an assertion.
function cloneOutline(items: readonly LayoutOutlineItem[]): LayoutOutlineItem[] {
  return items.map((item) => ({ title: item.title, ...(item.destination !== undefined ? { destination: item.destination } : {}), children: cloneOutline(item.children) }));
}

describe('stampPdfPackageTables', () => {
  it('lands named destinations and a flattened outline in the destinations table', () => {
    const pkg = packageOf(wordprocessing());
    stampPdfPackageTables(pkg, layoutOf({
      destinations: [
        { name: 'intro', pageIndex: 0, target: { kind: 'xyz', leftPt: 72, topPt: 700 } },
        { name: 'dest1', pageIndex: 1, target: { kind: 'fit' } },
      ],
      outline: [
        { title: 'Introduction', destination: 'intro', children: [{ title: 'Nested', children: [] }] },
        { title: 'Later', children: [] },
      ],
    }));
    expect(pkg.destinations?.intro).toEqual({ kind: 'destination', pageIndex: 0, viewKind: 'xyz', leftPt: 72, topPt: 700 });
    expect(pkg.destinations?.dest1).toEqual({ kind: 'destination', pageIndex: 1, viewKind: 'fit' });
    expect(pkg.destinations?.['outline-1']).toEqual({ kind: 'outline', title: 'Introduction', destination: 'intro' });
    expect(pkg.destinations?.['outline-2']).toEqual({ kind: 'outline', title: 'Nested', parent: 'outline-1' });
    expect(pkg.destinations?.['outline-3']).toEqual({ kind: 'outline', title: 'Later' });
  });

  it('lands attachments and layers keyed by their own names', () => {
    const pkg = packageOf(wordprocessing());
    const attachments: LayoutAttachment[] = [{ name: 'notes.txt', description: 'Notes', mimeType: 'text/plain', base64: 'QQ==' }];
    const layers: LayoutLayer[] = [{ name: 'Background', visible: false }];
    stampPdfPackageTables(pkg, layoutOf({ attachments, layers }));
    expect(pkg.attachments?.['notes.txt']).toEqual({ kind: 'attachment', name: 'notes.txt', description: 'Notes', mimeType: 'text/plain', base64: 'QQ==' });
    expect(pkg.layers?.Background).toEqual({ kind: 'layer', name: 'Background', visible: false });
  });

  it('carries the residue table through under the same keys', () => {
    const pkg = packageOf(wordprocessing());
    stampPdfPackageTables(pkg, layoutOf({ source: { xmp: { format: 'pdf', xml: '<?xpacket…' } } }));
    expect(pkg.source?.xmp).toEqual({ format: 'pdf', xml: '<?xpacket…' });
  });

  it('mints comment definition bodies under the keys the anchor constructs reference', () => {
    const pkg = packageOf(wordprocessing());
    const pages: LayoutPage[] = [
      { widthPt: 612, heightPt: 792, items: [] },
      {
        widthPt: 612,
        heightPt: 792,
        items: [],
        annotations: [{ subtype: 'Text', xPt: 500, yPt: 740, widthPt: 16, heightPt: 16, contents: 'Second page note', author: 'R', modifiedIso: '2026-08-19T14:03:00Z' }],
      },
    ];
    stampPdfPackageTables(pkg, layoutOf({ pages }));
    expect(pkg.definitions?.['pdf-annot-1-0']).toEqual({ kind: 'comment', body: 'Second page note', author: 'R', dateIso: '2026-08-19T14:03:00Z' });
  });

  it('stamps nothing when the layout carries none of the surfaces', () => {
    const pkg = packageOf(wordprocessing());
    stampPdfPackageTables(pkg, layoutOf({}));
    expect(pkg.destinations).toBeUndefined();
    expect(pkg.attachments).toBeUndefined();
    expect(pkg.layers).toBeUndefined();
    expect(pkg.source).toBeUndefined();
    expect(pkg.definitions).toBeUndefined();
  });
});
