import { describe, expect, it } from 'vitest';
import {
  documentTreeWithSchema,
  DocumentTreeSchema,
  factorStyles,
  type ContentParagraph,
  type DefinitionEntry,
  type DocumentTree,
  type DocumentTreeJson,
  type LayoutMetadata,
  type StylesTable,
} from 'document-schema.js';
import { effectivePackage } from './effective';
import { contentHashV1, defaultExtractionPolicy, orderKeys, projectDocumentGraph, walkPropertyGraph, type ExtractionPolicy, type GraphNode, type PropertyGraph } from './graph';
import {
  drawPageGroup,
  drawingPackage,
  embeddedObject,
  formulaPackage,
  headingGroup,
  listGroup,
  paragraph,
  presentationPackage,
  sectionConstructGroup,
  sectionGroup,
  shapeGroup,
  sheetGroup,
  sheetImage,
  slideGroup,
  spreadsheetPackage,
  vectorLine,
  vectorRect,
  wordprocessingPackage,
} from '../test-support/fixtures';

// The worked example of ExaDev/documents.js#659: a report document whose heading paragraph carries a styles-table ref, plus a second document sharing the boilerplate line and the heading style content but nothing else -- the projection must share exactly those two things and nothing besides.
const H1_BOLD_RUN = { bold: true, fontFamily: 'Times New Roman' };
const REPORT_STYLES: StylesTable = { 'h1-bold': { run: H1_BOLD_RUN } };
const MEMO_STYLES: StylesTable = { 'heading-1': { run: H1_BOLD_RUN } }; // same entry content, different local key

function reportPackage(boilerplate: ReturnType<typeof paragraph>): DocumentTree {
  return wordprocessingPackage(
    [
      sectionGroup([
        headingGroup(
          'Summary',
          1,
          [
            boilerplate,
            { kind: 'paragraph', runs: [{ text: 'Revenue grew 12% quarter over quarter.', italic: true }] },
          ],
          { style: 'h1-bold' },
        ),
      ]),
    ],
    { metadata: { title: 'Q3 Report', author: 'Alice' }, styles: REPORT_STYLES },
  );
}

function memoPackage(boilerplate: ReturnType<typeof paragraph>): DocumentTree {
  return wordprocessingPackage([sectionGroup([headingGroup('Memo', 1, [boilerplate], { style: 'heading-1' })])], {
    metadata: { title: 'Staff Memo' },
    styles: MEMO_STYLES,
  });
}

function expectSchemaValid(pkg: DocumentTree, label: string): void {
  const result = DocumentTreeSchema.safeParse(pkg);
  expect(result.success ? 'valid' : `invalid (${label}): ${JSON.stringify(result.error.issues[0])}`).toBe('valid');
}

function nodesOf(graph: PropertyGraph, kind: string): GraphNode[] {
  return graph.nodes.filter((node) => node.kind === kind);
}

function nodeByText(graph: PropertyGraph, text: string): GraphNode {
  const matches = graph.nodes.filter((node) => JSON.stringify(node).includes(JSON.stringify(text)));
  expect(matches.length).toBe(1);
  return matches[0]!;
}

function edgesBetween(graph: PropertyGraph, from: string, kind: string): PropertyGraph['edges'][number][] {
  return graph.edges.filter((edge) => edge.from === from && edge.kind === kind);
}

describe('content-addressed deduplication', () => {
  it('splits nodes when the same style KEY names different entry content in two documents', () => {
    const docA = wordprocessingPackage([sectionGroup([headingGroup('Shared', 1, [], { style: 's1' })])], {
      styles: { s1: { run: { bold: true } } },
    });
    const docB = wordprocessingPackage([sectionGroup([headingGroup('Shared', 1, [], { style: 's1' })])], {
      styles: { s1: { run: { italic: true } } },
    });
    const graph = projectDocumentGraph([
      { id: 'a', package: docA },
      { id: 'b', package: docB },
    ]);
    // Hashing the bare ref key would wrongly merge these; the entry content keeps them apart, cascading to the referencing headings.
    expect(graph.nodes.filter((node) => node.kind === 'styleEntry')).toHaveLength(2);
    const headings = graph.nodes.filter((node) => node.kind === 'paragraph' && node.headingLevel === 1);
    expect(headings).toHaveLength(2);
    expect(headings[0]!.id).not.toBe(headings[1]!.id);
  });

  it('collapses an identical whole subtree to one shared subtree with only seam edges per document', () => {
    const sharedSection = sectionGroup([headingGroup('Terms', 1, [paragraph('All rights reserved.')]), paragraph('Fine print.')]);
    const docA = wordprocessingPackage([sharedSection, sectionGroup([paragraph('Document A only.')])], { metadata: { title: 'A' } });
    const docB = wordprocessingPackage([sectionGroup([paragraph('Document B only.')]), sharedSection], { metadata: { title: 'B' } });
    const graph = projectDocumentGraph([
      { id: 'a', package: docA },
      { id: 'b', package: docB },
    ]);
    expectSchemaValid(docA, 'docA');
    expectSchemaValid(docB, 'docB');
    const sections = graph.nodes.filter((node) => node.kind === 'section');
    expect(sections).toHaveLength(3); // the shared one plus each document's own final section
    const shared = sections.find((section) => graph.edges.some((edge) => edge.kind === 'CONTAINS' && edge.from === section.id && edge.orderKey === orderKeys.orderKeyForIndex(0) && graph.edges.some((rootEdge) => rootEdge.kind === 'CONTAINS' && rootEdge.from === 'a' && rootEdge.to === section.id)))!;
    // One shared section node, referenced by each document's own root at its own local orderKey.
    const seams = graph.edges.filter((edge) => edge.kind === 'CONTAINS' && edge.to === shared.id);
    expect(seams.map((edge) => ({ from: edge.from, orderKey: edge.orderKey })).sort((x, y) => x.from.localeCompare(y.from))).toEqual([
      { from: 'a', orderKey: orderKeys.orderKeyForIndex(0) },
      { from: 'b', orderKey: orderKeys.orderKeyForIndex(1) },
    ]);
    // Every descendant of the shared section is also emitted exactly once: the heading anchor, two paragraphs, and each document's own leaf.
    expect(graph.nodes.filter((node) => node.kind === 'paragraph')).toHaveLength(5);
  });

  it('deduplicates repeated content within one document: one node, one edge per position', () => {
    const repeated = paragraph('Standard disclaimer.');
    const pkg = wordprocessingPackage([sectionGroup([repeated, paragraph('Body.'), repeated])]);
    const graph = projectDocumentGraph([{ id: 'doc', package: pkg }]);
    const matches = graph.nodes.filter((node) => node.kind === 'paragraph' && JSON.stringify(node).includes('Standard disclaimer.'));
    expect(matches).toHaveLength(1);
    const contains = graph.edges.filter((edge) => edge.to === matches[0]!.id && edge.kind === 'CONTAINS');
    expect(contains.map((edge) => edge.orderKey)).toEqual([orderKeys.orderKeyForIndex(0), orderKeys.orderKeyForIndex(2)]);
  });
});

