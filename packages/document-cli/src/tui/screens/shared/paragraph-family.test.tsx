import { createMarkdownEditor, formulaOfBlock, readDocxContent, readMarkdownContent, readOdtContent, type ContentDocument } from 'documents.js';
import { Text, useInput } from 'ink';
import { render } from 'ink-testing-library';
import { useEffect, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { StatusLine } from '../../components/status-line.js';
import { AppStateProvider, useAppDispatch, useAppState } from '../../state/context.js';
import { currentScreen, type DocxOpenDocument, type MarkdownOpenDocument, type OdtOpenDocument } from '../../state/types.js';
import { createParagraphFamilyAdapter, ParagraphFamilyBodyList } from './paragraph-family.js';

// Ink's reconciler settles a `stdin.write()`-driven state update (and any effect it schedules, which can itself dispatch and schedule a further render) over more than one macrotask tick, not synchronously within the call, so a handful of `setImmediate` ticks are needed before reading `lastFrame()` or sending the next keystroke. A bare Escape additionally needs real elapsed time on top of that: Ink buffers it for up to 20ms (`pendingInputFlushDelayMilliseconds` in its own `App.js`) to disambiguate a lone Escape press from the start of a multi-byte ANSI sequence (an arrow key) -- confirmed necessary empirically: `setImmediate` ticks alone reliably delivered a plain character but silently dropped every Escape in this same harness. That real wait is only paid after an actual Escape write (`flush({ afterEscape: true })`), not on every flush, so the suite's total wall-clock time does not compound across the several non-Escape flushes each test also does.
const SETTLE_TICKS = 4;
const ESCAPE_FLUSH_MARGIN_MS = 30;

async function flush(options: { readonly afterEscape?: boolean } = {}): Promise<void> {
  // A reduce-built promise chain, not a for-loop with an await inside it -- each tick must still observe the previous one's effects before scheduling the next, but this expresses that sequencing without an await-in-loop construct for the linter to flag at all.
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
  if (options.afterEscape === true) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, ESCAPE_FLUSH_MARGIN_MS);
    });
  }
}

const ESCAPE = '\u001B';
const ENTER = '\r';

// A minimal stand-in for app.tsx's own screen router: real enough to prove PUSH_SCREEN/POP_SCREEN driven by ParagraphFamilyBodyList's own key handling actually lands on the screen it claims to, without pulling in the real ParagraphDetailScreen (a docx-family screen this file does not own testing for). Escape pops back to bodyList itself, standing in for that real screen's own Escape handling.
function Marker(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const screen = currentScreen(state);

  // Unconditionally active (not gated on `screen.kind !== 'bodyList'`) so this hook's own raw-mode registration never toggles off and back on in the same render ParagraphFamilyBodyList's own `useInput` mounts/unmounts in -- confirmed empirically that gating it caused Escape to go unhandled after a same-render screen swap.
  useInput((_input, key) => {
    if (key.escape && screen.kind !== 'bodyList') {
      dispatch({ type: 'POP_SCREEN' });
    }
  });

  if (screen.kind === 'bodyList') {
    return <Text>ON bodyList</Text>;
  }
  if (screen.kind === 'paragraphDetail') {
    return <Text>ON paragraphDetail blockIndex={screen.blockIndex}</Text>;
  }
  return <Text>ON {screen.kind}</Text>;
}

// A thin harness rather than constructing `createDocx()` and handing it straight to the adapter: dispatching the real CREATE_DOCUMENT action exercises the exact path a real app run takes (state.openDocument populated by the reducer, the adapter built from it fresh every render), and CREATE_DOCUMENT's own handler calls `createDocx()` internally regardless -- so this is still a real `createDocx()`-backed adapter underneath, just reached the way the app itself reaches it.
function DocxHarness(): ReactElement | null {
  const state = useAppState();
  const dispatch = useAppDispatch();

  useEffect(() => {
    dispatch({ type: 'CREATE_DOCUMENT', format: 'docx' });
  }, [dispatch]);

  const doc = state.openDocument;
  if (doc?.format !== 'docx') {
    return null;
  }

  const adapter = createParagraphFamilyAdapter({
    formatLabel: 'docx',
    paragraphs: () => doc.editor.paragraphs(),
    tables: () => doc.editor.tables(),
    dispatch,
  });

  const screen = currentScreen(state);
  return (
    <>
      {screen.kind === 'bodyList' ? <ParagraphFamilyBodyList adapter={adapter} /> : undefined}
      <Marker />
    </>
  );
}

