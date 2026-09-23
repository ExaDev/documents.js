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

  const { mutate: extractFontsMutate, reset: extractFontsReset } = extractFonts;
  useEffect(() => {
    extractFontsReset();
    if (document?.format === undefined) return;
    extractFontsMutate(
      { format: document.format, bytes: document.file.bytes },
      {
        onError: (error) => {
          notifyError("Could not read fonts", error);
        },
      },
    );
  }, [document, extractFontsMutate, extractFontsReset]);

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
