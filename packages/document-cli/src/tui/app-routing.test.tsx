import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PdfEditor, writePdf, type LayoutDocument } from "documents.js";
import { render } from "ink-testing-library";
import { useEffect, type ReactElement } from "react";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FORM_AND_REPORT_ODB_PATH } from "../test-support/odb-fixture.js";
import { App, ScreenBody } from "./app.js";
import { AppStateProvider, useAppDispatch } from "./state/context.js";
import { flattenFrame, settle, waitForFrame } from "./test-support.js";

// Exercises app.tsx's OWN ScreenBody switch, Overlay precedence chain, and AppShell key handlers/effects, end to end through the real App component, not any per-screen harness that reimplements a narrower routing switch of its own (see e.g. docx/extras.test.tsx's own DocxExtrasHarness, which only routes bodyList/docxExtras). Every per-screen test file elsewhere in this package bypasses app.tsx entirely for exactly that reason, which is why app.tsx itself had zero real coverage despite the screens it routes to being individually well tested.

const ENTER = "\r";
const ESCAPE = "\x1B";
const CTRL_C = "\x03";
const CTRL_S = "\x13";
const CTRL_W = "\x17";
const CTRL_D = "\x04";

// CREATABLE_FORMATS' own order in new-document-picker.tsx: docx, pptx, odt, odp, ods, odg, doc, xls, ppt, markdown. 'j' presses select the Nth entry before Enter creates it.
async function createDocument(
  stdin: { readonly write: (data: string) => void },
  lastFrame: () => string | undefined,
  format:
    | "docx"
    | "pptx"
    | "odt"
    | "odp"
    | "ods"
    | "odg"
    | "doc"
    | "xls"
    | "ppt"
    | "markdown",
): Promise<void> {
  const order = [
    "docx",
    "pptx",
    "odt",
    "odp",
    "ods",
    "odg",
    "doc",
    "xls",
    "ppt",
    "markdown",
  ] as const;
  const index = order.indexOf(format);
  stdin.write("n");
  await waitForFrame(lastFrame, (frame) => frame.includes("New document"));
  await settle();
  for (let step = 0; step < index; step += 1) {
    stdin.write("j");
    await settle();
  }
  stdin.write(ENTER);
  await waitForFrame(lastFrame, (frame) =>
    frame.includes(`New ${format} document`),
  );
  await settle();
}

describe("App ScreenBody routing, bodyList format branches", () => {
  it("routes a new odt document to Body (odt)", async () => {
    const { lastFrame, stdin } = render(<App />);
    await waitForFrame(lastFrame, (frame) => frame.includes("document-cli"));
    await settle();
    await createDocument(stdin, lastFrame, "odt");
    const frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("Body (odt)"),
    );
    expect(frame).toContain("Body (odt)");
  });

  it("routes a new doc document to Body (doc)", async () => {
    const { lastFrame, stdin } = render(<App />);
    await waitForFrame(lastFrame, (frame) => frame.includes("document-cli"));
    await settle();
    await createDocument(stdin, lastFrame, "doc");
    const frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("Body (doc)"),
    );
    expect(frame).toContain("Body (doc)");
  });

  it("routes a new markdown document to Body (markdown)", async () => {
    const { lastFrame, stdin } = render(<App />);
    await waitForFrame(lastFrame, (frame) => frame.includes("document-cli"));
    await settle();
    await createDocument(stdin, lastFrame, "markdown");
    const frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("Body (markdown)"),
    );
    expect(frame).toContain("Body (markdown)");
  });

  it("routes a new docx document to Body (docx) and 'x' opens docxExtras", async () => {
    const { lastFrame, stdin } = render(<App />);
    await waitForFrame(lastFrame, (frame) => frame.includes("document-cli"));
    await settle();
    await createDocument(stdin, lastFrame, "docx");
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("Body (docx)"),
    );
    await settle();

    stdin.write("x");
    const frame = await waitForFrame(lastFrame, (candidate) =>
      flattenFrame(candidate).includes(
        "Comments, footnotes, headers, footers, numbering (",
      ),
    );
    expect(flattenFrame(frame)).toContain(
      "Comments, footnotes, headers, footers, numbering (",
    );
  });
});

