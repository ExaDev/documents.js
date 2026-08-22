import { describe, expect, it } from 'vitest';
import {
  documentTreeWithSchema,
  DocumentTreeSchema,
  factorStyles,
  type ContentParagraph,
  type DefinitionEntry,
  type DocumentTree,
  type StylesTable,
} from 'document-schema.js';
import { effectivePackage } from './effective';
import { defaultExtractionPolicy, projectDocumentGraph, type ExtractionPolicy, type GraphNode, type PropertyGraph } from './graph';
import { initialOrderKeys, keyBetween } from './order';

// The fixed order key every DEFINED_BY/PROPERTY edge shares (there is never more than one such edge per (from, path), so there is nothing to distinguish it from) -- computed the identical way graph.ts's own internal SOLE_ORDER_KEY is, rather than duplicating its literal value.
const SOLE_ORDER = keyBetween(undefined, undefined);
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
    const shared = sections.find((section) => graph.edges.some((edge) => edge.kind === 'CONTAINS' && edge.from === section.id && edge.order === initialOrderKeys(2)[0] && graph.edges.some((rootEdge) => rootEdge.kind === 'CONTAINS' && rootEdge.from === 'a' && rootEdge.to === section.id)))!;
    // One shared section node, referenced by each document's own root at its own local order: first in root 'a''s own two-child list, second in root 'b''s.
    const seams = graph.edges.filter((edge) => edge.kind === 'CONTAINS' && edge.to === shared.id);
    const [rootOrderFirst, rootOrderSecond] = initialOrderKeys(2);
    expect(seams.map((edge) => ({ from: edge.from, order: edge.order })).sort((x, y) => x.from.localeCompare(y.from))).toEqual([
      { from: 'a', order: rootOrderFirst },
      { from: 'b', order: rootOrderSecond },
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
    const [orderAt0, , orderAt2] = initialOrderKeys(3); // repeated/Body./repeated -- positions 0 and 2 of a 3-child section
    expect(contains.map((edge) => edge.order)).toEqual([orderAt0, orderAt2]);
  });
});