describe('Merkle-DAG edit behaviour', () => {
  const before = () => wordprocessingPackage([sectionGroup([paragraph('First.'), paragraph('Last.')])]);
  const after = () => wordprocessingPackage([sectionGroup([paragraph('First.'), paragraph('Inserted.'), paragraph('Last.')])]);

  it('insertion between siblings changes no sibling identity, only local orderKey values', () => {
    const beforeGraph = projectDocumentGraph([{ id: 'doc', package: before() }]);
    const afterGraph = projectDocumentGraph([{ id: 'doc', package: after() }]);
    const idOf = (graph: PropertyGraph, text: string) => nodeByText(graph, text).id;
    expect(idOf(afterGraph, 'First.')).toBe(idOf(beforeGraph, 'First.'));
    expect(idOf(afterGraph, 'Last.')).toBe(idOf(beforeGraph, 'Last.'));
    const afterSection = afterGraph.nodes.find((node) => node.kind === 'section')!;
    const orders = afterGraph.edges
      .filter((edge) => edge.from === afterSection.id && edge.kind === 'CONTAINS')
      .map((edge) => ({ orderKey: edge.orderKey, to: edge.to }));
    expect(orders).toEqual([
      { orderKey: orderKeys.orderKeyForIndex(0), to: idOf(afterGraph, 'First.') },
      { orderKey: orderKeys.orderKeyForIndex(1), to: idOf(afterGraph, 'Inserted.') },
      { orderKey: orderKeys.orderKeyForIndex(2), to: idOf(afterGraph, 'Last.') },
    ]);
  });

  it('modification mints a new node and new ancestors while the old nodes persist beside them', () => {
    const edited = wordprocessingPackage([sectionGroup([paragraph('First, revised.'), paragraph('Last.')])]);
    const graph = projectDocumentGraph([
      { id: 'v1', package: before() },
      { id: 'v2', package: edited },
    ]);
    const v1First = nodeByText(graph, 'First.');
    const v2First = nodeByText(graph, 'First, revised.');
    expect(v1First.id).not.toBe(v2First.id);
    // The Merkle cascade: every ancestor of the edited leaf is a new node too, so the two sections are distinct.
    expect(graph.nodes.filter((node) => node.kind === 'section')).toHaveLength(2);
    // The unchanged sibling keeps its identity and is shared by both versions.
    const last = graph.nodes.filter((node) => node.kind === 'paragraph' && JSON.stringify(node).includes('Last.'));
    expect(last).toHaveLength(1);
    expect(graph.edges.filter((edge) => edge.kind === 'CONTAINS' && edge.to === last[0]!.id)).toHaveLength(2);
  });
});

describe('definitions tables', () => {
  const NOTE_BODY: DefinitionEntry = {
    kind: 'footnote',
    blocks: [{ kind: 'paragraph', runs: [{ text: 'The note body.' }] }],
  };

  function footnotePackage(styleKey: string, definitionKey = 'n1'): DocumentTree {
    return wordprocessingPackage(
      [
        sectionGroup([
          { node: { kind: 'anchor', anchorType: 'footnote', name: '1', definition: definitionKey }, children: [] },
          paragraph('Body text.'),
        ]),
      ],
      { styles: { [styleKey]: { run: { bold: true } } }, definitions: { [definitionKey]: NOTE_BODY } },
    );
  }

  it('projects an anchor definition ref as a DEFINED_BY edge to a definitionEntry node', () => {
    const pkg = footnotePackage('bold');
    expectSchemaValid(pkg, 'footnote');
    const graph = projectDocumentGraph([{ id: 'doc', package: pkg }]);

    const entryNodes = graph.nodes.filter((node) => node.kind === 'definitionEntry');
    // The entry's own tenant discriminator re-houses under tenantKind; the graph kind names the table.
    expect(entryNodes).toEqual([{ id: entryNodes[0]!.id, kind: 'definitionEntry', tenantKind: 'footnote', blocks: NOTE_BODY.blocks }]);

    const anchorNode = graph.nodes.find((node) => node.kind === 'anchor')!;
    expect(anchorNode).toMatchObject({ kind: 'anchor', anchorType: 'footnote', name: '1' });
    expect('definition' in anchorNode).toBe(false); // the local key never reaches the node face
    expect(graph.edges.filter((edge) => edge.kind === 'DEFINED_BY')).toEqual([
      { from: anchorNode.id, to: entryNodes[0]!.id, kind: 'DEFINED_BY', orderKey: orderKeys.orderKeyForIndex(0), path: ['definition'] },
    ]);
  });

  it('deduplicates anchor refs across documents naming the same entry content differently', () => {
    // Document b spells the identical entry under a different key and references it from an identically-shaped anchor.
    const a = footnotePackage('bold');
    const b = footnotePackage('bold', 'noteOne');
    expectSchemaValid(b, 'footnote-b');
    const graph = projectDocumentGraph([
      { id: 'a', package: a },
      { id: 'b', package: b },
    ]);
    expect(graph.nodes.filter((node) => node.kind === 'definitionEntry')).toHaveLength(1);
    expect(graph.nodes.filter((node) => node.kind === 'anchor')).toHaveLength(1);
    expect(graph.edges.filter((edge) => edge.kind === 'DEFINED_BY')).toHaveLength(1);
  });

  it('emits definitionEntry nodes for unreferenced entries in every generic table', () => {
    const pkg = wordprocessingPackage([sectionGroup([paragraph('Body.')])], {
      definitions: { n1: NOTE_BODY },
      layers: { ocg1: { kind: 'layer', name: 'Background' } },
      attachments: { file1: { kind: 'attachment', name: 'data.csv' } },
      destinations: { top: { kind: 'destination', page: 1 } },
    });
    expectSchemaValid(pkg, 'tables');
    const graph = projectDocumentGraph([{ id: 'doc', package: pkg }]);
    const entries = graph.nodes.filter((node) => node.kind === 'definitionEntry');
    expect(entries).toHaveLength(4); // all four exist whether or not anything references them
    expect(entries.map((node) => node.tenantKind).sort()).toEqual(['attachment', 'destination', 'footnote', 'layer']);
  });

  it('refuses a ref the table does not carry, loudly', () => {
    const danglingStyle = wordprocessingPackage([sectionGroup([headingGroup('H', 1, [], { style: 'missing' })])], {
      styles: { s1: { run: { bold: true } } },
    });
    expect(() => projectDocumentGraph([{ id: 'doc', package: danglingStyle }])).toThrow(
      /style ref "missing" names no entry in the styles table/,
    );

    const danglingDefinition = wordprocessingPackage(
      [sectionGroup([{ node: { kind: 'anchor', anchorType: 'footnote', name: '1', definition: 'gone' }, children: [] }])],
      { definitions: { n1: NOTE_BODY } },
    );
    expect(() => projectDocumentGraph([{ id: 'doc', package: danglingDefinition }])).toThrow(
      /definition ref "gone" names no entry in the definitions table/,
    );
  });

  it('treats a definitions-entry body key spelled "definition" as tenant content, never a table ref', () => {
    // DefinitionEntry bodies are tenant vocabulary, loose by design (src/definitions.ts): a glossary entry legitimately spells `definition` for a term's meaning, so the deref is gated on the containing record being an anchor descriptor, not on the key name. A value that coincidentally names a real key must stay content too -- hashed verbatim, never silently swapped for a ref id.
    const pkg = wordprocessingPackage(
      [sectionGroup([{ node: { kind: 'anchor', anchorType: 'footnote', name: '1', definition: 'n1' }, children: [] }])],
      {
        definitions: {
          g1: { kind: 'glossary', term: 'quorum', definition: 'the minimum number of members needed' },
          g2: { kind: 'glossary', term: 'proxy', definition: 'n1' }, // coincidentally names a real key
          n1: NOTE_BODY,
        },
      },
    );
    expectSchemaValid(pkg, 'glossary');
    const graph = projectDocumentGraph([{ id: 'doc', package: pkg }]);
    const glossary = graph.nodes.filter((node) => node.kind === 'definitionEntry' && node.tenantKind === 'glossary');
    expect(glossary.map((node) => node.definition).sort()).toEqual(['n1', 'the minimum number of members needed']);
    // The one DEFINED_BY edge is the tree anchor's own ref; neither glossary body produced one.
    expect(graph.edges.filter((edge) => edge.kind === 'DEFINED_BY')).toHaveLength(1);
  });

  it('extends deref-before-hash into entry bodies: an entry referencing another entry hashes its content', () => {
    const chain = (secondBody: string): DocumentTree =>
      wordprocessingPackage(
        [sectionGroup([{ node: { kind: 'anchor', anchorType: 'footnote', name: '1', definition: 'n1' }, children: [] }])],
        {
          definitions: {
            n1: {
              kind: 'footnote',
              blocks: [
                {
                  kind: 'paragraph',
                  runs: [{ text: 'See also.' }],
                  constructs: [{ descriptor: { kind: 'anchor', anchorType: 'footnote', name: '2', definition: 'n2' }, startRun: 0, endRun: 0 }],
                },
              ],
            },
            n2: { kind: 'footnote', blocks: [{ kind: 'paragraph', runs: [{ text: secondBody }] }] },
          },
        },
      );
    expectSchemaValid(chain('Second body.'), 'chain');
    const graphA = projectDocumentGraph([{ id: 'doc', package: chain('Second body.') }]);
    const graphB = projectDocumentGraph([{ id: 'doc', package: chain('Second body, revised.') }]);
    const entryByBody = (graph: PropertyGraph, text: string) =>
      graph.nodes.find((node) => node.kind === 'definitionEntry' && JSON.stringify(node).includes(JSON.stringify(text)))!;
    // n2's content feeds n1's hash through the body's anchor deref, so editing n2 mints a new n1 beside it.
    expect(entryByBody(graphA, 'See also.').id).not.toBe(entryByBody(graphB, 'See also.').id);
    expect(entryByBody(graphA, 'Second body.').id).not.toBe(entryByBody(graphB, 'Second body, revised.').id);
  });

  it('refuses a cycle of definition refs among entries by name, not with a stack overflow', () => {
    // Two footnotes whose bodies reference each other -- the mutual-reference case the graph hardenings name as legitimate-looking input. No content hash can cover it (the hash would have to include itself), so the projection refuses it loudly.
    const mutual: DocumentTree = wordprocessingPackage([sectionGroup([paragraph('Body.')])], {
      definitions: {
        n1: {
          kind: 'footnote',
          blocks: [
            {
              kind: 'paragraph',
              runs: [{ text: 'See n2.' }],
              constructs: [{ descriptor: { kind: 'anchor', anchorType: 'footnote', name: '2', definition: 'n2' }, startRun: 0, endRun: 0 }],
            },
          ],
        },
        n2: {
          kind: 'footnote',
          blocks: [
            {
              kind: 'paragraph',
              runs: [{ text: 'See n1.' }],
              constructs: [{ descriptor: { kind: 'anchor', anchorType: 'footnote', name: '1', definition: 'n1' }, startRun: 0, endRun: 0 }],
            },
          ],
        },
      },
    });
    expectSchemaValid(mutual, 'mutual');
    expect(() => projectDocumentGraph([{ id: 'doc', package: mutual }])).toThrow(
      /definitions table entry "n1" is reachable from its own body/,
    );
  });
});