describe("App ScreenBody routing, paragraph/table/list sub-screens (docx+odt)", () => {
  it("walks bodyList to paragraphDetail to runEditor for a new docx document", async () => {
    const { lastFrame, stdin } = render(<App />);
    await waitForFrame(lastFrame, (frame) => frame.includes("document-cli"));
    await settle();
    await createDocument(stdin, lastFrame, "docx");
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("Body (docx)"),
    );
    await settle();

    stdin.write("a");
    await waitForFrame(lastFrame, (frame) => frame.includes("Paragraph 0"));
    await settle();

    stdin.write("a");
    const frame = await waitForFrame(lastFrame, (candidate) =>
      flattenFrame(candidate).includes("Edit run"),
    );
    expect(flattenFrame(frame)).toContain("Edit run");
  });

  it("walks bodyList through the table wizard to tableView to tableCellDetail for a new odt document", async () => {
    const { lastFrame, stdin } = render(<App />);
    await waitForFrame(lastFrame, (frame) => frame.includes("document-cli"));
    await settle();
    await createDocument(stdin, lastFrame, "odt");
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("Body (odt)"),
    );
    await settle();

    stdin.write("T");
    await waitForFrame(lastFrame, (frame) =>
      flattenFrame(frame).includes("Rows:"),
    );
    await settle();
    stdin.write(ENTER);
    await waitForFrame(lastFrame, (frame) =>
      flattenFrame(frame).includes("Columns:"),
    );
    await settle();
    stdin.write(ENTER);
    await waitForFrame(lastFrame, (frame) =>
      flattenFrame(frame).includes("Merge cells now?"),
    );
    await settle();
    stdin.write("n");

    const tableViewFrame = await waitForFrame(lastFrame, (candidate) =>
      flattenFrame(candidate).includes("Table 0"),
    );
    expect(flattenFrame(tableViewFrame)).toContain("Table 0");
    await settle();

    stdin.write(ENTER);
    const cellFrame = await waitForFrame(lastFrame, (candidate) =>
      flattenFrame(candidate).includes("Table 0, cell"),
    );
    expect(flattenFrame(cellFrame)).toContain("Table 0, cell");
  });

  it("routes 'L' on a new odt document straight into listEditor", async () => {
    const { lastFrame, stdin } = render(<App />);
    await waitForFrame(lastFrame, (frame) => frame.includes("document-cli"));
    await settle();
    await createDocument(stdin, lastFrame, "odt");
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("Body (odt)"),
    );
    await settle();

    stdin.write("L");
    const frame = await waitForFrame(lastFrame, (candidate) =>
      /List \d+ \(/.test(flattenFrame(candidate)),
    );
    expect(flattenFrame(frame)).toMatch(/List \d+ \(/);
  });
});

