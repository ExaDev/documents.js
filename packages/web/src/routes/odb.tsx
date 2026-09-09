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

// The .odb browsing tool: a database front-end package's inventory (connection, table/query/form/report names) alongside its embedded engine's actual table data, read through the tier-dispatching decoder the conversions use and previewed as a spreadsheet -- one sheet per table.
function OdbPage() {
  const [fileName, setFileName] = useState("");
  const readOdb = useReadOdb();

  const handleFile = (opened: OpenedFile) => {
    setFileName(opened.name);
    readOdb.reset();
    readOdb.mutate(
      { bytes: opened.bytes },
      {
        onError: (error) => {
          notifyError("Could not read database", error);
        },
      },
    );
  };

  const inventory = readOdb.data?.inventory;

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
        {readOdb.data !== undefined && inventory !== undefined && (
          <Paper withBorder p="md">
            <Stack gap="xs">
              <Text size="sm" c="dimmed">
                Connection: {inventory.connection?.type ?? "none"}
                {inventory.connection?.url !== undefined
                  ? ` (${inventory.connection.url})`
                  : ""}
              </Text>
              <Group gap="xs">
                <Text size="sm">{inventory.tables.length} tables</Text>
                <Text size="sm">{inventory.queries.length} queries</Text>
                <Text size="sm">{inventory.forms.length} forms</Text>
                <Text size="sm">{inventory.reports.length} reports</Text>
              </Group>
              {inventory.queries.length > 0 && (
                <List size="sm" withPadding>
                  {inventory.queries.map((query) => (
                    <List.Item key={query.name}>{query.name}</List.Item>
                  ))}
                </List>
              )}
            </Stack>
          </Paper>
        )}
        {readOdb.data !== undefined && (
          <SheetPreview
            label={fileName === "" ? "database" : fileName}
            format="ods"
            content={readOdb.data.content}
          />
        )}
      </Stack>
    </Container>
  );
}