describe('factoring and node identity', () => {
  // One document, two spellings: the unfactored tree carries the recurring tuple inline on every styled paragraph; factorStyles (the minting pass itself) hoists it onto a section wrapper's ref plus a styles-table entry. The projection deliberately hashes each node's own projected content, not style-resolved content, so the two spellings' node ids differ wherever the style rides while everything it does not touch is shared -- and effectivePackage first is the caller's route to factoring-invariant ids, exactly as it already is for leafContentHash.
  const styled = (text: string): ContentParagraph => ({ kind: 'paragraph', runs: [{ text, bold: true }], alignment: 'center' });
  const unfactored = (): DocumentTree =>
    wordprocessingPackage([sectionGroup([styled('Styled one.'), styled('Styled two.')]), sectionGroup([paragraph('Plain.')])]);

  it('gives a factored and an unfactored spelling of one document different styled-node ids, sharing the untouched remainder', () => {
    const factored = factorStyles(unfactored());
    expectSchemaValid(unfactored(), 'unfactored');
    expectSchemaValid(factored, 'factored');
    // The minting pass really factored the recurring tuple: one entry, hoisted onto the first section's wrapper ref.
    expect(factored.styles).toEqual({ s1: { paragraph: { alignment: 'center' }, run: { bold: true } } });

    const factoredGraph = projectDocumentGraph([{ id: 'doc', package: factored }]);
    const unfactoredGraph = projectDocumentGraph([{ id: 'doc', package: unfactored() }]);

    // The plain paragraph, untouched by the style, is the same node in both spellings.
    expect(nodeByText(factoredGraph, 'Plain.').id).toBe(nodeByText(unfactoredGraph, 'Plain.').id);
    // The styled paragraphs are not: the factored hash folds in the style entry's hash, the unfactored hashes the properties inline.
    expect(nodeByText(factoredGraph, 'Styled one.').id).not.toBe(nodeByText(unfactoredGraph, 'Styled one.').id);
    // The extraction difference is visible as nodes and edges the unfactored spelling cannot have.
    expect(factoredGraph.nodes.filter((node) => node.kind === 'styleEntry')).toHaveLength(1);
    expect(unfactoredGraph.nodes.filter((node) => node.kind === 'styleEntry')).toHaveLength(0);
    // The recurring tuple is hoisted onto the first section's own ref (1 STYLED_BY edge), and both styled paragraphs -- now bare, non-anchor leaves under that styled section -- inherit the chain too (#660): one edge each, 3 in total, all resolving to the same shared style entry.
    expect(factoredGraph.edges.filter((edge) => edge.kind === 'STYLED_BY')).toHaveLength(3);
    expect(unfactoredGraph.edges.filter((edge) => edge.kind === 'STYLED_BY')).toHaveLength(0);
  });

  it('projects the two spellings to the identical graph once effectivePackage has resolved them', () => {
    const factored = factorStyles(unfactored());
    const resolvedFactored = projectDocumentGraph([{ id: 'doc', package: effectivePackage(factored) }]);
    const resolvedUnfactored = projectDocumentGraph([{ id: 'doc', package: effectivePackage(unfactored()) }]);
    expect(resolvedFactored).toEqual(resolvedUnfactored);
  });
});