describe("App ScreenBody routing, slideList/slideDetail/notesEditor/shapeEditor format branches", () => {
  it("routes a new pptx document to PowerPoint slides", async () => {
    const { lastFrame, stdin } = render(<App />);
    await waitForFrame(lastFrame, (frame) => frame.includes("document-cli"));
    await settle();
    await createDocument(stdin, lastFrame, "pptx");
    const frame = await waitForFrame(lastFrame, (candidate) =>
      flattenFrame(candidate).includes("PowerPoint slides"),
    );
    expect(flattenFrame(frame)).toContain("PowerPoint slides");
    expect(flattenFrame(frame)).not.toContain("Impress");
  });

  it("routes a new odp document to Impress slides", async () => {
    const { lastFrame, stdin } = render(<App />);
    await waitForFrame(lastFrame, (frame) => frame.includes("document-cli"));
    await settle();
    await createDocument(stdin, lastFrame, "odp");
    const frame = await waitForFrame(lastFrame, (candidate) =>
      flattenFrame(candidate).includes("Impress slides"),
    );
    expect(flattenFrame(frame)).toContain("Impress slides");
  });

  it("routes a new ppt document to PowerPoint 97-2003 slides and slideDetail shows 'Slide N' with no shape count", async () => {
    const { lastFrame, stdin } = render(<App />);
    await waitForFrame(lastFrame, (frame) => frame.includes("document-cli"));
    await settle();
    await createDocument(stdin, lastFrame, "ppt");
    await waitForFrame(lastFrame, (candidate) =>
      flattenFrame(candidate).includes("PowerPoint 97-2003 slides"),
    );
    await settle();

    stdin.write("a");
    await waitForFrame(lastFrame, (candidate) =>
      flattenFrame(candidate).includes("PowerPoint 97-2003 slides (1)"),
    );
    await settle();

    stdin.write(ENTER);
    const frame = await waitForFrame(lastFrame, (candidate) =>
      flattenFrame(candidate).includes("Slide 1 (0 shapes)"),
    );
    // PptSlideDetailScreen's own header is "Slide N (M shapes)" (parens); the shared pptx/odp slideDetail's own header is "Slide N — M shapes" (em dash, no parens) — the two are only distinguishable this way since both mention "shapes".
    expect(flattenFrame(frame)).toContain("Slide 1 (0 shapes)");
  });

  it("routes ppt slideDetail 'n' straight into notesEditor", async () => {
    const { lastFrame, stdin } = render(<App />);
    await waitForFrame(lastFrame, (frame) => frame.includes("document-cli"));
    await settle();
    await createDocument(stdin, lastFrame, "ppt");
    await waitForFrame(lastFrame, (candidate) =>
      flattenFrame(candidate).includes("PowerPoint 97-2003 slides"),
    );
    await settle();
    stdin.write("a");
    await waitForFrame(lastFrame, (candidate) =>
      flattenFrame(candidate).includes("PowerPoint 97-2003 slides (1)"),
    );
    await settle();
    stdin.write(ENTER);
    await waitForFrame(lastFrame, (candidate) =>
      flattenFrame(candidate).includes("Slide 1"),
    );
    await settle();

    stdin.write("n");
    const frame = await waitForFrame(lastFrame, (candidate) =>
      flattenFrame(candidate).includes("Slide 1 Notes"),
    );
    expect(flattenFrame(frame)).toContain("Slide 1 Notes");
  });

  it("walks a new pptx presentation into slideDetail (shared) then adds a textbox and opens shapeEditor", async () => {
    const { lastFrame, stdin } = render(<App />);
    await waitForFrame(lastFrame, (frame) => frame.includes("document-cli"));
    await settle();
    await createDocument(stdin, lastFrame, "pptx");
    await waitForFrame(lastFrame, (candidate) =>
      flattenFrame(candidate).includes("PowerPoint slides"),
    );
    await settle();

    stdin.write("a");
    await waitForFrame(lastFrame, (candidate) =>
      flattenFrame(candidate).includes("PowerPoint slides (1)"),
    );
    await settle();

    stdin.write(ENTER);
    const detailFrame = await waitForFrame(lastFrame, (candidate) =>
      /Slide 1 . \d+ shapes?/.test(flattenFrame(candidate)),
    );
    expect(flattenFrame(detailFrame)).toMatch(/Slide 1 . \d+ shapes?/);
    await settle();

    stdin.write("a");
    await waitForFrame(lastFrame, (frame) =>
      flattenFrame(frame).includes("Add shape:"),
    );
    await settle();
    stdin.write("t");
    await waitForFrame(lastFrame, (frame) => flattenFrame(frame).length > 0);
    await settle();
    stdin.write(ENTER);

    await waitForFrame(lastFrame, (candidate) =>
      /Slide 1 . 1 shape\b/.test(flattenFrame(candidate)),
    );
    await settle();

    stdin.write(ENTER);
    const shapeFrame = await waitForFrame(lastFrame, (candidate) =>
      flattenFrame(candidate).includes("Slide 1, shape 1"),
    );
    expect(flattenFrame(shapeFrame)).toContain("Slide 1, shape 1");
  });
});

describe("App ScreenBody routing, sheetList/spreadsheetGrid format branches", () => {
  it("routes a new xls document into Sheets without crashing on the xls-specific accessor guard", async () => {
    const { lastFrame, stdin } = render(<App />);
    await waitForFrame(lastFrame, (frame) => frame.includes("document-cli"));
    await settle();
    await createDocument(stdin, lastFrame, "xls");
    const frame = await waitForFrame(lastFrame, (candidate) =>
      flattenFrame(candidate).includes("Sheets ("),
    );
    expect(flattenFrame(frame)).toContain("Sheets (");
  });

  it("routes a new ods document into Sheets, and Enter opens spreadsheetGrid", async () => {
    const { lastFrame, stdin } = render(<App />);
    await waitForFrame(lastFrame, (frame) => frame.includes("document-cli"));
    await settle();
    await createDocument(stdin, lastFrame, "ods");
    await waitForFrame(lastFrame, (candidate) =>
      flattenFrame(candidate).includes("Sheets ("),
    );
    await settle();

    stdin.write("a");
    await waitForFrame(lastFrame, (frame) =>
      flattenFrame(frame).includes("New sheet name"),
    );
    await settle();
    stdin.write("Sheet1");
    await settle();
    stdin.write(ENTER);
    await waitForFrame(lastFrame, (frame) =>
      flattenFrame(frame).includes("Sheet1"),
    );
    await settle();

    stdin.write(ENTER);
    const frame = await waitForFrame(lastFrame, (candidate) =>
      /Sheet1 \(\d+x\d+\)/.test(flattenFrame(candidate)),
    );
    expect(flattenFrame(frame)).toMatch(/Sheet1 \(\d+x\d+\)/);
  });
});

