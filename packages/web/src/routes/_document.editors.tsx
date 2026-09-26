import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Group,
  Paper,
  Stack,
  Text,
  Textarea,
} from "@mantine/core";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import type { DocumentFormat } from "documents.js";
import { useEffect, useRef, useState } from "react";

import { createFileAccess } from "../adapters/fileAccess/createFileAccess";
import { NoDocumentOpen } from "../document/NoDocumentOpen";
import { useOpenDocument } from "../document/OpenDocumentContext";
import type { EditorSnapshot } from "../hooks/useEditorSession";
import {
  useAddParagraph,
  useOpenEditor,
  useRemoveParagraph,
  useSaveEditor,
  useSetParagraphText,
} from "../hooks/useEditorSession";
import type { OpenedFile } from "../ports/fileAccess";
import { editorRow } from "../ui/EditorPanel.css";
import { iconFlexShrink, minWidthZero } from "../ui/layout.css";
import { notifyError, notifySuccess } from "../ui/notify";
import { ToolPage } from "../ui/ToolPage";

export const Route = createFileRoute("/_document/editors")({
  component: EditorsPage,
});

// The formats documents.js exposes a live-view editor for. Every member is also a DocumentFormat, so editorFormat() below narrows the shared document's own inferred format without a cast.
const EDITOR_FORMATS = ["docx", "odt", "doc", "markdown"] as const;

export type EditorFormat = (typeof EDITOR_FORMATS)[number];

// Exported so a test can pin both branches directly, including the "recognised document format, but not an editable one" case that is the whole reason this page needs a state of its own between "nothing open" and "editing".
export function editorFormat(
  format: DocumentFormat | undefined,
): EditorFormat | undefined {
  return EDITOR_FORMATS.find((candidate) => candidate === format);
}

// Exported for the same reason: the singular/plural boundary is a literal a mutant can flip, so it gets its own pinning test rather than only being observed through a rendered count.
export function paragraphCountLabel(count: number): string {
  return count === 1 ? "1 paragraph" : `${count} paragraphs`;
}

// Whether the working snapshot has moved away from the last one the worker confirmed (the open, or the most recent save). Compares paragraph-by-paragraph rather than by reference, because every optimistic edit produces a brand-new snapshot object: reference equality would call an edited document clean.
export function snapshotDiffers(
  working: EditorSnapshot,
  saved: EditorSnapshot,
): boolean {
  return (
    working.id !== saved.id ||
    working.paragraphs.length !== saved.paragraphs.length ||
    working.paragraphs.some((text, index) => text !== saved.paragraphs[index])
  );
}

// The Editors tool: an in-browser editing surface over documents.js's live-view editors, which run in the worker and hold the document itself. Every edit below is applied to the live document through the rpc session (nothing is buffered client-side), and Save re-serialises the whole document through the format's own writer. The v1 surface is the paragraph list every format family shares: edit a paragraph's text in place, append, remove, save. Formats beyond these four (and deeper per-run styling) stay out until they have the same genuine cross-format surface.
function EditorsPage() {
  const { document } = useOpenDocument();
  const format = editorFormat(document?.format);

  return (
    <ToolPage
      title="Edit a document"
      description="Opens docx, odt, doc, and markdown through live-view editors running in the browser: edits apply to the document itself, and Save writes the whole document back through its format's own writer."
    >
      {document === undefined ? (
        <NoDocumentOpen>Open a document above to edit it.</NoDocumentOpen>
      ) : format === undefined ? (
        <Alert color="yellow" title="Not an editable format">
          Editing opens docx, odt, doc, and markdown documents. &quot;
          {document.file.name}&quot; is not one of those.
        </Alert>
      ) : (
        // Keyed by the document's own open sequence, so a fresh open (even re-picking the identical file) remounts this panel from scratch. That is what discards the previous document's editor session, rather than calling its setter directly inside an effect (react-hooks/set-state-in-effect).
        <EditorPanel key={document.id} file={document.file} format={format} />
      )}
    </ToolPage>
  );
}