function renderHarness() {
  return render(
    <AppStateProvider>
      <DocxHarness />
    </AppStateProvider>,
  );
}

// A generalised, docx/odt/markdown harness for the 'T' table-creation wizard tests below -- reused for all three formats rather than duplicating DocxHarness, since the wizard itself is genuinely format-agnostic (APPEND_TABLE's own reducer case resolves the open docx/odt/markdown document uniformly, exactly as the module doc comment on createParagraphFamilyAdapter's own `appendParagraph` already establishes for paragraphs). Markdown has no CREATE_DOCUMENT path (EditableFormat doesn't include it) -- a fresh MarkdownOpenDocument is built directly via createMarkdownEditor() and dispatched through OPEN_FILE_SUCCESS instead, the same real action openDocumentAtPath's own caller dispatches, matching reducer.test.ts's own openMarkdownDocument convention.
function BodyListHarness({ format }: { readonly format: 'docx' | 'odt' | 'markdown' }): ReactElement | null {
  const state = useAppState();
  const dispatch = useAppDispatch();

  useEffect(() => {
    if (format === 'markdown') {
      const doc: MarkdownOpenDocument = { format: 'markdown', editor: createMarkdownEditor(), originalText: undefined, path: undefined };
      dispatch({ type: 'OPEN_FILE_SUCCESS', path: 'untitled.md', doc });
      return;
    }
    dispatch({ type: 'CREATE_DOCUMENT', format });
  }, [format, dispatch]);

  const doc = state.openDocument;
  if (doc?.format !== format) {
    return null;
  }

  const adapter = createParagraphFamilyAdapter({
    formatLabel: format,
    paragraphs: () => doc.editor.paragraphs(),
    tables: () => doc.editor.tables(),
    dispatch,
  });

  const screen = currentScreen(state);
  return (
    <>
      {screen.kind === 'bodyList' ? <ParagraphFamilyBodyList adapter={adapter} /> : undefined}
      <TableProbe doc={doc} />
      <FormulaProbe doc={doc} />
      <StatusLine />
      <Marker />
    </>
  );
}

type WordprocessingOpenDocument = DocxOpenDocument | OdtOpenDocument | MarkdownOpenDocument;

// The one content-reading step genuinely specific to each format: docx/odt read through their own already-decoded package, markdown re-serialises its live editor to text first (readMarkdownContent takes text, not a package) -- mirroring format/read-metadata.ts's own per-format dispatch.
function wordprocessingContentFor(doc: WordprocessingOpenDocument): ContentDocument {
  if (doc.format === 'docx') {
    return readDocxContent(doc.editor.toPackage());
  }
  if (doc.format === 'odt') {
    return readOdtContent(doc.editor.toPackage());
  }
  return readMarkdownContent(doc.editor.toMarkdownText());
}

// Reads the document's own first table block fresh through readDocxContent/readOdtContent/readMarkdownContent on every render -- the real proof a wizard-driven APPEND_TABLE dispatch reached the package, and (for the merge tests) that the anchor cell carries the real colSpan/rowSpan a creation-time merge writes.
function TableProbe({ doc }: { readonly doc: WordprocessingOpenDocument }): ReactElement {
  const content = wordprocessingContentFor(doc);
  if (content.kind !== 'wordprocessing') {
    throw new Error(`expected a wordprocessing ContentDocument, got ${content.kind}`);
  }
  const tableBlock = content.sections.flatMap((section) => section.blocks).find((block): block is Extract<(typeof content.sections)[number]['blocks'][number], { readonly kind: 'table' }> => block.kind === 'table');
  if (tableBlock === undefined) {
    return <Text>probe:table=none</Text>;
  }
  const anchor = tableBlock.rows[0]?.cells[0];
  return (
    <Text>
      probe:table={tableBlock.rows.length}x{tableBlock.columnWidthsPt.length} anchorColSpan={anchor?.colSpan ?? 1} anchorRowSpan={anchor?.rowSpan ?? 1}
    </Text>
  );
}

// ContentEmbeddedObjectBlock has no top-level re-export from documents.js (only the ContentBlock union itself does) -- narrowed via Extract from that union's own block-array element type instead, the same trick TableProbe above already uses for its table-block narrowing.
type WordprocessingBlock = Extract<ContentDocument, { readonly kind: 'wordprocessing' }>['sections'][number]['blocks'][number];