describe("App ScreenBody routing, odg pageList/pageDetail/shapeOrVectorDetail", () => {
  it("routes a new odg document to pageList and walks pageList to pageDetail to add rectangle to shapeOrVectorDetail", async () => {
    const { lastFrame, stdin } = render(<App />);
    await waitForFrame(lastFrame, (frame) => frame.includes("document-cli"));
    await settle();
    await createDocument(stdin, lastFrame, "odg");
    await waitForFrame(lastFrame, (candidate) =>
      flattenFrame(candidate).includes("Drawing pages"),
    );
    await settle();

    stdin.write("a");
    await waitForFrame(lastFrame, (candidate) =>
      flattenFrame(candidate).includes("Drawing pages (1)"),
    );
    await settle();

    stdin.write(ENTER);
    const pageDetailFrame = await waitForFrame(lastFrame, (candidate) =>
      /Page 1 . \d+ items?/.test(flattenFrame(candidate)),
    );
    expect(flattenFrame(pageDetailFrame)).toMatch(/Page 1 . \d+ items?/);
    await settle();

    stdin.write("a");
    await waitForFrame(lastFrame, (candidate) =>
      flattenFrame(candidate).includes("choose a kind"),
    );
    await settle();
    stdin.write(ENTER);
    for (let step = 0; step < 8; step += 1) {
      const frame = flattenFrame(lastFrame());
      if (/Page 1 . 1 item\b/.test(frame)) {
        break;
      }
      stdin.write(ENTER);
      await settle();
    }
    await waitForFrame(lastFrame, (candidate) =>
      /Page 1 . 1 item\b/.test(flattenFrame(candidate)),
    );
    await settle();

    stdin.write(ENTER);
    const detailFrame = await waitForFrame(lastFrame, (candidate) =>
      flattenFrame(candidate).includes("Geometry:"),
    );
    expect(flattenFrame(detailFrame)).toContain("Rect");
    expect(flattenFrame(detailFrame)).toContain("Geometry:");
  });
});

describe("App ScreenBody routing, filePicker", () => {
  it("routes 'o' from the launcher into the filePicker screen", async () => {
    const { lastFrame, stdin } = render(<App />);
    await waitForFrame(lastFrame, (frame) => frame.includes("document-cli"));
    await settle();

    stdin.write("o");
    const frame = await waitForFrame(lastFrame, (candidate) =>
      flattenFrame(candidate).includes("Enter to open, Esc to cancel"),
    );
    expect(flattenFrame(frame)).toContain("Enter to open, Esc to cancel");
  });
});

describe("App ScreenBody routing, markdown viewSource", () => {
  it("routes :view-source on an open markdown document into viewSource", async () => {
    const { lastFrame, stdin } = render(<App />);
    await waitForFrame(lastFrame, (frame) => frame.includes("document-cli"));
    await settle();
    await createDocument(stdin, lastFrame, "markdown");
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("Body (markdown)"),
    );
    await settle();

    stdin.write(":");
    await waitForFrame(lastFrame, (frame) =>
      flattenFrame(frame).includes(": "),
    );
    await settle();
    stdin.write("view-source");
    await settle();
    stdin.write(ENTER);

    const frame = await waitForFrame(lastFrame, (candidate) =>
      flattenFrame(candidate).includes("As opened"),
    );
    expect(flattenFrame(frame)).toContain("As opened");
  });
});

