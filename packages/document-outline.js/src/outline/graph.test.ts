import { describe, expect, it } from 'vitest';
import {
  documentPackageWithSchema,
  DocumentPackageSchema,
  type ContentParagraph,
  type DefinitionEntry,
  type DocumentPackage,
  type StylesTable,
} from 'document-schema.js';
import { defaultExtractionPolicy, projectDocumentGraph, type ExtractionPolicy, type GraphNode, type PropertyGraph } from './graph';
import {
  drawPageGroup,
  drawingPackage,
  embeddedObject,
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
  vectorRect,
  wordprocessingPackage,
} from '../test-support/fixtures';

// The worked example of ExaDev/documents.js#659: a report document whose heading paragraph carries a styles-table ref, plus a second document sharing the boilerplate line and the heading style content but nothing else -- the projection must share exactly those two things and nothing besides.
const H1_BOLD_RUN = { bold: true, fontFamily: 'Times New Roman' };
const REPORT_STYLES: StylesTable = { 'h1-bold': { run: H1_BOLD_RUN } };
const MEMO_STYLES: StylesTable = { 'heading-1': { run: H1_BOLD_RUN } }; // same entry content, different local key

function reportPackage(boilerplate: ReturnType<typeof paragraph>): DocumentPackage {
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

function memoPackage(boilerplate: ReturnType<typeof paragraph>): DocumentPackage {
  return wordprocessingPackage([sectionGroup([headingGroup('Memo', 1, [boilerplate], { style: 'heading-1' })])], {
    metadata: { title: 'Staff Memo' },
    styles: MEMO_STYLES,
  });
}

function expectSchemaValid(pkg: DocumentPackage, label: string): void {
  const result = DocumentPackageSchema.safeParse(pkg);
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
    const shared = sections.find((section) => graph.edges.some((edge) => edge.kind === 'CONTAINS' && edge.from === section.id && edge.order === 0 && graph.edges.some((rootEdge) => rootEdge.kind === 'CONTAINS' && rootEdge.from === 'a' && rootEdge.to === section.id)))!;
    // One shared section node, referenced by each document's own root at its own local order.
    const seams = graph.edges.filter((edge) => edge.kind === 'CONTAINS' && edge.to === shared.id);
    expect(seams.map((edge) => ({ from: edge.from, order: edge.order })).sort((x, y) => x.from.localeCompare(y.from))).toEqual([
      { from: 'a', order: 0 },
      { from: 'b', order: 1 },
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
    expect(contains.map((edge) => edge.order)).toEqual([0, 2]);
  });
});

