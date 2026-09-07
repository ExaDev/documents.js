import { Box, Text, useInput } from "ink";
import type { ReactElement } from "react";
import { formatMetadataLines } from "../../../runtime/metadata-format.js";
import { metadataFor } from "../../format/read-metadata.js";
import { useAppDispatch, useAppState } from "../../state/context.js";
import { anyOverlayOpen } from "../../state/types.js";

// A deliberately read-only screen, reachable for any open document ('m' from app.tsx's own shell-level global useInput). documents.js's DocxEditor/OdtEditor/PptxEditor/OdpEditor/OdsEditor/OdgEditor now DO each expose a real `editor.metadata = {...}` setter, the same live-view/patch-in-place pattern `run.bold = true` already follows (ExaDev/documents.js#933) -- so the documents.js-level gap this screen used to be blocked on is closed. Wiring an actual edit flow through it (a form/prompt committing through that setter, mirroring how other live-edit screens dispatch into the reducer) is still a separate, not-yet-done piece of TUI work, tracked as its own follow-up rather than attempted here -- this screen still only shows what a document's own metadata currently is.
export function MetadataScreen(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const doc = state.openDocument;

  useInput(
    (input, key) => {
      if (key.escape || key.leftArrow || input === "h") {
        dispatch({ type: "POP_SCREEN" });
      }
    },
    { isActive: doc !== undefined && !anyOverlayOpen(state) },
  );

  if (doc === undefined) {
    return <Text color="red">MetadataScreen requires an open document.</Text>;
  }

  let lines: readonly string[] | undefined;
  let errorMessage: string | undefined;
  try {
    lines = formatMetadataLines(metadataFor(doc));
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
  }

  return (
    <Box flexDirection="column">
      <Text bold>Document metadata ({doc.format})</Text>
      {errorMessage !== undefined ? (
        <Text color="yellow">{errorMessage}</Text>
      ) : lines !== undefined && lines.length > 0 ? (
        lines.map((line) => <Text key={line}>{line}</Text>)
      ) : (
        <Text dimColor>This document carries no metadata.</Text>
      )}
      <Text dimColor>Esc / ← / h to go back</Text>
    </Box>
  );
}