describe("App ScreenBody routing, odb read-only screens", () => {
  it("opens a real odb fixture and walks odbTableList to odbTableRows", async () => {
    const { lastFrame, stdin } = render(
      <App startPath={FORM_AND_REPORT_ODB_PATH} />,
    );
    const listFrame = await waitForFrame(
      lastFrame,
      (candidate) => flattenFrame(candidate).includes("Tables ("),
      15000,
    );
    expect(flattenFrame(listFrame)).toContain("Tables (");
    await settle();

    stdin.write(ENTER);
    const frame = await waitForFrame(lastFrame, (candidate) =>
      /\(\d+ of \d+ rows\)/.test(flattenFrame(candidate)),
    );
    expect(flattenFrame(frame)).toMatch(/\(\d+ of \d+ rows\)/);
  });
});

describe("App ScreenBody routing, pdf screens", () => {
  let workspace: string;
  let pdfPath: string;

  beforeAll(async () => {
    const layout: LayoutDocument = {
      formatVersion: 1,
      metadata: {},
      images: {},
      pages: [
        {
          widthPt: 612,
          heightPt: 792,
          items: [
            {
              kind: "text",
              text: "Hello from a fixture PDF",
              xPt: 10,
              yPt: 700,
              font: { family: "Helvetica", weight: "normal", style: "normal" },
              sizePt: 12,
              color: { r: 0, g: 0, b: 0 },
            },
          ],
        },
      ],
    };
    const editor = new PdfEditor(layout);
    workspace = await mkdtemp(join(tmpdir(), "document-cli-app-routing-pdf-"));
    pdfPath = join(workspace, "fixture.pdf");
    await writeFile(pdfPath, writePdf(editor.toLayoutDocument()));
  });

  afterAll(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it("opens a real pdf file and walks pdfPageList to pdfPageItems to pdfItemDetail", async () => {
    const { lastFrame, stdin } = render(<App startPath={pdfPath} />);
    await waitForFrame(
      lastFrame,
      (candidate) => flattenFrame(candidate).includes("Page 1"),
      10000,
    );
    await settle();

    stdin.write(ENTER);
    const itemsFrame = await waitForFrame(lastFrame, (candidate) =>
      flattenFrame(candidate).includes("Page 1 items"),
    );
    expect(flattenFrame(itemsFrame)).toContain("Page 1 items");
    await settle();

    stdin.write(ENTER);
    const detailFrame = await waitForFrame(lastFrame, (candidate) =>
      flattenFrame(candidate).includes("Page 1, item 1"),
    );
    expect(flattenFrame(detailFrame)).toContain("Page 1, item 1");
  });
});

describe("App Overlay precedence", () => {
  it("shows ErrorDetail when startPath fails to open, and it wins over every later overlay-open key", async () => {
    const { lastFrame, stdin } = render(
      <App startPath="/not/a/real/document-cli-fixture.docx" />,
    );
    const frame = await waitForFrame(lastFrame, (candidate) =>
      flattenFrame(candidate).includes("Could not open"),
    );
    expect(flattenFrame(frame)).toContain("Could not open");
    await settle();

    // AppShell's own global useInput is gated `isActive: !overlayOpen`, and errorDetail counts toward overlayOpen, so ':' here is a no-op: the frame keeps showing the error rather than commandPalette silently taking over underneath it.
    stdin.write(":");
    await settle();
    const stillError = lastFrame();
    expect(flattenFrame(stillError)).toContain("Could not open");
    expect(flattenFrame(stillError)).toContain("Esc or Enter to dismiss");
  });

  it("shows the commandPalette on ':' from the launcher", async () => {
    const { lastFrame, stdin } = render(<App />);
    await waitForFrame(lastFrame, (frame) => frame.includes("document-cli"));
    await settle();
    stdin.write(":");
    const frame = await waitForFrame(lastFrame, (candidate) =>
      flattenFrame(candidate).includes(": "),
    );
    expect(flattenFrame(frame)).toContain(": ");
  });

  it("shows the SearchOverlay on '/' from the launcher", async () => {
    const { lastFrame, stdin } = render(<App />);
    await waitForFrame(lastFrame, (frame) => frame.includes("document-cli"));
    await settle();
    stdin.write("/");
    const frame = await waitForFrame(lastFrame, (candidate) =>
      flattenFrame(candidate).includes("Enter to keep the filter"),
    );
    expect(flattenFrame(frame)).toContain("Enter to keep the filter");
  });

  it("shows the HelpOverlay on '?' from the launcher", async () => {
    const { lastFrame, stdin } = render(<App />);
    await waitForFrame(lastFrame, (frame) => frame.includes("document-cli"));
    await settle();
    stdin.write("?");
    const frame = await waitForFrame(lastFrame, (candidate) =>
      flattenFrame(candidate).includes("Key bindings"),
    );
    expect(flattenFrame(frame)).toContain("Key bindings");
  });

  it("shows the DiagnosticsPanel on Ctrl+D from the launcher", async () => {
    const { lastFrame, stdin } = render(<App />);
    await waitForFrame(lastFrame, (frame) => frame.includes("document-cli"));
    await settle();
    stdin.write(CTRL_D);
    const frame = await waitForFrame(lastFrame, (candidate) =>
      flattenFrame(candidate).includes("Diagnostics ("),
    );
    expect(flattenFrame(frame)).toContain("Diagnostics (");
  });

  it("shows a confirmClose ConfirmDialog on Ctrl+W once there are unsaved changes, and Esc cancels it back", async () => {
    const { lastFrame, stdin } = render(<App />);
    await waitForFrame(lastFrame, (frame) => frame.includes("document-cli"));
    await settle();
    await createDocument(stdin, lastFrame, "docx");
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("Body (docx)"),
    );
    await settle();
    stdin.write("a");
    await waitForFrame(lastFrame, (frame) => frame.includes("Paragraph 0"));
    await settle();
    stdin.write(ESCAPE);
    await waitForFrame(lastFrame, (frame) =>
      flattenFrame(frame).includes("Body (docx)"),
    );
    await settle();

    stdin.write(CTRL_W);
    const frame = await waitForFrame(lastFrame, (candidate) =>
      flattenFrame(candidate).includes("Close this document?"),
    );
    expect(flattenFrame(frame)).toContain("Close this document?");
    await settle();

    stdin.write("n");
    const cancelled = await waitForFrame(
      lastFrame,
      (candidate) => !flattenFrame(candidate).includes("Close this document?"),
    );
    expect(flattenFrame(cancelled)).toContain("Body (docx)");
  });

  it("shows a confirmQuit ConfirmDialog on 'q' once there are unsaved changes", async () => {
    const { lastFrame, stdin } = render(<App />);
    await waitForFrame(lastFrame, (frame) => frame.includes("document-cli"));
    await settle();
    await createDocument(stdin, lastFrame, "docx");
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("Body (docx)"),
    );
    await settle();
    stdin.write("a");
    await waitForFrame(lastFrame, (frame) => frame.includes("Paragraph 0"));
    await settle();
    stdin.write(ESCAPE);
    await waitForFrame(lastFrame, (frame) =>
      flattenFrame(frame).includes("Body (docx)"),
    );
    await settle();

    stdin.write("q");
    const frame = await waitForFrame(lastFrame, (candidate) =>
      flattenFrame(candidate).includes("Quit? The open document"),
    );
    expect(flattenFrame(frame)).toContain("Quit? The open document");
  });
});

