import { Box, Text } from "ink";
import { render } from "ink-testing-library";
import type { ReactElement } from "react";
import { useEffect, useRef } from "react";
import { describe, expect, it } from "vitest";
import {
  createOdg,
  elementsWithTag,
  openOdg,
  rootElement,
  type OdgEditor,
  type XmlElement,
} from "documents.js";
import {
  AppStateProvider,
  useAppDispatch,
  useAppState,
} from "../../../state/context.js";
import {
  currentScreen,
  type OpenDocument,
  type Screen,
} from "../../../state/types.js";
import { flattenFrame, settle, waitForFrame } from "../../../test-support.js";
import { buildPageItems } from "./shared.js";
import { OdgShapeOrVectorDetailScreen } from "./shape-or-vector-detail.js";

const PATH = "/tmp/drawing.odg";

function openOdgDocument(editor: OdgEditor): OpenDocument {
  return { format: "odg", editor: openOdg(editor.toBytes()), path: PATH };
}

// Injects a draw:circle odf.js's own reader salvages (as an 'ellipse'-kind ContentVector) but OdgPage.vectors() has no wrapper for at all — the same fixture technique shared.test.ts's own "falls back to read-only" test uses. Mutates the SAME OpenDocument the caller goes on to use, not a fresh decode of it: `openOdgDocument` re-decodes `editor.toBytes()` into an independent live tree every time it is called, so injecting into a second, throwaway decode would leave the one actually rendered untouched.
function addUnwrappableCircle(doc: OpenDocument): void {
  if (doc.format !== "odg") {
    throw new Error("addUnwrappableCircle only supports an odg document");
  }
  const pkg = doc.editor.toPackage();
  const root = rootElement(pkg.parts["content.xml"]);
  if (root === undefined) {
    throw new Error("expected a content.xml root element");
  }
  const [drawPage] = elementsWithTag([root], "draw:page");
  if (drawPage === undefined) {
    throw new Error("expected a draw:page element");
  }
  const circle: XmlElement = {
    type: "element",
    tag: "draw:circle",
    attributes: [
      { name: "svg:x", value: "200pt" },
      { name: "svg:y", value: "200pt" },
      { name: "svg:width", value: "40pt" },
      { name: "svg:height", value: "40pt" },
    ],
    children: [],
  };
  drawPage.children.push(circle);
  // toPackage() returns the SAME live tree editor.addPage()/addRect() etc. already mutated in place (see shared.ts's own PageVectorItem doc comment on why this works); pushing onto it here is enough, this function's caller only needed a page to already exist on `editor` before calling it.
}

// Renders the real screen tree once seeded: dispatches OPEN_FILE_SUCCESS with a pre-built odg document (constructed with the real documents.js editor API, so every live vector/shape handle SET_VECTOR_FILL/STROKE and SET_SHAPE_TEXT/FRAME/ROTATION dispatch against is genuine, not a fixture stand-in), then PUSH_SCREEN to the given target screen. A trailing `top:{kind}` probe line, plus a fresh `buildPageItems` read of the target page/item, lets a test observe both navigation and the live document's own post-edit state without reaching into React internals.
function Harness({
  doc,
  target,
  pageIndex = 0,
}: {
  readonly doc: OpenDocument;
  readonly target: Screen;
  readonly pageIndex?: number;
}): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const hasOpened = useRef(false);
  const hasPushed = useRef(false);

  useEffect(() => {
    if (!hasOpened.current && state.openDocument === undefined) {
      hasOpened.current = true;
      dispatch({ type: "OPEN_FILE_SUCCESS", path: PATH, doc });
      return;
    }
    if (
      !hasPushed.current &&
      state.openDocument !== undefined &&
      currentScreen(state).kind !== target.kind
    ) {
      hasPushed.current = true;
      dispatch({ type: "PUSH_SCREEN", screen: target });
    }
  }, [state, dispatch]);

  const screen =
    state.openDocument === undefined ? undefined : currentScreen(state);
  const items =
    state.openDocument?.format === "odg"
      ? buildPageItems(state.openDocument, pageIndex)
      : [];

  return (
    <Box flexDirection="column">
      {screen?.kind === "shapeOrVectorDetail" ? (
        <OdgShapeOrVectorDetailScreen />
      ) : (
        <Text>closed</Text>
      )}
      <Text>top:{screen?.kind ?? "none"}</Text>
      <Text>
        status:
        {state.status === undefined
          ? "none"
          : `${state.status.severity}:${state.status.text}`}
      </Text>
      <Text>
        items:
        {items
          .map((item) =>
            item.kind === "vector"
              ? `vector(${item.vector.kind},${item.liveVector === undefined ? "readonly" : "live"})`
              : `shape(${item.shape.text})`,
          )
          .join("|")}
      </Text>
    </Box>
  );
}

