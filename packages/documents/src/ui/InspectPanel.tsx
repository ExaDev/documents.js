import { Alert, Skeleton, Stack, Table, Text, Title } from '@mantine/core';

import type { InspectResult } from '../hooks/useInspect';
import { StructureTree } from './StructureTree';

export interface InspectPanelProps {
  data?: InspectResult;
  loading?: boolean;
  error?: unknown;
}

// Renders an InspectResult -- shared by the Inspect page's own result panel and the Convert page's per-side "Show structure" disclosure, so the two never drift into rendering the same data two different ways. Branches on `backing`: a PDF-backed result shows page count, per-item-kind breakdown, metadata, and the LayoutDocument tree; a content-backed result shows a variant-aware summary and the $schema-stamped tree-form DocumentTree (the artefact form since document-schema.js 4 -- the $schema URI it opens with is the document's version).
export function InspectPanel({ data, loading, error }: InspectPanelProps) {
  if (loading === true) return <Skeleton height={120} />;
  if (error !== undefined) return <Alert color="red">Could not inspect this document.</Alert>;
  if (data === undefined) return null;

  if (data.backing === 'content') {
    return (
      <Stack gap="sm">
        {data.summary.map((line) => (
          <Text key={line} size="sm">
            {line}
          </Text>
        ))}
        <Title order={6}>Document structure</Title>
        <StructureTree data={data.package} />
      </Stack>
    );
  }

  return (
    <Stack gap="sm">
      <Text size="sm">
        <strong>{data.pageCount}</strong> page{data.pageCount === 1 ? '' : 's'}
      </Text>
      <Table>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Item kind</Table.Th>
            <Table.Th>Count</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {Object.entries(data.itemKindCounts).map(([kind, count]) => (
            <Table.Tr key={kind}>
              <Table.Td>{kind}</Table.Td>
              <Table.Td>{count}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {data.metadata.title !== undefined && <Text size="sm">Title: {data.metadata.title}</Text>}
      {data.metadata.producer !== undefined && <Text size="sm">Producer: {data.metadata.producer}</Text>}
      <Title order={6}>Document structure</Title>
      <StructureTree data={data.layout} />
    </Stack>
  );
}
