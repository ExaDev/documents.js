import { openDocx } from "documents.js";
import { Text } from "ink";
import { render } from "ink-testing-library";
import { useEffect, type ReactElement } from "react";
import { describe, expect, it } from "vitest";
import {
  buildDocxWithExtras,
  DOCX_EXTRAS_FIXTURE,
} from "../../../../test-support/docx-extras-fixture.js";
import {
  AppStateProvider,
  useAppDispatch,
  useAppState,
} from "../../../state/context.js";
import { currentScreen } from "../../../state/types.js";
import { settle, waitForFrame } from "../../../test-support.js";
import { DocxExtrasScreen } from "./extras.js";
import { DocxBodyListScreen } from "./index.js";

// `AppStateProvider` exposes no way to seed its initial state from outside, so this harness opens a real docx document the same way the real app does: by dispatching `OPEN_FILE_SUCCESS` from an effect after mount, with a genuine `DocxEditor` built by `openDocx` over the real fixture bytes (test-support/docx-extras-fixture.ts) -- not a hand-built `DocxExtras` value. Only `bodyList`/`docxExtras` are routed, the two screens 'x' actually connects.
function DocxExtrasHarness(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();

  useEffect(() => {
    dispatch({
      type: "OPEN_FILE_SUCCESS",
      path: "extras.docx",
      doc: {
        format: "docx",
        editor: openDocx(buildDocxWithExtras()),
        path: "extras.docx",
      },
    });
  }, [dispatch]);

  if (state.openDocument === undefined) {
    return <Text>loading</Text>;
  }

  const screen = currentScreen(state);
  switch (screen.kind) {
    case "bodyList":
      return <DocxBodyListScreen />;
    case "docxExtras":
      return <DocxExtrasScreen />;
    default:
      return <Text>unexpected screen: {screen.kind}</Text>;
  }
}

function renderHarness() {
  return render(
    <AppStateProvider>
      <DocxExtrasHarness />
    </AppStateProvider>,
  );
}

describe("DocxExtrasScreen", () => {
  it("opens from the body list with 'x' and shows the fixture's own comments, footnotes, headers, footers, and numbering", async () => {
    const { lastFrame, stdin } = renderHarness();
    await waitForFrame(lastFrame, (frame) => frame.includes("Body (docx)"));
    await settle();

    stdin.write("x");

    const frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("Comments, footnotes, headers, footers, numbering"),
    );
    expect(frame).toContain(DOCX_EXTRAS_FIXTURE.commentAuthor);
    expect(frame).toContain(DOCX_EXTRAS_FIXTURE.commentWithAuthorText);
    expect(frame).toContain(DOCX_EXTRAS_FIXTURE.footnoteText);
    expect(frame).toContain(DOCX_EXTRAS_FIXTURE.headerText);
    expect(frame).toContain(DOCX_EXTRAS_FIXTURE.footerText);
    expect(frame).toContain(`numId ${DOCX_EXTRAS_FIXTURE.numId}`);
  });

  it("goes back to the body list on Esc/h", async () => {
    const { lastFrame, stdin } = renderHarness();
    await waitForFrame(lastFrame, (frame) => frame.includes("Body (docx)"));
    await settle();
    stdin.write("x");
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("Comments, footnotes, headers, footers, numbering"),
    );
    await settle();

    stdin.write("h");

    const frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("Body (docx)"),
    );
    expect(frame).toContain("Paragraphs");
  });
});
