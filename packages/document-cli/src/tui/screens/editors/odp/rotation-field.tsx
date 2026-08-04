import { Box, Text } from 'ink';
import type { ReactElement } from 'react';
import { TextField } from '../../../components/text-field.js';

export interface RotationFieldProps {
  readonly rotationDeg: number | undefined;
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

// Both PptxShape and OdpShape have a real `rotationDeg` getter/setter now, so this row is editable for every shape-host format that reaches it (pptx and odp share this component; odg's own rotation editing lives in shape-or-vector-detail.tsx's ShapeDetail) -- there is no per-format gate left to drive from the caller.
export function RotationField(props: RotationFieldProps): ReactElement {
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
