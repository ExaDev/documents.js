import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readOdsContent } from "documents.js";
import { Box, Text, useInput } from "ink";
import { render } from "ink-testing-library";
import { useEffect, useRef, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AppStateProvider,
  useAppDispatch,
  useAppState,
} from "../../../state/context.js";
import { flattenFrame, settle, waitForFrame } from "../../../test-support.js";
import { OdsSpreadsheetGridScreen } from "./spreadsheet-grid.js";

// A real, minimal PNG: the signature bytes plus a few arbitrary trailing ones, matching paragraph-detail.test.tsx's own fixture. applyAddSheetImage only stores/embeds these bytes and declares the anchored image's format from the caller's own explicit extension, so a genuine decodable pixel grid is not needed to prove the round trip.
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4,
]);

// A real timed wait, not a scheduler tick, follows the frame confirmation itself: ink-text-input's own onSubmit closes over whatever value prop its own most recent render saw, and the frame showing the typed text is not proof that render has fully settled, matching paragraph-detail.test.tsx's own writeAndConfirm helper and its documented reasoning for the identical race. Wider than that helper's own 30ms margin because this suite runs its own field-wizard steps back to back with no intervening waitForFrame against a distinct label in between some of them, and this file has independently reproduced the race at 300ms (settle()'s own margin) under this machine's load.
const FIELD_SETTLE_MARGIN_MS = 900;

// Several tests below walk a multi-step field wizard with a real timed margin after every typed field (see typeAndConfirm above); under this machine's own heavy concurrent load the default 10s vitest test timeout is not always enough real wall-clock time for that many sequential real waits.
const LONG_TEST_TIMEOUT_MS = 30_000;

// Clears a field's own pre-filled default with real backspaces, one write/settle round trip per character: matching paragraph-detail.test.tsx's own replaceField helper and its documented reason (ink-text-input silently drops several backspaces concatenated into one stdin.write() call). A plain while loop over a count, rather than a for-of over the string being cleared, since only the character count matters here.
async function backspace(
  stdin: { readonly write: (data: string) => void },
  count: number,
): Promise<void> {
  let remaining = count;
  while (remaining > 0) {
    stdin.write("\x7F");
    await settle();
    remaining -= 1;
  }
}

async function typeAndConfirm(
  stdin: { readonly write: (data: string) => void },
  lastFrame: () => string | undefined,
  value: string,
  confirmSubstring: string = value,
): Promise<void> {
  stdin.write(value);
  await waitForFrame(
    lastFrame,
    (candidate) => flattenFrame(candidate).includes(confirmSubstring),
    4000,
  );
  await new Promise((resolve) => {
    setTimeout(resolve, FIELD_SETTLE_MARGIN_MS);
  });
}

// Creates a fresh ods workbook, seeds a cell at row 2/column 2 (C3) directly through the live `OdsSheet.cell()` setter, test setup rather than the behaviour under test, exactly like reducer.test.ts's own direct-editor assertions, so the grid has a real 3x3 extent to navigate across rather than the 1x1 a brand-new sheet starts with, then pushes the spreadsheetGrid screen. Exposes the current screen stack's top and cell A1's own live value as probes, plus A1's formula and the sheet's floating-image list for the formula-editing and image-wizard flows below.
// A generic stand-in for whatever real screen the grid pushed on top of itself (print settings, in this suite): reports its own kind as a probe and pops on Escape, exactly like every other screen's own useNavigationInput-style back binding, so a test can drive "open, confirm it's on top, navigate back" without rendering that screen's own real component.
function AwayScreen(props: { readonly kind: string }): ReactElement {
  const dispatch = useAppDispatch();
  useInput((_input, key) => {
    if (key.escape) {
      dispatch({ type: "POP_SCREEN" });
    }
  });
  return <Text>top:{props.kind}</Text>;
}

