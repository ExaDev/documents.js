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
import { useEffect, useState } from "react";

import { NoDocumentOpen } from "../document/NoDocumentOpen";
import { useOpenDocument } from "../document/OpenDocumentContext";
import { useOdmRender } from "../hooks/useOdmRender";
import { usePdfObjectUrl } from "../hooks/usePdfObjectUrl";
import type { OpenedFile } from "../ports/fileAccess";
import { FileUpload } from "../ui/FileUpload";
import { notifyError } from "../ui/notify";

export const Route = createFileRoute("/_document/odm")({
  component: OdmPage,
});

// The .odm rendering tool. A master document's chapters are external .odt references by design, so rendering in the browser is a two-file-kind flow: the shared open document is the master, and chapters (which no other tool has any use for) stay local to this panel — pick whichever of the master's linked chapter .odt files you have, hrefs resolve by basename, and the procedure answers the named list of unresolved hrefs when chapters are missing, which is the whole UX ("add these files") rather than an error to hide. Everything runs in the worker through the same oRPC boundary as every other tool; the rendered PDF previews in the browser's native viewer.
function OdmPage() {
  const { document } = useOpenDocument();

  return (
    <Container size="lg" py="xl">
      <Stack gap="lg">
        <Title order={2}>Render an .odm master document</Title>
        <Text c="dimmed">
          A master document links its chapters as external .odt files. Open the
          .odm above, then add whichever chapter files you have below — the
          named list of still-missing chapters tells you what else to add.
        </Text>
        {document === undefined ? (
          <NoDocumentOpen>
            Open an .odm master document above to render it.
          </NoDocumentOpen>
        ) : (
          // Keyed by the document's own open sequence: a fresh master document remounts this panel from scratch, dropping any chapters picked for the previous master without calling its setter directly inside an effect (react-hooks/set-state-in-effect). A chapter file is only ever meaningful relative to the master that links it.
          <OdmPanel key={document.id} master={document.file} />
        )}
      </Stack>
    </Container>
  );
}

function OdmPanel({ master }: { master: OpenedFile }) {
  const [chapters, setChapters] = useState<OpenedFile[]>([]);
  const renderOdm = useOdmRender();
  const pdfUrl = usePdfObjectUrl(
    renderOdm.data?.ok ? renderOdm.data.pdf : undefined,
  );

  const unresolved =
    renderOdm.data?.ok === false ? renderOdm.data.unresolved : undefined;

  const { mutate: renderOdmMutate } = renderOdm;
  // Runs once at mount, then again on every subsequent chapter pick via handleChapter's own direct call below, not re-triggered by this effect, since `master` never changes for a given panel instance (see the key above).
  useEffect(() => {
    renderOdmMutate(
      { master: master.bytes, chapters: [] },
      {
        onError: (error) => {
          notifyError("Could not render master document", error);
        },
      },
    );
  }, [master, renderOdmMutate]);

  const handleChapter = (opened: OpenedFile) => {
    // A chapter file replaces an earlier pick with the same name (a re-pick of a chapter you edited on disk) and otherwise joins the set; either way the master re-renders against the new set immediately.
    const next = [
      ...chapters.filter((file) => file.name !== opened.name),
      opened,
    ];
    setChapters(next);
    renderOdmMutate(
      {
        master: master.bytes,
        chapters: next.map((file) => ({ href: file.name, bytes: file.bytes })),
      },
      {
        onError: (error) => {
          notifyError("Could not render master document", error);
        },
      },
    );
  };

  return (
    <>
      <FileUpload
        onFile={handleChapter}
        accept={{
          "application/vnd.oasis.opendocument.text": [".odt"],
        }}
        formatHint={
          chapters.length > 0
            ? `chapters: ${chapters.map((file) => file.name).join(", ")} — add more or re-pick to replace`
            : "the linked chapter .odt files"
        }
      />
      {unresolved !== undefined && unresolved.length > 0 && (
        <Alert color="yellow" title="Chapters still missing">
          <Text>
            The master document links these files, which you have not added yet:
          </Text>
          <List>
            {unresolved.map((href) => (
              <List.Item key={href}>{href}</List.Item>
            ))}
          </List>
        </Alert>
      )}
      {pdfUrl !== undefined && (
        <Paper withBorder p="md">
          <Group justify="space-between" mb="xs">
            <Text fw={500}>Rendered PDF</Text>
            <Text c="dimmed" size="sm">
              {master.name}
            </Text>
          </Group>
          <iframe
            src={pdfUrl}
            title="Rendered master document"
            style={{ width: "100%", height: "70vh", border: "none" }}
          />
        </Paper>
      )}
    </>
  );
}
