import { Box, Text, useInput } from "ink";
import type { ReactElement } from "react";
import { useAppDispatch, useAppState } from "../state/context.js";
import { anyOverlayOpen } from "../state/types.js";

// The very first screen: nothing is open yet, so there is no list to navigate -- just two entry points into the rest of the app. 'q'/Ctrl+C quit and the ':'/'/'/'?' overlays are already wired globally in app.tsx's AppShell; this screen only owns 'o' and 'n'.
export function LauncherScreen(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const isActive = !anyOverlayOpen(state);

  useInput(
    (input) => {
      if (input === "o") {
        dispatch({
          type: "PUSH_SCREEN",
          screen: { kind: "filePicker", purpose: "open", cwd: state.cwd },
        });
        return;
      }
      if (input === "n") {
        dispatch({
          type: "PUSH_SCREEN",
          screen: { kind: "newDocumentPicker" },
        });
      }
    },
    { isActive },
  );

  return (
    <Box flexDirection="column">
      <Text bold>document-cli</Text>
      <Text dimColor>
        A terminal editor for docx, pptx, odt, odp, ods, odg, markdown, odb and
        pdf -- xlsx, csv and svg open as read-only PDF previews.
      </Text>
      <Text> </Text>
      <Text>
        <Text color="cyan">o</Text> Open a document
      </Text>
      <Text>
        <Text color="cyan">n</Text> Create a new document
      </Text>
      <Text>
        <Text color="cyan">?</Text> Show all key bindings
      </Text>
      <Text>
        <Text color="cyan">q</Text> Quit
      </Text>
    </Box>
  );
}