describe('extraction policy', () => {
  it('default: metadata stays inline on the root even when identical across documents, and nothing else is extracted', () => {
    const docA = wordprocessingPackage([sectionGroup([paragraph('A body.')])], { metadata: { title: 'Same title' } });
    const docB = wordprocessingPackage([sectionGroup([paragraph('B body.')])], { metadata: { title: 'Same title' } });
    const graph = projectDocumentGraph([
      { id: 'a', package: docA },
      { id: 'b', package: docB },
    ]);
    expect(graph.nodes.filter((node) => node.kind === 'value')).toEqual([]);
    expect(graph.edges.filter((edge) => edge.kind === 'PROPERTY')).toEqual([]);
    const roots = graph.nodes.filter((node) => node.kind === 'documentTree');
    expect(roots).toHaveLength(2);
    for (const root of roots) expect(root.metadata).toEqual({ title: 'Same title' });
  });

  it('custom: extracting a recurring scalar promotes it to a shared value node with a PROPERTY edge', () => {
    const extractTitles: ExtractionPolicy = (path, value) =>
      path.length === 2 && path[0] === 'metadata' && path[1] === 'title' && typeof value === 'string' ? 'extract' : 'inline';
    const docA = wordprocessingPackage([sectionGroup([paragraph('A body.')])], { metadata: { title: 'Shared title' } });
    const docB = wordprocessingPackage([sectionGroup([paragraph('B body.')])], { metadata: { title: 'Shared title' } });
    const graph = projectDocumentGraph(
      [
        { id: 'a', package: docA },
        { id: 'b', package: docB },
      ],
      { policy: extractTitles },
    );
    const valueNodes = graph.nodes.filter((node) => node.kind === 'value');
    expect(valueNodes).toEqual([{ id: valueNodes[0]!.id, kind: 'value', value: 'Shared title' }]);
    const roots = graph.nodes.filter((node) => node.kind === 'documentTree');
    expect(roots).toHaveLength(2);
    for (const root of roots) expect('title' in (root.metadata as Record<string, unknown>)).toBe(false);
    expect(graph.edges.filter((edge) => edge.kind === 'PROPERTY')).toHaveLength(2);
    for (const edge of graph.edges.filter((edge) => edge.kind === 'PROPERTY')) {
      expect(edge.path).toEqual(['metadata', 'title']);
      expect(edge.to).toBe(valueNodes[0]!.id);
      expect(edge.orderKey).toBe(orderKeys.orderKeyForIndex(0));
    }
  });

  it('custom: inlining style entries folds the dereferenced entry content into the referencing node', () => {
    const inlineStyles: ExtractionPolicy = (path, value) =>
      path.length === 2 && path[0] === 'styles' ? 'inline' : defaultExtractionPolicy(path, value);
    const entry = { run: { bold: true } };
    const doc = wordprocessingPackage([sectionGroup([headingGroup('H', 1, [], { style: 's1' })])], { styles: { s1: entry } });
    const graph = projectDocumentGraph([{ id: 'doc', package: doc }], { policy: inlineStyles });
    expect(graph.nodes.filter((node) => node.kind === 'styleEntry')).toEqual([]);
    expect(graph.edges.filter((edge) => edge.kind === 'STYLED_BY')).toEqual([]);
    const heading = graph.nodes.find((node) => node.kind === 'paragraph' && node.headingLevel === 1)!;
    // The dereferenced ENTRY CONTENT rides on the node -- never the document-local key 's1'.
    expect(heading.style).toEqual(entry);
    expect(graph.nodes.find((node) => node.kind === 'documentTree')!.styles).toEqual({ s1: entry });
  });
});

describe('every document kind projects', () => {
  it('presentation: slide and shape groups with list nesting', () => {
    const pkg = presentationPackage([slideGroup([shapeGroup([listGroup('Top', 0, [listGroup('Nested', 1, [])])])])]);
    expectSchemaValid(pkg, 'presentation');
    const graph = projectDocumentGraph([{ id: 'deck', package: pkg }]);
    // Both list anchors are paragraphs in the tree vocabulary, so the projected kinds name payloads, not wrappers.
    expect(graph.nodes.map((node) => node.kind).sort()).toEqual(['documentTree', 'paragraph', 'paragraph', 'shape', 'slide']);
    const slide = graph.nodes.find((node) => node.kind === 'slide')!;
    const shape = graph.nodes.find((node) => node.kind === 'shape')!;
    const top = nodeByText(graph, 'Top');
    expect(graph.edges).toEqual([
      { from: 'deck', to: slide.id, kind: 'CONTAINS', orderKey: orderKeys.orderKeyForIndex(0) },
      { from: slide.id, to: shape.id, kind: 'CONTAINS', orderKey: orderKeys.orderKeyForIndex(0) },
      { from: shape.id, to: top.id, kind: 'CONTAINS', orderKey: orderKeys.orderKeyForIndex(0) },
      { from: top.id, to: nodeByText(graph, 'Nested').id, kind: 'CONTAINS', orderKey: orderKeys.orderKeyForIndex(0) },
    ]);
  });

  it('spreadsheet: sheet node with image and embedded-object children, envelope facts inline', () => {
    const pkg = spreadsheetPackage([sheetGroup({ name: 'Revenue', images: [sheetImage('chart')], embeddedObjects: [embeddedObject()] })], {
      pages: [{ widthPt: 842, heightPt: 595 }],
    });
    expectSchemaValid(pkg, 'spreadsheet');
    const graph = projectDocumentGraph([{ id: 'book', package: pkg }]);
    expect(graph.nodes.map((node) => node.kind).sort()).toEqual(['documentTree', 'embeddedObject', 'image', 'sheet']);
    const root = graph.nodes.find((node) => node.kind === 'documentTree')!;
    expect(root.pages).toEqual([{ widthPt: 842, heightPt: 595 }]);
    const sheet = graph.nodes.find((node) => node.kind === 'sheet')!;
    expect(sheet).toMatchObject({ kind: 'sheet', name: 'Revenue' });
    const contains = graph.edges.filter((edge) => edge.from === sheet.id && edge.kind === 'CONTAINS');
    expect(contains.map((edge) => [edge.orderKey, graph.nodes.find((node) => node.id === edge.to)!.kind])).toEqual([
      [orderKeys.orderKeyForIndex(0), 'image'],
      [orderKeys.orderKeyForIndex(1), 'embeddedObject'],
    ]);
  });

  it('drawing: draw page with shapes and vector leaves', () => {
    const pkg = drawingPackage([drawPageGroup([shapeGroup([paragraph('Caption.')]), vectorLine(), vectorRect()])]);
    expectSchemaValid(pkg, 'drawing');
    const graph = projectDocumentGraph([{ id: 'poster', package: pkg }]);
    expect(graph.nodes.map((node) => node.kind).sort()).toEqual(['documentTree', 'drawPage', 'line', 'paragraph', 'rect', 'shape']);
    const page = graph.nodes.find((node) => node.kind === 'drawPage')!;
    const contains = graph.edges.filter((edge) => edge.from === page.id && edge.kind === 'CONTAINS');
    expect(contains.map((edge) => [edge.orderKey, graph.nodes.find((node) => node.id === edge.to)!.kind])).toEqual([
      [orderKeys.orderKeyForIndex(0), 'shape'],
      [orderKeys.orderKeyForIndex(1), 'line'],
      [orderKeys.orderKeyForIndex(2), 'rect'],
    ]);
  });

  it('formula: the single leaf is the whole tree', () => {
    const pkg = formulaPackage('x^2');
    expectSchemaValid(pkg, 'formula');
    const graph = projectDocumentGraph([{ id: 'eq', package: pkg }]);
    expect(graph.nodes.map((node) => node.kind).sort()).toEqual(['documentTree', 'formula']);
    expect(graph.edges).toEqual([
      { from: 'eq', to: graph.nodes.find((node) => node.kind === 'formula')!.id, kind: 'CONTAINS', orderKey: orderKeys.orderKeyForIndex(0) },
    ]);
  });
});

