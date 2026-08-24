import { dirname, join } from "node:path";
import { Box, Text } from "ink";
import { useState, type ReactElement } from "react";
import { renderOdbReportTo } from "../../../format/render-odb-report.js";
import { TextField } from "../../../components/text-field.js";
import { describeError } from "../../../errors.js";
import { useAppDispatch, useAppState } from "../../../state/context.js";
import { anyOverlayOpen, currentScreen } from "../../../state/types.js";
import { requireOdbDocument } from "./shared.js";

// Which of the two fields currently owns the keyboard -- the identical two-field shape ExportOptionsScreen already uses, so the whole interaction ("type a path, press Enter twice") reads the same everywhere this TUI writes a file to disk.
type Field = "destination" | "fonts";

function defaultReportRenderDestination(
  odbPath: string,
  reportName: string,
): string {
  return join(dirname(odbPath), `${reportName}.pdf`);
}

// Comma-separated for the same reason ExportOptionsScreen's own font field is: a font path on macOS routinely contains spaces and almost never a comma.
function parseFontFileField(value: string): readonly string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

// Reached with Enter from report-detail.tsx (odbReportDetail), for the report the user was already looking at. This screen owns only the destination-path and font-file prompts; rendering itself, the fonts it loads, and the diagnostics it reports are exactly what src/tui/format/render-odb-report.ts's renderOdbReportTo already does. Unlike every mutating editor screen, submitting here never touches state.openDocument or dispatches a mutation -- a rendered report is an independent output file, so the only dispatches on success are the same status/diagnostics/pop sequence ExportOptionsScreen already uses.
export function OdbReportRenderScreen(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const isActive = !anyOverlayOpen(state);
  const doc = requireOdbDocument(state.openDocument);
  const screen = currentScreen(state);
  if (screen.kind !== "odbReportRender") {
    throw new Error(
      `OdbReportRenderScreen rendered while the current screen is "${screen.kind}", not "odbReportRender".`,
    );
  }
  const reportName = screen.reportName;

  const [destination, setDestination] = useState(() =>
    defaultReportRenderDestination(doc.path, reportName),
  );
  const [fontFiles, setFontFiles] = useState("");
  const [field, setField] = useState<Field>("destination");

  const cancel = (): void => {
    dispatch({ type: "POP_SCREEN" });
  };

  const submit = (): void => {
    void (async () => {
      let diagnosticCount = 0;
      try {
        await renderOdbReportTo(doc, destination, {
          reportName,
          fontFiles: parseFontFileField(fontFiles),
          onDiagnostic: (diagnostic) => {
            diagnosticCount += 1;
            dispatch({ type: "APPEND_DIAGNOSTIC", diagnostic });
          },
        });
        dispatch({
          type: "SET_STATUS",
          severity: "info",
          text: `Rendered "${reportName}" to ${destination}`,
        });
        // Diagnostics are first-class here too, matching ExportOptionsScreen: any produced by a successful render open the diagnostics panel immediately rather than leaving it to the status-line badge alone.
        if (diagnosticCount > 0) {
          dispatch({ type: "OPEN_OVERLAY", overlay: "diagnosticsPanel" });
        }
        dispatch({ type: "POP_SCREEN" });
      } catch (error) {
        dispatch({
          type: "OPEN_FILE_ERROR",
          message: `Could not render "${reportName}" to ${destination}`,
          detail: describeError(error),
        });
      }
    })();
  };

  return (
    <Box flexDirection="column">
      <Text bold>Render report: {reportName}</Text>
      <Box>
        <Text color="cyan">Path: </Text>
        <TextField
          value={destination}
          isFocused={isActive && field === "destination"}
          placeholder="destination path (.docx, .odt, or .pdf)"
          onChange={setDestination}
          onSubmit={() => {
            setField("fonts");
          }}
          onCancel={cancel}
        />
      </Box>
      <Box>
        <Text color="cyan">Fonts: </Text>
        <TextField
          value={fontFiles}
          isFocused={isActive && field === "fonts"}
          placeholder="optional .ttf/.otf paths, comma-separated -- pdf only"
          onChange={setFontFiles}
          onSubmit={submit}
          onCancel={cancel}
        />
      </Box>
      <Text dimColor>
        {field === "destination"
          ? "Enter for fonts, Esc to cancel"
          : "Enter to render, Esc to cancel. The destination's own extension picks docx/odt/pdf"}
      </Text>
    </Box>
  );
}
