import { createOdp, createPptx, openOdp, openPptx } from 'documents.js';
import { Box } from 'ink';
import { render } from 'ink-testing-library';
import { useEffect, type ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { StatusLine } from '../../../components/status-line.js';
import { AppStateProvider, useAppDispatch, useAppState } from '../../../state/context.js';
import { currentScreen, type Screen } from '../../../state/types.js';
import { settle, waitForFrame } from '../../../test-support.js';
import { ShapeEditorScreen } from './shape-editor.js';

const ENTER_KEY = '\r';

function waitForText(lastFrame: () => string | undefined, text: string): Promise<string> {
  return waitForFrame(lastFrame, (frame) => frame.includes(text));
}

async function sendKey(stdin: { readonly write: (data: string) => void }, key: string): Promise<void> {
  await settle();
  stdin.write(key);
}

function buildOnePptxShapeBytes(): Uint8Array<ArrayBuffer> {
  const editor = createPptx();
  const slide = editor.addSlide();
  slide.addTextBox({ frame: { xPt: 10, yPt: 10, widthPt: 100, heightPt: 50 }, text: 'Title' });
  return editor.toBytes();
}

function buildOneOdpShapeBytes(): Uint8Array<ArrayBuffer> {
  const editor = createOdp();
  const slide = editor.addSlide();
  slide.addTextBox({ frame: { xPt: 10, yPt: 10, widthPt: 100, heightPt: 50 }, text: 'Title' });
  return editor.toBytes();
}

// Opens the test document AND pushes shapeEditor for its one shape in a single effect, so this harness has exactly one screen swap to settle -- ShapeEditorScreen itself, not an intermediate slideList/slideDetail hop this file has no interest in exercising.
function OpenAtShapeEditor({ format, bytes }: { readonly format: 'pptx' | 'odp'; readonly bytes: Uint8Array<ArrayBuffer> }): ReactElement | undefined {
  const dispatch = useAppDispatch();
  useEffect(() => {
    if (format === 'pptx') {
      dispatch({ type: 'OPEN_FILE_SUCCESS', path: 'test.pptx', doc: { format: 'pptx', editor: openPptx(bytes), path: 'test.pptx' } });
    } else {
      dispatch({ type: 'OPEN_FILE_SUCCESS', path: 'test.odp', doc: { format: 'odp', editor: openOdp(bytes), path: 'test.odp' } });
    }
    dispatch({ type: 'PUSH_SCREEN', screen: { kind: 'shapeEditor', slideIndex: 0, shapeIndex: 0 } });
  }, [format, bytes, dispatch]);
  return undefined;
}

function Harness({ format, bytes }: { readonly format: 'pptx' | 'odp'; readonly bytes: Uint8Array<ArrayBuffer> }): ReactElement {
  const state = useAppState();
  if (state.openDocument === undefined) {
    return <OpenAtShapeEditor format={format} bytes={bytes} />;
  }
  const screen: Screen = currentScreen(state);
  if (screen.kind !== 'shapeEditor') {
    return <OpenAtShapeEditor format={format} bytes={bytes} />;
  }
  // StatusLine alongside the screen, matching app.tsx's own shell layout -- SET_STATUS (the pptx rotation warning this file tests) renders through StatusLine, not through ShapeEditorScreen itself.
  return (
    <Box flexDirection="column">
      <ShapeEditorScreen screen={screen} />
      <StatusLine />
    </Box>
  );
}

function renderShapeEditor(format: 'pptx' | 'odp', bytes: Uint8Array<ArrayBuffer>): ReturnType<typeof render> {
  return render(
    <AppStateProvider>
      <Harness format={format} bytes={bytes} />
    </AppStateProvider>,
  );
}

describe('ShapeEditorScreen rotation row: pptx vs odp', () => {
  it('renders the rotation row greyed out for a pptx shape', async () => {
    const { lastFrame } = renderShapeEditor('pptx', buildOnePptxShapeBytes());
    const frame = await waitForText(lastFrame, 'Slide 1, shape 1');
    expect(frame).toContain('not available for pptx shapes');
    expect(frame).not.toContain('(unset)');
  });

  it('renders the rotation row as an editable, currently-unset value for an odp shape', async () => {
    const { lastFrame } = renderShapeEditor('odp', buildOneOdpShapeBytes());
    const frame = await waitForText(lastFrame, 'Slide 1, shape 1');
    expect(frame).toContain('Rotation: (unset)');
    expect(frame).not.toContain('not available for pptx shapes');
  });

  it('warns rather than opening an editor when Enter is pressed on the rotation row for a pptx shape', async () => {
    const { lastFrame, stdin } = renderShapeEditor('pptx', buildOnePptxShapeBytes());
    await waitForText(lastFrame, 'Slide 1, shape 1');

    // Field order is text, x, y, width, height, rotation -- five downs from the initial text-row selection lands on rotation.
    for (let i = 0; i < 5; i += 1) {
      await sendKey(stdin, 'j');
    }
    await sendKey(stdin, ENTER_KEY);
    const frame = await waitForText(lastFrame, 'documents.js has no rotation setter for a pptx shape');
    // Still on the field list, not inside a TextField editor -- the warning replaces entering edit mode, it doesn't precede it.
    expect(frame).not.toContain('Rotation (deg');
  });

  it('opens an editable rotation field on Enter for an odp shape and commits a value on submit', async () => {
    const { lastFrame, stdin } = renderShapeEditor('odp', buildOneOdpShapeBytes());
    await waitForText(lastFrame, 'Slide 1, shape 1');

    for (let i = 0; i < 5; i += 1) {
      await sendKey(stdin, 'j');
    }
    await sendKey(stdin, ENTER_KEY);
    await waitForText(lastFrame, 'Rotation (deg');

    await sendKey(stdin, '3');
    await sendKey(stdin, '0');
    await sendKey(stdin, ENTER_KEY);
    const frame = await waitForText(lastFrame, 'Rotation: 30°');
    expect(frame).not.toContain('Rotation (deg');
  });
});