describe('projectDocumentGraph', () => {
  it('is deterministic: the same input projects to the same graph, nodes and edges in the same order', () => {
    const boilerplate = paragraph('Please see attached.');
    const first = projectDocumentGraph([
      { id: 'report-1', package: reportPackage(boilerplate) },
      { id: 'memo-1', package: memoPackage(boilerplate) },
    ]);
    const second = projectDocumentGraph([
      { id: 'report-1', package: reportPackage(boilerplate) },
      { id: 'memo-1', package: memoPackage(boilerplate) },
    ]);
    expect(second).toEqual(first);
  });

  it('emits table-entry nodes in content order, so differently spelled key sets yield the same graph', () => {
    const boldRun = { run: { bold: true } };
    const italicRun = { run: { italic: true } };
    // The same two entries and the same referencing tree, under two different key spellings and two different insertion orders.
    const spelledA = wordprocessingPackage(
      [sectionGroup([headingGroup('One', 1, [], { style: 'bold' }), headingGroup('Two', 2, [], { style: 'italic' })])],
      { styles: { bold: boldRun, italic: italicRun } },
    );
    const spelledB = wordprocessingPackage(
      [sectionGroup([headingGroup('One', 1, [], { style: 'weight' }), headingGroup('Two', 2, [], { style: 'slant' })])],
      { styles: { slant: italicRun, weight: boldRun } },
    );
    expectSchemaValid(spelledA, 'spelledA');
    expectSchemaValid(spelledB, 'spelledB');

    const graphA = projectDocumentGraph([{ id: 'doc', package: spelledA }]);
    const graphB = projectDocumentGraph([{ id: 'doc', package: spelledB }]);
    // Root nodes identical (same id, same envelope); every content node identical and in the same order.
    expect(graphB.nodes.filter((node) => node.kind !== 'documentTree')).toEqual(
      graphA.nodes.filter((node) => node.kind !== 'documentTree'),
    );
    expect(graphB.edges).toEqual(graphA.edges);

    // The deref-before-hash rule itself: two documents whose identical paragraphs reference identical entry content under different keys produce the identical referencing node -- the two spellings collapse onto one shared subgraph, distinct only at their roots.
    const cross = projectDocumentGraph([
      { id: 'a', package: spelledA },
      { id: 'b', package: spelledB },
    ]);
    const styleNodes = cross.nodes.filter((node) => node.kind === 'styleEntry');
    expect(styleNodes).toHaveLength(2);
    const headingNodes = cross.nodes.filter((node) => node.kind === 'paragraph' && node.headingLevel !== undefined);
    expect(headingNodes).toHaveLength(2); // 'One' and 'Two', each shared across a and b
    expect(cross.nodes.filter((node) => node.kind === 'documentTree').map((node) => node.id).sort()).toEqual(['a', 'b']);
    expect(cross.edges.filter((edge) => edge.kind === 'CONTAINS' && (edge.from === 'a' || edge.from === 'b')).map((edge) => edge.from).sort()).toEqual(['a', 'b']);
  });

  it('projects the worked example: containment edges, a shared style node, and a shared boilerplate leaf', () => {
    const boilerplate = paragraph('Please see attached.');
    const report = reportPackage(boilerplate);
    const memo = memoPackage(boilerplate);
    expectSchemaValid(report, 'report');
    expectSchemaValid(memo, 'memo');

    const graph = projectDocumentGraph([
      { id: 'report-1', package: report },
      { id: 'memo-1', package: memo },
    ]);

    // The two document roots carry their own caller-assigned ids and their metadata inline.
    const roots = nodesOf(graph, 'documentTree');
    expect(roots).toEqual([
      { id: 'report-1', kind: 'documentTree', documentKind: 'wordprocessing', metadata: { title: 'Q3 Report', author: 'Alice' } },
      { id: 'memo-1', kind: 'documentTree', documentKind: 'wordprocessing', metadata: { title: 'Staff Memo' } },
    ]);

    // One style entry node shared by both documents (identical entry content, different local keys).
    const styleNodes = nodesOf(graph, 'styleEntry');
    expect(styleNodes).toEqual([{ id: styleNodes[0]?.id, kind: 'styleEntry', run: H1_BOLD_RUN }]);
    expect(styleNodes[0]!.id).toMatch(/^[0-9a-f]{64}$/);

    // Each document keeps its own section (its subtree differs), carrying its own payload.
    const sections = nodesOf(graph, 'section');
    expect(sections).toHaveLength(2);
    for (const section of sections) expect(section).toMatchObject({ kind: 'section', pageSize: { widthPt: 595, heightPt: 842 } });
    const headings = graph.nodes.filter((node) => node.kind === 'paragraph' && node.headingLevel === 1);
    expect(headings).toHaveLength(2);
    const summary = nodeByText(graph, 'Summary');
    expect(summary.headingLevel).toBe(1);
    expect('style' in summary).toBe(false);

    // The boilerplate paragraph is ONE node shared by both documents.
    const shared = nodeByText(graph, 'Please see attached.');
    const sharedContains = graph.edges.filter((edge) => edge.to === shared.id && edge.kind === 'CONTAINS');
    expect(sharedContains).toHaveLength(2);
    expect(sharedContains.map((edge) => edge.from)).toEqual([summary.id, headings.find((node) => node !== summary)!.id]);

    // Containment edges are stamped with an orderKey derived from document order.
    const reportSection = sections.find((section) => graph.edges.some((edge) => edge.kind === 'CONTAINS' && edge.from === section.id && edge.to === summary.id))!;
    const rootContains = edgesBetween(graph, 'report-1', 'CONTAINS');
    expect(rootContains).toEqual([{ from: 'report-1', to: reportSection.id, kind: 'CONTAINS', orderKey: orderKeys.orderKeyForIndex(0) }]);
    const sectionContains = edgesBetween(graph, reportSection.id, 'CONTAINS');
    expect(sectionContains).toEqual([{ from: reportSection.id, to: summary.id, kind: 'CONTAINS', orderKey: orderKeys.orderKeyForIndex(0) }]);
    const summaryContains = edgesBetween(graph, summary.id, 'CONTAINS');
    expect(summaryContains.map((edge) => edge.orderKey)).toEqual([orderKeys.orderKeyForIndex(0), orderKeys.orderKeyForIndex(1)]);
    expect(summaryContains.map((edge) => edge.to)).toEqual([
      shared.id,
      nodeByText(graph, 'Revenue grew 12% quarter over quarter.').id,
    ]);

    // Both heading paragraphs point at the one shared style node from their own document's ref, and so does every bare, non-anchor paragraph leaf sitting inside a heading's chain (#660): the boilerplate leaf (shared, so its one inherited edge dedupes across both documents) and report's own second paragraph.
    const revenueParagraph = nodeByText(graph, 'Revenue grew 12% quarter over quarter.');
    const styledBy = graph.edges.filter((edge) => edge.kind === 'STYLED_BY');
    expect(styledBy.every((edge) => edge.to === styleNodes[0]!.id)).toBe(true);
    expect(styledBy.map((edge) => edge.from).sort()).toEqual(
      [...headings.map((node) => node.id), shared.id, revenueParagraph.id].sort(),
    );
    expect(styledBy.every((edge) => edge.orderKey === orderKeys.orderKeyForIndex(0))).toBe(true);

    // Every node id is unique, and content ids are lowercase hex content hashes.
    expect(new Set(graph.nodes.map((node) => node.id)).size).toBe(graph.nodes.length);
    for (const node of graph.nodes) {
      if (node.kind !== 'documentTree') expect(node.id).toMatch(/^[0-9a-f]{64}$/);
    }
    for (const edge of graph.edges) {
      expect(graph.nodes.some((node) => node.id === edge.from)).toBe(true);
      expect(graph.nodes.some((node) => node.id === edge.to)).toBe(true);
    }
  });

  it('treats a $schema-stamped dump exactly like its parsed original', () => {
    const pkg = wordprocessingPackage([sectionGroup([paragraph('Body.')])], { metadata: { title: 'T' } });
    const stamped = documentTreeWithSchema(pkg);
    expect(projectDocumentGraph([{ id: 'doc', package: stamped }])).toEqual(projectDocumentGraph([{ id: 'doc', package: pkg }]));
  });

  it('dereferences a run-level anchor extent definition through the owning paragraph node', () => {
    const carrier: ContentParagraph = {
      kind: 'paragraph',
      runs: [{ text: 'before ' }, { text: 'words' }, { text: ' after' }],
      constructs: [{ descriptor: { kind: 'anchor', anchorType: 'footnote', name: '1', definition: 'n1' }, startRun: 1, endRun: 3 }],
    };
    const pkg = wordprocessingPackage([sectionGroup([carrier])], {
      definitions: { n1: { kind: 'footnote', blocks: [{ kind: 'paragraph', runs: [{ text: 'The note body.' }] }] } },
    });
    expectSchemaValid(pkg, 'run-extent');
    const graph = projectDocumentGraph([{ id: 'doc', package: pkg }]);
    const entry = graph.nodes.find((node) => node.kind === 'definitionEntry')!;
    const definedBy = graph.edges.filter((edge) => edge.kind === 'DEFINED_BY');
    expect(definedBy).toHaveLength(1);
    expect(definedBy[0]!.to).toBe(entry.id);
    expect(definedBy[0]!.path).toEqual(['constructs', 0, 'descriptor', 'definition']);
    const owner = graph.nodes.find((node) => node.id === definedBy[0]!.from)!;
    expect(owner.kind).toBe('paragraph');
    expect(JSON.stringify(owner).includes('"definition"')).toBe(false);
  });

  it('refuses a document id assigned to more than one document', () => {
    const first = wordprocessingPackage([sectionGroup([paragraph('A.')])]);
    const second = wordprocessingPackage([sectionGroup([paragraph('B.')])]);
    expect(() =>
      projectDocumentGraph([
        { id: 'same', package: first },
        { id: 'same', package: second },
      ]),
    ).toThrow(/document id "same" assigned to more than one document/);
  });
});

