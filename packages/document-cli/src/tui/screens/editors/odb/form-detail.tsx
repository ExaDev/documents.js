import type { OdbForm } from "documents.js";
import { Box, Text } from "ink";
import type { ReactElement } from "react";
import { formatOdbFormLines } from "../../../../odb-structure.js";
import { ListView } from "../../../components/list-view.js";
import { useNavigationInput } from "../../../keybindings/use-navigation-input.js";
import { useAppDispatch, useAppState } from "../../../state/context.js";
import { anyOverlayOpen, currentScreen } from "../../../state/types.js";
import { requireOdbDocument } from "./shared.js";

// The title line, the href line beneath it, the hint line, and the status line at the bottom -- one more row of chrome than ListView's own default reserves, matching table-rows.tsx's own reasoning.
const FORM_DETAIL_RESERVED_ROWS = 5;

function requireForm(forms: readonly OdbForm[], formName: string): OdbForm {
  const form = forms.find((candidate) => candidate.name === formName);
  if (form === undefined) {
    throw new Error(
      `odbFormDetail was pushed for form "${formName}", but the open .odb document has no form by that name.`,
    );
  }
  return form;
}

// A form's own control tree, rendered one already-indented line per row through the same `formatOdbFormLines` the `odb-forms` command prints -- so what the TUI shows and what the CLI writes cannot drift apart. Selecting a row does nothing: every line is fully rendered inline and there is nothing further to drill into, exactly as in table-rows.tsx.
export function OdbFormDetailScreen(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const doc = requireOdbDocument(state.openDocument);
  const screen = currentScreen(state);
  if (screen.kind !== "odbFormDetail") {
    throw new Error(
      `OdbFormDetailScreen rendered while the current screen is "${screen.kind}", not "odbFormDetail".`,
    );
  }
  const form = requireForm(doc.forms, screen.formName);

  const allLines = formatOdbFormLines(form);
  const query = state.searchQuery.trim().toLowerCase();
  const lines =
    query === ""
      ? allLines
      : allLines.filter((line) => line.toLowerCase().includes(query));

  const { selectedIndex } = useNavigationInput({
    itemCount: lines.length,
    onSelect: () => {
      // Nothing to open: a control line already carries its own tag, name, field binding, label, and implementation.
    },
    onBack: () => {
      dispatch({ type: "POP_SCREEN" });
    },
    isActive: !anyOverlayOpen(state),
  });

  return (
    <Box flexDirection="column">
      <Text bold>
        {form.name} ({lines.length} of {allLines.length} lines)
      </Text>
      <Text dimColor>{form.href}</Text>
      <ListView
        items={lines}
        selectedIndex={selectedIndex}
        reservedRows={FORM_DETAIL_RESERVED_ROWS}
        emptyMessage={
          query === ""
            ? "This form declares no structure."
            : `No lines match "${state.searchQuery}".`
        }
        renderItem={(line, isSelected) => (
          <Text color={isSelected ? "cyan" : undefined} inverse={isSelected}>
            {line}
          </Text>
        )}
      />
      <Text dimColor>Esc to go back to the form list</Text>
    </Box>
  );
}
