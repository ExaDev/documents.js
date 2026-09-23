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
import { useEffect } from "react";

import { NoDocumentOpen } from "../document/NoDocumentOpen";
import { useOpenDocument } from "../document/OpenDocumentContext";
import { useReadOdb } from "../hooks/useOdbInventory";
import { notifyError } from "../ui/notify";
import { SheetPreview } from "../ui/SheetPreview";

export const Route = createFileRoute("/_document/odb")({
  component: OdbPage,
});

// The .odb browsing tool: a database front-end package's inventory (connection, table/query/form/report names) alongside its embedded engine's actual table data, read through the tier-dispatching decoder the conversions use and previewed as a spreadsheet — one sheet per table. Reads raw bytes directly, with no format check of its own: the shared document's inferred format (docx, odt, ...) is irrelevant here, since whatever is currently open is simply handed to the .odb decoder as-is.
function OdbPage() {
  const { document } = useOpenDocument();
  const readOdb = useReadOdb();

  const { mutate: readOdbMutate } = readOdb;
  useEffect(() => {
    if (document === undefined) return;
    readOdbMutate(
      { bytes: document.file.bytes },
      {
        onError: (error) => {
          notifyError("Could not read database", error);
        },
      },
    );
  }, [document, readOdbMutate]);

  // readOdb.data's own output schema requires `inventory`, so once data is present its inventory is too — a separate `inventory !== undefined` guard alongside `data !== undefined` would be checking a fact the type already guarantees, never a real second condition.
  const data = readOdb.data;

  return (
    <Container size="lg" py="xl">
      <Stack gap="lg">
        <Title order={2}>Browse an .odb database</Title>
        {document === undefined ? (
          <NoDocumentOpen>
            Open an .odb database above to browse it.
          </NoDocumentOpen>
        ) : (
          <>
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
                    <Text size="sm">
                      {data.inventory.queries.length} queries
                    </Text>
                    <Text size="sm">{data.inventory.forms.length} forms</Text>
                    <Text size="sm">
                      {data.inventory.reports.length} reports
                    </Text>
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
                  document.file.name === "" ? "database" : document.file.name
                }
                format="ods"
                content={data.content}
              />
            )}
          </>
        )}
      </Stack>
    </Container>
  );
}