// The #660 hardening rows, each named in the issue: fractional ordering keys (insertion between siblings touches one edge, never a renumber), the versioned content-hash contract, the no-external-ids rule pinned against face shadowing, ordered STYLED_BY chains (one edge per ancestor entry, outermost first), and the per-kind cycle policy a shared walker applies.

describe('order keys (#660)', () => {
  it('mints lexicographically sorted sibling keys with insertion room between every adjacent pair', () => {
    const pkg = wordprocessingPackage([sectionGroup([paragraph('First.'), paragraph('Second.'), paragraph('Third.')])]);
    const graph = projectDocumentGraph([{ id: 'doc', package: pkg }]);
    const section = graph.nodes.find((node) => node.kind === 'section')!;
    const keys = graph.edges
      .filter((edge) => edge.kind === 'CONTAINS' && edge.from === section.id)
      .map((edge) => edge.orderKey)
      .sort();
    expect(keys).toHaveLength(3);
    // Equal-width lexicographic sort is numeric sort: the minted keys sort in document order and leave room between each adjacent pair for a consumer-side insert that touches no sibling edge.
    expect(keys[0]! < keys[1]!).toBe(true);
    expect(keys[1]! < keys[2]!).toBe(true);
    // The mint is index-derived and deterministic: re-projecting the same package yields the identical keys.
    const again = projectDocumentGraph([{ id: 'doc', package: pkg }]);
    expect(again.edges.filter((edge) => edge.kind === 'CONTAINS' && edge.from === section.id).map((edge) => edge.orderKey).sort()).toEqual(keys);
  });

  it('orderKeyBetween mints a key strictly between two neighbours, and refuses loudly when the room is exhausted', () => {
    const { orderKeyForIndex, orderKeyBetween } = orderKeys;
    const first = orderKeyForIndex(0);
    const second = orderKeyForIndex(1);
    const mid = orderKeyBetween(first, second);
    expect(first < mid && mid < second).toBe(true);
    // Nested midpoints keep landing in the shrinking interval until the digits run out -- the documented rebalance signal, not a silent duplicate.
    let low = first;
    let landed = true;
    for (let i = 0; i < 10_000 && landed; i += 1) {
      try {
        const next = orderKeyBetween(low, mid);
        if (!(low < next && next < mid)) throw new Error('midpoint out of interval');
        low = next;
      } catch {
        landed = false;
      }
    }
    expect(landed).toBe(false);
  });

  it('renumberedOrderKeys re-mints a fresh, roomy sibling list (the rebalance operation)', () => {
    const { orderKeyForIndex, renumberedOrderKeys } = orderKeys;
    expect(renumberedOrderKeys(3)).toEqual([orderKeyForIndex(0), orderKeyForIndex(1), orderKeyForIndex(2)]);
  });
});

describe('contentHashV1 (#660)', () => {
  it('is the projection\'s named hash contract: identical content carries identical ids regardless of the $schema release label it was serialised under', () => {
    const docA = wordprocessingPackage([sectionGroup([paragraph('Same.')])]);
    const docB = wordprocessingPackage([sectionGroup([paragraph('Same.')])]);
    // Two serialisation labels naming two different schema releases -- additive-compatible releases stamp different URIs on the same semantics, and the recipe strips the label before hashing.
    const taggedA: DocumentTreeJson = { ...documentTreeWithSchema(docA), $schema: 'https://exadev.dev/schemas/document-tree@4.1.0/schema.json' };
    const taggedB: DocumentTreeJson = { ...documentTreeWithSchema(docB), $schema: 'https://exadev.dev/schemas/document-tree@4.9.0/schema.json' };
    const a = projectDocumentGraph([{ id: 'a', package: taggedA }]);
    const b = projectDocumentGraph([{ id: 'b', package: taggedB }]);
    const idA = nodeByText(a, 'Same.').id;
    const idB = nodeByText(b, 'Same.').id;
    expect(idA).toBe(idB);
    expect(contentHashV1({ text: 'Same.' })).toBe(contentHashV1({ text: 'Same.' }));
    expect(contentHashV1({ text: 'A' })).not.toBe(contentHashV1({ text: 'B' }));
  });

  it('is stable across additive schema growth: a field a later release added and this document never populated hashes the same as the field present but explicitly unset', () => {
    // No multi-version document-schema.js fixtures exist in this repo (only one version is ever installed at a time), so the additive-compatible-schema-versions guarantee is operationalised directly against the mechanism that provides it: JSON.stringify drops undefined-valued keys (hash.ts's own step 3), so "the field was never in this shape" and "the field is in scope but this document leaves it unset" must hash identically.
    const withoutField = contentHashV1({ metadata: { title: 'X' } });
    const withFieldUndefined = contentHashV1({ metadata: { title: 'X', author: undefined } });
    expect(withFieldUndefined).toBe(withoutField);
  });
});

