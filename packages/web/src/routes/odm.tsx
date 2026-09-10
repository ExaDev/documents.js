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

import { useOdmRender } from "../hooks/useOdmRender";
import { usePdfObjectUrl } from "../hooks/usePdfObjectUrl";
import type { OpenedFile } from "../ports/fileAccess";
import { FileUpload } from "../ui/FileUpload";
import { notifyError } from "../ui/notify";

export const Route = createFileRoute("/odm")({
  component: OdmPage,
});

// The .odm rendering tool. A master document's chapters are external .odt references by design, so rendering in the browser is a two-file-kind flow: pick the .odm, then pick whichever of its linked chapter .odt files you have -- hrefs resolve by basename, and the procedure answers the named list of unresolved hrefs when chapters are missing, which is the whole UX ("add these files") rather than an error to hide. Everything runs in the worker through the same oRPC boundary as every other tool; the rendered PDF previews in the browser's native viewer.
function OdmPage() {
  const [master, setMaster] = useState<OpenedFile | undefined>(undefined);
  const [chapters, setChapters] = useState<OpenedFile[]>([]);
  const renderOdm = useOdmRender();
  const pdfUrl = usePdfObjectUrl(
    renderOdm.data?.ok ? renderOdm.data.pdf : undefined,
  );

  const unresolved =
    renderOdm.data?.ok === false ? renderOdm.data.unresolved : undefined;

  const render = (
    masterFile: OpenedFile | undefined,
    chapterFiles: OpenedFile[],
  ) => {
    if (masterFile === undefined) return;
    renderOdm.reset();
    renderOdm.mutate(
      {
        master: masterFile.bytes,
        chapters: chapterFiles.map((file) => ({
          href: file.name,
          bytes: file.bytes,
        })),
      },
      {
        onError: (error) => {
          notifyError("Could not render master document", error);
        },
      },
    );
  };

  const handleMaster = (opened: OpenedFile) => {
    setMaster(opened);
    render(opened, chapters);
  };

  const handleChapter = (opened: OpenedFile) => {
    // A chapter file replaces an earlier pick with the same name (a re-pick of a chapter you edited on disk) and otherwise joins the set; either way the master re-renders against the new set immediately.
    const next = [
      ...chapters.filter((file) => file.name !== opened.name),
      opened,
    ];
    setChapters(next);
    render(master, next);
  };

  return (
    <Container size="lg" py="xl">
      <Stack gap="lg">
        <Title order={2}>Render an .odm master document</Title>
        <Text c="dimmed">
          A master document links its chapters as external .odt files. Pick the
          .odm, then add whichever chapter files you have -- the named list of
          still-missing chapters tells you what else to add.
        </Text>
        <FileUpload
          onFile={handleMaster}
          accept={{
            "application/vnd.oasis.opendocument.text-master": [".odm"],
          }}
          formatHint="an .odm master document"
          file={master}
        />
        <FileUpload
          onFile={handleChapter}
          accept={{
            "application/vnd.oasis.opendocument.text": [".odt"],
          }}
          formatHint={
            chapters.length > 0
              ? `chapters: ${chapters.map((file) => file.name).join(", ")} -- add more or re-pick to replace`
              : "the linked chapter .odt files"
          }
        />
        {unresolved !== undefined && unresolved.length > 0 && (
          <Alert color="yellow" title="Chapters still missing">
            <Text>
              The master document links these files, which you have not added
              yet:
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
                {master?.name}
              </Text>
            </Group>
            <iframe
              src={pdfUrl}
              title="Rendered master document"
              style={{ width: "100%", height: "70vh", border: "none" }}
            />
          </Paper>
        )}
      </Stack>
    </Container>
  );
}
