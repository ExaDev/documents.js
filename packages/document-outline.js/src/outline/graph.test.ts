import { describe, expect, it } from 'vitest';
import { DocumentPackageSchema, type DocumentPackage, type StylesTable } from 'document-schema.js';
import { projectDocumentGraph, type GraphNode, type PropertyGraph } from './graph';
import { headingGroup, paragraph, sectionGroup, wordprocessingPackage } from '../test-support/fixtures';

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

describe('projectDocumentGraph', () => {
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
});
