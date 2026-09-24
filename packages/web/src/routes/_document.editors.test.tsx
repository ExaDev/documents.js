import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  mountWithOpenDocument,
  openDocument,
  resetOpenDocumentCapture,
} from "../test/openDocumentHarness";

const openEditor = vi.fn();
const saveEditor = vi.fn();
const addParagraph = vi.fn();
const removeParagraph = vi.fn();
const setParagraphText = vi.fn();

// Each hook stands in for one rpc mutation. `isError`/`error` are driven per test so the panel's own open-failure branch can be exercised without a real worker.
let openEditorState = { isError: false, error: undefined as unknown };
vi.mock("../hooks/useEditorSession", () => ({
  useOpenEditor: () => ({ mutate: openEditor, ...openEditorState }),
  useSetParagraphText: () => ({ mutate: setParagraphText, isPending: false }),
  useAddParagraph: () => ({ mutate: addParagraph, isPending: false }),
  useRemoveParagraph: () => ({ mutate: removeParagraph, isPending: false }),
  useSaveEditor: () => ({ mutate: saveEditor, isPending: false }),
}));

vi.mock("../adapters/fileAccess/createFileAccess", () => ({
  createFileAccess: () => ({ saveFile: vi.fn() }),
}));

const { editorFormat, Route } = await import("./_document.editors");
const EditorsPage = Route.options.component!;

function openedFile(name: string) {
  return { bytes: new Uint8Array([1, 2, 3]), name };
}

function mountPage() {
  return mountWithOpenDocument(<EditorsPage />);
}

// Drives the mount effect's own success callback, which is the only way a snapshot ever reaches this panel.
function settleOpen(paragraphs: readonly string[]) {
  const [, callbacks] = openEditor.mock.calls.at(-1) as [
    unknown,
    { onSuccess: (snapshot: unknown) => void },
  ];
  act(() => {
    callbacks.onSuccess({ id: 1, paragraphs: [...paragraphs] });
  });
}

afterEach(() => {
  resetOpenDocumentCapture();
  openEditor.mockReset();
  saveEditor.mockReset();
  addParagraph.mockReset();
  removeParagraph.mockReset();
  setParagraphText.mockReset();
  openEditorState = { isError: false, error: undefined };
});

describe("editorFormat", () => {
  it("narrows each of the four formats documents.js has a live-view editor for", () => {
    expect(editorFormat("docx")).toBe("docx");
    expect(editorFormat("odt")).toBe("odt");
    expect(editorFormat("doc")).toBe("doc");
    expect(editorFormat("markdown")).toBe("markdown");
  });

  it("rejects a real document format that has no editor", () => {
    expect(editorFormat("xlsx")).toBeUndefined();
    expect(editorFormat("pdf")).toBeUndefined();
  });

  it("rejects an unrecognised extension, which reaches here as undefined", () => {
    expect(editorFormat(undefined)).toBeUndefined();
  });
});

describe("EditorsPage", () => {
  it("prompts for the shared document rather than showing an upload of its own", () => {
    const mounted = mountPage();
    expect(mounted.container.textContent).toContain(
      "Open a document above to edit it.",
    );
    expect(openEditor).not.toHaveBeenCalled();
    mounted.unmount();
  });

  it("opens an editor session for a document opened elsewhere in the app, with no second pick", () => {
    const mounted = mountPage();
    act(() => {
      openDocument(openedFile("report.docx"));
    });
    expect(openEditor).toHaveBeenCalledWith(
      expect.objectContaining({ format: "docx" }),
      expect.anything(),
    );
    mounted.unmount();
  });

  it("explains that a recognised but non-editable format cannot be edited, naming the file", () => {
    const mounted = mountPage();
    act(() => {
      openDocument(openedFile("budget.xlsx"));
    });
    expect(mounted.container.textContent).toContain("Not an editable format");
    expect(mounted.container.textContent).toContain("budget.xlsx");
    expect(openEditor).not.toHaveBeenCalled();
    mounted.unmount();
  });

  it("renders the document's paragraphs once the session opens", () => {
    const mounted = mountPage();
    act(() => {
      openDocument(openedFile("report.docx"));
    });
    settleOpen(["First paragraph", "Second paragraph"]);
    expect(mounted.container.textContent).toContain("2 paragraphs");
    const textareas = mounted.container.querySelectorAll("textarea");
    expect(textareas[0]?.value).toBe("First paragraph");
    mounted.unmount();
  });

  it("counts a single paragraph in the singular", () => {
    const mounted = mountPage();
    act(() => {
      openDocument(openedFile("report.docx"));
    });
    settleOpen(["Only one"]);
    expect(mounted.container.textContent).toContain("1 paragraph");
    expect(mounted.container.textContent).not.toContain("1 paragraphs");
    mounted.unmount();
  });

  it("reports an open failure in place of the editing surface", () => {
    openEditorState = { isError: true, error: new Error("worker refused") };
    const mounted = mountPage();
    act(() => {
      openDocument(openedFile("report.docx"));
    });
    expect(mounted.container.textContent).toContain("Could not open document");
    expect(mounted.container.querySelectorAll("textarea")).toHaveLength(0);
    mounted.unmount();
  });

  it("shows a loading line between opening the document and the first snapshot arriving", () => {
    const mounted = mountPage();
    act(() => {
      openDocument(openedFile("report.docx"));
    });
    expect(mounted.container.textContent).toContain(
      "Opening the document for editing",
    );
    mounted.unmount();
  });

  it("discards the previous document's session when a different document is opened", () => {
    const mounted = mountPage();
    act(() => {
      openDocument(openedFile("first.docx"));
    });
    settleOpen(["First document's paragraph"]);
    act(() => {
      openDocument(openedFile("second.odt"));
    });
    expect(mounted.container.textContent).not.toContain(
      "First document's paragraph",
    );
    expect(openEditor).toHaveBeenCalledTimes(2);
    mounted.unmount();
  });

  it("saves the live session by its own id rather than re-sending the document's bytes", () => {
    const mounted = mountPage();
    act(() => {
      openDocument(openedFile("report.docx"));
    });
    settleOpen(["A paragraph"]);
    const saveButton = [
      ...mounted.container.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent === "Save");
    act(() => {
      saveButton?.click();
    });
    expect(saveEditor).toHaveBeenCalledWith({ id: 1 }, expect.anything());
    mounted.unmount();
  });
});
