import { Box, Text } from 'ink';
import { render } from 'ink-testing-library';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExportToPdfOptions } from '../format/export-pdf.js';
import { type defaultPdfPathFor, exportToPdf } from '../format/export-pdf.js';
import { AppStateProvider, useAppState } from '../state/context.js';
import type { OpenDocument } from '../state/types.js';
import { ExportOptionsScreen } from './export-options.js';
import { NewDocumentPickerScreen } from './new-document-picker.js';

// A type guard against the two already-imported bindings' own real types, not an inline `import('../format/export-pdf.js')` type query -- avoids needing any project-wide consistent-type-imports exception for this one test file, and is a genuine runtime check besides, unlike an unverified generic type parameter on importOriginal().
function isExportPdfModule(value: unknown): value is { exportToPdf: typeof exportToPdf; defaultPdfPathFor: typeof defaultPdfPathFor } {
  return typeof value === 'object' && value !== null && 'exportToPdf' in value && 'defaultPdfPathFor' in value;
}

vi.mock('../format/export-pdf.js', async (importOriginal) => {
  const actual = await importOriginal();
  if (!isExportPdfModule(actual)) {
    throw new Error('../format/export-pdf.js mock: importOriginal() returned an unexpected shape');
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
      <Text>diagnosticsPanelOpen:{String(state.overlays.diagnosticsPanel)}</Text>
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
  rendered.stdin.write('\r');
  await vi.waitFor(() => {
    expect(rendered.lastFrame()).toContain('diagnosticsPanelOpen:false');
  });
  return rendered;
}

describe('ExportOptionsScreen', () => {
  beforeEach(() => {
    vi.mocked(exportToPdf).mockClear();
  });

  it('opens the diagnostics panel automatically when the export reports a diagnostic', async () => {
    vi.mocked(exportToPdf).mockImplementationOnce((_document: OpenDocument, _destination: string, options: ExportToPdfOptions) => {
      options.onDiagnostic({ severity: 'info', message: 'Substituted "?" for "*"' });
      return Promise.resolve();
    });

    const { lastFrame, stdin } = await renderWithOpenDocument();

    stdin.write('out.pdf');
    stdin.write('\r');

    await vi.waitFor(() => {
      expect(lastFrame()).toContain('diagnosticsPanelOpen:true');
    });
  });

  it('leaves the diagnostics panel closed when the export reports nothing', async () => {
    const mockedExport = vi.mocked(exportToPdf);
    mockedExport.mockImplementationOnce(() => Promise.resolve());

    const { lastFrame, stdin } = await renderWithOpenDocument();

    stdin.write('clean.pdf');
    stdin.write('\r');

    await vi.waitFor(() => {
      expect(mockedExport).toHaveBeenCalledTimes(1);
    });
    expect(lastFrame()).toContain('diagnosticsPanelOpen:false');
  });
});
