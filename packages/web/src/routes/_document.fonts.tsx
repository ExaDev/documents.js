import { Container, Paper, Stack, Table, Text, Title } from "@mantine/core";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

import { NoDocumentOpen } from "../document/NoDocumentOpen";
import { useOpenDocument } from "../document/OpenDocumentContext";
import { UnrecognisedFormatAlert } from "../document/UnrecognisedFormatAlert";
import { useExtractSourceFonts } from "../hooks/useFonts";
import { notifyError } from "../ui/notify";

export const Route = createFileRoute("/_document/fonts")({
  component: FontsPage,
});

function FontsPage() {
  const { document } = useOpenDocument();
  const extractFonts = useExtractSourceFonts();

  // No explicit reset before a fresh extraction: TanStack Query's own mutate() already clears a mutation's previous data at the moment it dispatches its "pending" state, before the new mutationFn even starts, so a separate reset() call here has nothing left to do. When the newly opened document's format is unrecognised, this effect returns before ever calling mutate() at all, but the render below shows UnrecognisedFormatAlert in that branch regardless of what extractFonts.data still holds, so a stale value sitting unread in the mutation's own state has no observable effect either.
  const { mutate: extractFontsMutate } = extractFonts;
  useEffect(() => {
    if (document?.format === undefined) return;
    extractFontsMutate(
      { format: document.format, bytes: document.file.bytes },
      {
        onError: (error) => {
          notifyError("Could not read fonts", error);
        },
      },
    );
  }, [document, extractFontsMutate]);

  return (
    <Container size="sm" py="xl">
      <Stack gap="lg">
        <Title order={2}>Embedded fonts</Title>

        {document === undefined ? (
          <NoDocumentOpen>
            Open a document above to see its embedded fonts.
          </NoDocumentOpen>
        ) : document.format === undefined ? (
          <UnrecognisedFormatAlert fileName={document.file.name} />
        ) : (
          extractFonts.data && (
            <Paper withBorder p="md">
              {extractFonts.data.length === 0 ? (
                <Text c="dimmed">No embedded fonts found.</Text>
              ) : (
                <Table>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Family</Table.Th>
                      <Table.Th>Bold</Table.Th>
                      <Table.Th>Italic</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {extractFonts.data.map((font, index) => (
                      <Table.Tr key={index}>
                        <Table.Td>{font.family}</Table.Td>
                        <Table.Td>{font.bold ? "yes" : "no"}</Table.Td>
                        <Table.Td>{font.italic ? "yes" : "no"}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              )}
            </Paper>
          )
        )}
      </Stack>
    </Container>
  );
}
