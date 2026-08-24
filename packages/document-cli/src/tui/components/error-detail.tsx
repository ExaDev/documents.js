import { Box, Text, useInput } from "ink";
import type { ReactElement } from "react";
import { useAppDispatch, useAppState } from "../state/context.js";

// Reads `state.errorDetail`, which is its own visibility flag: non-undefined means this overlay is showing. The app shell renders it only in that case, so the empty branch below is what a caller sees if it renders the component unconditionally.
export function ErrorDetail(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();

  useInput((_input, key) => {
    if (key.escape || key.return) {
      dispatch({ type: "DISMISS_ERROR_DETAIL" });
    }
  });

  const errorDetail = state.errorDetail;
  if (errorDetail === undefined) {
    return <Box />;
  }

  return (
    <Box borderStyle="round" flexDirection="column" paddingX={1}>
      <Text bold color="red">
        {errorDetail.message}
      </Text>
      {errorDetail.detail === undefined ? undefined : (
        <Text>{errorDetail.detail}</Text>
      )}
      <Text dimColor>Esc or Enter to dismiss</Text>
    </Box>
  );
}
