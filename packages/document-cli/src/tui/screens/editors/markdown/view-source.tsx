import { Box, Text, useInput } from "ink";
import type { ReactElement } from "react";
import { useAppDispatch, useAppState } from "../../../state/context.js";
import { anyOverlayOpen, currentScreen } from "../../../state/types.js";

// A read-only screen reachable via the ':view-source' command, showing both `originalText` (the literal text this document was last opened/saved with -- see MarkdownOpenDocument's own doc comment: never mutated, never written back directly) and `doc.editor.toMarkdownText()` (what a save would write right now). These can genuinely differ even with zero edits made this session -- a heading-style, bullet-marker, or line-ending choice the writer normalises, or any construct README.md's own Gotchas table documents as lossy on the read side -- so both are shown side by side, labelled distinctly, rather than picking one and hiding the difference.
export function MarkdownViewSourceScreen(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const screen = currentScreen(state);
  const doc = state.openDocument;

  useInput(
    (_input, key) => {
      if (key.escape) {
        dispatch({ type: "POP_SCREEN" });
      }
    },
    { isActive: !anyOverlayOpen(state) && screen.kind === "viewSource" },
  );

  if (screen.kind !== "viewSource") {
    return (
      <Text color="red">
        MarkdownViewSourceScreen rendered outside a viewSource screen.
      </Text>
    );
  }
  if (doc?.format !== "markdown") {
    return (
      <Text color="red">view-source requires an open markdown document.</Text>
    );
  }

  const asItWillSaveNow = doc.editor.toMarkdownText();

  return (
    <Box flexDirection="column">
      <Text bold>As opened</Text>
      <Text>
        {doc.originalText ??
          "(this document was created fresh, with no original text to compare against)"}
      </Text>
      <Text bold>As it will save right now</Text>
      <Text>{asItWillSaveNow}</Text>
      <Text dimColor>Esc back</Text>
    </Box>
  );
}