describe('Merkle-DAG edit behaviour', () => {
  const before = () => wordprocessingPackage([sectionGroup([paragraph('First.'), paragraph('Last.')])]);
  const after = () => wordprocessingPackage([sectionGroup([paragraph('First.'), paragraph('Inserted.'), paragraph('Last.')])]);

  it('insertion between siblings changes no sibling identity, only local order values', () => {
    const beforeGraph = projectDocumentGraph([{ id: 'doc', package: before() }]);
    const afterGraph = projectDocumentGraph([{ id: 'doc', package: after() }]);
    const idOf = (graph: PropertyGraph, text: string) => nodeByText(graph, text).id;
    expect(idOf(afterGraph, 'First.')).toBe(idOf(beforeGraph, 'First.'));
    expect(idOf(afterGraph, 'Last.')).toBe(idOf(beforeGraph, 'Last.'));
    const afterSection = afterGraph.nodes.find((node) => node.kind === 'section')!;
    const orders = afterGraph.edges
      .filter((edge) => edge.from === afterSection.id && edge.kind === 'CONTAINS')
      .map((edge) => ({ order: edge.order, to: edge.to }));
    expect(orders).toEqual([
      { order: 0, to: idOf(afterGraph, 'First.') },
      { order: 1, to: idOf(afterGraph, 'Inserted.') },
      { order: 2, to: idOf(afterGraph, 'Last.') },
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

  function footnotePackage(styleKey: string, definitionKey = 'n1'): DocumentPackage {
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
      { from: anchorNode.id, to: entryNodes[0]!.id, kind: 'DEFINED_BY', order: 0, path: ['definition'] },
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
    expect(() => projectDocumentGraph([{ id: 'doc', package: danglingStyle }])).toThrowError(
      /style ref "missing" names no entry in the styles table/,
    );

    const danglingDefinition = wordprocessingPackage(
      [sectionGroup([{ node: { kind: 'anchor', anchorType: 'footnote', name: '1', definition: 'gone' }, children: [] }])],
      { definitions: { n1: NOTE_BODY } },
    );
    expect(() => projectDocumentGraph([{ id: 'doc', package: danglingDefinition }])).toThrowError(
      /definition ref "gone" names no entry in the definitions table/,
    );
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
    const roots = graph.nodes.filter((node) => node.kind === 'documentPackage');
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
    const roots = graph.nodes.filter((node) => node.kind === 'documentPackage');
    expect(roots).toHaveLength(2);
    for (const root of roots) expect('title' in (root.metadata as Record<string, unknown>)).toBe(false);
    expect(graph.edges.filter((edge) => edge.kind === 'PROPERTY')).toHaveLength(2);
    for (const edge of graph.edges.filter((edge) => edge.kind === 'PROPERTY')) {
      expect(edge.path).toEqual(['metadata', 'title']);
      expect(edge.to).toBe(valueNodes[0]!.id);
      expect(edge.order).toBe(0);
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
    expect(graph.nodes.filter((node) => node.kind === 'documentPackage')[0]!.styles).toEqual({ s1: entry });
  });
});

describe('every document kind projects', () => {
  it('presentation: slide and shape groups with list nesting', () => {
    const pkg = presentationPackage([slideGroup([shapeGroup([listGroup('Top', 0, [listGroup('Nested', 1, [])])])])]);
    expectSchemaValid(pkg, 'presentation');
    const graph = projectDocumentGraph([{ id: 'deck', package: pkg }]);
    // Both list anchors are paragraphs in the tree vocabulary, so the projected kinds name payloads, not wrappers.
    expect(graph.nodes.map((node) => node.kind).sort()).toEqual(['documentPackage', 'paragraph', 'paragraph', 'shape', 'slide']);
    const slide = graph.nodes.find((node) => node.kind === 'slide')!;
    const shape = graph.nodes.find((node) => node.kind === 'shape')!;
    const top = nodeByText(graph, 'Top');
    expect(graph.edges).toEqual([
      { from: 'deck', to: slide.id, kind: 'CONTAINS', order: 0 },
      { from: slide.id, to: shape.id, kind: 'CONTAINS', order: 0 },
      { from: shape.id, to: top.id, kind: 'CONTAINS', order: 0 },
      { from: top.id, to: nodeByText(graph, 'Nested').id, kind: 'CONTAINS', order: 0 },
    ]);
  });

  it('spreadsheet: sheet node with image and embedded-object children, envelope facts inline', () => {
    const pkg = spreadsheetPackage([sheetGroup({ name: 'Revenue', images: [sheetImage('chart')], embeddedObjects: [embeddedObject()] })], {
      pages: [{ widthPt: 842, heightPt: 595 }],
    });
    expectSchemaValid(pkg, 'spreadsheet');
    const graph = projectDocumentGraph([{ id: 'book', package: pkg }]);
    expect(graph.nodes.map((node) => node.kind).sort()).toEqual(['documentPackage', 'embeddedObject', 'image', 'sheet']);
    const root = graph.nodes.find((node) => node.kind === 'documentPackage')!;
    expect(root.pages).toEqual([{ widthPt: 842, heightPt: 595 }]);
    const sheet = graph.nodes.find((node) => node.kind === 'sheet')!;
    expect(sheet).toMatchObject({ kind: 'sheet', name: 'Revenue' });
    const contains = graph.edges.filter((edge) => edge.from === sheet.id && edge.kind === 'CONTAINS');
    expect(contains.map((edge) => [edge.order, graph.nodes.find((node) => node.id === edge.to)!.kind])).toEqual([
      [0, 'image'],
      [1, 'embeddedObject'],
    ]);
  });

  it('drawing: draw page with shapes and vector leaves', () => {
    const pkg = drawingPackage([drawPageGroup([shapeGroup([paragraph('Caption.')]), vectorLine(), vectorRect()])]);
    expectSchemaValid(pkg, 'drawing');
    const graph = projectDocumentGraph([{ id: 'poster', package: pkg }]);
    expect(graph.nodes.map((node) => node.kind).sort()).toEqual(['documentPackage', 'drawPage', 'line', 'paragraph', 'rect', 'shape']);
    const page = graph.nodes.find((node) => node.kind === 'drawPage')!;
    const contains = graph.edges.filter((edge) => edge.from === page.id && edge.kind === 'CONTAINS');
    expect(contains.map((edge) => [edge.order, graph.nodes.find((node) => node.id === edge.to)!.kind])).toEqual([
      [0, 'shape'],
      [1, 'line'],
      [2, 'rect'],
    ]);
  });

  it('formula: the single leaf is the whole tree', () => {
    const pkg = formulaPackage('x^2');
    expectSchemaValid(pkg, 'formula');
    const graph = projectDocumentGraph([{ id: 'eq', package: pkg }]);
    expect(graph.nodes.map((node) => node.kind).sort()).toEqual(['documentPackage', 'formula']);
    expect(graph.edges).toEqual([
      { from: 'eq', to: graph.nodes.find((node) => node.kind === 'formula')!.id, kind: 'CONTAINS', order: 0 },
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
    expect(graphB.nodes.filter((node) => node.kind !== 'documentPackage')).toEqual(
      graphA.nodes.filter((node) => node.kind !== 'documentPackage'),
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
    expect(cross.nodes.filter((node) => node.kind === 'documentPackage').map((node) => node.id).sort()).toEqual(['a', 'b']);
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
    const roots = nodesOf(graph, 'documentPackage');
    expect(roots).toEqual([
      { id: 'report-1', kind: 'documentPackage', documentKind: 'wordprocessing', metadata: { title: 'Q3 Report', author: 'Alice' } },
      { id: 'memo-1', kind: 'documentPackage', documentKind: 'wordprocessing', metadata: { title: 'Staff Memo' } },
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

    // Containment edges are stamped with document order.
    const reportSection = sections.find((section) => graph.edges.some((edge) => edge.kind === 'CONTAINS' && edge.from === section.id && edge.to === summary.id))!;
    const rootContains = edgesBetween(graph, 'report-1', 'CONTAINS');
    expect(rootContains).toEqual([{ from: 'report-1', to: reportSection.id, kind: 'CONTAINS', order: 0 }]);
    const sectionContains = edgesBetween(graph, reportSection.id, 'CONTAINS');
    expect(sectionContains).toEqual([{ from: reportSection.id, to: summary.id, kind: 'CONTAINS', order: 0 }]);
    const summaryContains = edgesBetween(graph, summary.id, 'CONTAINS');
    expect(summaryContains.map((edge) => edge.order)).toEqual([0, 1]);
    expect(summaryContains.map((edge) => edge.to)).toEqual([
      shared.id,
      nodeByText(graph, 'Revenue grew 12% quarter over quarter.').id,
    ]);

    // Both heading paragraphs point at the one shared style node, from their own document's ref.
    const styledBy = graph.edges.filter((edge) => edge.kind === 'STYLED_BY');
    expect(styledBy.map((edge) => edge.to)).toEqual([styleNodes[0]!.id, styleNodes[0]!.id]);
    expect(styledBy.map((edge) => edge.from).sort()).toEqual(headings.map((node) => node.id).sort());
    expect(styledBy.every((edge) => edge.order === 0)).toBe(true);

    // Every node id is unique, and content ids are lowercase hex content hashes.
    expect(new Set(graph.nodes.map((node) => node.id)).size).toBe(graph.nodes.length);
    for (const node of graph.nodes) {
      if (node.kind !== 'documentPackage') expect(node.id).toMatch(/^[0-9a-f]{64}$/);
    }
    for (const edge of graph.edges) {
      expect(graph.nodes.some((node) => node.id === edge.from)).toBe(true);
      expect(graph.nodes.some((node) => node.id === edge.to)).toBe(true);
    }
  });

  it('treats a $schema-stamped dump exactly like its parsed original', () => {
    const pkg = wordprocessingPackage([sectionGroup([paragraph('Body.')])], { metadata: { title: 'T' } });
    const stamped = documentPackageWithSchema(pkg);
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
    ).toThrowError(/document id "same" assigned to more than one document/);
  });
});