describe('no externally supplied node ids (#660)', () => {
  it('ignores an id-shaped field in content: the body value is hashed verbatim and never becomes the node\'s identity', () => {
    // A table entry whose body spells the face's reserved word -- the projection's own hash decides the id, so a caller cannot steer it.
    const pkg = wordprocessingPackage([sectionGroup([paragraph('Body.')])], {
      definitions: { n1: { kind: 'footnote', label: '1', id: 'caller-chosen', body: 'note text' } },
    });
    const graph = projectDocumentGraph([{ id: 'doc', package: pkg }]);
    const entry = graph.nodes.find((node) => node.tenantKind === 'footnote')!;
    expect(entry.id).not.toBe('caller-chosen');
  });

  it('ignores an id-shaped field on a group anchor\'s own node payload (projectGroup)', () => {
    // The anchor's own content spells the face's reserved word directly on the node, not inside a table entry -- projectGroup's mint site must shadow it exactly as entryNodeFace's does.
    const anchorNode: ContentParagraph & { headingLevel: number; id: string } = {
      kind: 'paragraph',
      runs: [{ text: 'Anchored.' }],
      headingLevel: 1,
      id: 'caller-chosen',
    };
    const pkg = wordprocessingPackage([sectionGroup([{ node: anchorNode, children: [] }])]);
    const graph = projectDocumentGraph([{ id: 'doc', package: pkg }]);
    const heading = graph.nodes.find((node) => node.kind === 'paragraph' && node.headingLevel === 1)!;
    expect(heading.id).not.toBe('caller-chosen');
  });

  it('ignores an id-shaped field in an extracted value\'s own content (mintValueNode)', () => {
    // A custom policy promotes the whole metadata record to a shared value node; the record itself spells the face's reserved word, which mintValueNode's record branch must shadow exactly as the other mint sites do.
    const metadataWithId: LayoutMetadata & { id: string } = { title: 'T', id: 'caller-chosen' };
    const pkg = wordprocessingPackage([sectionGroup([paragraph('Body.')])], { metadata: metadataWithId });
    const extractMetadata: ExtractionPolicy = (path) => (path.length === 1 && path[0] === 'metadata' ? 'extract' : 'inline');
    const graph = projectDocumentGraph([{ id: 'doc', package: pkg }], { policy: extractMetadata });
    const valueNode = graph.nodes.find((node) => node.kind === 'value')!;
    expect(valueNode.id).not.toBe('caller-chosen');
    expect(valueNode.title).toBe('T'); // the record's own content still rides through, only the reserved word is shadowed
  });
});

describe('ordered STYLED_BY chains (#660)', () => {
  it('emits one edge per ancestor chain entry, outermost first, so walking in orderKey order reconstructs the resolution chain', () => {
    // A section wrapper styled s1 containing a heading wrapper styled s2: the heading's chain is [s1, s2] -- outermost first, nearest last, exactly the order effectivePackage overlays in.
    const pkg = wordprocessingPackage([sectionGroup([headingGroup('T', 1, [paragraph('x.')], { style: 's2' })], { style: 's1' })], {
      styles: { s1: { run: { bold: true } }, s2: { run: { italic: true } } },
    });
    const graph = projectDocumentGraph([{ id: 'doc', package: pkg }]);
    const heading = graph.nodes.find((node) => node.kind === 'paragraph' && node.headingLevel === 1)!;
    const chain = graph.edges
      .filter((edge) => edge.kind === 'STYLED_BY' && edge.from === heading.id)
      .sort((x, y) => (x.orderKey < y.orderKey ? -1 : 1));
    expect(chain).toHaveLength(2);
    const boldEntry = graph.nodes.find((node) => node.kind === 'styleEntry' && JSON.stringify(node).includes('bold'))!;
    const italicEntry = graph.nodes.find((node) => node.kind === 'styleEntry' && JSON.stringify(node).includes('italic'))!;
    expect(chain.map((edge) => edge.to)).toEqual([boldEntry.id, italicEntry.id]);
  });

  it('emits the full chain for a list anchor exactly as for a heading anchor', () => {
    const pkg = wordprocessingPackage([sectionGroup([listGroup('Item', 0, [], { style: 's2' })], { style: 's1' })], {
      styles: { s1: { run: { bold: true } }, s2: { run: { italic: true } } },
    });
    const graph = projectDocumentGraph([{ id: 'doc', package: pkg }]);
    const item = nodeByText(graph, 'Item');
    const chain = graph.edges
      .filter((edge) => edge.kind === 'STYLED_BY' && edge.from === item.id)
      .sort((x, y) => (x.orderKey < y.orderKey ? -1 : 1));
    const boldEntry = graph.nodes.find((node) => node.kind === 'styleEntry' && JSON.stringify(node).includes('bold'))!;
    const italicEntry = graph.nodes.find((node) => node.kind === 'styleEntry' && JSON.stringify(node).includes('italic'))!;
    expect(chain.map((edge) => edge.to)).toEqual([boldEntry.id, italicEntry.id]);
  });

  it('emits an inherited-chain edge for a bare, non-anchor paragraph leaf sitting directly in a styled scope', () => {
    const pkg = wordprocessingPackage([sectionGroup([paragraph('Plain body.')], { style: 's1' })], {
      styles: { s1: { run: { bold: true } } },
    });
    const graph = projectDocumentGraph([{ id: 'doc', package: pkg }]);
    const leaf = nodeByText(graph, 'Plain body.');
    const edges = graph.edges.filter((edge) => edge.kind === 'STYLED_BY' && edge.from === leaf.id);
    const entry = graph.nodes.find((node) => node.kind === 'styleEntry')!;
    expect(edges).toEqual([{ from: leaf.id, to: entry.id, kind: 'STYLED_BY', orderKey: orderKeys.orderKeyForIndex(0) }]);
  });

  it('threads the chain through three levels of nested anchors down to a bare leaf', () => {
    const pkg = wordprocessingPackage(
      [
        sectionGroup(
          [headingGroup('H', 1, [listGroup('Item', 0, [paragraph('Deepest.')], { style: 's3' })], { style: 's2' })],
          { style: 's1' },
        ),
      ],
      { styles: { s1: { run: { bold: true } }, s2: { run: { italic: true } }, s3: { run: { underline: true } } } },
    );
    const graph = projectDocumentGraph([{ id: 'doc', package: pkg }]);
    const deepest = nodeByText(graph, 'Deepest.');
    const chain = graph.edges
      .filter((edge) => edge.kind === 'STYLED_BY' && edge.from === deepest.id)
      .sort((x, y) => (x.orderKey < y.orderKey ? -1 : 1));
    const s1Entry = graph.nodes.find((node) => node.kind === 'styleEntry' && JSON.stringify(node).includes('bold'))!;
    const s2Entry = graph.nodes.find((node) => node.kind === 'styleEntry' && JSON.stringify(node).includes('italic'))!;
    const s3Entry = graph.nodes.find((node) => node.kind === 'styleEntry' && JSON.stringify(node).includes('underline'))!;
    expect(chain.map((edge) => edge.to)).toEqual([s1Entry.id, s2Entry.id, s3Entry.id]);
  });

  it('a non-anchor styled group emits only its own single ref for itself, but still passes the full chain to its children', () => {
    const pkg = wordprocessingPackage(
      [sectionGroup([sectionConstructGroup([paragraph('Inside construct.')], { style: 's2' })], { style: 's1' })],
      { styles: { s1: { run: { bold: true } }, s2: { run: { italic: true } } } },
    );
    const graph = projectDocumentGraph([{ id: 'doc', package: pkg }]);
    const construct = graph.nodes.find((node) => node.kind === 'contentControl')!;
    const s1Entry = graph.nodes.find((node) => node.kind === 'styleEntry' && JSON.stringify(node).includes('bold'))!;
    const s2Entry = graph.nodes.find((node) => node.kind === 'styleEntry' && JSON.stringify(node).includes('italic'))!;
    // Non-anchor: only its own direct ref, never the inherited chain -- unchanged from pre-#660 behaviour.
    const constructEdges = graph.edges.filter((edge) => edge.kind === 'STYLED_BY' && edge.from === construct.id);
    expect(constructEdges).toEqual([{ from: construct.id, to: s2Entry.id, kind: 'STYLED_BY', orderKey: orderKeys.orderKeyForIndex(0) }]);
    // Its child leaf still inherits the FULL chain (s1, s2) passed through the non-anchor wrapper.
    const inside = nodeByText(graph, 'Inside construct.');
    const leafChain = graph.edges
      .filter((edge) => edge.kind === 'STYLED_BY' && edge.from === inside.id)
      .sort((x, y) => (x.orderKey < y.orderKey ? -1 : 1));
    expect(leafChain.map((edge) => edge.to)).toEqual([s1Entry.id, s2Entry.id]);
  });

  it('custom: an inlined ancestor entry in the chain contributes no edge, leaving extracted entries at their own chain position', () => {
    const inlineS1: ExtractionPolicy = (path, value) =>
      path.length === 2 && path[0] === 'styles' && path[1] === 's1' ? 'inline' : defaultExtractionPolicy(path, value);
    const pkg = wordprocessingPackage([sectionGroup([headingGroup('T', 1, [], { style: 's2' })], { style: 's1' })], {
      styles: { s1: { run: { bold: true } }, s2: { run: { italic: true } } },
    });
    const graph = projectDocumentGraph([{ id: 'doc', package: pkg }], { policy: inlineS1 });
    const heading = graph.nodes.find((node) => node.kind === 'paragraph' && node.headingLevel === 1)!;
    const chain = graph.edges.filter((edge) => edge.kind === 'STYLED_BY' && edge.from === heading.id);
    // s1 (chain position 0) inlines -- no edge; s2 (chain position 1) is still extracted, at its own chain position.
    const s2Entry = graph.nodes.find((node) => node.kind === 'styleEntry')!;
    expect(chain).toEqual([{ from: heading.id, to: s2Entry.id, kind: 'STYLED_BY', orderKey: orderKeys.orderKeyForIndex(1) }]);
  });
});

