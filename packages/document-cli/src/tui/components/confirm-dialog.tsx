import { Box, Text, useInput } from 'ink';
import type { ReactElement } from 'react';

export interface ConfirmDialogProps {
  readonly message: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

export function ConfirmDialog(props: ConfirmDialogProps): ReactElement {
  useInput((input, key) => {
    if (input === 'y' || input === 'Y' || key.return) {
      props.onConfirm();
      return;
    }
    if (input === 'n' || input === 'N' || key.escape) {
      props.onCancel();
    }
  });

  return (
    <Box borderStyle="round" flexDirection="column" paddingX={1}>
      <Text>{props.message}</Text>
      <Text dimColor>y / Enter to confirm, n / Esc to cancel</Text>
    </Box>
  );
}