function EditorPanel({
  file,
  format,
}: {
  file: OpenedFile;
  format: EditorFormat;
}) {
  const [snapshot, setSnapshot] = useState<EditorSnapshot | undefined>(
    undefined,
  );
  // The last snapshot the worker confirmed: the open itself, then each successful save. The working snapshot above moves ahead of it on every optimistic edit, and the gap between the two is exactly what the unsaved-changes indicator reports.
  const [savedSnapshot, setSavedSnapshot] = useState<
    EditorSnapshot | undefined
  >(undefined);
  const [newParagraph, setNewParagraph] = useState("");

  const openEditor = useOpenEditor();
  const setParagraphText = useSetParagraphText();
  const addParagraph = useAddParagraph();
  const removeParagraph = useRemoveParagraph();
  const saveEditor = useSaveEditor();
  const fileAccess = createFileAccess();

  // Runs exactly once, for the one document this panel instance will ever see. A fresh open remounts a whole new instance (see the key above) rather than this effect re-running to reset anything. A `hasOpened` ref guard stands in for a dependency array here, not out of preference, but because one is provably impossible to write correctly: `file`, `format`, and `openEditorMutate` are guaranteed stable for this panel's entire lifetime (the key above is what enforces that), so there is no reactive value a dependency list could ever meaningfully name, and nothing for react-hooks/exhaustive-deps to check. The guard still has to exist: the panel re-renders on every `setSnapshot` call below, and without it this effect would call `openEditorMutate` again on each of those, silently reopening the document.
  const { mutate: openEditorMutate } = openEditor;
  const hasOpened = useRef(false);
  useEffect(() => {
    if (hasOpened.current) return;
    hasOpened.current = true;
    openEditorMutate(
      { format, bytes: file.bytes },
      {
        onSuccess: (opened) => {
          setSnapshot(opened);
          setSavedSnapshot(opened);
        },
        onError: (error) => {
          notifyError("Could not open document", error);
        },
      },
    );
  });

  // Every paragraph action below is wired only to elements rendered inside the `snapshot !== undefined` panel further down, so by the time any of them can actually run the snapshot is already known to be defined. There is no separate guard to check here.
  const applySet = (index: number, text: string, current: EditorSnapshot) => {
    setParagraphText.mutate(
      { id: current.id, index, text },
      {
        onSuccess: (updated) => {
          setSnapshot(updated);
        },
        onError: (error) => {
          notifyError("Could not edit paragraph", error);
        },
      },
    );
  };

  const applyAdd = (current: EditorSnapshot) => {
    addParagraph.mutate(
      { id: current.id, text: newParagraph },
      {
        onSuccess: (updated) => {
          setSnapshot(updated);
          setNewParagraph("");
        },
        onError: (error) => {
          notifyError("Could not add paragraph", error);
        },
      },
    );
  };

  const applyRemove = (index: number, current: EditorSnapshot) => {
    removeParagraph.mutate(
      { id: current.id, index },
      {
        onSuccess: (updated) => {
          setSnapshot(updated);
        },
        onError: (error) => {
          notifyError("Could not remove paragraph", error);
        },
      },
    );
  };

  const applySave = (current: EditorSnapshot) => {
    saveEditor.mutate(
      { id: current.id },
      {
        onSuccess: (result) => {
          // The save's own success is what closes the unsaved-changes gap: the working snapshot becomes the saved one the moment the worker has serialised it, so the indicator clears even though the bytes are on their way to disk asynchronously.
          setSavedSnapshot(current);
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

  if (openEditor.isError)
    return (
      <Alert color="red" title="Could not open document">
        {String(openEditor.error)}
      </Alert>
    );

  if (snapshot === undefined)
    return <Text c="dimmed">Opening the document for editing…</Text>;

  const hasUnsavedChanges =
    savedSnapshot !== undefined && snapshotDiffers(snapshot, savedSnapshot);

  return (
    <Paper withBorder p="md">
      <Group
        justify="space-between"
        align="flex-start"
        mb="md"
        className={minWidthZero}
        wrap="nowrap"
      >
        <Stack gap={2} className={minWidthZero}>
          <Text fw={500} truncate title={file.name}>
            {file.name}
          </Text>
          <Group gap={6} wrap="nowrap">
            <Badge size="sm" variant="light">
              {format.toUpperCase()}
            </Badge>
            <Text size="sm" c="dimmed">
              {paragraphCountLabel(snapshot.paragraphs.length)}
            </Text>
          </Group>
        </Stack>
        <Group gap="sm" wrap="nowrap">
          {hasUnsavedChanges && (
            <Text size="sm" c="orange" span>
              Unsaved changes
            </Text>
          )}
          <Button
            size="xs"
            onClick={() => {
              applySave(snapshot);
            }}
            loading={saveEditor.isPending}
          >
            Save
          </Button>
        </Group>
      </Group>
      <Stack gap="xs">
        {snapshot.paragraphs.length === 0 ? (
          <Text c="dimmed" size="sm" py="xs">
            This document has no paragraphs yet. Write the first one below and
            choose add.
          </Text>
        ) : (
          snapshot.paragraphs.map((text, index) => (
            <Group
              key={index}
              align="flex-start"
              gap="xs"
              wrap="nowrap"
              className={editorRow}
              px="xs"
              py={4}
            >
              <Text
                size="xs"
                c="dimmed"
                ta="right"
                w={24}
                className={iconFlexShrink}
                pt={7}
                data-paragraph-number={index + 1}
              >
                {index + 1}
              </Text>
              <Textarea
                value={text}
                autosize
                minRows={1}
                style={{ flex: 1 }}
                aria-label={`Paragraph ${index + 1}`}
                onChange={(event) => {
                  // Optimistic local edit: the input is driven by local state per keystroke, and the worker session is updated on blur, so there is one rpc round-trip per finished edit rather than per keystroke.
                  setSnapshot({
                    id: snapshot.id,
                    paragraphs: snapshot.paragraphs.map((value, i) =>
                      i === index ? event.currentTarget.value : value,
                    ),
                  });
                }}
                onBlur={(event) => {
                  applySet(index, event.currentTarget.value, snapshot);
                }}
              />
              <ActionIcon
                color="red"
                variant="subtle"
                aria-label={`Remove paragraph ${index + 1}`}
                onClick={() => {
                  applyRemove(index, snapshot);
                }}
                loading={removeParagraph.isPending}
              >
                <IconTrash size={16} />
              </ActionIcon>
            </Group>
          ))
        )}
      </Stack>
      <Group mt="md" align="flex-start" gap="xs" wrap="nowrap">
        <Textarea
          value={newParagraph}
          autosize
          minRows={1}
          placeholder="a new paragraph"
          aria-label="New paragraph"
          style={{ flex: 1 }}
          onChange={(event) => {
            setNewParagraph(event.currentTarget.value);
          }}
        />
        <ActionIcon
          variant="subtle"
          aria-label="Add paragraph"
          onClick={() => {
            applyAdd(snapshot);
          }}
          disabled={newParagraph === ""}
          loading={addParagraph.isPending}
        >
          <IconPlus size={16} />
        </ActionIcon>
      </Group>
    </Paper>
  );
}
