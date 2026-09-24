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

// A stable mock across every render, mirroring metadata.test.tsx/package.test.tsx: the component calls createFileAccess() fresh on every render, so a factory returning a brand new vi.fn() each time would lose call history the moment the panel re-renders.
const saveFile =
  vi.fn<
    (
      bytes: Uint8Array,
      options: Readonly<{ suggestedName: string; mimeType: string }>,
    ) => Promise<{ handle?: undefined }>
  >();
vi.mock("../adapters/fileAccess/createFileAccess", () => ({
  createFileAccess: () => ({ saveFile }),
}));

const notifyError = vi.fn<(title: string, error: unknown) => void>();
const notifySuccess = vi.fn<(message: string) => void>();
vi.mock("../ui/notify", () => ({
  notifyError: (title: string, error: unknown) => {
    notifyError(title, error);
  },
  notifySuccess: (message: string) => {
    notifySuccess(message);
  },
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

// Every other mutation (edit, add, remove, save) is likewise a mocked mutate() that never invokes its own callbacks on its own: this pulls the pair back off the mock's most recent call so a test can drive whichever one it needs directly.
function latestCallbacks(mockFn: { mock: { calls: unknown[][] } }): {
  onSuccess: (result: unknown) => void;
  onError: (error: unknown) => void;
} {
  const [, callbacks] = mockFn.mock.calls.at(-1) as [
    unknown,
    {
      onSuccess: (result: unknown) => void;
      onError: (error: unknown) => void;
    },
  ];
  return callbacks;
}

function paragraphTextarea(container: HTMLElement, position: number) {
  return container.querySelector<HTMLTextAreaElement>(
    `textarea[aria-label="Paragraph ${position}"]`,
  );
}

function removeButton(container: HTMLElement, position: number) {
  return container.querySelector<HTMLButtonElement>(
    `button[aria-label="Remove paragraph ${position}"]`,
  );
}

function newParagraphTextarea(container: HTMLElement) {
  return container.querySelector<HTMLTextAreaElement>(
    'textarea[aria-label="New paragraph"]',
  );
}

function addButton(container: HTMLElement) {
  return container.querySelector<HTMLButtonElement>(
    'button[aria-label="Add paragraph"]',
  );
}

function saveButton(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent === "Save",
  );
}

// React tracks a textarea's last-known value on the DOM node itself and skips its onChange dispatch when a plain `textarea.value = ...` assignment already matches what it already recorded, so going through the native setter (bypassing React's own patched one) keeps its tracked value stale and the subsequent "input" event is seen as a real change.
function typeInto(textarea: HTMLTextAreaElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    )?.set?.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

// Native blur/focus events do not bubble, so React's own onBlur/onFocus (which do) are wired to the delegated, bubbling focusout/focusin events instead; dispatching a plain "blur" would never reach a delegated root listener.
function blurOut(element: HTMLElement) {
  act(() => {
    element.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

afterEach(() => {
  resetOpenDocumentCapture();
  openEditor.mockReset();
  saveEditor.mockReset();
  addParagraph.mockReset();
  removeParagraph.mockReset();
  setParagraphText.mockReset();
  saveFile.mockReset();
  notifyError.mockReset();
  notifySuccess.mockReset();
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

  it("renders the document's paragraphs, the format in upper case, and an empty new-paragraph field, once the session opens", () => {
    const mounted = mountPage();
    act(() => {
      openDocument(openedFile("report.docx"));
    });
    settleOpen(["First paragraph", "Second paragraph"]);
    expect(mounted.container.textContent).toContain("DOCX · 2 paragraphs");
    expect(paragraphTextarea(mounted.container, 1)?.value).toBe(
      "First paragraph",
    );
    expect(paragraphTextarea(mounted.container, 2)?.value).toBe(
      "Second paragraph",
    );
    expect(newParagraphTextarea(mounted.container)?.value).toBe("");
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

  it("gives each paragraph field a numbered aria-label, a remove control of its own, and a flexed layout", () => {
    const mounted = mountPage();
    act(() => {
      openDocument(openedFile("report.docx"));
    });
    settleOpen(["First", "Second", "Third"]);
    for (const position of [1, 2, 3]) {
      const field = paragraphTextarea(mounted.container, position);
      expect(field).not.toBeNull();
      // The `style={{ flex: 1 }}` prop lands on Mantine's own Textarea root wrapper, not the inner <textarea> the aria-label sits on.
      expect(
        field?.closest<HTMLElement>(".mantine-Textarea-root")?.style.flex,
      ).toBe("1 1 0%");
      expect(removeButton(mounted.container, position)).not.toBeNull();
    }
    mounted.unmount();
  });

  it("gives the new-paragraph field a flexed layout", () => {
    const mounted = mountPage();
    act(() => {
      openDocument(openedFile("report.docx"));
    });
    settleOpen([]);
    const field = newParagraphTextarea(mounted.container);
    expect(
      field?.closest<HTMLElement>(".mantine-Textarea-root")?.style.flex,
    ).toBe("1 1 0%");
    mounted.unmount();
  });

  it("disables Add until the new-paragraph field holds text", () => {
    const mounted = mountPage();
    act(() => {
      openDocument(openedFile("report.docx"));
    });
    settleOpen(["Existing"]);
    expect(addButton(mounted.container)?.disabled).toBe(true);
    typeInto(newParagraphTextarea(mounted.container)!, "A new line");
    expect(addButton(mounted.container)?.disabled).toBe(false);
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

  it("notifies when opening the document for editing rejects", () => {
    const mounted = mountPage();
    act(() => {
      openDocument(openedFile("report.docx"));
    });
    const { onError } = latestCallbacks(openEditor);
    act(() => {
      onError(new Error("worker refused"));
    });
    expect(notifyError).toHaveBeenCalledWith(
      "Could not open document",
      expect.any(Error),
    );
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

  it("does not reopen the document on a re-render triggered by its own snapshot updates", () => {
    const mounted = mountPage();
    act(() => {
      openDocument(openedFile("report.docx"));
    });
    settleOpen(["First"]);
    settleOpen(["First", "Second"]);
    expect(openEditor).toHaveBeenCalledTimes(1);
    mounted.unmount();
  });

  it("edits a paragraph locally per keystroke, leaving its sibling untouched, then commits the edit on blur", () => {
    const mounted = mountPage();
    act(() => {
      openDocument(openedFile("report.docx"));
    });
    settleOpen(["First", "Second"]);

    const first = paragraphTextarea(mounted.container, 1)!;
    const second = paragraphTextarea(mounted.container, 2)!;
    typeInto(first, "First, edited");
    expect(first.value).toBe("First, edited");
    expect(second.value).toBe("Second");
    expect(setParagraphText).not.toHaveBeenCalled();

    blurOut(first);
    expect(setParagraphText).toHaveBeenCalledWith(
      { id: 1, index: 0, text: "First, edited" },
      expect.anything(),
    );

    const { onSuccess } = latestCallbacks(setParagraphText);
    act(() => {
      onSuccess({ id: 1, paragraphs: ["First, edited", "Second"] });
    });
    expect(paragraphTextarea(mounted.container, 1)?.value).toBe(
      "First, edited",
    );
    mounted.unmount();
  });

  it("notifies when committing a paragraph edit rejects", () => {
    const mounted = mountPage();
    act(() => {
      openDocument(openedFile("report.docx"));
    });
    settleOpen(["First"]);
    const first = paragraphTextarea(mounted.container, 1)!;
    typeInto(first, "changed");
    blurOut(first);
    const { onError } = latestCallbacks(setParagraphText);
    act(() => {
      onError(new Error("bad edit"));
    });
    expect(notifyError).toHaveBeenCalledWith(
      "Could not edit paragraph",
      expect.any(Error),
    );
    mounted.unmount();
  });

  it("adds a paragraph typed into the new-paragraph field, clearing it and refreshing the list on success", () => {
    const mounted = mountPage();
    act(() => {
      openDocument(openedFile("report.docx"));
    });
    settleOpen(["Existing"]);

    typeInto(newParagraphTextarea(mounted.container)!, "New one");
    expect(newParagraphTextarea(mounted.container)?.value).toBe("New one");

    act(() => {
      addButton(mounted.container)!.click();
    });
    expect(addParagraph).toHaveBeenCalledWith(
      { id: 1, text: "New one" },
      expect.anything(),
    );

    const { onSuccess } = latestCallbacks(addParagraph);
    act(() => {
      onSuccess({ id: 1, paragraphs: ["Existing", "New one"] });
    });
    expect(mounted.container.textContent).toContain("2 paragraphs");
    expect(newParagraphTextarea(mounted.container)?.value).toBe("");
    mounted.unmount();
  });

  it("notifies when adding a paragraph rejects", () => {
    const mounted = mountPage();
    act(() => {
      openDocument(openedFile("report.docx"));
    });
    settleOpen([]);
    typeInto(newParagraphTextarea(mounted.container)!, "New one");
    act(() => {
      addButton(mounted.container)!.click();
    });
    const { onError } = latestCallbacks(addParagraph);
    act(() => {
      onError(new Error("bad add"));
    });
    expect(notifyError).toHaveBeenCalledWith(
      "Could not add paragraph",
      expect.any(Error),
    );
    mounted.unmount();
  });

  it("removes a paragraph via its own remove control, refreshing the list on success", () => {
    const mounted = mountPage();
    act(() => {
      openDocument(openedFile("report.docx"));
    });
    settleOpen(["First", "Second"]);

    act(() => {
      removeButton(mounted.container, 2)!.click();
    });
    expect(removeParagraph).toHaveBeenCalledWith(
      { id: 1, index: 1 },
      expect.anything(),
    );

    const { onSuccess } = latestCallbacks(removeParagraph);
    act(() => {
      onSuccess({ id: 1, paragraphs: ["First"] });
    });
    expect(mounted.container.textContent).toContain("1 paragraph");
    expect(paragraphTextarea(mounted.container, 2)).toBeNull();
    mounted.unmount();
  });

  it("notifies when removing a paragraph rejects", () => {
    const mounted = mountPage();
    act(() => {
      openDocument(openedFile("report.docx"));
    });
    settleOpen(["Only one"]);
    act(() => {
      removeButton(mounted.container, 1)!.click();
    });
    const { onError } = latestCallbacks(removeParagraph);
    act(() => {
      onError(new Error("bad remove"));
    });
    expect(notifyError).toHaveBeenCalledWith(
      "Could not remove paragraph",
      expect.any(Error),
    );
    mounted.unmount();
  });

  it("saves the live session by its own id rather than re-sending the document's bytes", () => {
    const mounted = mountPage();
    act(() => {
      openDocument(openedFile("report.docx"));
    });
    settleOpen(["A paragraph"]);
    act(() => {
      saveButton(mounted.container)?.click();
    });
    expect(saveEditor).toHaveBeenCalledWith({ id: 1 }, expect.anything());
    mounted.unmount();
  });

  it("notifies success and downloads the written bytes once a save resolves", () => {
    const mounted = mountPage();
    act(() => {
      openDocument(openedFile("report.docx"));
    });
    settleOpen(["A paragraph"]);
    act(() => {
      saveButton(mounted.container)?.click();
    });
    const { onSuccess } = latestCallbacks(saveEditor);
    const written = new Uint8Array([9, 9]);
    act(() => {
      onSuccess({ bytes: written });
    });
    expect(notifySuccess).toHaveBeenCalledWith("Document saved");
    expect(saveFile).toHaveBeenCalledWith(written, {
      suggestedName: "report.docx",
      mimeType: "application/octet-stream",
    });
    mounted.unmount();
  });

  it("notifies when saving rejects", () => {
    const mounted = mountPage();
    act(() => {
      openDocument(openedFile("report.docx"));
    });
    settleOpen(["A paragraph"]);
    act(() => {
      saveButton(mounted.container)?.click();
    });
    const { onError } = latestCallbacks(saveEditor);
    act(() => {
      onError(new Error("save failed"));
    });
    expect(notifyError).toHaveBeenCalledWith(
      "Could not save document",
      expect.any(Error),
    );
    mounted.unmount();
  });
});
