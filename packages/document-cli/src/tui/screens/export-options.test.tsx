import { Box, Text } from "ink";
import { render } from "ink-testing-library";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExportToPdfOptions } from "../format/export-pdf.js";
import { type defaultPdfPathFor, exportToPdf } from "../format/export-pdf.js";
import { AppStateProvider, useAppState } from "../state/context.js";
import type { OpenDocument } from "../state/types.js";
import { ExportOptionsScreen } from "./export-options.js";
import { NewDocumentPickerScreen } from "./new-document-picker.js";

// A type guard against the two already-imported bindings' own real types, not an inline `import('../format/export-pdf.js')` type query -- avoids needing any project-wide consistent-type-imports exception for this one test file, and is a genuine runtime check besides, unlike an unverified generic type parameter on importOriginal().
function isExportPdfModule(value: unknown): value is {
  exportToPdf: typeof exportToPdf;
  defaultPdfPathFor: typeof defaultPdfPathFor;
} {
  return (
    typeof value === "object" &&
    value !== null &&
    "exportToPdf" in value &&
    "defaultPdfPathFor" in value
  );
}

vi.mock("../format/export-pdf.js", async (importOriginal) => {
  const actual = await importOriginal();
  if (!isExportPdfModule(actual)) {
    throw new Error(
      "../format/export-pdf.js mock: importOriginal() returned an unexpected shape",
    );
  }
  return { ...actual, exportToPdf: vi.fn(() => Promise.resolve()) };
});

// A tiny stand-in for app.tsx's own router: shows the new-document picker until a document exists (a real editable document is what actually gates the 'e' export binding in the app), then swaps to the screen under test, alongside a probe line exposing whether the diagnostics-panel overlay is open.
function Harness(): ReactElement {
  const state = useAppState();
  if (state.openDocument === undefined) {
    return <NewDocumentPickerScreen />;
  }
  return (
    <Box flexDirection="column">
      <ExportOptionsScreen />
      <Text>
        diagnosticsPanelOpen:{String(state.overlays.diagnosticsPanel)}
      </Text>
    </Box>
  );
}

async function renderWithOpenDocument(): Promise<ReturnType<typeof render>> {
  const rendered = render(
    <AppStateProvider>
      <Harness />
    </AppStateProvider>,
  );
  // Selects the first creatable format (docx) so a real document backs the export.
  rendered.stdin.write("\r");
  await vi.waitFor(() => {
    expect(rendered.lastFrame()).toContain("diagnosticsPanelOpen:false");
  });
  return rendered;
}

// The screen is a two-field form: Enter on the destination field moves focus to the font-file field, Enter there exports. Both Enters cannot be written back to back -- focus moves on a state change, so the second keystroke has to wait for the re-render that actually hands the font field the keyboard, exactly as a real user's second keypress does. The hint line is what says which field is live, so it is what this waits on.
const SUBMIT = "\r";
const FONTS_FIELD_HINT = "Enter to export";

async function advanceToFontsField(
  rendered: ReturnType<typeof render>,
): Promise<void> {
  rendered.stdin.write(SUBMIT);
  await vi.waitFor(() => {
    expect(rendered.lastFrame()).toContain(FONTS_FIELD_HINT);
  });
}

describe("ExportOptionsScreen", () => {
  beforeEach(() => {
    vi.mocked(exportToPdf).mockClear();
  });

  it("opens the diagnostics panel automatically when the export reports a diagnostic", async () => {
    vi.mocked(exportToPdf).mockImplementationOnce(
      (
        _document: OpenDocument,
        _destination: string,
        options: ExportToPdfOptions,
      ) => {
        options.onDiagnostic({
          severity: "info",
          message: 'Substituted "?" for "*"',
        });
        return Promise.resolve();
      },
    );

    const rendered = await renderWithOpenDocument();

    rendered.stdin.write("out.pdf");
    await advanceToFontsField(rendered);
    rendered.stdin.write(SUBMIT);

    await vi.waitFor(() => {
      expect(rendered.lastFrame()).toContain("diagnosticsPanelOpen:true");
    });
  });

  it("leaves the diagnostics panel closed when the export reports nothing", async () => {
    const mockedExport = vi.mocked(exportToPdf);
    mockedExport.mockImplementationOnce(() => Promise.resolve());

    const rendered = await renderWithOpenDocument();

    rendered.stdin.write("clean.pdf");
    await advanceToFontsField(rendered);
    rendered.stdin.write(SUBMIT);

    await vi.waitFor(() => {
      expect(mockedExport).toHaveBeenCalledTimes(1);
    });
    expect(rendered.lastFrame()).toContain("diagnosticsPanelOpen:false");
  });

  it("passes no fonts at all when the font field is left empty", async () => {
    const mockedExport = vi.mocked(exportToPdf);
    mockedExport.mockImplementationOnce(() => Promise.resolve());

    const rendered = await renderWithOpenDocument();

    rendered.stdin.write("plain.pdf");
    await advanceToFontsField(rendered);
    rendered.stdin.write(SUBMIT);

    await vi.waitFor(() => {
      expect(mockedExport).toHaveBeenCalledTimes(1);
    });
    expect(mockedExport.mock.calls[0]?.[2].fontFiles).toStrictEqual([]);
  });

  it("threads every font path typed into the font field through to the export", async () => {
    const mockedExport = vi.mocked(exportToPdf);
    mockedExport.mockImplementationOnce(() => Promise.resolve());

    const rendered = await renderWithOpenDocument();

    rendered.stdin.write("branded.pdf");
    await advanceToFontsField(rendered);
    // Deliberately typed the way a user would rather than as an already-clean list: a trailing space after the comma, which the field's own parsing has to trim off, and a path containing a space, which it must not split on.
    const typed = "/fonts/Brand-Regular.ttf, /fonts/Brand Bold.ttf";
    rendered.stdin.write(typed);
    // Waited for the same reason the Enter between the two fields is: the field's value is React state, so a submit issued in the same tick as the keystrokes would run against the value the field held before them.
    await vi.waitFor(() => {
      expect(rendered.lastFrame()).toContain(typed);
    });
    rendered.stdin.write(SUBMIT);

    await vi.waitFor(() => {
      expect(mockedExport).toHaveBeenCalledTimes(1);
    });
    const call = mockedExport.mock.calls[0];
    // The destination field starts pre-filled with the default export path and the cursor at its end, so typed text appends to it rather than replacing it -- unchanged behaviour, asserted here only to show the destination and the fonts stayed in their own fields.
    expect(call?.[1]).toMatch(/branded\.pdf$/);
    expect(call?.[2].fontFiles).toStrictEqual([
      "/fonts/Brand-Regular.ttf",
      "/fonts/Brand Bold.ttf",
    ]);
  });
});
