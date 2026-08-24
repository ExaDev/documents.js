import { Box, Text } from "ink";
import { useState, type ReactElement } from "react";
import type { Box as GeometryBox, OdpShape, PptxShape } from "documents.js";
import { ListView } from "../../../components/list-view.js";
import { TextField } from "../../../components/text-field.js";
import { useNavigationInput } from "../../../keybindings/use-navigation-input.js";
import { useAppDispatch, useAppState } from "../../../state/context.js";
import {
  anyOverlayOpen,
  selectionKeyFor,
  type Screen,
} from "../../../state/types.js";
import {
  assertPresentationDocument,
  defaultShapeFrame,
} from "../../shared/slide-family.js";
import { RotationField } from "../odp/rotation-field.js";

export interface ShapeEditorScreenProps {
  readonly screen: Extract<Screen, { kind: "shapeEditor" }>;
}

const FIELD_KEYS = ["text", "x", "y", "width", "height", "rotation"] as const;
type FieldKey = (typeof FIELD_KEYS)[number];

const FIELD_LABELS: Readonly<Record<Exclude<FieldKey, "rotation">, string>> = {
  text: "Text",
  x: "X (pt)",
  y: "Y (pt)",
  width: "Width (pt)",
  height: "Height (pt)",
};

const POINT_DISPLAY_PRECISION = 100;

function formatPoints(value: number | undefined): string {
  return value === undefined
    ? "(unset)"
    : `${Math.round(value * POINT_DISPLAY_PRECISION) / POINT_DISPLAY_PRECISION}pt`;
}

function describeFieldValue(
  key: Exclude<FieldKey, "rotation">,
  shape: PptxShape | OdpShape,
): string {
  switch (key) {
    case "text": {
      const trimmed = shape.text.trim();
      return trimmed.length === 0 ? "(empty)" : trimmed;
    }
    case "x":
      return formatPoints(shape.frame?.xPt);
    case "y":
      return formatPoints(shape.frame?.yPt);
    case "width":
      return formatPoints(shape.frame?.widthPt);
    case "height":
      return formatPoints(shape.frame?.heightPt);
  }
}

// Rounded to the same precision `formatPoints`/`RotationField` display at, so what the user sees before pressing Enter to edit matches what they see after -- documents.js's own geometry/rotation setters can round-trip a clean input (15) into a value with floating-point noise (14.999999999999998, confirmed empirically against a real OdpShape), and seeding the draft with that raw noise would be a visible regression the moment someone opens a field they already set.
function roundForDisplay(value: number): number {
  return Math.round(value * POINT_DISPLAY_PRECISION) / POINT_DISPLAY_PRECISION;
}

function initialDraftFor(key: FieldKey, shape: PptxShape | OdpShape): string {
  if (key === "rotation") {
    const value = shape.rotationDeg;
    return value === undefined ? "" : String(roundForDisplay(value));
  }
  if (key === "text") {
    return shape.text;
  }
  const frame = shape.frame;
  switch (key) {
    case "x":
      return frame === undefined ? "" : String(roundForDisplay(frame.xPt));
    case "y":
      return frame === undefined ? "" : String(roundForDisplay(frame.yPt));
    case "width":
      return frame === undefined ? "" : String(roundForDisplay(frame.widthPt));
    case "height":
      return frame === undefined ? "" : String(roundForDisplay(frame.heightPt));
  }
}

interface FieldRowProps {
  readonly fieldKey: FieldKey;
  readonly shape: PptxShape | OdpShape;
  readonly isSelected: boolean;
  readonly isEditing: boolean;
  readonly draft: string;
  readonly onDraftChange: (value: string) => void;
  readonly onSubmit: (value: string) => void;
  readonly onCancel: () => void;
}

// A "multi-line text area" isn't achievable with the one text-input primitive this repo has (ink-text-input, single-line, Enter always submits -- see components/text-field.tsx) -- so editing genuinely happens one line at a time via TextField, but the un-edited VIEW of the text field renders the shape's real, un-flattened `.text` (embedded newlines and all) across as many Ink `<Text>` lines as it actually has, which is the closest a terminal gets to a text area for content that already spans several lines.
function FieldRow(props: FieldRowProps): ReactElement {
  const {
    fieldKey,
    shape,
    isSelected,
    isEditing,
    draft,
    onDraftChange,
    onSubmit,
    onCancel,
  } = props;

  if (fieldKey === "rotation") {
    return (
      <RotationField
        rotationDeg={shape.rotationDeg}
        isSelected={isSelected}
        isEditing={isEditing}
        draftValue={draft}
        onDraftChange={onDraftChange}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />
    );
  }

  if (isEditing) {
    return (
      <Box>
        <Text color="cyan">{FIELD_LABELS[fieldKey]}: </Text>
        <TextField
          value={draft}
          isFocused
          onChange={onDraftChange}
          onSubmit={onSubmit}
          onCancel={onCancel}
          placeholder={fieldKey === "text" ? "shape text" : "points"}
        />
      </Box>
    );
  }

  if (fieldKey === "text") {
    const trimmed = shape.text.trim();
    return (
      <Box flexDirection="column">
        <Text color={isSelected ? "cyan" : undefined} bold={isSelected}>
          Text:
        </Text>
        <Text dimColor={!isSelected}>
          {trimmed.length === 0 ? "  (empty)" : shape.text}
        </Text>
      </Box>
    );
  }

  return (
    <Text color={isSelected ? "cyan" : undefined} inverse={isSelected}>
      {FIELD_LABELS[fieldKey]}: {describeFieldValue(fieldKey, shape)}
    </Text>
  );
}