describe('walkPropertyGraph (#660)', () => {
  it('walks containment-only in document order without a cycle guard (a Merkle DAG is provably acyclic), revisiting a shared node once per path', () => {
    const shared = paragraph('Shared.');
    const pkg = wordprocessingPackage([sectionGroup([shared, shared])]);
    const graph = projectDocumentGraph([{ id: 'doc', package: pkg }]);
    const visited = walkPropertyGraph(graph, 'doc', { kinds: ['CONTAINS'] }).map(({ node }) => node.id);
    // The same shared leaf is reachable by two paths, and the walker reports it per path: termination is the acyclicity guarantee, uniqueness is the caller's to coalesce.
    expect(visited.filter((id) => id === visited.find((candidate) => candidate === id)).length).toBeGreaterThanOrEqual(1);
    expect(visited).toHaveLength(4); // root, section, then the shared leaf once per path
  });

  it('guards reference-kind edges by default: a hand-built cyclic graph terminates, and the cycle is reported rather than looping', () => {
    const nodes = [
      { id: 'a', kind: 'x' },
      { id: 'b', kind: 'x' },
    ];
    // Two nodes pointing at each other through DEFINED_BY edges -- the author-supplied-pointer shape the issue names.
    const edges = [
      { from: 'a', to: 'b', kind: 'DEFINED_BY', orderKey: 'k0' },
      { from: 'b', to: 'a', kind: 'DEFINED_BY', orderKey: 'k0' },
    ];
    const walked = walkPropertyGraph({ nodes, edges }, 'a');
    expect(walked.map(({ node }) => node.id)).toContain('b');
    expect(walked.filter(({ node }) => node.id === 'a').length).toBe(1); // the revisit was suppressed by the guard
  });

  it('walks every kind present by default, mixing CONTAINS with STYLED_BY and DEFINED_BY in one traversal', () => {
    const pkg = wordprocessingPackage(
      [
        sectionGroup([
          headingGroup(
            'T',
            1,
            [{ node: { kind: 'anchor', anchorType: 'footnote', name: '1', definition: 'n1' }, children: [] }],
            { style: 's1' },
          ),
        ]),
      ],
      { styles: { s1: { run: { bold: true } } }, definitions: { n1: { kind: 'footnote', blocks: [{ kind: 'paragraph', runs: [{ text: 'Note.' }] }] } } },
    );
    const graph = projectDocumentGraph([{ id: 'doc', package: pkg }]);
    const visited = walkPropertyGraph(graph, 'doc');
    const kindsSeen = new Set(visited.map(({ edge }) => edge?.kind).filter((kind): kind is string => kind !== undefined));
    expect(kindsSeen).toEqual(new Set(['CONTAINS', 'STYLED_BY', 'DEFINED_BY']));
    // Every node in the graph is reachable from the root once every kind is in play.
    expect(new Set(visited.map(({ node }) => node.id))).toEqual(new Set(graph.nodes.map((node) => node.id)));
  });

  it('walking STYLED_BY alone in orderKey order reconstructs the resolution chain from a starting anchor', () => {
    const pkg = wordprocessingPackage([sectionGroup([headingGroup('T', 1, [], { style: 's2' })], { style: 's1' })], {
      styles: { s1: { run: { bold: true } }, s2: { run: { italic: true } } },
    });
    const graph = projectDocumentGraph([{ id: 'doc', package: pkg }]);
    const heading = graph.nodes.find((node) => node.kind === 'paragraph' && node.headingLevel === 1)!;
    const s1Entry = graph.nodes.find((node) => node.kind === 'styleEntry' && JSON.stringify(node).includes('bold'))!;
    const s2Entry = graph.nodes.find((node) => node.kind === 'styleEntry' && JSON.stringify(node).includes('italic'))!;
    const walked = walkPropertyGraph(graph, heading.id, { kinds: ['STYLED_BY'] });
    // The start node itself, then s1 (outermost) before s2 (nearest) -- orderKey order reproduces resolution order.
    expect(walked.map(({ node }) => node.id)).toEqual([heading.id, s1Entry.id, s2Entry.id]);
  });

  it('WalkedNode.edge names the exact edge traversed to reach each node, and is undefined only for the start node', () => {
    const nodes = [
      { id: 'a', kind: 'x' },
      { id: 'b', kind: 'x' },
      { id: 'c', kind: 'x' },
    ];
    const edges = [
      { from: 'a', to: 'b', kind: 'CONTAINS', orderKey: orderKeys.orderKeyForIndex(0) },
      { from: 'a', to: 'c', kind: 'CONTAINS', orderKey: orderKeys.orderKeyForIndex(1) },
    ];
    const walked = walkPropertyGraph({ nodes, edges }, 'a');
    expect(walked).toEqual([
      { node: nodes[0], edge: undefined },
      { node: nodes[1], edge: edges[0] },
      { node: nodes[2], edge: edges[1] },
    ]);
  });
});