// Reads the document's own first embedded-formula block fresh through readDocxContent/readOdtContent/readMarkdownContent on every render -- the real proof an 'm'-driven INSERT_ODT_FORMULA dispatch reached the package, mirroring TableProbe's own convention. docx never reaches this probe with a formula present, since paragraph-detail.tsx's own 'm' handler (paragraph-scoped, not this body-list screen's) is what docx uses instead; markdown never reaches it with one present either, since CommonMark/GFM has no formula construct at all -- always 'none' for markdown.
function FormulaProbe({ doc }: { readonly doc: WordprocessingOpenDocument }): ReactElement {
  const content = wordprocessingContentFor(doc);
  if (content.kind !== 'wordprocessing') {
    throw new Error(`expected a wordprocessing ContentDocument, got ${content.kind}`);
  }
  const blocks = content.sections.flatMap((section) => section.blocks);
  const formulaBlock = blocks.find((block): block is Extract<WordprocessingBlock, { readonly kind: 'embeddedObject' }> => block.kind === 'embeddedObject');
  const formula = formulaBlock === undefined ? undefined : formulaOfBlock(formulaBlock);
  const rootTag = formula?.mathml[0]?.type === 'element' ? formula.mathml[0].tag : undefined;
  return <Text>probe:formula={formula === undefined ? 'none' : `present root=${rootTag ?? '?'}`}</Text>;
}

function renderBodyListHarness(format: 'docx' | 'odt' | 'markdown'): ReturnType<typeof render> {
  return render(
    <AppStateProvider>
      <BodyListHarness format={format} />
    </AppStateProvider>,
  );
}

// The rows/columns/merge-rectangle TextFields all start pre-filled with their own default value and the cursor at the end (see export-options.test.tsx's own comment on this exact TextField behaviour) -- typing a digit appends to that default rather than replacing it, so a test wanting a specific value first clears the single pre-filled default digit with one backspace.
const BACKSPACE = '\x7F';
async function replaceField(stdin: { readonly write: (data: string) => void }, value: string): Promise<void> {
  stdin.write(BACKSPACE);
  await flush();
  stdin.write(value);
  await flush();
}

// Confirms a just-typed draft actually reached the rendered frame, plus a further short real wait, before the caller sends anything else -- see paragraph-detail.test.tsx's own identical helper for the exact race this closes (ink-text-input's own onSubmit closes over whatever `originalValue` prop its own most recent render saw, and the frame showing the typed text is not, on its own, proof that render has fully settled). Used here for the formula picker's own raw-MathML entry, a longer, more varied string than the table wizard's own single-digit fields above.
async function writeAndConfirm(stdin: { readonly write: (data: string) => void }, lastFrame: () => string | undefined, value: string): Promise<void> {
  stdin.write(value);
  await vi.waitFor(() => {
    expect(lastFrame()).toContain(value);
  });
  await new Promise((resolve) => {
    setTimeout(resolve, ESCAPE_FLUSH_MARGIN_MS);
  });
}

describe('ParagraphFamilyBodyList', () => {
  it('shows the empty-body hint before any paragraph exists', async () => {
    const { lastFrame } = renderHarness();
    await flush();
    expect(lastFrame()).toContain("No paragraphs or tables yet -- press 'a' to append a paragraph.");
    expect(lastFrame()).toContain('ON bodyList');
  });

  it('appends a paragraph on "a" and pushes paragraphDetail for it', async () => {
    const { lastFrame, stdin } = renderHarness();
    await flush();

    stdin.write('a');
    await flush();
    expect(lastFrame()).toContain('ON paragraphDetail blockIndex=0');
  });

  it(
    'navigates the list with j and opens the selected paragraph with Enter',
    async () => {
      const { lastFrame, stdin } = renderHarness();
      await flush();

      stdin.write('a');
      await flush();
      expect(lastFrame()).toContain('ON paragraphDetail blockIndex=0');

      stdin.write(ESCAPE);
      await flush({ afterEscape: true });
      expect(lastFrame()).toContain('ON bodyList');
      expect(lastFrame()).toContain('Paragraphs (1/1)');

      stdin.write('a');
      await flush();
      expect(lastFrame()).toContain('ON paragraphDetail blockIndex=1');

      stdin.write(ESCAPE);
      await flush({ afterEscape: true });
      expect(lastFrame()).toContain('ON bodyList');
      expect(lastFrame()).toContain('Paragraphs (2/2)');

      // Two paragraphs now exist; the list's own cursor is local to this mount (see paragraph-family.ts's own note on `usePersistedSelection`) and starts back at row 0 -- move down once with 'j' to reach the second paragraph, then open it.
      stdin.write('j');
      await flush();
      stdin.write(ENTER);
      await flush();
      expect(lastFrame()).toContain('ON paragraphDetail blockIndex=1');
    },
    // Generous relative to this suite's normal sub-second runtime: this test alone makes three round trips through Ink's real Escape-disambiguation wait (see `flush`'s own comment), and the default 10s unit-test timeout has been observed to run close under heavy concurrent load on this machine.
    20_000,
  );
});

