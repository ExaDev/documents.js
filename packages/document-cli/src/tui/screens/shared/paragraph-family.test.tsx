import { Text, useInput } from 'ink';
import { render } from 'ink-testing-library';
import { useEffect, type ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { AppStateProvider, useAppDispatch, useAppState } from '../../state/context.js';
import { currentScreen } from '../../state/types.js';
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
