import { Box, Text } from 'ink';
import { useState, type ReactElement } from 'react';
import { TextField } from '../../components/text-field.js';

// A generic sequential-field text-entry wizard: originally local to odg/page-detail.tsx (the odg add-item flow), extracted here once paragraph-detail.tsx's own image-insertion wizard and paragraph-family.tsx's own odt formula-frame wizard needed the identical "walk a fixed list of labelled text fields, one TextField at a time, collect them into a Record" shape. Every caller supplies its own field list and reads the finished record back through `requireFieldValue` below.

export interface FieldSpec {
  readonly key: string;
  readonly label: string;
  readonly defaultValue: string;
}

// A field wizard walks every field of its own field list in order and always records a value (its own default at minimum) before advancing, so a missing key at build time indicates a bug in that walk, not a legitimate empty state -- throwing here, rather than substituting a silent default, surfaces that bug instead of building a wrong action from it.
export function requireFieldValue(values: Readonly<Record<string, string>>, key: string): string {
  const value = values[key];
  if (value === undefined) {
    throw new Error(`Field wizard field '${key}' was never recorded before building the action.`);
  }
  return value;
}

export function FieldWizard(props: { readonly fields: readonly FieldSpec[]; readonly onCancel: () => void; readonly onComplete: (values: Readonly<Record<string, string>>) => void }): ReactElement {
  const [stepIndex, setStepIndex] = useState(0);
  const [collected, setCollected] = useState<Record<string, string>>({});
  const initialField = props.fields[0];
  const [draft, setDraft] = useState(initialField === undefined ? '' : initialField.defaultValue);

  const field = props.fields[stepIndex];
  if (field === undefined) {
    throw new Error(`FieldWizard stepIndex ${stepIndex} is out of range for ${props.fields.length} fields -- onComplete always fires before stepIndex can advance past the last field, so this indicates a bug in that advance.`);
  }

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1}>
      <Text bold>{field.label}</Text>
      <TextField
        value={draft}
        isFocused
        onChange={setDraft}
        onCancel={props.onCancel}
        onSubmit={(value) => {
          const recorded = { ...collected, [field.key]: value };
          const nextIndex = stepIndex + 1;
          const nextField = props.fields[nextIndex];
          if (nextField === undefined) {
            props.onComplete(recorded);
            return;
          }
          setCollected(recorded);
          setDraft(nextField.defaultValue);
          setStepIndex(nextIndex);
        }}
      />
      <Text dimColor>
        Step {stepIndex + 1} of {props.fields.length} -- Enter to continue, Esc to cancel
      </Text>
    </Box>
  );
}