// Every predicate/assertion in this suite reads the flattened frame: a long probe or status line (the stroke-cannot-be-cleared warning runs well past the 100-column stub width) can genuinely word-wrap mid-string, splitting a literal substring an assertion expects intact — see flattenFrame's own doc comment.
async function waitForFlatFrame(
  rendered: ReturnType<typeof render>,
  predicate: (frame: string) => boolean,
): Promise<string> {
  return waitForFrame(() => flattenFrame(rendered.lastFrame()), predicate);
}

async function waitForTop(
  rendered: ReturnType<typeof render>,
  kind: string,
): Promise<string> {
  const frame = await waitForFlatFrame(rendered, (candidate) =>
    candidate.includes(`top:${kind}`),
  );
  await settle();
  return frame;
}

describe("OdgShapeOrVectorDetailScreen", () => {
  it.each([
    ["Escape", "\u001B"],
    ["h", "h"],
    ["the left arrow", "\u001B[D"],
  ] as const)(
    "shows an item-not-found message and pops the screen on %s when the item no longer exists",
    async (_label, key) => {
      const editor = createOdg();
      editor.addPage();
      const doc = openOdgDocument(editor);

      const rendered = render(
        <AppStateProvider>
          <Harness
            doc={doc}
            target={{ kind: "shapeOrVectorDetail", pageIndex: 0, itemIndex: 0 }}
          />
        </AppStateProvider>,
      );
      const frame = await waitForTop(rendered, "shapeOrVectorDetail");
      expect(frame).toContain("There is no item 0 on page 1 any more.");

      rendered.stdin.write(key);
      const after = await waitForFlatFrame(
        rendered,
        (candidate) => !candidate.includes("shapeOrVectorDetail"),
      );
      expect(after).toContain("top:pageList");
    },
  );

  it("does nothing on an unrelated key while the item-not-found message is shown", async () => {
    const editor = createOdg();
    editor.addPage();
    const doc = openOdgDocument(editor);

    const rendered = render(
      <AppStateProvider>
        <Harness
          doc={doc}
          target={{ kind: "shapeOrVectorDetail", pageIndex: 0, itemIndex: 0 }}
        />
      </AppStateProvider>,
    );
    const before = await waitForTop(rendered, "shapeOrVectorDetail");
    rendered.stdin.write("x");
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
    expect(flattenFrame(rendered.lastFrame())).toBe(before);
  });

  it("routes a vector item to VectorDetail with its own live handle and shows Fill/Stroke rows for a box vector", async () => {
    const editor = createOdg();
    const page = editor.addPage();
    page.addRect({
      frame: { xPt: 10, yPt: 10, widthPt: 40, heightPt: 30 },
      fill: { r: 1, g: 0, b: 0 },
    });
    const doc = openOdgDocument(editor);

    const rendered = render(
      <AppStateProvider>
        <Harness
          doc={doc}
          target={{ kind: "shapeOrVectorDetail", pageIndex: 0, itemIndex: 0 }}
        />
      </AppStateProvider>,
    );
    const frame = await waitForTop(rendered, "shapeOrVectorDetail");
    expect(frame).toContain("Rect");
    expect(frame).toMatch(/Fill: rgb\(1\.00, 0\.00, 0\.00\)/);
    expect(frame).toMatch(/Stroke: none/);
    expect(frame).toContain("Enter to edit a field, Esc to go back");
  });

  it("omits the Fill row entirely for a line vector, which has none to show", async () => {
    const editor = createOdg();
    const page = editor.addPage();
    page.addLine({
      from: { xPt: 0, yPt: 0 },
      to: { xPt: 100, yPt: 0 },
      stroke: { color: { r: 0, g: 0, b: 0 }, widthPt: 1 },
    });
    const doc = openOdgDocument(editor);

    const rendered = render(
      <AppStateProvider>
        <Harness
          doc={doc}
          target={{ kind: "shapeOrVectorDetail", pageIndex: 0, itemIndex: 0 }}
        />
      </AppStateProvider>,
    );
    const frame = await waitForTop(rendered, "shapeOrVectorDetail");
    expect(frame).toContain("Line");
    expect(frame).not.toContain("Fill:");
    expect(frame).toMatch(/Stroke: rgb\(0\.00, 0\.00, 0\.00\) 1\.0pt/);
  });

  it("starts the Fill row's own edit box empty when the vector has no fill of its own", async () => {
    const editor = createOdg();
    const page = editor.addPage();
    page.addRect({ frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 } });
    const doc = openOdgDocument(editor);

    const rendered = render(
      <AppStateProvider>
        <Harness
          doc={doc}
          target={{ kind: "shapeOrVectorDetail", pageIndex: 0, itemIndex: 0 }}
        />
      </AppStateProvider>,
    );
    await waitForTop(rendered, "shapeOrVectorDetail");
    rendered.stdin.write("\r");
    await settle();
    // Typing straight after Enter, with no backspacing first, proves the box started empty: a fixed "0.9 0.9 0.9" landing means currentValue's own "" branch for an undefined fill never ran, leaving a leftover non-empty draft from React's own initial state instead.
    rendered.stdin.write("0.9 0.9 0.9");
    await settle();
    rendered.stdin.write("\r");

    const frame = await waitForFlatFrame(rendered, (candidate) =>
      candidate.includes("0.90, 0.90, 0.90"),
    );
    expect(frame).toMatch(/Fill: rgb\(0\.90, 0\.90, 0\.90\)/);
  });

  it("commits a new fill through SET_VECTOR_FILL when the Fill row is edited, over its own real pre-filled value", async () => {
    const editor = createOdg();
    const page = editor.addPage();
    page.addRect({
      frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
      fill: { r: 1, g: 0, b: 0 },
      stroke: { color: { r: 0, g: 0, b: 1 }, widthPt: 2 },
    });
    const doc = openOdgDocument(editor);

    const rendered = render(
      <AppStateProvider>
        <Harness
          doc={doc}
          target={{ kind: "shapeOrVectorDetail", pageIndex: 0, itemIndex: 0 }}
        />
      </AppStateProvider>,
    );
    const listFrame = await waitForTop(rendered, "shapeOrVectorDetail");
    // Fill is the first (selected-by-default) row, Stroke the second: the ">" marker distinguishes which one, and each row's own real fill/stroke values back its label. flattenFrame collapses the unselected marker's own "  " down to a single space alongside any real line wrap, so the absence of "> " directly before "Stroke:" is what actually proves it, not an exact space count.
    expect(listFrame).toMatch(/> Fill: rgb\(1\.00, 0\.00, 0\.00\)/);
    expect(listFrame).toContain("Stroke: rgb(0.00, 0.00, 1.00) 2.0pt");
    expect(listFrame).not.toContain("> Stroke:");

    rendered.stdin.write("\r");
    const editFrame = await waitForFlatFrame(
      rendered,
      (candidate) =>
        !candidate.includes("Enter to edit a field, Esc to go back"),
    );
    // The edit box's own starting value is the real currentValue built from vector.fill (buildVectorRows), not the field's own leftover React state from a previous edit — proves setDraft(row.currentValue) actually ran.
    expect(editFrame).toContain("1 0 0");
    await settle();
    let remainingChars = "1 0 0".length;
    while (remainingChars > 0) {
      rendered.stdin.write("\x7f");
      await settle();
      remainingChars -= 1;
    }
    rendered.stdin.write("0.25 0.5 0.75");
    await settle();
    rendered.stdin.write("\r");

    // "live)" alone would match the pre-existing "vector(rect,live)" item probe from before the edit landed; wait for the new fill value specifically.
    const frame = await waitForFlatFrame(rendered, (candidate) =>
      candidate.includes("0.25, 0.50, 0.75"),
    );
    expect(frame).toContain("vector(rect,live)");
    expect(frame).toMatch(/Fill: rgb\(0\.25, 0\.50, 0\.75\)/);
  });

  it("commits a new stroke through SET_VECTOR_STROKE when the Stroke row is edited with a valid value", async () => {
    const editor = createOdg();
    const page = editor.addPage();
    page.addRect({ frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 } });
    const doc = openOdgDocument(editor);

    const rendered = render(
      <AppStateProvider>
        <Harness
          doc={doc}
          target={{ kind: "shapeOrVectorDetail", pageIndex: 0, itemIndex: 0 }}
        />
      </AppStateProvider>,
    );
    await waitForTop(rendered, "shapeOrVectorDetail");
    // Stroke is the second row: one down, then Enter.
    rendered.stdin.write("j");
    await settle();
    rendered.stdin.write("\r");
    await settle();
    rendered.stdin.write("0 0 1 2.5");
    await settle();
    rendered.stdin.write("\r");

    const frame = await waitForFlatFrame(rendered, (candidate) =>
      candidate.includes("2.5pt"),
    );
    expect(frame).toMatch(/Stroke: rgb\(0\.00, 0\.00, 1\.00\) 2\.5pt/);
  });

  it("warns instead of clearing the stroke when the Stroke row is submitted blank", async () => {
    const editor = createOdg();
    const page = editor.addPage();
    page.addRect({
      frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
      stroke: { color: { r: 0, g: 0, b: 0 }, widthPt: 1 },
    });
    const doc = openOdgDocument(editor);

    const rendered = render(
      <AppStateProvider>
        <Harness
          doc={doc}
          target={{ kind: "shapeOrVectorDetail", pageIndex: 0, itemIndex: 0 }}
        />
      </AppStateProvider>,
    );
    const listFrame = await waitForTop(rendered, "shapeOrVectorDetail");
    // This rect has a stroke but no fill of its own, unlike the sibling "commits a new fill" test's fixture — together the two cover both the defined and the "none" label branch for each field.
    expect(listFrame).toMatch(/Fill: none/);
    rendered.stdin.write("j");
    await settle();
    rendered.stdin.write("\r");
    const editFrame = await waitForFlatFrame(
      rendered,
      (candidate) =>
        !candidate.includes("Enter to edit a field, Esc to go back"),
    );
    // Proves buildVectorRows' own currentValue (built from vector.stroke) actually reached the edit box, not a leftover empty draft.
    expect(editFrame).toContain("0 0 0 1");
    await settle();
    // Clear the pre-filled "0 0 0 1" currentValue down to empty, then submit.
    for (let step = 0; step < 8; step += 1) {
      rendered.stdin.write("\x7f");
      await settle();
    }
    rendered.stdin.write("\r");

    const frame = await waitForFlatFrame(rendered, (candidate) =>
      candidate.includes("cannot be cleared to none"),
    );
    expect(frame).toContain(
      'A vector stroke cannot be cleared to none through this editor — enter "r g b widthPt" (0-1 colour, pt width) instead',
    );
    // The original stroke survives untouched — the warning path never dispatches SET_VECTOR_STROKE.
    expect(frame).toMatch(/Stroke: rgb\(0\.00, 0\.00, 0\.00\) 1\.0pt/);
  });

  it("cancels an in-progress field edit on Escape without committing anything", async () => {
    const editor = createOdg();
    const page = editor.addPage();
    page.addRect({
      frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
      fill: { r: 1, g: 1, b: 1 },
    });
    const doc = openOdgDocument(editor);

    const rendered = render(
      <AppStateProvider>
        <Harness
          doc={doc}
          target={{ kind: "shapeOrVectorDetail", pageIndex: 0, itemIndex: 0 }}
        />
      </AppStateProvider>,
    );
    await waitForTop(rendered, "shapeOrVectorDetail");
    rendered.stdin.write("\r");
    await settle();
    rendered.stdin.write("9 9 9");
    await settle();
    rendered.stdin.write("\u001B");

    const frame = await waitForFlatFrame(rendered, (candidate) =>
      candidate.includes("Enter to edit a field, Esc to go back"),
    );
    expect(frame).toMatch(/Fill: rgb\(1\.00, 1\.00, 1\.00\)/);
    expect(frame).not.toContain("rgb(9.00");
  });

  it("pops the screen on Escape from the row list", async () => {
    const editor = createOdg();
    const page = editor.addPage();
    page.addRect({ frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 } });
    const doc = openOdgDocument(editor);

    const rendered = render(
      <AppStateProvider>
        <Harness
          doc={doc}
          target={{ kind: "shapeOrVectorDetail", pageIndex: 0, itemIndex: 0 }}
        />
      </AppStateProvider>,
    );
    await waitForTop(rendered, "shapeOrVectorDetail");
    rendered.stdin.write("\u001B");

    const frame = await waitForFlatFrame(rendered, (candidate) =>
      candidate.includes("top:pageList"),
    );
    expect(frame).toContain("top:pageList");
  });

  it("shows a vector read-only when the page also carries an element OdgPage.vectors() cannot wrap, and still pops on Escape", async () => {
    const editor = createOdg();
    const page = editor.addPage();
    page.addRect({
      frame: { xPt: 10, yPt: 10, widthPt: 40, heightPt: 30 },
      fill: { r: 1, g: 0, b: 0 },
    });
    const doc = openOdgDocument(editor);
    addUnwrappableCircle(doc);

    const rendered = render(
      <AppStateProvider>
        <Harness
          doc={doc}
          target={{ kind: "shapeOrVectorDetail", pageIndex: 0, itemIndex: 0 }}
        />
      </AppStateProvider>,
    );
    const frame = await waitForTop(rendered, "shapeOrVectorDetail");
    expect(frame).toContain("(view-only)");
    expect(frame).toContain(
      "This page's live vectors (documents.js's `OdgPage.vectors()`) don't",
    );
    expect(frame).toContain("Esc to go back");
    expect(frame).not.toContain("Enter to edit a field");

    rendered.stdin.write("\u001B");
    const after = await waitForFlatFrame(rendered, (candidate) =>
      candidate.includes("top:pageList"),
    );
    expect(after).toContain("top:pageList");
  });

  it("routes a shape item to ShapeDetail, addressed past however many vectors precede it on the same page", async () => {
    const editor = createOdg();
    const page = editor.addPage();
    page.addRect({ frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 } });
    page.addTextBox({
      frame: { xPt: 5, yPt: 5, widthPt: 80, heightPt: 40 },
      text: "hello",
    });
    const doc = openOdgDocument(editor);

    const rendered = render(
      <AppStateProvider>
        <Harness
          doc={doc}
          target={{ kind: "shapeOrVectorDetail", pageIndex: 0, itemIndex: 1 }}
        />
      </AppStateProvider>,
    );
    const frame = await waitForTop(rendered, "shapeOrVectorDetail");
    expect(frame).toContain("Shape");
    expect(frame).toContain("Text: hello");
    expect(frame).toContain("X: 5.0pt");
    expect(frame).toContain("Y: 5.0pt");
    expect(frame).toContain("Width: 80.0pt");
    expect(frame).toContain("Height: 40.0pt");
    expect(frame).toContain("Rotation: none");
  });

  it("commits a new shape text through SET_SHAPE_TEXT, addressed by the shape's own index excluding vectors", async () => {
    const editor = createOdg();
    const page = editor.addPage();
    page.addRect({ frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 } });
    page.addTextBox({
      frame: { xPt: 5, yPt: 5, widthPt: 80, heightPt: 40 },
      text: "hello",
    });
    const doc = openOdgDocument(editor);

    const rendered = render(
      <AppStateProvider>
        <Harness
          doc={doc}
          target={{ kind: "shapeOrVectorDetail", pageIndex: 0, itemIndex: 1 }}
        />
      </AppStateProvider>,
    );
    const listFrame = await waitForTop(rendered, "shapeOrVectorDetail");
    // ">"/"  " distinguishes the selected row from any sibling; Text is the first (selected-by-default) row.
    expect(listFrame).toContain("> Text: hello");
    rendered.stdin.write("\r");
    const editFrame = await waitForFlatFrame(
      rendered,
      (candidate) =>
        !candidate.includes("Enter to edit a field, Esc to go back"),
    );
    // Proves setDraft(row.currentValue) actually populated the edit box from the shape's own real text, not a leftover empty draft.
    expect(editFrame).toContain("hello");
    await settle();
    let remainingChars = "hello".length;
    while (remainingChars > 0) {
      rendered.stdin.write("\x7f");
      await settle();
      remainingChars -= 1;
    }
    rendered.stdin.write("bonjour");
    await settle();
    rendered.stdin.write("\r");

    const frame = await waitForFlatFrame(rendered, (candidate) =>
      candidate.includes("shape(bonjour)"),
    );
    expect(frame).toContain("Text: bonjour");
  });

  it.each([
    {
      field: "X",
      downCount: 1,
      initial: "5",
      other: { Y: "6.0pt", Width: "80.0pt", Height: "40.0pt" },
    },
    {
      field: "Y",
      downCount: 2,
      initial: "6",
      other: { X: "5.0pt", Width: "80.0pt", Height: "40.0pt" },
    },
    {
      field: "Width",
      downCount: 3,
      initial: "80",
      other: { X: "5.0pt", Y: "6.0pt", Height: "40.0pt" },
    },
    {
      field: "Height",
      downCount: 4,
      initial: "40",
      other: { X: "5.0pt", Y: "6.0pt", Width: "80.0pt" },
    },
  ] as const)(
    "commits a new $field through SET_SHAPE_FRAME, leaving the other frame fields untouched",
    async ({ field, downCount, initial, other }) => {
      const editor = createOdg();
      const page = editor.addPage();
      page.addTextBox({
        frame: { xPt: 5, yPt: 6, widthPt: 80, heightPt: 40 },
        text: "hello",
      });
      const doc = openOdgDocument(editor);

      const rendered = render(
        <AppStateProvider>
          <Harness
            doc={doc}
            target={{
              kind: "shapeOrVectorDetail",
              pageIndex: 0,
              itemIndex: 0,
            }}
          />
        </AppStateProvider>,
      );
      await waitForTop(rendered, "shapeOrVectorDetail");
      // Text is row 0; X/Y/Width/Height are rows 1-4 in that order.
      for (let step = 0; step < downCount; step += 1) {
        rendered.stdin.write("j");
        await settle();
      }
      rendered.stdin.write("\r");
      await settle();
      let remainingChars = initial.length;
      while (remainingChars > 0) {
        rendered.stdin.write("\x7f");
        await settle();
        remainingChars -= 1;
      }
      rendered.stdin.write("42");
      await settle();
      rendered.stdin.write("\r");

      const frame = await waitForFlatFrame(rendered, (candidate) =>
        candidate.includes(`${field}: 42.0pt`),
      );
      expect(frame).toContain(`${field}: 42.0pt`);
      for (const [otherField, expected] of Object.entries(other)) {
        expect(frame).toContain(`${otherField}: ${expected}`);
      }
    },
  );

  it("sets a rotation through SET_SHAPE_ROTATION when the Rotation row is given a value", async () => {
    const editor = createOdg();
    const page = editor.addPage();
    page.addTextBox({
      frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
      text: "hello",
    });
    const doc = openOdgDocument(editor);

    const rendered = render(
      <AppStateProvider>
        <Harness
          doc={doc}
          target={{ kind: "shapeOrVectorDetail", pageIndex: 0, itemIndex: 0 }}
        />
      </AppStateProvider>,
    );
    await waitForTop(rendered, "shapeOrVectorDetail");
    // Rotation is the sixth (last) row: Text, X, Y, Width, Height, Rotation.
    for (let step = 0; step < 5; step += 1) {
      rendered.stdin.write("j");
      await settle();
    }
    rendered.stdin.write("\r");
    await settle();
    rendered.stdin.write("45");
    await settle();
    rendered.stdin.write("\r");

    const frame = await waitForFlatFrame(rendered, (candidate) =>
      candidate.includes("Rotation: 45.0 deg"),
    );
    expect(frame).toContain("Rotation: 45.0 deg");
  });

  // A longer per-test timeout than the suite's default: clearing a floating-point-tailed rotation value (applyOdfGeometry's own radians round-trip) needs one settle() per character, and that tail can run to ~18 characters.
  it("clears the rotation back to undefined through SET_SHAPE_ROTATION when the row is submitted blank", async () => {
    const editor = createOdg();
    const page = editor.addPage();
    const shape = page.addTextBox({
      frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
      text: "hello",
    });
    shape.rotationDeg = 30;
    // The edit row's own currentValue is the raw `String(shape.rotationDeg)`, not the rounded "30.0" its label displays — applyOdfGeometry's own radians round-trip can leave a floating-point tail, so the exact character count to clear is read back from the same live shape rather than assumed.
    const rawRotationLength = String(shape.rotationDeg).length;
    const doc = openOdgDocument(editor);

    const rendered = render(
      <AppStateProvider>
        <Harness
          doc={doc}
          target={{ kind: "shapeOrVectorDetail", pageIndex: 0, itemIndex: 0 }}
        />
      </AppStateProvider>,
    );
    const frame0 = await waitForTop(rendered, "shapeOrVectorDetail");
    expect(frame0).toContain("Rotation: 30.0 deg");

    for (let step = 0; step < 5; step += 1) {
      rendered.stdin.write("j");
      await settle();
    }
    rendered.stdin.write("\r");
    const editFrame = await waitForFlatFrame(
      rendered,
      (candidate) =>
        !candidate.includes("Enter to edit a field, Esc to go back"),
    );
    // Proves the Rotation row's own currentValue ternary actually took its defined-value branch (String(shape.rotationDeg)), not a hardcoded "" regardless of whether a rotation is set.
    expect(editFrame).toContain(String(shape.rotationDeg));
    await settle();
    for (let step = 0; step < rawRotationLength; step += 1) {
      rendered.stdin.write("\x7f");
      await settle();
    }
    rendered.stdin.write("\r");

    const frame = await waitForFlatFrame(rendered, (candidate) =>
      candidate.includes("Rotation: none"),
    );
    expect(frame).toContain("Rotation: none");
  }, 15000);

  it("cancels an in-progress shape field edit on Escape without committing anything", async () => {
    const editor = createOdg();
    const page = editor.addPage();
    page.addTextBox({
      frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
      text: "hello",
    });
    const doc = openOdgDocument(editor);

    const rendered = render(
      <AppStateProvider>
        <Harness
          doc={doc}
          target={{ kind: "shapeOrVectorDetail", pageIndex: 0, itemIndex: 0 }}
        />
      </AppStateProvider>,
    );
    await waitForTop(rendered, "shapeOrVectorDetail");
    rendered.stdin.write("\r");
    await settle();
    rendered.stdin.write("changed");
    await settle();
    rendered.stdin.write("\u001B");

    const frame = await waitForFlatFrame(rendered, (candidate) =>
      candidate.includes("Enter to edit a field, Esc to go back"),
    );
    expect(frame).toContain("Text: hello");
    expect(frame).not.toContain("changed");
  });

  it("pops the screen on Escape from a shape's own row list", async () => {
    const editor = createOdg();
    const page = editor.addPage();
    page.addTextBox({
      frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
      text: "hello",
    });
    const doc = openOdgDocument(editor);

    const rendered = render(
      <AppStateProvider>
        <Harness
          doc={doc}
          target={{ kind: "shapeOrVectorDetail", pageIndex: 0, itemIndex: 0 }}
        />
      </AppStateProvider>,
    );
    await waitForTop(rendered, "shapeOrVectorDetail");
    rendered.stdin.write("\u001B");

    const frame = await waitForFlatFrame(rendered, (candidate) =>
      candidate.includes("top:pageList"),
    );
    expect(frame).toContain("top:pageList");
  });
});