describe('Merkle-DAG edit behaviour', () => {
  const before = () => wordprocessingPackage([sectionGroup([paragraph('First.'), paragraph('Last.')])]);
  const after = () => wordprocessingPackage([sectionGroup([paragraph('First.'), paragraph('Inserted.'), paragraph('Last.')])]);

  it('insertion between siblings changes no sibling identity, and the after graph orders its edges correctly', () => {
    // projectDocumentGraph is a stateless full projection with nothing to diff against between calls, so it mints a fresh evenly-spaced key batch (initialOrderKeys) for a group's children on every run -- it cannot itself exhibit "touches only the new edge", which is a property of a PERSISTENT, incremental consumer built on top of this projection (a live graph store that keeps each existing sibling's already-minted key and calls keyBetween -- see order.test.ts -- only for the newly inserted one). What this projection DOES guarantee, and what this test checks, is the more fundamental half: node IDENTITY is unaffected by where in the tree a node sits, so inserting a sibling mints no new ancestor nodes and the unaffected siblings keep their ids -- only the freshly (re)computed CONTAINS edges change, and they still name the correct document order.
    const beforeGraph = projectDocumentGraph([{ id: 'doc', package: before() }]);
    const afterGraph = projectDocumentGraph([{ id: 'doc', package: after() }]);
    const idOf = (graph: PropertyGraph, text: string) => nodeByText(graph, text).id;
    expect(idOf(afterGraph, 'First.')).toBe(idOf(beforeGraph, 'First.'));
    expect(idOf(afterGraph, 'Last.')).toBe(idOf(beforeGraph, 'Last.'));
    // The section itself is a NEW node in the after graph too: it is a group, and a group's hash covers its children's ids, so gaining a child mints a new ancestor -- exactly the Merkle-DAG cascade the next test in this describe block exercises directly for a content edit. Insertion (not just edit) still cascades for the same reason: the parent's hash input changed shape.
    expect(afterGraph.nodes.find((node) => node.kind === 'section')!.id).not.toBe(
      beforeGraph.nodes.find((node) => node.kind === 'section')!.id,
    );
    const afterSection = afterGraph.nodes.find((node) => node.kind === 'section')!;
    const orders = afterGraph.edges
      .filter((edge) => edge.from === afterSection.id && edge.kind === 'CONTAINS')
      .map((edge) => ({ order: edge.order, to: edge.to }));
    const [orderFirst, orderInserted, orderLast] = initialOrderKeys(3);
    expect(orders).toEqual([
      { order: orderFirst, to: idOf(afterGraph, 'First.') },
      { order: orderInserted, to: idOf(afterGraph, 'Inserted.') },
      { order: orderLast, to: idOf(afterGraph, 'Last.') },
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
      { from: anchorNode.id, to: entryNodes[0]!.id, kind: 'DEFINED_BY', order: SOLE_ORDER, path: ['definition'] },
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
    expect(() => projectDocumentGraph([{ id: 'doc', package: mutual }])).toThrowError(
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
    expect(factoredGraph.edges.filter((edge) => edge.kind === 'STYLED_BY')).toHaveLength(1);
    expect(unfactoredGraph.edges.filter((edge) => edge.kind === 'STYLED_BY')).toHaveLength(0);
  });

  it('projects the two spellings to the identical graph once effectivePackage has resolved them', () => {
    const factored = factorStyles(unfactored());
    const resolvedFactored = projectDocumentGraph([{ id: 'doc', package: effectivePackage(factored) }]);
    const resolvedUnfactored = projectDocumentGraph([{ id: 'doc', package: effectivePackage(unfactored()) }]);
    expect(resolvedFactored).toEqual(resolvedUnfactored);
  });

  // ExaDev/documents.js#660's refinement 3: a content node's id is always DERIVED by the projector from its own content, never accepted as a caller-supplied value -- there is no parameter anywhere in this module's public surface (GraphDocument, ExtractionPolicy, GraphProjectionOptions) through which a caller could hand the projector a mismatched id for a node being inserted. The dedup tests above already show ONE side of this (shared content collapses to one id); this test states both directions explicitly and independently of any sharing.
  it('derives every content node id purely from its own content: two independently built identical contents always share one id, and two different contents can never collide', () => {
    const identicalPayload = () => paragraph('Exactly the same content, built independently each time.');
    // Each section also carries its OWN unique paragraph, so the two sections themselves stay distinct nodes -- otherwise an all-shared section would itself dedupe too, leaving only one CONTAINS edge to inspect instead of the two this test means to compare.
    const docA = wordprocessingPackage([sectionGroup([identicalPayload(), paragraph('Unique to A.')])], { metadata: { title: 'A' } });
    const docB = wordprocessingPackage([sectionGroup([identicalPayload(), paragraph('Unique to B.')])], { metadata: { title: 'B' } }); // a fresh object, same shared content, different document entirely
    const docC = wordprocessingPackage([sectionGroup([paragraph('A different content string.')])], { metadata: { title: 'C' } });
    const graph = projectDocumentGraph([
      { id: 'a', package: docA },
      { id: 'b', package: docB },
      { id: 'c', package: docC },
    ]);
    const paragraphs = graph.nodes.filter((node) => node.kind === 'paragraph');
    // Same content (independently constructed) -> exactly one shared node, not two.
    expect(paragraphs.filter((node) => JSON.stringify(node).includes('Exactly the same content'))).toHaveLength(1);
    // Different content -> a distinct id, never colliding with the shared one.
    const shared = paragraphs.find((node) => JSON.stringify(node).includes('Exactly the same content'))!;
    const distinct = paragraphs.find((node) => JSON.stringify(node).includes('A different content string.'))!;
    expect(distinct.id).not.toBe(shared.id);
    // The shared node is reachable from both a's and b's own section -- proof the identity is content-derived rather than tied to whichever document happened to insert it first.
    const containsToShared = graph.edges.filter((edge) => edge.kind === 'CONTAINS' && edge.to === shared.id);
    const sections = graph.nodes.filter((node) => node.kind === 'section');
    const sectionOf = (docId: string) => sections.find((section) => graph.edges.some((edge) => edge.kind === 'CONTAINS' && edge.from === docId && edge.to === section.id))!;
    expect(containsToShared.map((edge) => edge.from).sort()).toEqual([sectionOf('a').id, sectionOf('b').id].sort());
  });
});

// ExaDev/documents.js#660's refinement 4: STYLED_BY is one edge per entry in a node's full style-resolution chain (ancestor refs plus this group's own, outermost first -- the exact order document-schema.js's resolveStyleChain folds, "nearest wins"), not one edge for a group's own ref alone.
describe('ordered STYLED_BY chains', () => {
  it('emits one STYLED_BY edge per ancestor-chain entry, outermost first, each targeting the correct styles-table entry -- reproducing resolveStyleChain order', () => {
    const pkg = wordprocessingPackage(
      [sectionGroup([headingGroup('Title', 1, [], { style: 'headingStyle' })], { style: 'sectionStyle' })],
      { styles: { sectionStyle: { run: { italic: true } }, headingStyle: { run: { bold: true } } } },
    );
    expectSchemaValid(pkg, 'chained styles');
    const graph = projectDocumentGraph([{ id: 'doc', package: pkg }]);

    const sectionEntry = graph.nodes.find((node) => node.kind === 'styleEntry' && JSON.stringify(node).includes('italic'))!;
    const headingEntry = graph.nodes.find((node) => node.kind === 'styleEntry' && JSON.stringify(node).includes('bold'))!;
    expect(sectionEntry.id).not.toBe(headingEntry.id);

    // The heading group is resolved through TWO ancestor levels: the section's own ref (outermost, so it applies first / is overridden by anything nearer) and the heading's own ref (nearest, so it wins on any overlapping property).
    const heading = graph.nodes.find((node) => node.kind === 'paragraph' && node.headingLevel === 1)!;
    const headingStyledBy = graph.edges.filter((edge) => edge.kind === 'STYLED_BY' && edge.from === heading.id);
    expect(headingStyledBy).toHaveLength(2);
    expect(headingStyledBy[0]).toMatchObject({ to: sectionEntry.id });
    expect(headingStyledBy[1]).toMatchObject({ to: headingEntry.id });
    expect(headingStyledBy[0]!.order < headingStyledBy[1]!.order).toBe(true); // outermost-first: the section's edge sorts before the heading's own
    expect([...headingStyledBy].sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))).toEqual(headingStyledBy);

    // The section node's own (single-entry, no ancestors above it) chain still gets exactly one STYLED_BY edge -- the N=1 case this generalises from.
    const section = graph.nodes.find((node) => node.kind === 'section')!;
    const sectionStyledBy = graph.edges.filter((edge) => edge.kind === 'STYLED_BY' && edge.from === section.id);
    expect(sectionStyledBy).toEqual([{ from: section.id, to: sectionEntry.id, kind: 'STYLED_BY', order: initialOrderKeys(1)[0]! }]);
  });

  it('reflects three ancestor levels in outermost-first order when a list group nests inside a styled heading inside a styled section', () => {
    const pkg = wordprocessingPackage(
      [
        sectionGroup(
          [headingGroup('Title', 1, [listGroup('Item', 0, [], { style: 'listStyle' })], { style: 'headingStyle' })],
          { style: 'sectionStyle' },
        ),
      ],
      {
        styles: {
          sectionStyle: { run: { italic: true } },
          headingStyle: { run: { bold: true } },
          listStyle: { run: { underline: true } },
        },
      },
    );
    expectSchemaValid(pkg, 'three-level chain');
    const graph = projectDocumentGraph([{ id: 'doc', package: pkg }]);
    const entryFor = (needle: string) => graph.nodes.find((node) => node.kind === 'styleEntry' && JSON.stringify(node).includes(needle))!;
    const sectionEntry = entryFor('italic');
    const headingEntry = entryFor('bold');
    const listEntry = entryFor('underline');

    const listNode = nodeByText(graph, 'Item');
    const listStyledBy = graph.edges.filter((edge) => edge.kind === 'STYLED_BY' && edge.from === listNode.id);
    expect(listStyledBy).toHaveLength(3);
    expect(listStyledBy.map((edge) => edge.to)).toEqual([sectionEntry.id, headingEntry.id, listEntry.id]);
    for (let i = 1; i < listStyledBy.length; i++) expect(listStyledBy[i - 1]!.order < listStyledBy[i]!.order).toBe(true);
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
      expect(edge.order).toBe(SOLE_ORDER);
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
    const soleContains = initialOrderKeys(1)[0]!; // every CONTAINS edge here is the only child of its parent
    expect(graph.edges).toEqual([
      { from: 'deck', to: slide.id, kind: 'CONTAINS', order: soleContains },
      { from: slide.id, to: shape.id, kind: 'CONTAINS', order: soleContains },
      { from: shape.id, to: top.id, kind: 'CONTAINS', order: soleContains },
      { from: top.id, to: nodeByText(graph, 'Nested').id, kind: 'CONTAINS', order: soleContains },
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
    const [orderImage, orderEmbedded] = initialOrderKeys(2);
    expect(contains.map((edge) => [edge.order, graph.nodes.find((node) => node.id === edge.to)!.kind])).toEqual([
      [orderImage, 'image'],
      [orderEmbedded, 'embeddedObject'],
    ]);
  });

  it('drawing: draw page with shapes and vector leaves', () => {
    const pkg = drawingPackage([drawPageGroup([shapeGroup([paragraph('Caption.')]), vectorLine(), vectorRect()])]);
    expectSchemaValid(pkg, 'drawing');
    const graph = projectDocumentGraph([{ id: 'poster', package: pkg }]);
    expect(graph.nodes.map((node) => node.kind).sort()).toEqual(['documentPackage', 'drawPage', 'line', 'paragraph', 'rect', 'shape']);
    const page = graph.nodes.find((node) => node.kind === 'drawPage')!;
    const contains = graph.edges.filter((edge) => edge.from === page.id && edge.kind === 'CONTAINS');
    const [orderShape, orderLine, orderRect] = initialOrderKeys(3);
    expect(contains.map((edge) => [edge.order, graph.nodes.find((node) => node.id === edge.to)!.kind])).toEqual([
      [orderShape, 'shape'],
      [orderLine, 'line'],
      [orderRect, 'rect'],
    ]);
  });

  it('formula: the single leaf is the whole tree', () => {
    const pkg = formulaPackage('x^2');
    expectSchemaValid(pkg, 'formula');
    const graph = projectDocumentGraph([{ id: 'eq', package: pkg }]);
    expect(graph.nodes.map((node) => node.kind).sort()).toEqual(['documentPackage', 'formula']);
    expect(graph.edges).toEqual([
      { from: 'eq', to: graph.nodes.find((node) => node.kind === 'formula')!.id, kind: 'CONTAINS', order: initialOrderKeys(1)[0]! },
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
    const soleContains = initialOrderKeys(1)[0]!; // report-1 and its section each have exactly one relevant child here
    const rootContains = edgesBetween(graph, 'report-1', 'CONTAINS');
    expect(rootContains).toEqual([{ from: 'report-1', to: reportSection.id, kind: 'CONTAINS', order: soleContains }]);
    const sectionContains = edgesBetween(graph, reportSection.id, 'CONTAINS');
    expect(sectionContains).toEqual([{ from: reportSection.id, to: summary.id, kind: 'CONTAINS', order: soleContains }]);
    const summaryContains = edgesBetween(graph, summary.id, 'CONTAINS');
    const [orderShared, orderRevenue] = initialOrderKeys(2);
    expect(summaryContains.map((edge) => edge.order)).toEqual([orderShared, orderRevenue]);
    expect(summaryContains.map((edge) => edge.to)).toEqual([
      shared.id,
      nodeByText(graph, 'Revenue grew 12% quarter over quarter.').id,
    ]);

    // Both heading paragraphs point at the one shared style node, from their own document's ref -- each heading's own chain is exactly its own single ref (no ancestor group in either fixture carries a style), so each gets exactly one STYLED_BY edge stamped with the one-entry chain's single order key.
    const styledBy = graph.edges.filter((edge) => edge.kind === 'STYLED_BY');
    expect(styledBy.map((edge) => edge.to)).toEqual([styleNodes[0]!.id, styleNodes[0]!.id]);
    expect(styledBy.map((edge) => edge.from).sort()).toEqual(headings.map((node) => node.id).sort());
    expect(styledBy.every((edge) => edge.order === initialOrderKeys(1)[0]!)).toBe(true);

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
    ).toThrowError(/document id "same" assigned to more than one document/);
  });
});