// A generous per-test timeout throughout this describe.each: each test makes several sequential flush() round trips (one per wizard step), and the default 10s unit-test timeout has been observed to run close under heavy concurrent load on this machine -- the same reasoning already documented on the "navigates ... with Enter" test above.
const WIZARD_TEST_TIMEOUT_MS = 20_000;

describe.each(['docx', 'odt', 'markdown'] as const)('ParagraphFamilyBodyList "T" table-creation wizard on %s', (format) => {
  it(
    'adds a real table of the requested dimensions via the 2-step rows/columns wizard, no merge',
    async () => {
      const { lastFrame, stdin } = renderBodyListHarness(format);
      await flush();
      expect(lastFrame()).toContain('probe:table=none');

      stdin.write('T');
      await flush();
      expect(lastFrame()).toContain('Rows:');

      await replaceField(stdin, '3');
      stdin.write(ENTER);
      await flush();
      expect(lastFrame()).toContain('Columns:');

      await replaceField(stdin, '4');
      stdin.write(ENTER);
      await flush();
      expect(lastFrame()).toContain('Merge cells now? y/N');

      stdin.write('n');
      await flush();
      expect(lastFrame()).toContain('probe:table=3x4 anchorColSpan=1 anchorRowSpan=1');
      expect(lastFrame()).toContain('ON tableView');
      expect(lastFrame()).not.toContain('Merge cells now?');
    },
    WIZARD_TEST_TIMEOUT_MS,
  );

  it(
    format === 'markdown'
      ? "requests a merge via the wizard's own merge step, but a markdown table declines it with a warning (GFM tables have no cell-merge concept)"
      : "creates a table with cells pre-merged via the wizard's own merge step, in one APPEND_TABLE dispatch",
    async () => {
      const { lastFrame, stdin } = renderBodyListHarness(format);
      await flush();

      stdin.write('T');
      await flush();
      await replaceField(stdin, '3');
      stdin.write(ENTER);
      await flush();
      await replaceField(stdin, '3');
      stdin.write(ENTER);
      await flush();
      expect(lastFrame()).toContain('Merge cells now? y/N');

      stdin.write('y');
      await flush();
      expect(lastFrame()).toContain('Merge start row (0-2):');
      stdin.write(ENTER);
      await flush();
      expect(lastFrame()).toContain('Merge start column (0-2):');
      stdin.write(ENTER);
      await flush();
      expect(lastFrame()).toContain('Merge row span (1-3):');

      await replaceField(stdin, '2');
      stdin.write(ENTER);
      await flush();
      expect(lastFrame()).toContain('Merge column span (1-3):');

      await replaceField(stdin, '2');
      stdin.write(ENTER);
      await flush();

      if (format === 'markdown') {
        // The table is still created (3x3), just left unmerged -- see reducer.ts's own APPEND_TABLE case and reducer.test.ts's identical assertion at the state level.
        expect(lastFrame()).toContain('probe:table=3x3 anchorColSpan=1 anchorRowSpan=1');
        expect(lastFrame()).toContain('do not support merged cells');
      } else {
        expect(lastFrame()).toContain('probe:table=3x3 anchorColSpan=2 anchorRowSpan=2');
      }
      expect(lastFrame()).toContain('ON tableView');
    },
    WIZARD_TEST_TIMEOUT_MS,
  );

  it(
    'cancels the wizard on Escape without touching the document',
    async () => {
      const { lastFrame, stdin } = renderBodyListHarness(format);
      await flush();

      stdin.write('T');
      await flush();
      expect(lastFrame()).toContain('Rows:');

      stdin.write(ESCAPE);
      await flush({ afterEscape: true });
      expect(lastFrame()).not.toContain('Rows:');
      expect(lastFrame()).toContain('probe:table=none');
      expect(lastFrame()).toContain('ON bodyList');
    },
    WIZARD_TEST_TIMEOUT_MS,
  );
});

