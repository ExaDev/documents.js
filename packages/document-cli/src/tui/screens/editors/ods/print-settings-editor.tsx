import type { ContentSheetPrintSettings } from "documents.js";
import { Box, Text } from "ink";
import { useState, type ReactElement } from "react";
import { ListView } from "../../../components/list-view.js";
import { TextField } from "../../../components/text-field.js";
import { useNavigationInput } from "../../../keybindings/use-navigation-input.js";
import { useAppDispatch, useAppState } from "../../../state/context.js";
import { anyOverlayOpen, currentScreen } from "../../../state/types.js";
import { odsDocument } from "./shared.js";

// The five fields `ContentSheetPrintSettingsSchema` always carries (pageSize, margins, gridlines, headers, pageOrder) -- printRange/scale/fitToPages/repeatRows/repeatColumns/manualBreaks are all optional and, per documents.js's own README, neither `OdsSheet.printSettings`'s getter nor `buildOdsPackage` reads or writes them yet, so there is nothing meaningful for this form to show or set for those.
type FieldKey =
  | "pageWidthPt"
  | "pageHeightPt"
  | "marginTopPt"
  | "marginRightPt"
  | "marginBottomPt"
  | "marginLeftPt"
  | "gridlines"
  | "headers"
  | "pageOrder";

interface FieldRow {
  readonly key: FieldKey;
  readonly label: string;
}

const FIELD_ROWS: readonly FieldRow[] = [
  { key: "pageWidthPt", label: "Page width (pt)" },
  { key: "pageHeightPt", label: "Page height (pt)" },
  { key: "marginTopPt", label: "Margin top (pt)" },
  { key: "marginRightPt", label: "Margin right (pt)" },
  { key: "marginBottomPt", label: "Margin bottom (pt)" },
  { key: "marginLeftPt", label: "Margin left (pt)" },
  { key: "gridlines", label: "Gridlines" },
  { key: "headers", label: "Headers" },
  { key: "pageOrder", label: "Page order" },
];

const NUMERIC_FIELD_KEYS: ReadonlySet<FieldKey> = new Set([
  "pageWidthPt",
  "pageHeightPt",
  "marginTopPt",
  "marginRightPt",
  "marginBottomPt",
  "marginLeftPt",
]);

// Wide enough for the longest label above ("Margin bottom (pt)") plus a space.
const LABEL_COLUMN_WIDTH = 20;

function fieldValueText(
  settings: ContentSheetPrintSettings,
  key: FieldKey,
): string {
  switch (key) {
    case "pageWidthPt":
      return String(settings.pageSize.widthPt);
    case "pageHeightPt":
      return String(settings.pageSize.heightPt);
    case "marginTopPt":
      return String(settings.margins.topPt);
    case "marginRightPt":
      return String(settings.margins.rightPt);
    case "marginBottomPt":
      return String(settings.margins.bottomPt);
    case "marginLeftPt":
      return String(settings.margins.leftPt);
    case "gridlines":
      return settings.gridlines ? "on" : "off";
    case "headers":
      return settings.headers ? "on" : "off";
    case "pageOrder":
      return settings.pageOrder;
  }
}

// Only ever called for a key in NUMERIC_FIELD_KEYS -- every call site checks that set first, so a boolean/enum key reaching the default branch is a genuine caller bug, not a case worth handling quietly.
function withNumericField(
  settings: ContentSheetPrintSettings,
  key: FieldKey,
  value: number,
): ContentSheetPrintSettings {
  switch (key) {
    case "pageWidthPt":
      return {
        ...settings,
        pageSize: { ...settings.pageSize, widthPt: value },
      };
    case "pageHeightPt":
      return {
        ...settings,
        pageSize: { ...settings.pageSize, heightPt: value },
      };
    case "marginTopPt":
      return { ...settings, margins: { ...settings.margins, topPt: value } };
    case "marginRightPt":
      return { ...settings, margins: { ...settings.margins, rightPt: value } };
    case "marginBottomPt":
      return { ...settings, margins: { ...settings.margins, bottomPt: value } };
    case "marginLeftPt":
      return { ...settings, margins: { ...settings.margins, leftPt: value } };
    default:
      throw new Error(`${key} does not take a numeric value`);
  }
}

