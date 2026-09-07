import { Box, Text } from "ink";
import { useState, type ReactElement } from "react";
import type { MetadataOverrides } from "documents.js";
import { ListView } from "../../components/list-view.js";
import { TextField } from "../../components/text-field.js";
import { useNavigationInput } from "../../keybindings/use-navigation-input.js";
import {
  formatMetadataLines,
  formatMetadataValue,
} from "../../../runtime/metadata-format.js";
import { metadataFor } from "../../format/read-metadata.js";
import { useAppDispatch, useAppState } from "../../state/context.js";
import { anyOverlayOpen, isEditableDocument } from "../../state/types.js";

// The four fields MetadataOverrides (documents.js) actually accepts -- creator/producer/createdIso/modifiedIso are real LayoutMetadata fields this screen still DISPLAYS (formatMetadataLines below, unchanged from before this screen gained write support), but they are derived/producer-stamped rather than user-authored, so editor.metadata's own setter has no field for them and this screen offers no row to edit them through.
interface MetadataField {
  readonly key: "title" | "author" | "subject" | "keywords";
  readonly label: string;
}

const EDITABLE_FIELDS: readonly MetadataField[] = [
  { key: "title", label: "title" },
  { key: "author", label: "author" },
  { key: "subject", label: "subject" },
  { key: "keywords", label: "keywords" },
];

// Splits a comma-separated field edit into MetadataOverrides' own keywords: string[] shape: trims each entry and drops empty ones, so "a, , b," reads back as ["a", "b"] rather than carrying stray blanks from trailing/doubled commas -- the same forgiving parse a human typing a quick comma list expects, not a strict CSV reader.
function parseKeywords(text: string): string[] {
  return text
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

// Builds the one-field MetadataOverrides a field edit commits -- an explicit switch rather than a computed { [field]: text } property, since editor.metadata's own partial-merge semantics (documents.js's mergeMetadata) mean only the field actually named here changes; every other field, edited or not, is left exactly as the document already had it.
function overridesFor(
  field: MetadataField["key"],
  text: string,
): MetadataOverrides {
  switch (field) {
    case "title":
      return { title: text };
    case "author":
      return { author: text };
    case "subject":
      return { subject: text };
    case "keywords":
      return { keywords: parseKeywords(text) };
  }
}

// A real edit flow over editor.metadata's own setter (ExaDev/documents.js#933), reachable for any open document ('m' from app.tsx's own shell-level global useInput). Only EditableOpenDocument formats (docx/pptx/odt/odp/ods/odg/pdf) carry that setter -- markdown and every read-only preview format (odb, xlsx, csv, svg, rtf, wpd, doc, xls, ppt) still show their current metadata, just with no way to change it here, exactly as before this screen gained write support.
export function MetadataScreen(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const doc = state.openDocument;
  const editable = doc !== undefined && isEditableDocument(doc);
  const [editingField, setEditingField] = useState<
    MetadataField["key"] | undefined
  >(undefined);
  const [draft, setDraft] = useState("");

  const isNavigationActive =
    doc !== undefined && !anyOverlayOpen(state) && editingField === undefined;

  const { selectedIndex } = useNavigationInput({
    itemCount: editable ? EDITABLE_FIELDS.length : 0,
    isActive: isNavigationActive,
    onBack: () => {
      dispatch({ type: "POP_SCREEN" });
    },
    onSelect: (index) => {
      if (doc === undefined || !editable) return;
      const field = EDITABLE_FIELDS[index];
      if (field === undefined) return;
      const currentValue = metadataFor(doc)[field.key];
      setDraft(
        currentValue === undefined ? "" : formatMetadataValue(currentValue),
      );
      setEditingField(field.key);
    },
  });

  if (doc === undefined) {
    return <Text color="red">MetadataScreen requires an open document.</Text>;
  }

  let lines: readonly string[] | undefined;
  let errorMessage: string | undefined;
  try {
    lines = formatMetadataLines(metadataFor(doc));
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
  }

  if (editingField !== undefined) {
    const field = EDITABLE_FIELDS.find((f) => f.key === editingField);
    return (
      <Box flexDirection="column">
        <Text bold>Editing {field?.label ?? editingField}</Text>
        {editingField === "keywords" ? (
          <Text dimColor>Comma-separated</Text>
        ) : undefined}
        <TextField
          value={draft}
          isFocused
          onChange={setDraft}
          onSubmit={(text) => {
            dispatch({
              type: "SET_METADATA",
              overrides: overridesFor(editingField, text),
            });
            setEditingField(undefined);
          }}
          onCancel={() => {
            setEditingField(undefined);
          }}
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>Document metadata ({doc.format})</Text>
      {errorMessage !== undefined ? (
        <Text color="yellow">{errorMessage}</Text>
      ) : lines !== undefined && lines.length > 0 ? (
        lines.map((line) => <Text key={line}>{line}</Text>)
      ) : (
        <Text dimColor>This document carries no metadata.</Text>
      )}
      {editable ? (
        <>
          <Text bold>Edit a field</Text>
          <ListView
            items={EDITABLE_FIELDS}
            selectedIndex={selectedIndex}
            renderItem={(field, isSelected) => (
              <Text
                color={isSelected ? "cyan" : undefined}
                inverse={isSelected}
              >
                {field.label}
              </Text>
            )}
          />
          <Text dimColor>Enter to edit, Esc / ← / h to go back</Text>
        </>
      ) : (
        <Text dimColor>
          This document's metadata is read-only. Esc / ← / h to go back
        </Text>
      )}
    </Box>
  );
}
