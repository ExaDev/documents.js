import { Box, Text } from 'ink';
import type { ReactElement } from 'react';
import { TextField } from '../../../components/text-field.js';

export interface RotationFieldProps {
  readonly rotationDeg: number | undefined;
  readonly isEditable: boolean;
  readonly isSelected: boolean;
  readonly isEditing: boolean;
  readonly draftValue: string;
  readonly onDraftChange: (value: string) => void;
  readonly onSubmit: (value: string) => void;
  readonly onCancel: () => void;
}

const ROTATION_DISPLAY_PRECISION = 100;

function formatRotationDeg(value: number | undefined): string {
  return value === undefined ? '(unset)' : `${Math.round(value * ROTATION_DISPLAY_PRECISION) / ROTATION_DISPLAY_PRECISION}°`;
}

// PptxShape genuinely has no `rotationDeg` property at all -- confirmed against the installed .d.ts -- documents.js has no way to rotate a pptx shape, so this row is always rendered rather than omitted (a caller should never have to guess whether rotation exists), but stays inert for a pptx document: it never enters edit mode, and there is nothing this component's own props can do to change that. `isEditable` is driven entirely by the caller's own document-format check (see pptx/shape-editor.tsx), not by anything this component inspects itself.
export function RotationField(props: RotationFieldProps): ReactElement {
  if (!props.isEditable) {
    return <Text dimColor>[R] Rotation: not available for pptx shapes</Text>;
  }

  if (props.isEditing) {
    return (
      <Box>
        <Text color="cyan">[R] Rotation (deg, blank to unset): </Text>
        <TextField value={props.draftValue} isFocused onChange={props.onDraftChange} onSubmit={props.onSubmit} onCancel={props.onCancel} />
      </Box>
    );
  }

  return (
    <Text color={props.isSelected ? 'cyan' : undefined} inverse={props.isSelected}>
      [R] Rotation: {formatRotationDeg(props.rotationDeg)}
    </Text>
  );
}
