import { Container, Paper, Stack, Text } from "@mantine/core";
import { createFileRoute, Outlet } from "@tanstack/react-router";

import { useOpenDocument } from "../document/OpenDocumentContext";
import { FileUpload } from "../ui/FileUpload";

// Pathless layout route (the leading '_' contributes no URL segment — see TanStack Router's file-based routing docs) wrapping Convert/Editors/Metadata/Inspect/Fonts/Package/.odb/.odm: the eight tool pages that all operate on one shared open document rather than each demanding their own upload. It renders the one place a document is opened; the document itself is held by the root route's OpenDocumentProvider, so Recent Files can open into it from outside this layout. Recent stays outside, since it lists history rather than operating on a currently-open document.
export const Route = createFileRoute("/_document")({
  component: DocumentLayout,
});

function OpenDocumentBar() {
  const { document, openDocument } = useOpenDocument();
  return (
    <Paper withBorder p="md">
      <Stack gap="xs">
        <FileUpload
          file={document?.file}
          onFile={openDocument}
          formatHint="Any document format this app supports"
        />
        {document !== undefined && (
          <Text size="xs" c="dimmed">
            {document.format !== undefined
              ? `Detected format: ${document.format}`
              : "Could not detect a format from the file's extension."}
          </Text>
        )}
      </Stack>
    </Paper>
  );
}

function DocumentLayout() {
  return (
    <Container fluid px="xl" py="xl">
      <Stack gap="lg">
        <OpenDocumentBar />
        <Outlet />
      </Stack>
    </Container>
  );
}
