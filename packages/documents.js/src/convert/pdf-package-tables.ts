import type { DefinitionEntry, DocumentPackage } from 'document-schema.js';
import type { LayoutAnnotation, LayoutDocument, LayoutOutlineItem, LayoutStructureElement } from 'pdf-codec';

// The package-table half of PDF-side construct surfacing (#721): stamping the LayoutDocument's document-level surfaces onto the tree the fromPdf executor assembles. The flat ContentDocument a reconstructor returns has no root for these tables (they are tree-only by design), so this runs immediately after assemblePackage -- the one place both the layout (the facts) and the package (the home) are in hand. Entry vocabularies are this package's own tenants inside the generic definitions-table facility: a destinations entry names a page and a view, an outline entry names its title/destination and parent, an attachment carries decoded bytes, a layer its visibility, and (#760) a structure entry states one tagged-PDF element's type and attributes, parent stated as a reference.

export function stampPdfPackageTables(pkg: DocumentPackage, layout: LayoutDocument): void {
  if (layout.destinations !== undefined || layout.outline !== undefined) {
    const destinations: Record<string, DefinitionEntry> = {};
    for (const destination of layout.destinations ?? []) {
      destinations[destination.name] = {
        kind: 'destination',
        pageIndex: destination.pageIndex,
        viewKind: destination.target.kind,
        ...(destination.target.leftPt !== undefined ? { leftPt: destination.target.leftPt } : {}),
        ...(destination.target.topPt !== undefined ? { topPt: destination.target.topPt } : {}),
        ...(destination.target.bottomPt !== undefined ? { bottomPt: destination.target.bottomPt } : {}),
        ...(destination.target.rightPt !== undefined ? { rightPt: destination.target.rightPt } : {}),
        ...(destination.target.zoom !== undefined ? { zoom: destination.target.zoom } : {}),
      };
    }
    // The outline flattens depth-first into outline-N entries whose `parent` names the enclosing entry's key -- the tree the definitions table cannot hold, stated as the reference every other table entry already uses.
    const outlineKeys: string[] = [];
    const walkOutline = (items: readonly LayoutOutlineItem[] | undefined, parentKey: string | undefined): void => {
      for (const item of items ?? []) {
        const key = `outline-${String(outlineKeys.length + 1)}`;
        outlineKeys.push(key);
        destinations[key] = {
          kind: 'outline',
          title: item.title,
          ...(item.destination !== undefined ? { destination: item.destination } : {}),
          ...(parentKey !== undefined ? { parent: parentKey } : {}),
        };
        walkOutline(item.children, key);
      }
    };
    walkOutline(layout.outline, undefined);
    pkg.destinations = { ...pkg.destinations, ...destinations };
  }

  if (layout.attachments !== undefined && layout.attachments.length > 0) {
    pkg.attachments = {
      ...pkg.attachments,
      ...Object.fromEntries(
        layout.attachments.map((attachment) => [
          attachment.name,
          {
            kind: 'attachment',
            name: attachment.name,
            ...(attachment.description !== undefined ? { description: attachment.description } : {}),
            ...(attachment.mimeType !== undefined ? { mimeType: attachment.mimeType } : {}),
            base64: attachment.base64,
          },
        ]),
      ),
    };
  }

  if (layout.layers !== undefined && layout.layers.length > 0) {
    pkg.layers = {
      ...pkg.layers,
      ...Object.fromEntries(layout.layers.map((layer) => [layer.name, { kind: 'layer', name: layer.name, visible: layer.visible }])),
    };
  }

  if (layout.source !== undefined) {
    pkg.source = { ...pkg.source, ...layout.source };
  }

  // Comment bodies: the same deterministic pdf-annot-{page}-{index} keys reconstruct.ts's anchor constructs reference, so the marker and its definition can never drift apart -- both derive from one walk of the same annotations array.
  const definitions: Record<string, DefinitionEntry> = {};
  layout.pages.forEach((page, pageIndex) => {
    (page.annotations ?? []).forEach((annotation: LayoutAnnotation, annotIndex) => {
      definitions[`pdf-annot-${String(pageIndex)}-${String(annotIndex)}`] = {
        kind: 'comment',
        ...(annotation.contents !== undefined ? { body: annotation.contents } : {}),
        ...(annotation.author !== undefined ? { author: annotation.author } : {}),
        ...(annotation.modifiedIso !== undefined ? { dateIso: annotation.modifiedIso } : {}),
        ...(annotation.source !== undefined ? { source: annotation.source } : {}),
      };
    });
  });
  if (layout.structure !== undefined) {
    walkStructureElements(layout.structure, undefined, definitions);
  }
  if (Object.keys(definitions).length > 0) {
    pkg.definitions = { ...pkg.definitions, ...definitions };
  }
}

// The structure tree flattened depth-first into structure entries keyed by each element's own reader-minted id, the parent stated as a reference the same way outline entries state theirs. This is where a per-element /Lang override stays reachable from the package -- the flat ContentDocument has no run-level or block-level language field to spell one in, so the definitions table is the honest home for the fact the reader recovered.
function walkStructureElements(elements: readonly LayoutStructureElement[], parentKey: string | undefined, definitions: Record<string, DefinitionEntry>): void {
  for (const element of elements) {
    definitions[element.id] = {
      kind: 'structure',
      type: element.type,
      ...(element.title !== undefined ? { title: element.title } : {}),
      ...(element.language !== undefined ? { language: element.language } : {}),
      ...(element.alt !== undefined ? { alt: element.alt } : {}),
      ...(element.actualText !== undefined ? { actualText: element.actualText } : {}),
      ...(parentKey !== undefined ? { parent: parentKey } : {}),
    };
    walkStructureElements(element.children, element.id, definitions);
  }
}
