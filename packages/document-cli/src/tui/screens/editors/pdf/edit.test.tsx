import type { LayoutDocument } from 'documents.js';
import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';
import { settle, waitForFrame } from '../../../test-support.js';
import { PdfHarness } from './test-support.js';

interface Stdin {
  readonly write: (data: string) => void;
}
type LastFrame = () => string | undefined;

// A single text item, deliberately smaller than navigation.test.tsx's own three-item SAMPLE_LAYOUT: these tests drive real keystrokes through PdfPageItemsScreen's add-item flow and PdfItemDetailScreen's field editor, and a shorter starting document keeps the item-count/index arithmetic each test asserts against easy to follow.
const SAMPLE_LAYOUT: LayoutDocument = {
  formatVersion: 1,
  metadata: {},
  images: {},
  pages: [
    {
      widthPt: 612,
      heightPt: 792,
      items: [{ kind: 'text', text: 'Hi', xPt: 10, yPt: 20, font: { family: 'Helvetica', weight: 'normal', style: 'normal' }, sizePt: 12, color: { r: 0, g: 0, b: 0 } }],
    },
  ],
};

const ENTER = '\r';
const BACKSPACE = '\x7F';

// Matching docx/paragraph-detail.test.tsx's own SETTLE_TICKS/flush pattern: several `setImmediate` ticks, not a real timer wait, so a rapid run of backspaces reaches ink-text-input's own reconciled state one keystroke at a time rather than being coalesced or dropped.
const SETTLE_TICKS = 4;

async function flush(): Promise<void> {
  await Array.from({ length: SETTLE_TICKS }).reduce<Promise<void>>(
    (previous) =>
      previous.then(
        () =>
          new Promise<void>((resolve) => {
            setImmediate(resolve);
          }),
      ),
    Promise.resolve(),
  );
}

// Clears a TextField's own pre-filled draft (the cursor starts at its end) with `count` backspaces, then types `value` fresh and waits for it to actually reach the rendered frame before returning -- see paragraph-detail.test.tsx's own identical helper for the empirically-observed races this closes.
async function replaceField(stdin: Stdin, lastFrame: LastFrame, count: number, value: string): Promise<void> {
  for (let step = 0; step < count; step += 1) {
    stdin.write(BACKSPACE);
    await flush();
  }
  stdin.write(value);
  await vi.waitFor(() => {
    expect(lastFrame()).toContain(value);
  });
}

// Navigates a fresh harness from pdfPageList all the way down to pdfItemDetail for the fixture's one item, then moves the selection down `rowsDown` rows -- shared by every test below so each one starts from an identical, freshly-rendered state rather than chaining edits (and their own settle()/race-avoidance overhead) across a single long-running test. Row order in EditableItemDetail's own rows for a text item: 0 Text, 1 X, 2 Y, 3 Font family, 4 Font weight, 5 Font style, 6 Size, 7 Colour, 8 Width, 9 Rotation, 10 Underline.
async function openItemDetailRow(stdin: Stdin, lastFrame: LastFrame, rowsDown: number): Promise<void> {
  await waitForFrame(lastFrame, (candidate) => candidate.includes('Page 1'));
  await settle();

  stdin.write(ENTER); // pdfPageList -> pdfPageItems
  await waitForFrame(lastFrame, (candidate) => candidate.includes('Page 1 items'));
  await settle();

  stdin.write(ENTER); // pdfPageItems -> pdfItemDetail (a real field editor, since the harness opens a genuine 'pdf'-format document)
  await waitForFrame(lastFrame, (candidate) => candidate.includes('Page 1, item 1'));
  await settle();

  for (let step = 0; step < rowsDown; step += 1) {
    stdin.write('j');
    await settle();
  }
}