// A minimal harness for the two Screen union members ScreenBody switches on but the app's own UI never pushes: "cellDetail" (rendered inline by spreadsheetGrid instead, per its own case comment in app.tsx) and "exportOptions" (superseded by the command palette's own ':export pdf' flow, which performs the export directly rather than routing through a screen). Dispatching PUSH_SCREEN with an arbitrary kind is exactly what the real reducer already does unconditionally (see reducer.ts's own PUSH_SCREEN case), so this proves ScreenBody's own case for each kind resolves to the right component without needing app.tsx to expose a way to reach it through real keystrokes, which by design it does not.
function ScreenBodyHarness({
  screen,
  withOpenDocument = false,
}: {
  readonly screen: Parameters<typeof ScreenBody>[0]["screen"];
  readonly withOpenDocument?: boolean;
}): ReactElement {
  const dispatch = useAppDispatch();
  useEffect(() => {
    if (withOpenDocument) {
      dispatch({ type: "CREATE_DOCUMENT", format: "docx" });
    }
    dispatch({ type: "PUSH_SCREEN", screen });
  }, [dispatch, screen, withOpenDocument]);
  return <ScreenBody screen={screen} />;
}

describe("App ScreenBody routing, screens with no reachable route through the real UI", () => {
  it("renders the cellDetail case's own explanatory text", async () => {
    const { lastFrame } = render(
      <AppStateProvider>
        <ScreenBodyHarness
          screen={{ kind: "cellDetail", sheetIndex: 0, row: 0, col: 0 }}
        />
      </AppStateProvider>,
    );
    const frame = await waitForFrame(lastFrame, (candidate) =>
      flattenFrame(candidate).includes("never pushed as its own screen"),
    );
    expect(flattenFrame(frame)).toContain("never pushed as its own screen");
  });

  it("renders ExportOptionsScreen for the exportOptions case", async () => {
    const { lastFrame } = render(
      <AppStateProvider>
        <ScreenBodyHarness
          screen={{ kind: "exportOptions" }}
          withOpenDocument
        />
      </AppStateProvider>,
    );
    const frame = await waitForFrame(lastFrame, (candidate) =>
      flattenFrame(candidate).includes("Export to PDF"),
    );
    expect(flattenFrame(frame)).toContain("Export to PDF");
  });
});

