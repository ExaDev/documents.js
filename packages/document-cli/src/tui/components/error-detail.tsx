import { Box, Text, useInput } from "ink";
import type { ReactElement } from "react";
import { useAppDispatch, useAppState } from "../state/context.js";

// Extracted so its own undefined/ReactElement branching is directly assertable on the return value — ink renders an empty <Text>{undefined}</Text> identically to omitting the node outright (an empty child contributes no visible row), so a rendered-frame assertion alone can never distinguish "correctly omitted" from "always rendered, just empty this time".
export function detailNode(
  detail: string | undefined,
): ReactElement | undefined {
  return detail === undefined ? undefined : <Text>{detail}</Text>;
}

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
      {detailNode(errorDetail.detail)}
      <Text dimColor>Esc or Enter to dismiss</Text>
    </Box>
  );
}