describe('PDF item editing via PdfItemDetailScreen', () => {
  it('edits the text field, and the change is a real dispatch through the live PdfEditor, not merely a rendered draft', async () => {
    const { lastFrame, stdin } = render(<PdfHarness layout={SAMPLE_LAYOUT} />);
    await openItemDetailRow(stdin, lastFrame, 0);

    expect(lastFrame()).toContain('Text: Hi');
    stdin.write(ENTER);
    await waitForFrame(lastFrame, (candidate) => candidate.includes('Text: Hi')); // the field-edit box's own title line, seeded from the row's label
    await settle(); // entering edit mode toggles EditableItemDetail's own useNavigationInput inactive, re-subscribing Ink's raw-mode listener -- settle before typing, matching the documented swap race in ../../../test-support.js.
    await replaceField(stdin, lastFrame, 'Hi'.length, 'Goodbye');
    stdin.write(ENTER);
    await waitForFrame(lastFrame, (candidate) => candidate.includes('Text: Goodbye'));
  }, 20000);

  it('edits the X position field', async () => {
    const { lastFrame, stdin } = render(<PdfHarness layout={SAMPLE_LAYOUT} />);
    await openItemDetailRow(stdin, lastFrame, 1);

    expect(lastFrame()).toContain('X: 10.0pt');
    stdin.write(ENTER);
    await waitForFrame(lastFrame, (candidate) => candidate.includes('X: 10.0pt'));
    await settle();
    await replaceField(stdin, lastFrame, '10'.length, '50');
    stdin.write(ENTER);
    await waitForFrame(lastFrame, (candidate) => candidate.includes('X: 50.0pt'));
  }, 20000);

  it('edits the colour field', async () => {
    const { lastFrame, stdin } = render(<PdfHarness layout={SAMPLE_LAYOUT} />);
    await openItemDetailRow(stdin, lastFrame, 7);

    expect(lastFrame()).toContain('Colour: #000000');
    stdin.write(ENTER);
    await waitForFrame(lastFrame, (candidate) => candidate.includes('Colour: #000000'));
    await settle();
    await replaceField(stdin, lastFrame, '0 0 0'.length, '1 0 0');
    stdin.write(ENTER);
    await waitForFrame(lastFrame, (candidate) => candidate.includes('Colour: #ff0000'));
  }, 20000);

  it('toggles underline via an activate-based row -- Enter dispatches immediately, no TextField or edit-mode transition involved at all', async () => {
    const { lastFrame, stdin } = render(<PdfHarness layout={SAMPLE_LAYOUT} />);
    await openItemDetailRow(stdin, lastFrame, 10);

    expect(lastFrame()).toContain('Underline: no');
    stdin.write(ENTER);
    await waitForFrame(lastFrame, (candidate) => candidate.includes('Underline: yes'));
  }, 20000);
});

describe('PdfPageItemsScreen add and delete flow', () => {
  it("adds a rectangle through the 'a' add-item flow, then removes it with 'd'", async () => {
    const { lastFrame, stdin } = render(<PdfHarness layout={SAMPLE_LAYOUT} />);
    await waitForFrame(lastFrame, (candidate) => candidate.includes('Page 1'));
    await settle();

    stdin.write(ENTER);
    await waitForFrame(lastFrame, (candidate) => candidate.includes('Page 1 items'));
    expect(lastFrame()).toContain('Page 1 items (1 of 1)');
    await settle();

    stdin.write('a');
    await waitForFrame(lastFrame, (candidate) => candidate.includes('Add item'));
    await settle();

    // ADD_KIND_OPTIONS: 0 Text, 1 Rectangle, 2 Ellipse, 3 Line, 4 Path, 5 Image, 6 Link.
    stdin.write('j');
    await settle();
    stdin.write(ENTER);
    await waitForFrame(lastFrame, (candidate) => candidate.includes('X (pt)'));
    await settle();

    // Accept every field's own pre-filled default in turn: X, Y, Width, Height, Fill, Stroke.
    for (let step = 0; step < 6; step += 1) {
      stdin.write(ENTER);
      await settle();
    }
    await waitForFrame(lastFrame, (candidate) => candidate.includes('Page 1 items (2 of 2)'));
    expect(lastFrame()).toContain('2. rect');
    // The add flow completing swaps AddItemFlow back out for the main list JSX, re-activating PdfPageItemsScreen's own useNavigationInput/delete useInput (see the documented swap race above) -- settle before the next keystroke.
    await settle();

    // The list's own selection was never moved during the add flow (AddItemFlow owns its own separate cursor), so it is still resting on row 0 (the fixture's text item) -- move down once to reach the freshly added rect before deleting it.
    stdin.write('j');
    await settle();
    stdin.write('d');
    await waitForFrame(lastFrame, (candidate) => candidate.includes('Page 1 items (1 of 1)'));
    expect(lastFrame()).not.toContain('rect');
  }, 30000);
});
