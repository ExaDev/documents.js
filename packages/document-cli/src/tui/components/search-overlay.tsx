import { Box, Text } from "ink";
import { useState, type ReactElement } from "react";
import { useAppDispatch, useAppState } from "../state/context.js";
import { TextField } from "./text-field.js";

// THE SEARCH CONTRACT, kept as small as it can usefully be for v1: this overlay owns nothing but the query string, which it writes to `state.searchQuery`. Every screen filters its OWN rows by case-insensitive substring while that string is non-empty, and clears nothing -- the query survives until the user submits an empty one or the document is closed. The alternative considered and rejected was a registry in which the top-of-stack screen publishes its visible row text through a context or ref for a central filter to consume: that makes every screen responsible for keeping a duplicate of its own rows in sync with the live editor tree, which is exactly the caching hazard the live-view rule in state/types.ts forbids.
export function SearchOverlay(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const [query, setQuery] = useState(state.searchQuery);

  const close = (): void => {
    dispatch({ type: "CLOSE_OVERLAY", overlay: "search" });
  };

  return (
    <Box borderStyle="round" flexDirection="column" paddingX={1}>
      <Box>
        <Text color="cyan">/ </Text>
        <TextField
          value={query}
          isFocused
          placeholder="filter this screen"
          onChange={(value) => {
            setQuery(value);
            dispatch({ type: "SET_SEARCH_QUERY", query: value });
          }}
          onSubmit={close}
          onCancel={() => {
            dispatch({ type: "SET_SEARCH_QUERY", query: "" });
            close();
          }}
        />
      </Box>
      <Text dimColor>Enter to keep the filter, Esc to clear it</Text>
    </Box>
  );
}