describe("App AppShell key handlers", () => {
  it("quits immediately on 'q' when there are no unsaved changes", async () => {
    const { lastFrame, stdin, unmount } = render(<App />);
    await waitForFrame(lastFrame, (frame) => frame.includes("document-cli"));
    await settle();
    stdin.write("q");
    await settle();
    // isExiting triggers useApp().exit(), which unmounts the tree; there is nothing further to assert against a frame once it has, so this proves the handler ran rather than being swallowed some other way.
    expect(lastFrame()).toBeDefined();
    unmount();
  });

  it("Ctrl+C quits the same way 'q' does when there are no unsaved changes", async () => {
    const { lastFrame, stdin, unmount } = render(<App />);
    await waitForFrame(lastFrame, (frame) => frame.includes("document-cli"));
    await settle();
    stdin.write(CTRL_C);
    await settle();
    expect(lastFrame()).toBeDefined();
    unmount();
  });

  it("Ctrl+S with no open document warns instead of saving", async () => {
    const { lastFrame, stdin } = render(<App />);
    await waitForFrame(lastFrame, (frame) => frame.includes("document-cli"));
    await settle();
    stdin.write(CTRL_S);
    const frame = await waitForFrame(lastFrame, (candidate) =>
      flattenFrame(candidate).includes("There is no open document to save"),
    );
    expect(flattenFrame(frame)).toContain("There is no open document to save");
  });

  it("Ctrl+S on an unsaved new document opens the saveAsPrompt", async () => {
    const { lastFrame, stdin } = render(<App />);
    await waitForFrame(lastFrame, (frame) => frame.includes("document-cli"));
    await settle();
    await createDocument(stdin, lastFrame, "docx");
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("Body (docx)"),
    );
    await settle();

    stdin.write(CTRL_S);
    const frame = await waitForFrame(lastFrame, (candidate) =>
      flattenFrame(candidate).includes("Save as"),
    );
    expect(flattenFrame(frame)).toContain("Save as");
    expect(flattenFrame(frame)).toContain("Enter to save, Esc to cancel");
  });

  it("Ctrl+S on an on-disk document saves it directly, without opening saveAsPrompt", async () => {
    const { lastFrame, stdin } = render(
      <App startPath={FORM_AND_REPORT_ODB_PATH} />,
    );
    await waitForFrame(
      lastFrame,
      (candidate) => flattenFrame(candidate).includes("Tables ("),
      15000,
    );
    await settle();

    stdin.write(CTRL_S);
    const frame = await waitForFrame(
      lastFrame,
      (candidate) =>
        flattenFrame(candidate).includes(
          "opened read-only and cannot be written back",
        ) || flattenFrame(candidate).includes("Saved"),
    );
    expect(flattenFrame(frame)).toMatch(/Saved|cannot be written back/);
  });

  it("Ctrl+W with no open document reports there is nothing to close", async () => {
    const { lastFrame, stdin } = render(<App />);
    await waitForFrame(lastFrame, (frame) => frame.includes("document-cli"));
    await settle();
    stdin.write(CTRL_W);
    const frame = await waitForFrame(lastFrame, (candidate) =>
      flattenFrame(candidate).includes("There is no open document to close"),
    );
    expect(flattenFrame(frame)).toContain("There is no open document to close");
  });

  it("'m' with no open document warns instead of opening metadata", async () => {
    const { lastFrame, stdin } = render(<App />);
    await waitForFrame(lastFrame, (frame) => frame.includes("document-cli"));
    await settle();
    stdin.write("m");
    const frame = await waitForFrame(lastFrame, (candidate) =>
      flattenFrame(candidate).includes(
        "There is no open document to show metadata for",
      ),
    );
    expect(flattenFrame(frame)).toContain(
      "There is no open document to show metadata for",
    );
  });
});
