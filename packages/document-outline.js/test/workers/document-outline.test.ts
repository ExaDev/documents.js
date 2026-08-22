import { describe, expect, it } from 'vitest';
import { documentPackageWithSchema, type StylesTable } from 'document-schema.js';
import { buildOutline, effectivePackage, flattenOutline, isOutlineChild, leafContentHash, outlineLeafText, projectDocumentGraph } from '../../src';
import { stableContentHash } from '../../src/outline/hash';
import {
  drawPageGroup,
  drawingPackage,
  formulaPackage,
  headingGroup,
  listGroup,
  paragraph,
  presentationPackage,
  sectionGroup,
  shapeGroup,
  sheetGroup,
  sheetImage,
  slideGroup,
  spreadsheetPackage,
  vectorLine,
  wordprocessingPackage,
} from '../../src/test-support/fixtures';

// Proves document-outline.js's surface executes inside a Cloudflare Workers isolate (workerd, via @cloudflare/vitest-pool-workers) with no Node-only APIs. Every path here -- per-kind outline building, effective-property resolution, flatten, leaf text, content hashing -- is deliberately Node-free (the SHA-256 is hand-rolled over Uint8Array precisely so no node:crypto is needed); if any touched code path in this module graph or its zod / document-schema.js dependencies reached for node:fs/Buffer/process, the workerd isolate would throw rather than these passing. This is the runtime complement to the static ESLint Worker-isomorphism guard.
describe('document-outline.js under the Cloudflare Workers runtime', () => {
  it('builds and validates outlines for all five package kinds inside the isolate', () => {
    const wordPkg = wordprocessingPackage([sectionGroup([headingGroup('Chapter', 1, [paragraph('body')])])]);
    const packages = [
      wordPkg,
      presentationPackage([slideGroup([shapeGroup([listGroup('A', 0, [listGroup('B', 1, [])])])])]),
      spreadsheetPackage([sheetGroup({ name: 'Revenue', images: [sheetImage('a chart')] })]),
      drawingPackage([drawPageGroup([shapeGroup([paragraph('text box')]), vectorLine()])]),
      formulaPackage('x^2'),
    ];
    for (const pkg of packages) {
      expect(buildOutline(pkg).every(isOutlineChild)).toBe(true);
    }
    expect(buildOutline(wordPkg)).toEqual([
      { text: 'Chapter', level: 1, children: [paragraph('body')] },
    ]);
  });

  it('resolves effective properties, walks, and hashes leaves inside the isolate', () => {
    const styles: StylesTable = { 'body-text': { paragraph: { indentLeftPt: 24 } } };
    const factored = wordprocessingPackage(
      [sectionGroup([headingGroup('Chapter', 1, [paragraph('body')], { style: 'body-text' })])],
      { styles },
    );
    const outline = buildOutline(effectivePackage(factored));
    expect(outline.every(isOutlineChild)).toBe(true);
    const leaves = flattenOutline(outline);
    expect(leaves).toEqual([{ kind: 'paragraph', runs: [{ text: 'body' }], indentLeftPt: 24 }]);
    expect(leafContentHash(leaves[0]!)).toBe(leafContentHash({ kind: 'paragraph', runs: [{ text: 'body' }], indentLeftPt: 24 }));
    expect(outlineLeafText(leaves[0]!)).toBe('body');
  });

  it('projects packages into the content-addressed property graph inside the isolate', () => {
    const styles: StylesTable = { 'body-text': { run: { bold: true } } };
    const first = wordprocessingPackage([sectionGroup([headingGroup('Chapter', 1, [paragraph('body')], { style: 'body-text' })])], { styles });
    const second = wordprocessingPackage([sectionGroup([paragraph('body')])]);
    const graph = projectDocumentGraph([
      { id: 'one', package: first },
      { id: 'two', package: second },
    ]);
    // The shared body paragraph is one node with two containment edges, and the style entry node is reachable by its STYLED_BY edge -- all inside workerd, proving the projection is as Node-free as the hash it reuses. Two STYLED_BY edges reach it (#660): the heading's own ref, and the shared bare paragraph leaf's inherited-chain edge (the second document's own occurrence carries no style scope, so it contributes none).
    const sharedBody = graph.nodes.filter((node) => node.kind === 'paragraph' && JSON.stringify(node).includes('body'));
    expect(sharedBody).toHaveLength(1);
    expect(graph.edges.filter((edge) => edge.kind === 'CONTAINS' && edge.to === sharedBody[0]!.id)).toHaveLength(2);
    expect(graph.edges.filter((edge) => edge.kind === 'STYLED_BY')).toHaveLength(2);
    expect(graph.nodes.filter((node) => node.kind === 'styleEntry')).toHaveLength(1);
  });

  it('hashes a serialised package identically with and without its $schema label inside the isolate', () => {
    const pkg = wordprocessingPackage([sectionGroup([paragraph('before')])]);
    expect(leafContentHash(flattenOutline(buildOutline(pkg))[0]!)).toBe(
      leafContentHash({ kind: 'paragraph', runs: [{ text: 'before' }] }),
    );
    expect(stableContentHash(documentPackageWithSchema(pkg))).toBe(stableContentHash(pkg));
  });
});