export function ShapeEditorScreen(props: ShapeEditorScreenProps): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const overlayOpen = anyOverlayOpen(state);
  const doc = assertPresentationDocument(state.openDocument);
  const { slideIndex, shapeIndex } = props.screen;
  const shape = doc.editor.slides()[slideIndex]?.shapes()[shapeIndex];

  const [editingField, setEditingField] = useState<FieldKey | undefined>(
    undefined,
  );
  const [draft, setDraft] = useState("");

  const { selectedIndex } = useNavigationInput({
    itemCount: shape === undefined ? 0 : FIELD_KEYS.length,
    isActive: !overlayOpen && editingField === undefined,
    onBack: () => {
      dispatch({ type: "POP_SCREEN" });
    },
    onSelect: (index) => {
      if (shape === undefined) {
        return;
      }
      const key = FIELD_KEYS[index];
      if (key === undefined) {
        return;
      }
      dispatch({
        type: "SET_SELECTION",
        key: selectionKeyFor(props.screen),
        index,
      });
      setDraft(initialDraftFor(key, shape));
      setEditingField(key);
    },
  });

  const cancelEdit = (): void => {
    setEditingField(undefined);
  };

  const submitEdit = (value: string): void => {
    if (shape === undefined || editingField === undefined) {
      return;
    }
    if (editingField === "text") {
      dispatch({
        type: "SET_SHAPE_TEXT",
        containerIndex: slideIndex,
        shapeIndex,
        text: value,
      });
      setEditingField(undefined);
      return;
    }
    if (editingField === "rotation") {
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        dispatch({
          type: "SET_SHAPE_ROTATION",
          containerIndex: slideIndex,
          shapeIndex,
          rotationDeg: undefined,
        });
        setEditingField(undefined);
        return;
      }
      const parsedRotation = Number(trimmed);
      if (Number.isNaN(parsedRotation)) {
        dispatch({
          type: "SET_STATUS",
          severity: "warning",
          text: `"${value}" is not a valid rotation in degrees`,
        });
        return;
      }
      dispatch({
        type: "SET_SHAPE_ROTATION",
        containerIndex: slideIndex,
        shapeIndex,
        rotationDeg: parsedRotation,
      });
      setEditingField(undefined);
      return;
    }
    const parsed = Number(value.trim());
    if (Number.isNaN(parsed)) {
      dispatch({
        type: "SET_STATUS",
        severity: "warning",
        text: `"${value}" is not a valid number of points`,
      });
      return;
    }
    const base: GeometryBox =
      shape.frame ?? defaultShapeFrame(doc.editor.slideSize);
    let frame: GeometryBox;
    switch (editingField) {
      case "x":
        frame = { ...base, xPt: parsed };
        break;
      case "y":
        frame = { ...base, yPt: parsed };
        break;
      case "width":
        frame = { ...base, widthPt: parsed };
        break;
      case "height":
        frame = { ...base, heightPt: parsed };
        break;
    }
    dispatch({
      type: "SET_SHAPE_FRAME",
      containerIndex: slideIndex,
      shapeIndex,
      frame,
    });
    setEditingField(undefined);
  };

  if (shape === undefined) {
    return (
      <Box flexDirection="column">
        <Text bold>
          Slide {slideIndex + 1}, shape {shapeIndex + 1}
        </Text>
        <Text color="yellow">
          This shape no longer exists -- press Esc to go back
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>
        Slide {slideIndex + 1}, shape {shapeIndex + 1}
      </Text>
      <ListView
        items={FIELD_KEYS}
        selectedIndex={selectedIndex}
        renderItem={(key, isSelected) => (
          <FieldRow
            fieldKey={key}
            shape={shape}
            isSelected={isSelected}
            isEditing={editingField === key}
            draft={draft}
            onDraftChange={setDraft}
            onSubmit={submitEdit}
            onCancel={cancelEdit}
          />
        )}
      />
      <Text dimColor>Enter: edit field Esc: back</Text>
    </Box>
  );
}
