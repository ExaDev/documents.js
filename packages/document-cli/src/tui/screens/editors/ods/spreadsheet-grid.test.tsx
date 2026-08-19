import { readOdsContent } from 'documents.js';
import { Box, Text } from 'ink';
import { render } from 'ink-testing-library';
import { useEffect, type ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { AppStateProvider, useAppDispatch, useAppState } from '../../../state/context.js';
import { settle, waitForFrame } from '../../../test-support.js';
import { OdsSpreadsheetGridScreen } from './spreadsheet-grid.js';

// Creates a fresh ods workbook, seeds a cell at row 2/column 2 (C3) directly through the live `OdsSheet.cell()` setter -- test setup, not the behaviour under test, exactly like reducer.test.ts's own direct-editor assertions -- so the grid has a real 3x3 extent to navigate across rather than the 1x1 a brand-new sheet starts with, then pushes the spreadsheetGrid screen. Exposes the current screen stack's top and cell A1's own live value as probes.
function GridHarness(): ReactElement {
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
      const sheet = doc.editor.sheets()[0];
      if (sheet !== undefined) {
        sheet.cell(2, 2).value = { kind: 'string', value: 'seed' };
      }
      dispatch({ type: 'PUSH_SCREEN', screen: { kind: 'spreadsheetGrid', sheetIndex: 0 } });
    }
  }, [doc, top, dispatch]);

  if (doc?.format !== 'ods' || top?.kind !== 'spreadsheetGrid') {
    return <Text>loading</Text>;
  }

  // A1's own colSpan/rowSpan after a merge, read fresh through readOdsContent on every render -- the same "display-unsafe live accessor, read through the content pivot" convention this screen's own resolveSheet already follows (see shared.ts), used here purely as a test probe.
  const content = readOdsContent(doc.editor.toPackage());
  const anchor = content.kind === 'spreadsheet' ? content.sheets[0]?.cells.find((cell) => cell.row === 0 && cell.column === 0) : undefined;

  return (
    <Box flexDirection="column">
      <OdsSpreadsheetGridScreen />
      <Text>top:{top.kind}</Text>
      <Text>cellA1:{JSON.stringify(doc.editor.sheets()[0]?.cell(0, 0).value)}</Text>
      <Text>anchorSpan:{anchor?.colSpan ?? 1}x{anchor?.rowSpan ?? 1}</Text>
    </Box>
  );
}

function renderHarness(): ReturnType<typeof render> {
  return render(
    <AppStateProvider>
      <GridHarness />
    </AppStateProvider>,
  );
}

describe('OdsSpreadsheetGridScreen', () => {
  it('moves the cell cursor literally on hjkl/arrows instead of the generic back/select list convention', async () => {
    const { lastFrame, stdin } = renderHarness();

    let frame = await waitForFrame(lastFrame, (candidate) => candidate.includes('A1'));
    expect(frame).toContain('top:spreadsheetGrid');
    await settle();

    // The generic ListView convention treats 'l' as "open/select the highlighted item" -- this screen deliberately overrides it to mean "move right".
    stdin.write('l');
    frame = await waitForFrame(lastFrame, (candidate) => candidate.includes('B1'));
    expect(frame).toContain('top:spreadsheetGrid');
    expect(frame).not.toContain('Enter to commit');
    await settle();

    stdin.write('j');
    await waitForFrame(lastFrame, (candidate) => candidate.includes('B2'));
    await settle();

    // The generic convention treats 'h' as "go back" (popping the screen). It must not here -- the screen stays on top and the cursor simply moves left.
    stdin.write('h');
    frame = await waitForFrame(lastFrame, (candidate) => candidate.includes('A2'));
    expect(frame).toContain('top:spreadsheetGrid');
    await settle();

    stdin.write('k');
    frame = await waitForFrame(lastFrame, (candidate) => candidate.includes('A1'));
    expect(frame).toContain('top:spreadsheetGrid');
  });

  it('round-trips a type-to-edit commit through the reducer to the real OdsCell.value', async () => {
    const { lastFrame, stdin } = renderHarness();
    await waitForFrame(lastFrame, (candidate) => candidate.includes('A1'));
    await settle();

    // A leading digit seeds the inline editor with an inferred 'number' kind, per the brief.
    stdin.write('4');
    const seededFrame = await waitForFrame(lastFrame, (candidate) => candidate.includes('Enter to commit'));
    expect(seededFrame).toContain('[N]');
    // OdsCellEditor's own TextField has just mounted for the first time -- see test-support.ts, and settle() again between its own writes for the same reason.
    await settle();

    stdin.write('2');
    await settle();
    stdin.write('\r');

    const frame = await waitForFrame(lastFrame, (candidate) => candidate.includes('cellA1:{"kind":"number","value":42}'));
    expect(frame).not.toContain('Enter to commit');
  });

  it('merges a real rectangle of cells via the range-select-then-merge flow (m to anchor, move, m to commit)', async () => {
    const { lastFrame, stdin } = renderHarness();
    let frame = await waitForFrame(lastFrame, (candidate) => candidate.includes('A1'));
    expect(frame).toContain('anchorSpan:1x1');
    await settle();

    // Seed A1 with a real string so the merged cell keeps something visible after committing.
    stdin.write('T');
    await waitForFrame(lastFrame, (candidate) => candidate.includes('Enter to commit'));
    await settle();
    stdin.write('otal');
    await settle();
    stdin.write('\r');
    await waitForFrame(lastFrame, (candidate) => candidate.includes('cellA1:{"kind":"string","value":"Total"}'));
    await settle();

    // Anchor the merge at A1, move to B2 (the opposite corner), then commit.
    stdin.write('m');
    frame = await waitForFrame(lastFrame, (candidate) => candidate.includes('m/Enter to merge'));
    // The hint text switched to the pending-merge variant.
    expect(frame).not.toContain('to anchor a merge');
    await settle();

    stdin.write('l');
    await settle();
    stdin.write('j');
    await settle();

    stdin.write('m');
    frame = await waitForFrame(lastFrame, (candidate) => candidate.includes('anchorSpan:2x2'));
    expect(frame).toContain('to anchor a merge');
    expect(frame).toContain('cellA1:{"kind":"string","value":"Total"}');
  });

  it('cancels a pending merge on Escape without touching the document', async () => {
    const { lastFrame, stdin } = renderHarness();
    await waitForFrame(lastFrame, (candidate) => candidate.includes('anchorSpan:1x1'));
    await settle();

    stdin.write('m');
    await waitForFrame(lastFrame, (candidate) => candidate.includes('m/Enter to merge'));
    await settle();

    stdin.write('\x1B');
    const frame = await waitForFrame(lastFrame, (candidate) => candidate.includes('to anchor a merge'));
    expect(frame).toContain('anchorSpan:1x1');
    // Esc cancelled the pending merge only -- the screen itself is still on top, not popped.
    expect(frame).toContain('top:spreadsheetGrid');
  });

  it('switches to the compact non-empty-cells list on "t" and back to the grid', async () => {
    const { lastFrame, stdin } = renderHarness();
    await waitForFrame(lastFrame, (candidate) => candidate.includes('t compact list view'));
    await settle();

    stdin.write('t');
    const compactFrame = await waitForFrame(lastFrame, (candidate) => candidate.includes('t grid view'));
    // The seeded cell at row 2/column 2 shows up as a real compact-list row.
    expect(compactFrame).toContain('C3');
    await settle();

    stdin.write('t');
    await waitForFrame(lastFrame, (candidate) => candidate.includes('t compact list view'));
  });
});