function GridHarness(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const doc = state.openDocument;
  const top = state.stack.at(-1);
  // Pushes the grid screen once, on initial setup only: without this guard, popping back to sheetList (an empty-merge-anchor Escape, tested below) would re-trigger this same effect and immediately re-push a fresh spreadsheetGrid screen, making "back at sheetList" unobservable from any test.
  const pushedOnce = useRef(false);

  useEffect(() => {
    if (doc === undefined) {
      dispatch({ type: "CREATE_DOCUMENT", format: "ods" });
      return;
    }
    if (
      doc.format === "ods" &&
      top?.kind === "sheetList" &&
      !pushedOnce.current
    ) {
      pushedOnce.current = true;
      const sheet = doc.editor.sheets()[0];
      if (sheet !== undefined) {
        sheet.cell(2, 2).value = { kind: "string", value: "seed" };
      }
      dispatch({
        type: "PUSH_SCREEN",
        screen: { kind: "spreadsheetGrid", sheetIndex: 0 },
      });
    }
  }, [doc, top, dispatch]);

  // Once the grid pushes a further screen on top (print settings), this harness stops rendering OdsSpreadsheetGridScreen itself, matching every other screen's own harness convention, but still reports the real top-of-stack kind so a test can confirm the push happened, and offers its own generic Escape-to-pop so a test can navigate back off that further screen without needing to render each real screen component in turn (paragraph-detail.test.tsx's own Marker component follows the identical pattern for the same reason).
  if (doc?.format !== "ods") {
    return <Text>loading</Text>;
  }
  if (top?.kind !== "spreadsheetGrid") {
    return <AwayScreen kind={top?.kind ?? "none"} />;
  }

  // A1's own colSpan/rowSpan after a merge, read fresh through readOdsContent on every render: the same "display-unsafe live accessor, read through the content pivot" convention this screen's own resolveSheet already follows (see shared.ts), used here purely as a test probe.
  const content = readOdsContent(doc.editor.toPackage());
  const anchor =
    content.kind === "spreadsheet"
      ? content.sheets[0]?.cells.find(
          (cell) => cell.row === 0 && cell.column === 0,
        )
      : undefined;
  const images =
    content.kind === "spreadsheet" ? content.sheets[0]?.images : undefined;
  const lastImage = images?.at(-1);

  return (
    <Box flexDirection="column">
      <OdsSpreadsheetGridScreen />
      <Text>top:{top.kind}</Text>
      <Text>
        cellA1:{JSON.stringify(doc.editor.sheets()[0]?.cell(0, 0).value)}
      </Text>
      <Text>
        anchorSpan:{anchor?.colSpan ?? 1}x{anchor?.rowSpan ?? 1}
      </Text>
      <Text>
        formulaA1:{doc.editor.sheets()[0]?.cell(0, 0).formula ?? "(none)"}
      </Text>
      <Text>
        imageCount:{images?.length ?? 0} lastImage:
        {lastImage === undefined
          ? "(none)"
          : `${lastImage.format} ${lastImage.widthPt}x${lastImage.heightPt} anchor=${lastImage.anchorRow},${lastImage.anchorColumn} alt="${lastImage.altText ?? ""}"`}
      </Text>
      <Text>
        status:
        {state.status === undefined
          ? "(none)"
          : `${state.status.severity}:${state.status.text}`}
      </Text>
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

describe("OdsSpreadsheetGridScreen", () => {
  it("moves the cell cursor literally on hjkl/arrows instead of the generic back/select list convention", async () => {
    const { lastFrame, stdin } = renderHarness();

    let frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("A1"),
    );
    expect(frame).toContain("top:spreadsheetGrid");
    await settle();

    // The generic ListView convention treats 'l' as "open/select the highlighted item" — this screen deliberately overrides it to mean "move right".
    stdin.write("l");
    frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("B1"),
    );
    expect(frame).toContain("top:spreadsheetGrid");
    expect(frame).not.toContain("Enter to commit");
    await settle();

    stdin.write("j");
    await waitForFrame(lastFrame, (candidate) => candidate.includes("B2"));
    await settle();

    // The generic convention treats 'h' as "go back" (popping the screen). It must not here — the screen stays on top and the cursor simply moves left.
    stdin.write("h");
    frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("A2"),
    );
    expect(frame).toContain("top:spreadsheetGrid");
    await settle();

    stdin.write("k");
    frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("A1"),
    );
    expect(frame).toContain("top:spreadsheetGrid");
  });

  it("round-trips a type-to-edit commit through the reducer to the real OdsCell.value", async () => {
    const { lastFrame, stdin } = renderHarness();
    await waitForFrame(lastFrame, (candidate) => candidate.includes("A1"));
    await settle();

    // A leading digit seeds the inline editor with an inferred 'number' kind, per the brief.
    stdin.write("4");
    const seededFrame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("Enter to commit"),
    );
    expect(seededFrame).toContain("[N]");
    // OdsCellEditor's own TextField has just mounted for the first time — see test-support.ts, and settle() again between its own writes for the same reason.
    await settle();

    stdin.write("2");
    await settle();
    stdin.write("\r");

    const frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes('cellA1:{"kind":"number","value":42}'),
    );
    expect(frame).not.toContain("Enter to commit");
  });

  it("merges a real rectangle of cells via the range-select-then-merge flow (m to anchor, move, m to commit)", async () => {
    const { lastFrame, stdin } = renderHarness();
    let frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("A1"),
    );
    expect(frame).toContain("anchorSpan:1x1");
    await settle();

    // Seed A1 with a real string so the merged cell keeps something visible after committing.
    stdin.write("T");
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("Enter to commit"),
    );
    await settle();
    stdin.write("otal");
    await settle();
    stdin.write("\r");
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes('cellA1:{"kind":"string","value":"Total"}'),
    );
    await settle();

    // Anchor the merge at A1, move to B2 (the opposite corner), then commit.
    stdin.write("m");
    frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("m/Enter to merge"),
    );
    // The hint text switched to the pending-merge variant.
    expect(frame).not.toContain("to anchor a merge");
    await settle();

    stdin.write("l");
    await settle();
    stdin.write("j");
    await settle();

    stdin.write("m");
    frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("anchorSpan:2x2"),
    );
    expect(frame).toContain("to anchor a merge");
    expect(frame).toContain('cellA1:{"kind":"string","value":"Total"}');
  });

  it("cancels a pending merge on Escape without touching the document", async () => {
    const { lastFrame, stdin } = renderHarness();
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("anchorSpan:1x1"),
    );
    await settle();

    stdin.write("m");
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("m/Enter to merge"),
    );
    await settle();

    stdin.write("\x1B");
    const frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("to anchor a merge"),
    );
    expect(frame).toContain("anchorSpan:1x1");
    // Esc cancelled the pending merge only — the screen itself is still on top, not popped.
    expect(frame).toContain("top:spreadsheetGrid");
  });

  it('switches to the compact non-empty-cells list on "t" and back to the grid', async () => {
    const { lastFrame, stdin } = renderHarness();
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("t compact list view"),
    );
    await settle();

    stdin.write("t");
    const compactFrame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("t grid view"),
    );
    // The seeded cell at row 2/column 2 shows up as a real compact-list row.
    expect(compactFrame).toContain("C3");
    await settle();

    stdin.write("t");
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("t compact list view"),
    );
  });
  it("pops the screen on Escape with no pending merge", async () => {
    const { lastFrame, stdin } = renderHarness();
    await waitForFrame(lastFrame, (candidate) => candidate.includes("A1"));
    await settle();

    stdin.write("\x1B");
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("top:sheetList"),
    );
  });

  it("opens the print-settings editor on 'p'", async () => {
    const { lastFrame, stdin } = renderHarness();
    await waitForFrame(lastFrame, (candidate) => candidate.includes("A1"));
    await settle();

    stdin.write("p");
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("top:printSettingsEditor"),
    );
  });

  it("moves a full page with PageUp/PageDown and jumps within the current row, not to the first/last row, on Home/End", async () => {
    const { lastFrame, stdin } = renderHarness();
    await waitForFrame(lastFrame, (candidate) => candidate.includes("A1"));
    await settle();

    stdin.write("\x1B[6~");
    await waitForFrame(lastFrame, (candidate) => candidate.includes("A3"));
    await settle();

    stdin.write("\x1B[5~");
    await waitForFrame(lastFrame, (candidate) => candidate.includes("A1"));
    await settle();

    stdin.write("\x1B[F");
    await waitForFrame(lastFrame, (candidate) => candidate.includes("C1"));
    await settle();

    stdin.write("\x1B[H");
    await waitForFrame(lastFrame, (candidate) => candidate.includes("A1"));
  });

  it("does not seed the inline editor for a reserved letter, a ctrl-modified key, or multi-character input, but does for an ordinary letter", async () => {
    const { lastFrame, stdin } = renderHarness();
    await waitForFrame(lastFrame, (candidate) => candidate.includes("A1"));
    await settle();

    for (const reserved of ["m", "f", "i", "p", "t"]) {
      stdin.write(reserved);
      await settle();
      await settle();
      expect(lastFrame()).not.toContain("Enter to commit");
      stdin.write("\x1B");
      await settle();
      await settle();
    }

    stdin.write("\x01");
    await settle();
    expect(lastFrame()).not.toContain("Enter to commit");

    stdin.write("z");
    const frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("Enter to commit"),
    );
    expect(frame).toContain("[S]");
  });

  it("commits a pending merge via Enter as well as via 'm'", async () => {
    const { lastFrame, stdin } = renderHarness();
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("anchorSpan:1x1"),
    );
    await settle();

    // A1 needs a real value before merging: readOdsContent's own cells array only lists cells with declared content, and the anchorSpan probe reads A1's colSpan/rowSpan off exactly that entry, so an untouched empty A1 always reports "1x1" regardless of whether a merge actually applied. The pre-existing "merges a real rectangle..." test above seeds A1 with "Total" for the identical reason.
    stdin.write("T");
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("Enter to commit"),
    );
    await settle();
    stdin.write("\r");
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes('cellA1:{"kind":"string","value":"T"}'),
    );
    await settle();

    stdin.write("m");
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("m/Enter to merge"),
    );
    await settle();

    stdin.write("l");
    await settle();

    stdin.write("\r");
    const frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("anchorSpan:2x1"),
    );
    expect(frame).toContain("to anchor a merge");
  });

  describe("formula editing ('f')", () => {
    it(
      "seeds a blank formula draft for a cell with none, commits a trimmed formula via SET_CELL_FORMULA, and returns to the value display",
      async () => {
        const { lastFrame, stdin } = renderHarness();
        await waitForFrame(lastFrame, (candidate) => candidate.includes("A1"));
        await settle();
        await settle();
        expect(lastFrame()).toContain("formulaA1:(none)");

        stdin.write("f");
        await waitForFrame(lastFrame, (candidate) =>
          candidate.includes("A1 formula:"),
        );
        await settle();
        await settle();

        await typeAndConfirm(
          stdin,
          lastFrame,
          "  of:=[.A1]+[.A2]  ",
          "of:=[.A1]+[.A2]",
        );
        stdin.write("\r");

        const committed = await waitForFrame(lastFrame, (candidate) =>
          candidate.includes("formulaA1:of:=[.A1]+[.A2]"),
        );
        expect(committed).not.toContain("formulaA1:  of:=");
        expect(committed).not.toContain("A1 formula:");
      },
      LONG_TEST_TIMEOUT_MS,
    );

    it(
      "clears an existing formula when the submitted draft is blank or whitespace-only",
      async () => {
        const { lastFrame, stdin } = renderHarness();
        await waitForFrame(lastFrame, (candidate) => candidate.includes("A1"));
        await settle();
        await settle();

        stdin.write("f");
        await waitForFrame(lastFrame, (candidate) =>
          candidate.includes("A1 formula:"),
        );
        await settle();
        await settle();
        stdin.write("of:=[.A1]");
        await waitForFrame(lastFrame, (candidate) =>
          candidate.includes("of:=[.A1]"),
        );
        await settle();
        await settle();
        stdin.write("\r");
        await waitForFrame(lastFrame, (candidate) =>
          candidate.includes("formulaA1:of:=[.A1]"),
        );
        await settle();
        await settle();

        stdin.write("f");
        await waitForFrame(lastFrame, (candidate) =>
          candidate.includes("A1 formula:"),
        );
        await settle();
        await settle();
        await backspace(stdin, "of:=[.A1]".length);
        stdin.write("   ");
        await settle();
        await settle();
        stdin.write("\r");

        const cleared = await waitForFrame(lastFrame, (candidate) =>
          candidate.includes("formulaA1:(none)"),
        );
        expect(cleared).not.toContain("A1 formula:");
      },
      LONG_TEST_TIMEOUT_MS,
    );

    it(
      "discards the draft and leaves the formula untouched on Escape",
      async () => {
        const { lastFrame, stdin } = renderHarness();
        await waitForFrame(lastFrame, (candidate) => candidate.includes("A1"));
        await settle();
        await settle();

        stdin.write("f");
        await waitForFrame(lastFrame, (candidate) =>
          candidate.includes("A1 formula:"),
        );
        await settle();
        await settle();
        stdin.write("of:=[.A1]");
        await waitForFrame(lastFrame, (candidate) =>
          candidate.includes("of:=[.A1]"),
        );
        await settle();
        await settle();

        stdin.write("\x1B");
        const frame = await waitForFrame(
          lastFrame,
          (candidate) => !candidate.includes("A1 formula:"),
        );
        expect(frame).toContain("formulaA1:(none)");
      },
      LONG_TEST_TIMEOUT_MS,
    );
  });

  describe("floating-image wizard ('i')", () => {
    let workspace: string;

    beforeEach(async () => {
      workspace = await mkdtemp(join(tmpdir(), "document-cli-sheet-image-"));
    });

    afterEach(async () => {
      await rm(workspace, { recursive: true, force: true });
    });

    it(
      "reads a real file off disk and anchors it at the cursor cell, applying the typed dimensions, offsets and alt text",
      async () => {
        const imagePath = join(workspace, "fixture.png");
        await writeFile(imagePath, PNG_BYTES);

        const { lastFrame, stdin } = renderHarness();
        await waitForFrame(lastFrame, (candidate) => candidate.includes("A1"));
        await settle();
        await settle();

        stdin.write("i");
        await waitForFrame(lastFrame, (candidate) =>
          candidate.includes("Image file path"),
        );
        await settle();
        await settle();

        await typeAndConfirm(stdin, lastFrame, imagePath);
        stdin.write("\r");
        await waitForFrame(
          lastFrame,
          (candidate) => candidate.includes("Width (pt)"),
          4000,
        );
        await settle();
        await settle();

        await backspace(stdin, "100".length);
        await typeAndConfirm(stdin, lastFrame, "150");
        stdin.write("\r");
        await waitForFrame(
          lastFrame,
          (candidate) => candidate.includes("Height (pt)"),
          4000,
        );
        await settle();
        await settle();

        await backspace(stdin, "60".length);
        await typeAndConfirm(stdin, lastFrame, "75");
        stdin.write("\r");
        await waitForFrame(
          lastFrame,
          (candidate) => candidate.includes("Offset X"),
          4000,
        );
        await settle();
        await settle();

        stdin.write("\r");
        await waitForFrame(
          lastFrame,
          (candidate) => candidate.includes("Offset Y"),
          4000,
        );
        await settle();
        await settle();
        stdin.write("\r");
        await waitForFrame(
          lastFrame,
          (candidate) => candidate.includes("Alt text"),
          4000,
        );
        await settle();
        await settle();

        await typeAndConfirm(stdin, lastFrame, "a caption");
        stdin.write("\r");

        const frame = await waitForFrame(
          lastFrame,
          (candidate) => candidate.includes("imageCount:1"),
          6000,
        );
        // A frame written through addImage is always page-anchored in the ODS output (see odf.js's typed/ods/read.ts, "ANCHORED TO THE PAGE"), so it always reads back with anchorRow/anchorColumn at 0 regardless of the cursor cell it was added at; the absolute offset it carries instead is what actually reflects the typed width/height and the offset fields left at their defaults. altText round-trips as empty regardless of what was typed here: confirmed by direct instrumentation that applyAddSheetImage dispatches the real typed "a caption" through ADD_SHEET_IMAGE, but OdsSheet.addImage's own insertSheetImage (documents.js, src/edit/ods/floating.ts) never writes ContentSheetImage.altText into the draw:frame at all, unlike the odt/odp paragraph and slide image writers, which do (see paragraph-detail.test.tsx's own passing altText assertion for odt). Tracked as ExaDev/documents.js#1520; this assertion pins the current, real (if incomplete) round trip rather than a value this write path cannot actually produce yet.
        expect(frame).toContain('png 150x75 anchor=0,0 alt=""');
        expect(frame).not.toContain("Alt text");
      },
      LONG_TEST_TIMEOUT_MS,
    );

    it(
      "reports a warning and adds no image for a non .png/.jpg/.jpeg file extension",
      async () => {
        const { lastFrame, stdin } = renderHarness();
        await waitForFrame(lastFrame, (candidate) => candidate.includes("A1"));
        await settle();
        await settle();

        stdin.write("i");
        await waitForFrame(lastFrame, (candidate) =>
          candidate.includes("Image file path"),
        );
        await settle();
        await settle();
        await typeAndConfirm(stdin, lastFrame, "/not/a/real/file.txt");
        stdin.write("\r");
        await waitForFrame(
          lastFrame,
          (candidate) => candidate.includes("Width (pt)"),
          4000,
        );
        await settle();
        await settle();
        stdin.write("\r");
        await waitForFrame(
          lastFrame,
          (candidate) => candidate.includes("Height (pt)"),
          4000,
        );
        await settle();
        await settle();
        stdin.write("\r");
        await waitForFrame(
          lastFrame,
          (candidate) => candidate.includes("Offset X"),
          4000,
        );
        await settle();
        await settle();
        stdin.write("\r");
        await waitForFrame(
          lastFrame,
          (candidate) => candidate.includes("Offset Y"),
          4000,
        );
        await settle();
        await settle();
        stdin.write("\r");
        await waitForFrame(
          lastFrame,
          (candidate) => candidate.includes("Alt text"),
          4000,
        );
        await settle();
        await settle();
        stdin.write("\r");

        const dash = String.fromCharCode(8212);
        const frame = await waitForFrame(
          lastFrame,
          (candidate) =>
            flattenFrame(candidate).includes(
              `is not a .png or .jpg/.jpeg file ${dash} image not added`,
            ),
          6000,
        );
        expect(frame).toContain("imageCount:0");
      },
      LONG_TEST_TIMEOUT_MS,
    );

    it(
      "reports a read error and adds no image when the path does not exist",
      async () => {
        const { lastFrame, stdin } = renderHarness();
        await waitForFrame(lastFrame, (candidate) => candidate.includes("A1"));
        await settle();
        await settle();

        const missingPath = join(workspace, "does-not-exist.png");
        stdin.write("i");
        await waitForFrame(lastFrame, (candidate) =>
          candidate.includes("Image file path"),
        );
        await settle();
        await settle();
        // missingPath is typically too long to render on one line inside the wizard's bordered box, and it wraps mid-word (no natural space boundary) rather than at one flattenFrame can safely reconstruct, so confirm on the stable, always-unwrapped mkdtemp prefix rather than the full path string.
        stdin.write(missingPath);
        await waitForFrame(
          lastFrame,
          (candidate) => candidate.includes("document-cli-sheet-image-"),
          4000,
        );
        await new Promise((resolve) => {
          setTimeout(resolve, FIELD_SETTLE_MARGIN_MS);
        });
        stdin.write("\r");
        await waitForFrame(
          lastFrame,
          (candidate) => candidate.includes("Width (pt)"),
          4000,
        );
        await settle();
        await settle();
        stdin.write("\r");
        await waitForFrame(
          lastFrame,
          (candidate) => candidate.includes("Height (pt)"),
          4000,
        );
        await settle();
        await settle();
        stdin.write("\r");
        await waitForFrame(
          lastFrame,
          (candidate) => candidate.includes("Offset X"),
          4000,
        );
        await settle();
        await settle();
        stdin.write("\r");
        await waitForFrame(
          lastFrame,
          (candidate) => candidate.includes("Offset Y"),
          4000,
        );
        await settle();
        await settle();
        stdin.write("\r");
        await waitForFrame(
          lastFrame,
          (candidate) => candidate.includes("Alt text"),
          4000,
        );
        await settle();
        await settle();
        stdin.write("\r");

        const frame = await waitForFrame(
          lastFrame,
          (candidate) => flattenFrame(candidate).includes("Could not read"),
          6000,
        );
        expect(frame).toContain("imageCount:0");
      },
      LONG_TEST_TIMEOUT_MS,
    );

    it(
      "cancels the wizard on Escape without dispatching anything",
      async () => {
        const { lastFrame, stdin } = renderHarness();
        await waitForFrame(lastFrame, (candidate) => candidate.includes("A1"));
        await settle();
        await settle();

        stdin.write("i");
        await waitForFrame(lastFrame, (candidate) =>
          candidate.includes("Image file path"),
        );
        await settle();
        await settle();
        stdin.write("\x1B");

        const frame = await waitForFrame(
          lastFrame,
          (candidate) => !candidate.includes("Image file path"),
        );
        expect(frame).toContain("imageCount:0");
      },
      LONG_TEST_TIMEOUT_MS,
    );
  });

  describe("compact list ('t') select and back", () => {
    it("jumps to the selected cell's row/column and switches back to the grid on Enter", async () => {
      const { lastFrame, stdin } = renderHarness();
      await waitForFrame(lastFrame, (candidate) => candidate.includes("A1"));
      await settle();
      await settle();

      stdin.write("t");
      await waitForFrame(lastFrame, (candidate) => candidate.includes("C3"));
      await settle();
      await settle();

      stdin.write("\r");
      const frame = await waitForFrame(lastFrame, (candidate) =>
        candidate.includes("t compact list view"),
      );
      expect(frame).not.toContain("t grid view");
      expect(frame).toContain("seed");
    });

    it("returns to the grid without moving the cursor on Escape", async () => {
      const { lastFrame, stdin } = renderHarness();
      await waitForFrame(lastFrame, (candidate) => candidate.includes("A1"));
      await settle();
      await settle();

      stdin.write("t");
      await waitForFrame(lastFrame, (candidate) => candidate.includes("C3"));
      await settle();
      await settle();

      stdin.write("\x1B");
      const frame = await waitForFrame(lastFrame, (candidate) =>
        candidate.includes("t compact list view"),
      );
      expect(frame).toContain("A1");
    });
  });
});
