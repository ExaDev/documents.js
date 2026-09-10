import {
  ActionIcon,
  Alert,
  Button,
  Container,
  Group,
  Paper,
  Stack,
  Text,
  Textarea,
  Title,
} from "@mantine/core";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { createFileAccess } from "../adapters/fileAccess/createFileAccess";
import {
  useAddParagraph,
  useOpenEditor,
  useRemoveParagraph,
  useSaveEditor,
  useSetParagraphText,
} from "../hooks/useEditorSession";
import type { OpenedFile } from "../ports/fileAccess";
import { FileUpload } from "../ui/FileUpload";
import { notifyError, notifySuccess } from "../ui/notify";

export const Route = createFileRoute("/editors")({
  component: EditorsPage,
});

type EditorFormat = "docx" | "odt" | "doc" | "markdown";

// The Editors tool: an in-browser editing surface over documents.js's live-view editors, which run in the worker and hold the document itself -- every edit below is applied to the live document through the rpc session (nothing is buffered client-side), and Save re-serialises the whole document through the format's own writer. The v1 surface is the paragraph list every format family shares: edit a paragraph's text in place, append, remove, save. Formats beyond these four (and deeper per-run styling) stay out until they have the same genuine cross-format surface.
function EditorsPage() {
  const [file, setFile] = useState<OpenedFile | undefined>(undefined);
  const [format, setFormat] = useState<EditorFormat | undefined>(undefined);
  const [snapshot, setSnapshot] = useState<
    { id: number; paragraphs: string[] } | undefined
  >(undefined);
  const [newParagraph, setNewParagraph] = useState("");

  const openEditor = useOpenEditor();
  const setParagraphText = useSetParagraphText();
  const addParagraph = useAddParagraph();
  const removeParagraph = useRemoveParagraph();
  const saveEditor = useSaveEditor();
  const fileAccess = createFileAccess();

  const handleFile = (opened: OpenedFile) => {
    const inferred = inferFormat(opened.name);
    if (inferred === undefined) {
      notifyError(
        "Unsupported format",
        new Error("the editors tool opens docx, odt, doc, or markdown files"),
      );
      return;
    }
    setFile(opened);
    setFormat(inferred);
    setSnapshot(undefined);
    openEditor.reset();
    openEditor.mutate(
      { format: inferred, bytes: opened.bytes },
      {
        onSuccess: setSnapshot,
        onError: (error) => {
          notifyError("Could not open document", error);
        },
      },
    );
  };

  const applySet = (index: number, text: string) => {
    if (snapshot === undefined) return;
    setParagraphText.mutate(
      { id: snapshot.id, index, text },
      {
        onSuccess: setSnapshot,
        onError: (error) => {
          notifyError("Could not edit paragraph", error);
        },
      },
    );
  };

  const applyAdd = () => {
    if (snapshot === undefined || newParagraph === "") return;
    addParagraph.mutate(
      { id: snapshot.id, text: newParagraph },
      {
        onSuccess: (next) => {
          setSnapshot(next);
          setNewParagraph("");
        },
        onError: (error) => {
          notifyError("Could not add paragraph", error);
        },
      },
    );
  };

  const applyRemove = (index: number) => {
    if (snapshot === undefined) return;
    removeParagraph.mutate(
      { id: snapshot.id, index },
      {
        onSuccess: setSnapshot,
        onError: (error) => {
          notifyError("Could not remove paragraph", error);
        },
      },
    );
  };

  const applySave = () => {
    if (snapshot === undefined || file === undefined) return;
    saveEditor.mutate(
      { id: snapshot.id },
      {
        onSuccess: (result) => {
          notifySuccess("Document saved");
          void fileAccess.saveFile(result.bytes, {
            suggestedName: file.name,
            mimeType: "application/octet-stream",
          });
        },
        onError: (error) => {
          notifyError("Could not save document", error);
        },
      },
    );
  };

  return (
    <Container size="lg" py="xl">
      <Stack gap="lg">
        <Title order={2}>Edit a document</Title>
        <Text c="dimmed">
          Opens docx, odt, doc, and markdown through live-view editors running
          in the browser: edits apply to the document itself, and Save writes
          the whole document back through its format's own writer.
        </Text>
        <FileUpload
          onFile={handleFile}
          accept={{
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
              [".docx"],
            "application/vnd.oasis.opendocument.text": [".odt"],
            "application/msword": [".doc"],
            "text/markdown": [".md", ".markdown"],
          }}
          formatHint="docx, odt, doc, or markdown"
          file={file}
          loading={openEditor.isPending}
        />
        {snapshot !== undefined && (
          <Paper withBorder p="md">
            <Group justify="space-between" mb="md">
              <Text fw={500}>
                {format?.toUpperCase()} · {snapshot.paragraphs.length}{" "}
                {snapshot.paragraphs.length === 1 ? "paragraph" : "paragraphs"}
              </Text>
              <Button
                size="xs"
                onClick={applySave}
                loading={saveEditor.isPending}
              >
                Save
              </Button>
            </Group>
            <Stack gap="sm">
              {snapshot.paragraphs.map((text, index) => (
                <Group key={index} align="flex-start" gap="xs" wrap="nowrap">
                  <Textarea
                    value={text}
                    autosize
                    minRows={1}
                    style={{ flex: 1 }}
                    onChange={(event) => {
                      // Optimistic local edit: the input is driven by local state per keystroke, and the worker session is updated on blur -- one rpc round-trip per finished edit rather than per keystroke.
                      setSnapshot({
                        id: snapshot.id,
                        paragraphs: snapshot.paragraphs.map((value, i) =>
                          i === index ? event.currentTarget.value : value,
                        ),
                      });
                    }}
                    onBlur={(event) => {
                      applySet(index, event.currentTarget.value);
                    }}
                  />
                  <ActionIcon
                    color="red"
                    variant="subtle"
                    aria-label={`Remove paragraph ${index + 1}`}
                    onClick={() => {
                      applyRemove(index);
                    }}
                    loading={removeParagraph.isPending}
                  >
                    <IconTrash size={16} />
                  </ActionIcon>
                </Group>
              ))}
            </Stack>
            <Group mt="md" align="flex-start" gap="xs" wrap="nowrap">
              <Textarea
                value={newParagraph}
                autosize
                minRows={1}
                placeholder="a new paragraph"
                style={{ flex: 1 }}
                onChange={(event) => {
                  setNewParagraph(event.currentTarget.value);
                }}
              />
              <ActionIcon
                variant="subtle"
                aria-label="Add paragraph"
                onClick={applyAdd}
                disabled={newParagraph === ""}
                loading={addParagraph.isPending}
              >
                <IconPlus size={16} />
              </ActionIcon>
            </Group>
          </Paper>
        )}
        {openEditor.isError && (
          <Alert color="red" title="Could not open document">
            {String(openEditor.error)}
          </Alert>
        )}
      </Stack>
    </Container>
  );
}

function inferFormat(name: string): EditorFormat | undefined {
  const lower = name.toLowerCase();
  if (lower.endsWith(".docx")) return "docx";
  if (lower.endsWith(".odt")) return "odt";
  if (lower.endsWith(".doc")) return "doc";
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
  return undefined;
}
