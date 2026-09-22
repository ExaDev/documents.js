import {
  Alert,
  Container,
  Group,
  List,
  Paper,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { useReadOdb } from "../hooks/useOdbInventory";
import type { OpenedFile } from "../ports/fileAccess";
import { FileUpload } from "../ui/FileUpload";
import { notifyError } from "../ui/notify";
import { SheetPreview } from "../ui/SheetPreview";

export const Route = createFileRoute("/odb")({
  component: OdbPage,
});

// The .odb browsing tool: a database front-end package's inventory (connection, table/query/form/report names) alongside its embedded engine's actual table data, read through the tier-dispatching decoder the conversions use and previewed as a spreadsheet — one sheet per table.
function OdbPage() {
  const [fileName, setFileName] = useState<string>();
  const readOdb = useReadOdb();

  const handleFile = (opened: OpenedFile) => {
    setFileName(opened.name);
    // useMutation's own "pending" dispatch already clears the previous data/error before this call's result settles — a separate reset() call immediately beforehand would only repeat that, never add a state transition of its own.
    readOdb.mutate(
      { bytes: opened.bytes },
      {
        onError: (error) => {
          notifyError("Could not read database", error);
        },
      },
    );
  };

  // readOdb.data's own output schema requires `inventory`, so once data is present its inventory is too — a separate `inventory !== undefined` guard alongside `data !== undefined` would be checking a fact the type already guarantees, never a real second condition.
  const data = readOdb.data;

  return (
    <Container size="lg" py="xl">
      <Stack gap="lg">
        <Title order={2}>Browse an .odb database</Title>
        <FileUpload
          onFile={handleFile}
          accept={{ "application/vnd.oasis.opendocument.base": [".odb"] }}
        />
        {readOdb.isPending && <Text>Reading database…</Text>}
        {readOdb.error !== null && (
          <Alert color="red">
            The database could not be read: {String(readOdb.error)}
          </Alert>
        )}
        {data !== undefined && (
          <Paper withBorder p="md">
            <Stack gap="xs">
              <Text size="sm" c="dimmed">
                Connection: {data.inventory.connection?.type ?? "none"}
                {data.inventory.connection?.url !== undefined
                  ? ` (${data.inventory.connection.url})`
                  : ""}
              </Text>
              <Group gap="xs">
                <Text size="sm">{data.inventory.tables.length} tables</Text>
                <Text size="sm">{data.inventory.queries.length} queries</Text>
                <Text size="sm">{data.inventory.forms.length} forms</Text>
                <Text size="sm">{data.inventory.reports.length} reports</Text>
              </Group>
              {data.inventory.queries.length > 0 && (
                <List size="sm" withPadding>
                  {data.inventory.queries.map((query) => (
                    <List.Item key={query.name}>{query.name}</List.Item>
                  ))}
                </List>
              )}
            </Stack>
          </Paper>
        )}
        {data !== undefined && (
          <SheetPreview
            label={
              fileName === undefined || fileName === "" ? "database" : fileName
            }
            format="ods"
            content={data.content}
          />
        )}
      </Stack>
    </Container>
  );
}
