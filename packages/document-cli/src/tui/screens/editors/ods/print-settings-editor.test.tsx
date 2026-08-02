import { Box, Text } from 'ink';
import { render } from 'ink-testing-library';
import { useEffect, type ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { AppStateProvider, useAppDispatch, useAppState } from '../../../state/context.js';
import { settle, waitForFrame } from '../../../test-support.js';
import { OdsPrintSettingsEditorScreen } from './print-settings-editor.js';

function Harness(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const doc = state.openDocument;
  const top = state.stack.at(-1);

  useEffect(() => {
    if (doc === undefined) {
      dispatch({ type: 'CREATE_DOCUMENT', format: 'ods' });
      return;
    }
    if (doc.format === 'ods' && top?.kind === 'sheetList') {
      dispatch({ type: 'PUSH_SCREEN', screen: { kind: 'printSettingsEditor', sheetIndex: 0 } });
    }
  }, [doc, top, dispatch]);

  if (doc?.format !== 'ods' || top?.kind !== 'printSettingsEditor') {
    return <Text>loading</Text>;
  }
  return (
    <Box flexDirection="column">
      <OdsPrintSettingsEditorScreen />
      <Text>gridlines:{String(doc.editor.sheets()[0]?.printSettings.gridlines)}</Text>
    </Box>
  );
}

function renderHarness(): ReturnType<typeof render> {
  return render(
    <AppStateProvider>
      <Harness />
    </AppStateProvider>,
  );
}

describe('OdsPrintSettingsEditorScreen', () => {
  it('renders all five of OdsSheet.printSettings own guaranteed fields', async () => {
    const { lastFrame } = renderHarness();
    const frame = await waitForFrame(lastFrame, (candidate) => candidate.includes('Page width (pt)'));
    for (const label of ['Page height (pt)', 'Margin top (pt)', 'Margin right (pt)', 'Margin bottom (pt)', 'Margin left (pt)', 'Gridlines', 'Headers', 'Page order']) {
      expect(frame).toContain(label);
    }
  });

  it('toggles gridlines on Enter and commits through the reducer to the real OdsSheet.printSettings setter', async () => {
    const { lastFrame, stdin } = renderHarness();
    await waitForFrame(lastFrame, (candidate) => candidate.includes('gridlines:false'));
    await settle();

    // Down six times from the first row (pageWidthPt) reaches the Gridlines row (index 6 in FIELD_ROWS) -- settle() between each write for the same reason test-support.ts documents.
    for (let index = 0; index < 6; index += 1) {
      stdin.write('j');
      await settle();
    }
    stdin.write('\r');

    await waitForFrame(lastFrame, (candidate) => candidate.includes('gridlines:true'));
  });
});
