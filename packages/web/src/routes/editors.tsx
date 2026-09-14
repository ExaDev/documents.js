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

// The opened file, its inferred format, and its live snapshot always change together (the file/format are only ever set alongside the mutate() call whose result seeds the snapshot) and are only ever meaningful as a trio -- one state value carrying all three, rather than three separate pieces of state, is what makes that invariant a type-level fact instead of something every reader (and paragraph action below) needs to defensively re-check.
interface EditorSession {
  file: OpenedFile;
  format: EditorFormat;
  snapshot: { id: number; paragraphs: string[] };
}

// The Editors tool: an in-browser editing surface over documents.js's live-view editors, which run in the worker and hold the document itself -- every edit below is applied to the live document through the rpc session (nothing is buffered client-side), and Save re-serialises the whole document through the format's own writer. The v1 surface is the paragraph list every format family shares: edit a paragraph's text in place, append, remove, save. Formats beyond these four (and deeper per-run styling) stay out until they have the same genuine cross-format surface.
function EditorsPage() {
  const [session, setSession] = useState<EditorSession | undefined>(undefined);
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
    setSession(undefined);
    // No reset() call precedes this: mutate() itself already clears any previous open's data/error the instant this dispatch starts, before its own result settles.
    openEditor.mutate(
      { format: inferred, bytes: opened.bytes },
      {
        onSuccess: (snapshot) => {
          setSession({ file: opened, format: inferred, snapshot });
        },
        onError: (error) => {
          notifyError("Could not open document", error);
        },
      },
    );
  };

  // Every paragraph action below is wired only to elements rendered inside the `session !== undefined` panel further down, so by the time any of them can actually run, the session (and its file/snapshot) is already known to be defined -- there is no separate guard to check here.
  const applySet = (index: number, text: string, session: EditorSession) => {
    setParagraphText.mutate(
      { id: session.snapshot.id, index, text },
      {
        onSuccess: (snapshot) => {
          setSession({ ...session, snapshot });
        },
        onError: (error) => {
          notifyError("Could not edit paragraph", error);
        },
      },
    );
  };

  const applyAdd = (session: EditorSession) => {
    addParagraph.mutate(
      { id: session.snapshot.id, text: newParagraph },
      {
        onSuccess: (snapshot) => {
          setSession({ ...session, snapshot });
          setNewParagraph("");
        },
        onError: (error) => {
          notifyError("Could not add paragraph", error);
        },
      },
    );
  };

  const applyRemove = (index: number, session: EditorSession) => {
    removeParagraph.mutate(
      { id: session.snapshot.id, index },
      {
        onSuccess: (snapshot) => {
          setSession({ ...session, snapshot });
        },
        onError: (error) => {
          notifyError("Could not remove paragraph", error);
        },
      },
    );
  };

  const applySave = (session: EditorSession) => {
    saveEditor.mutate(
      { id: session.snapshot.id },
      {
        onSuccess: (result) => {
          notifySuccess("Document saved");
          void fileAccess.saveFile(result.bytes, {
            suggestedName: session.file.name,
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
          file={session?.file}
          loading={openEditor.isPending}
        />
        {session !== undefined && (
          <Paper withBorder p="md">
            <Group justify="space-between" mb="md">
              <Text fw={500}>
                {session.format.toUpperCase()} ·{" "}
                {session.snapshot.paragraphs.length}{" "}
                {session.snapshot.paragraphs.length === 1
                  ? "paragraph"
                  : "paragraphs"}
              </Text>
              <Button
                size="xs"
                onClick={() => {
                  applySave(session);
                }}
                loading={saveEditor.isPending}
              >
                Save
              </Button>
            </Group>
            <Stack gap="sm">
              {session.snapshot.paragraphs.map((text, index) => (
                <Group key={index} align="flex-start" gap="xs" wrap="nowrap">
                  <Textarea
                    value={text}
                    autosize
                    minRows={1}
                    style={{ flex: 1 }}
                    onChange={(event) => {
                      // Optimistic local edit: the input is driven by local state per keystroke, and the worker session is updated on blur -- one rpc round-trip per finished edit rather than per keystroke.
                      setSession({
                        ...session,
                        snapshot: {
                          id: session.snapshot.id,
                          paragraphs: session.snapshot.paragraphs.map(
                            (value, i) =>
                              i === index ? event.currentTarget.value : value,
                          ),
                        },
                      });
                    }}
                    onBlur={(event) => {
                      applySet(index, event.currentTarget.value, session);
                    }}
                  />
                  <ActionIcon
                    color="red"
                    variant="subtle"
                    aria-label={`Remove paragraph ${index + 1}`}
                    onClick={() => {
                      applyRemove(index, session);
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
                onClick={() => {
                  applyAdd(session);
                }}
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
