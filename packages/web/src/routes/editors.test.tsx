import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { OpenedFile } from "../ports/fileAccess";
import { createMockRpcClient } from "../test/mockRpcClient";
import { mountWithProviders } from "../test/mountComponent";

vi.mock("../rpc/client", () => ({ getRpcClient: vi.fn() }));

const saveFile =
  vi.fn<
    (
      bytes: Uint8Array,
      options: { suggestedName: string; mimeType: string },
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

// Stands in for the real FileUpload (already covered by its own dedicated test suite): EditorsPage's own logic -- inferring the format, opening/editing/saving through the editor session mutations -- is what this file exercises.
let latestOnFile: ((file: OpenedFile) => void) | undefined;
let latestFile: OpenedFile | undefined;
let latestAccept: Record<string, string[]> | undefined;
vi.mock("../ui/FileUpload", () => ({
  FileUpload: (props: {
    onFile: (file: OpenedFile) => void;
    file?: OpenedFile;
    accept: Record<string, string[]>;
  }) => {
    latestOnFile = props.onFile;
    latestFile = props.file;
    latestAccept = props.accept;
    return <div data-testid="file-upload" />;
  },
}));

const { getRpcClient } = await import("../rpc/client");
const { Route } = await import("./editors");
const EditorsPage = Route.options.component!;

function openedFile(name: string): OpenedFile {
  return { bytes: new Uint8Array([1, 2, 3]), name };
}

function mountEditorsPage() {
  return mountWithProviders(<EditorsPage />);
}

function paragraphTextareas(container: HTMLElement) {
  return [...container.querySelectorAll("textarea")].slice(0, -1);
}

function newParagraphTextarea(container: HTMLElement): HTMLTextAreaElement {
  const all = container.querySelectorAll("textarea");
  return all[all.length - 1]!;
}

function removeButton(container: HTMLElement, index: number) {
  return container.querySelector<HTMLButtonElement>(
    `button[aria-label="Remove paragraph ${index + 1}"]`,
  )!;
}

function addButton(container: HTMLElement) {
  return container.querySelector<HTMLButtonElement>(
    'button[aria-label="Add paragraph"]',
  )!;
}

function saveButton(container: HTMLElement) {
  return [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === "Save",
  )!;
}

function typeInto(textarea: HTMLTextAreaElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    )?.set?.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function click(element: HTMLElement) {
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

afterEach(() => {
  latestOnFile = undefined;
  latestFile = undefined;
  latestAccept = undefined;
  notifyError.mockReset();
  notifySuccess.mockReset();
  saveFile.mockReset();
  vi.mocked(getRpcClient).mockReset();
});

describe("EditorsPage", () => {
  it("renders only the FileUpload before anything is picked, restricted to docx/odt/doc/markdown", () => {
    const client = createMockRpcClient();
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountEditorsPage();
    expect(
      mounted.container.querySelector('[data-testid="file-upload"]'),
    ).not.toBeNull();
    expect(mounted.container.querySelector("textarea")).toBeNull();
    expect(mounted.container.textContent).not.toContain(
      "Could not open document",
    );
    expect(latestFile).toBeUndefined();
    expect(latestAccept).toEqual({
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        [".docx"],
      "application/vnd.oasis.opendocument.text": [".odt"],
      "application/msword": [".doc"],
      "text/markdown": [".md", ".markdown"],
    });
    mounted.unmount();
  });

  it("notifies with a message naming the supported formats, and never opens the editor, for an unsupported extension", () => {
    const client = createMockRpcClient();
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountEditorsPage();

    act(() => {
      latestOnFile?.(openedFile("notes.pdf"));
    });

    expect(notifyError).toHaveBeenCalledWith(
      "Unsupported format",
      new Error("the editors tool opens docx, odt, doc, or markdown files"),
    );
    expect(client.editor.open).not.toHaveBeenCalled();
    expect(latestFile).toBeUndefined();
    mounted.unmount();
  });

  it.each([
    ["report.docx", "docx"],
    ["report.odt", "odt"],
    ["report.doc", "doc"],
    ["report.md", "markdown"],
    ["report.markdown", "markdown"],
  ] as const)(
    "opens %s as format %s and renders its paragraph snapshot",
    async (name, format) => {
      const client = createMockRpcClient();
      vi.mocked(client.editor.open).mockResolvedValue({
        id: 1,
        paragraphs: ["Hello"],
      });
      vi.mocked(getRpcClient).mockReturnValue(client);
      const mounted = mountEditorsPage();

      act(() => {
        latestOnFile?.(openedFile(name));
      });
      await vi.waitFor(() => {
        expect(paragraphTextareas(mounted.container)).toHaveLength(1);
      });

      const [input] = vi.mocked(client.editor.open).mock.calls[0]!;
      expect(input.format).toBe(format);
      expect(input.bytes).toBeInstanceOf(Uint8Array);
      expect(mounted.container.textContent).toContain(
        `${format.toUpperCase()} · 1 paragraph`,
      );
      expect(mounted.container.textContent).not.toContain("1 paragraphs");
      expect(latestFile?.name).toBe(name);
      mounted.unmount();
    },
  );

  it("uses the plural 'paragraphs' label for zero or more than one paragraph", async () => {
    const client = createMockRpcClient();
    vi.mocked(client.editor.open).mockResolvedValue({ id: 1, paragraphs: [] });
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountEditorsPage();

    act(() => {
      latestOnFile?.(openedFile("report.docx"));
    });
    await vi.waitFor(() => {
      expect(mounted.container.textContent).toContain("0 paragraphs");
    });

    vi.mocked(client.editor.open).mockResolvedValue({
      id: 2,
      paragraphs: ["a", "b"],
    });
    act(() => {
      latestOnFile?.(openedFile("second.docx"));
    });
    await vi.waitFor(() => {
      expect(mounted.container.textContent).toContain("2 paragraphs");
    });
    mounted.unmount();
  });

  it("notifies and shows an alert when opening the document rejects", async () => {
    const client = createMockRpcClient();
    vi.mocked(client.editor.open).mockRejectedValue(new Error("corrupt file"));
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountEditorsPage();

    act(() => {
      latestOnFile?.(openedFile("report.docx"));
    });
    await vi.waitFor(() => {
      expect(notifyError).toHaveBeenCalledWith(
        "Could not open document",
        expect.any(Error),
      );
    });
    expect(mounted.container.textContent).toContain("Could not open document");
    expect(mounted.container.textContent).toContain("Error: corrupt file");
    expect(mounted.container.querySelector("textarea")).toBeNull();
    mounted.unmount();
  });

  it("clears a previous session's panel while the next file's open is still in flight", async () => {
    const client = createMockRpcClient();
    vi.mocked(client.editor.open).mockResolvedValueOnce({
      id: 1,
      paragraphs: ["first"],
    });
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountEditorsPage();

    act(() => {
      latestOnFile?.(openedFile("first.docx"));
    });
    await vi.waitFor(() => {
      expect(paragraphTextareas(mounted.container)).toHaveLength(1);
    });

    vi.mocked(client.editor.open).mockReturnValue(new Promise(() => {}));
    act(() => {
      latestOnFile?.(openedFile("second.docx"));
    });

    expect(mounted.container.querySelector("textarea")).toBeNull();
    mounted.unmount();
  });

  it("edits only the changed paragraph optimistically, leaving the others untouched, and applies the committed server snapshot on blur", async () => {
    const client = createMockRpcClient();
    vi.mocked(client.editor.open).mockResolvedValue({
      id: 7,
      paragraphs: ["First", "Second"],
    });
    vi.mocked(client.editor.setParagraphText).mockResolvedValue({
      id: 7,
      paragraphs: ["First (normalised)", "Second"],
    });
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountEditorsPage();

    act(() => {
      latestOnFile?.(openedFile("report.docx"));
    });
    await vi.waitFor(() => {
      expect(paragraphTextareas(mounted.container)).toHaveLength(2);
    });

    const [first, second] = paragraphTextareas(mounted.container);
    expect(
      first!.closest<HTMLElement>(".mantine-Textarea-root")!.style.flex,
    ).toBe("1 1 0%");
    expect(
      second!.closest<HTMLElement>(".mantine-Textarea-root")!.style.flex,
    ).toBe("1 1 0%");
    typeInto(first!, "First (edited)");
    expect(client.editor.setParagraphText).not.toHaveBeenCalled();
    expect(paragraphTextareas(mounted.container)[0]!.value).toBe(
      "First (edited)",
    );
    expect(paragraphTextareas(mounted.container)[1]!.value).toBe("Second");

    act(() => {
      second!.focus();
    });
    act(() => {
      first!.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    await vi.waitFor(() => {
      expect(client.editor.setParagraphText).toHaveBeenCalled();
    });
    const [input] = vi.mocked(client.editor.setParagraphText).mock.calls[0]!;
    expect(input).toEqual({ id: 7, index: 0, text: "First (edited)" });

    // The committed response's own text, distinct from what was typed, proves the resolved snapshot -- not just the optimistic edit already on screen -- is what ends up rendered.
    await vi.waitFor(() => {
      expect(paragraphTextareas(mounted.container)[0]!.value).toBe(
        "First (normalised)",
      );
    });
    expect(paragraphTextareas(mounted.container)[1]!.value).toBe("Second");
    mounted.unmount();
  });

  it("notifies when committing a paragraph edit rejects", async () => {
    const client = createMockRpcClient();
    vi.mocked(client.editor.open).mockResolvedValue({
      id: 1,
      paragraphs: ["Original"],
    });
    vi.mocked(client.editor.setParagraphText).mockRejectedValue(
      new Error("session gone"),
    );
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountEditorsPage();

    act(() => {
      latestOnFile?.(openedFile("report.docx"));
    });
    await vi.waitFor(() => {
      expect(paragraphTextareas(mounted.container)).toHaveLength(1);
    });

    const textarea = paragraphTextareas(mounted.container)[0]!;
    act(() => {
      textarea.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    await vi.waitFor(() => {
      expect(notifyError).toHaveBeenCalledWith(
        "Could not edit paragraph",
        expect.any(Error),
      );
    });
    mounted.unmount();
  });

  it("disables the add button until a new paragraph is typed, then adds and clears it", async () => {
    const client = createMockRpcClient();
    vi.mocked(client.editor.open).mockResolvedValue({
      id: 3,
      paragraphs: ["one"],
    });
    vi.mocked(client.editor.addParagraph).mockResolvedValue({
      id: 3,
      paragraphs: ["one", "two"],
    });
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountEditorsPage();

    act(() => {
      latestOnFile?.(openedFile("report.docx"));
    });
    await vi.waitFor(() => {
      expect(paragraphTextareas(mounted.container)).toHaveLength(1);
    });

    expect(addButton(mounted.container).disabled).toBe(true);
    expect(
      newParagraphTextarea(mounted.container).closest<HTMLElement>(
        ".mantine-Textarea-root",
      )!.style.flex,
    ).toBe("1 1 0%");
    typeInto(newParagraphTextarea(mounted.container), "two");
    expect(addButton(mounted.container).disabled).toBe(false);

    click(addButton(mounted.container));
    await vi.waitFor(() => {
      expect(paragraphTextareas(mounted.container)).toHaveLength(2);
    });

    const [input] = vi.mocked(client.editor.addParagraph).mock.calls[0]!;
    expect(input).toEqual({ id: 3, text: "two" });
    expect(newParagraphTextarea(mounted.container).value).toBe("");
    expect(addButton(mounted.container).disabled).toBe(true);
    mounted.unmount();
  });

  it("notifies when adding a paragraph rejects", async () => {
    const client = createMockRpcClient();
    vi.mocked(client.editor.open).mockResolvedValue({
      id: 1,
      paragraphs: [],
    });
    vi.mocked(client.editor.addParagraph).mockRejectedValue(
      new Error("session gone"),
    );
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountEditorsPage();

    act(() => {
      latestOnFile?.(openedFile("report.docx"));
    });
    await vi.waitFor(() => {
      expect(newParagraphTextarea(mounted.container)).toBeDefined();
    });

    typeInto(newParagraphTextarea(mounted.container), "two");
    click(addButton(mounted.container));
    await vi.waitFor(() => {
      expect(notifyError).toHaveBeenCalledWith(
        "Could not add paragraph",
        expect.any(Error),
      );
    });
    mounted.unmount();
  });

  it("removes the paragraph at the clicked row's own index", async () => {
    const client = createMockRpcClient();
    vi.mocked(client.editor.open).mockResolvedValue({
      id: 5,
      paragraphs: ["first", "second"],
    });
    vi.mocked(client.editor.removeParagraph).mockResolvedValue({
      id: 5,
      paragraphs: ["first"],
    });
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountEditorsPage();

    act(() => {
      latestOnFile?.(openedFile("report.docx"));
    });
    await vi.waitFor(() => {
      expect(paragraphTextareas(mounted.container)).toHaveLength(2);
    });

    click(removeButton(mounted.container, 1));
    await vi.waitFor(() => {
      expect(paragraphTextareas(mounted.container)).toHaveLength(1);
    });

    const [input] = vi.mocked(client.editor.removeParagraph).mock.calls[0]!;
    expect(input).toEqual({ id: 5, index: 1 });
    mounted.unmount();
  });

  it("notifies when removing a paragraph rejects", async () => {
    const client = createMockRpcClient();
    vi.mocked(client.editor.open).mockResolvedValue({
      id: 1,
      paragraphs: ["only"],
    });
    vi.mocked(client.editor.removeParagraph).mockRejectedValue(
      new Error("session gone"),
    );
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountEditorsPage();

    act(() => {
      latestOnFile?.(openedFile("report.docx"));
    });
    await vi.waitFor(() => {
      expect(paragraphTextareas(mounted.container)).toHaveLength(1);
    });

    click(removeButton(mounted.container, 0));
    await vi.waitFor(() => {
      expect(notifyError).toHaveBeenCalledWith(
        "Could not remove paragraph",
        expect.any(Error),
      );
    });
    mounted.unmount();
  });

  it("saves, notifies success, and downloads the written bytes", async () => {
    const client = createMockRpcClient();
    vi.mocked(client.editor.open).mockResolvedValue({
      id: 9,
      paragraphs: ["only"],
    });
    const writtenBytes = new Uint8Array([4, 5, 6]);
    vi.mocked(client.editor.save).mockResolvedValue({ bytes: writtenBytes });
    saveFile.mockResolvedValue({});
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountEditorsPage();

    act(() => {
      latestOnFile?.(openedFile("report.docx"));
    });
    await vi.waitFor(() => {
      expect(paragraphTextareas(mounted.container)).toHaveLength(1);
    });

    click(saveButton(mounted.container));
    await vi.waitFor(() => {
      expect(notifySuccess).toHaveBeenCalledWith("Document saved");
    });

    const [input] = vi.mocked(client.editor.save).mock.calls[0]!;
    expect(input).toEqual({ id: 9 });
    expect(saveFile).toHaveBeenCalledWith(writtenBytes, {
      suggestedName: "report.docx",
      mimeType: "application/octet-stream",
    });
    mounted.unmount();
  });

  it("shows the Save button as loading while the save is in flight", async () => {
    const client = createMockRpcClient();
    vi.mocked(client.editor.open).mockResolvedValue({
      id: 1,
      paragraphs: ["only"],
    });
    vi.mocked(client.editor.save).mockReturnValue(new Promise(() => {}));
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountEditorsPage();

    act(() => {
      latestOnFile?.(openedFile("report.docx"));
    });
    await vi.waitFor(() => {
      expect(paragraphTextareas(mounted.container)).toHaveLength(1);
    });

    expect(saveButton(mounted.container).getAttribute("data-loading")).not.toBe(
      "true",
    );
    click(saveButton(mounted.container));
    await vi.waitFor(() => {
      expect(saveButton(mounted.container).getAttribute("data-loading")).toBe(
        "true",
      );
    });
    mounted.unmount();
  });

  it("notifies when saving rejects and never downloads", async () => {
    const client = createMockRpcClient();
    vi.mocked(client.editor.open).mockResolvedValue({
      id: 1,
      paragraphs: ["only"],
    });
    vi.mocked(client.editor.save).mockRejectedValue(new Error("write failed"));
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountEditorsPage();

    act(() => {
      latestOnFile?.(openedFile("report.docx"));
    });
    await vi.waitFor(() => {
      expect(paragraphTextareas(mounted.container)).toHaveLength(1);
    });

    click(saveButton(mounted.container));
    await vi.waitFor(() => {
      expect(notifyError).toHaveBeenCalledWith(
        "Could not save document",
        expect.any(Error),
      );
    });
    expect(saveFile).not.toHaveBeenCalled();
    mounted.unmount();
  });
});