describe('ParagraphFamilyBodyList "m" formula insertion (odt body-scoped)', () => {
  it(
    'inserts the first preset via the picker, then the frame wizard, as a real embedded ODF formula',
    async () => {
      const { lastFrame, stdin } = renderBodyListHarness('odt');
      await flush();
      expect(lastFrame()).toContain('probe:formula=none');

      stdin.write('m');
      await flush();
      expect(lastFrame()).toContain('Insert formula');
      expect(lastFrame()).toContain('Fraction: x / 2');

      stdin.write(ENTER);
      await flush();
      expect(lastFrame()).toContain('X (pt)');

      // Accept every frame field's own pre-filled default.
      stdin.write(ENTER);
      await flush();
      expect(lastFrame()).toContain('Y (pt)');
      stdin.write(ENTER);
      await flush();
      expect(lastFrame()).toContain('Width (pt)');
      stdin.write(ENTER);
      await flush();
      expect(lastFrame()).toContain('Height (pt)');
      stdin.write(ENTER);
      await vi.waitFor(() => {
        expect(lastFrame()).toContain('probe:formula=present root=mfrac');
      });
    },
    WIZARD_TEST_TIMEOUT_MS,
  );

  it(
    'inserts a raw MathML entry, parsed via parseXml, as a real embedded formula',
    async () => {
      const { lastFrame, stdin } = renderBodyListHarness('odt');
      await flush();

      stdin.write('m');
      await flush();
      // Six presets precede the "Raw MathML..." row -- navigate down to it.
      for (let step = 0; step < 6; step += 1) {
        stdin.write('j');
        await flush();
      }
      expect(lastFrame()).toContain('Raw MathML...');
      stdin.write(ENTER);
      await flush();
      expect(lastFrame()).toContain('Raw MathML (the children');

      await writeAndConfirm(stdin, lastFrame, '<msup><mi>x</mi><mn>3</mn></msup>');
      stdin.write(ENTER);
      await flush();
      expect(lastFrame()).toContain('X (pt)');

      stdin.write(ENTER);
      await flush();
      stdin.write(ENTER);
      await flush();
      stdin.write(ENTER);
      await flush();
      stdin.write(ENTER);
      await vi.waitFor(() => {
        expect(lastFrame()).toContain('probe:formula=present root=msup');
      });
    },
    WIZARD_TEST_TIMEOUT_MS,
  );

  it(
    'reports a warning, not a crash, for raw MathML that fails to parse, and never opens the frame wizard',
    async () => {
      const { lastFrame, stdin } = renderBodyListHarness('odt');
      await flush();

      stdin.write('m');
      await flush();
      for (let step = 0; step < 6; step += 1) {
        stdin.write('j');
        await flush();
      }
      stdin.write(ENTER);
      await flush();

      // A closing tag missing its final '>' -- parseXml (fast-xml-parser) is lenient about several malformed shapes, but a truncated closing tag is a genuine, confirmed throw (see paragraph-detail.test.tsx's own identical fixture and comment).
      await writeAndConfirm(stdin, lastFrame, '<mfrac><mi>x</mi></mfrac');
      stdin.write(ENTER);
      await vi.waitFor(() => {
        expect(lastFrame()).toContain('Could not parse MathML');
      });
      expect(lastFrame()).toContain('probe:formula=none');
      expect(lastFrame()).not.toContain('X (pt)');
      // The picker itself stays open (back at the row list) so the user can retry, rather than the whole flow closing on a failed parse.
      expect(lastFrame()).toContain('Insert formula');
    },
    WIZARD_TEST_TIMEOUT_MS,
  );

  it('does not expose the formula flow for a docx document', async () => {
    const { lastFrame, stdin } = renderBodyListHarness('docx');
    await flush();

    stdin.write('m');
    await flush();

    expect(lastFrame()).not.toContain('Insert formula');
  });

  it('does not expose the formula flow for a markdown document either -- CommonMark/GFM has no formula construct at all', async () => {
    const { lastFrame, stdin } = renderBodyListHarness('markdown');
    await flush();

    stdin.write('m');
    await flush();

    expect(lastFrame()).not.toContain('Insert formula');
  });
});
