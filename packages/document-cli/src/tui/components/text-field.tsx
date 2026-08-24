import { useInput } from "ink";
import TextInput from "ink-text-input";
import type { ReactElement } from "react";

export interface TextFieldProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSubmit: (value: string) => void;
  readonly onCancel: () => void;
  readonly isFocused: boolean;
  readonly placeholder?: string;
}

// ink-text-input handles Enter (onSubmit) and editing keys but has no notion of cancelling -- Escape reaches its handler as an empty `input` string, so it neither submits nor inserts anything, which leaves Escape free for this wrapper to claim.
export function TextField(props: TextFieldProps): ReactElement {
  useInput(
    (_input, key) => {
      if (key.escape) {
        props.onCancel();
      }
    },
    { isActive: props.isFocused },
  );

  return (
    <TextInput
      value={props.value}
      placeholder={props.placeholder}
      focus={props.isFocused}
      onChange={props.onChange}
      onSubmit={props.onSubmit}
    />
  );
}
