import { Button, Container, Group, Paper, Stack, Text } from "@mantine/core";
import {
  createFileRoute,
  Link,
  Outlet,
  useMatchRoute,
} from "@tanstack/react-router";

import {
  OpenDocumentProvider,
  useOpenDocument,
} from "../document/OpenDocumentContext";
import { FileUpload } from "../ui/FileUpload";

// Pathless layout route (the leading '_' contributes no URL segment — see TanStack Router's file-based routing docs) wrapping Convert/Metadata/Inspect/Fonts/Package/.odb/.odm: the seven tool pages that all operate on one shared open document rather than each demanding their own upload. Editors and Recent stay outside this layout entirely, since neither fits the shared-document model (Editors owns its own live worker-side session per document; Recent lists history rather than operating on a currently-open one).
export const Route = createFileRoute("/_document")({
  component: DocumentLayout,
});

const DOCUMENT_TABS = [
  { to: "/convert", label: "Convert" },
  { to: "/metadata", label: "Metadata" },
  { to: "/inspect", label: "Inspect" },
  { to: "/fonts", label: "Fonts" },
  { to: "/package", label: "Package / JSON" },
  { to: "/odb", label: ".odb" },
  { to: "/odm", label: ".odm" },
] as const;

function DocumentTabs() {
  const matchRoute = useMatchRoute();
  return (
    <Group gap="xs" wrap="wrap">
      {DOCUMENT_TABS.map((tab) => {
        const isActive = matchRoute({ to: tab.to, fuzzy: true }) !== false;
        return (
          <Button
            key={tab.to}
            component={Link}
            to={tab.to}
            size="xs"
            variant={isActive ? "filled" : "default"}
            data-active={isActive ? "true" : undefined}
          >
            {tab.label}
          </Button>
        );
      })}
    </Group>
  );
}

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
    <OpenDocumentProvider>
      <Container fluid px="xl" py="xl">
        <Stack gap="lg">
          <OpenDocumentBar />
          <DocumentTabs />
          <Outlet />
        </Stack>
      </Container>
    </OpenDocumentProvider>
  );
}