// Only ever called for a key outside NUMERIC_FIELD_KEYS -- the mirror image of withNumericField above.
function toggledSettings(
  settings: ContentSheetPrintSettings,
  key: FieldKey,
): ContentSheetPrintSettings {
  switch (key) {
    case "gridlines":
      return { ...settings, gridlines: !settings.gridlines };
    case "headers":
      return { ...settings, headers: !settings.headers };
    case "pageOrder":
      return {
        ...settings,
        pageOrder:
          settings.pageOrder === "downThenOver"
            ? "overThenDown"
            : "downThenOver",
      };
    default:
      throw new Error(`${key} is not a toggleable field`);
  }
}

// A form over `OdsSheet.printSettings`'s five guaranteed fields, reached with 'p' from the grid. Reading `sheet.printSettings` directly (rather than through `readOdsContent`, the way the grid reads cells) is safe here: unlike `OdsSheet.cell()`, the getter resolves an existing style chain without materialising anything, so there is no display-time mutation hazard to avoid.
export function OdsPrintSettingsEditorScreen(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const doc = odsDocument(state);
  const screen = currentScreen(state);
  if (screen.kind !== "printSettingsEditor") {
    throw new Error(
      "OdsPrintSettingsEditorScreen was rendered while the current screen was not a printSettingsEditor screen.",
    );
  }
  const { sheetIndex } = screen;

  const [editingField, setEditingField] = useState<FieldKey | undefined>(
    undefined,
  );
  const [draftText, setDraftText] = useState("");

  const sheet = doc.editor.sheets()[sheetIndex];
  const settings = sheet?.printSettings;

  const commit = (next: ContentSheetPrintSettings): void => {
    dispatch({
      type: "SET_SHEET_PRINT_SETTINGS",
      sheetIndex,
      printSettings: next,
    });
  };

  const { selectedIndex } = useNavigationInput({
    itemCount: FIELD_ROWS.length,
    onSelect: (index) => {
      if (settings === undefined) {
        return;
      }
      const row = FIELD_ROWS[index];
      if (row === undefined) {
        return;
      }
      if (NUMERIC_FIELD_KEYS.has(row.key)) {
        setDraftText(fieldValueText(settings, row.key));
        setEditingField(row.key);
        return;
      }
      commit(toggledSettings(settings, row.key));
    },
    onBack: () => {
      dispatch({ type: "POP_SCREEN" });
    },
    isActive: !anyOverlayOpen(state) && editingField === undefined,
  });

  if (sheet === undefined || settings === undefined) {
    return (
      <Box flexDirection="column">
        <Text color="yellow">There is no sheet at index {sheetIndex}.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>Print settings -- {sheet.name}</Text>
      <ListView
        items={FIELD_ROWS}
        selectedIndex={selectedIndex}
        renderItem={(row, isSelected) => (
          <Box>
            <Box width={LABEL_COLUMN_WIDTH}>
              <Text
                color={isSelected ? "cyan" : undefined}
                inverse={isSelected}
              >
                {row.label}
              </Text>
            </Box>
            {editingField === row.key ? (
              <TextField
                value={draftText}
                isFocused={!anyOverlayOpen(state)}
                onChange={setDraftText}
                onSubmit={(value) => {
                  const parsed = Number(value);
                  if (!Number.isFinite(parsed)) {
                    dispatch({
                      type: "SET_STATUS",
                      severity: "warning",
                      text: `"${value}" is not a valid number`,
                    });
                    return;
                  }
                  commit(withNumericField(settings, row.key, parsed));
                  setEditingField(undefined);
                }}
                onCancel={() => {
                  setEditingField(undefined);
                }}
              />
            ) : (
              <Text>{fieldValueText(settings, row.key)}</Text>
            )}
          </Box>
        )}
      />
      <Text dimColor>Enter to edit or toggle, Esc to go back</Text>
    </Box>
  );
}
