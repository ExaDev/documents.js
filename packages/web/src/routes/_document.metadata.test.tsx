import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { OpenedFile } from "../ports/fileAccess";
import { createMockRpcClient } from "../test/mockRpcClient";
import {
  mountWithOpenDocument,
  openDocument,
  resetOpenDocumentCapture,
} from "../test/openDocumentHarness";

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

const { getRpcClient } = await import("../rpc/client");
const { Route } = await import("./_document.metadata");
const MetadataPage = Route.options.component!;

function openedFile(name: string): OpenedFile {
  return { bytes: new Uint8Array([1, 2, 3]), name };
}

function mountMetadataPage() {
  return mountWithOpenDocument(<MetadataPage />);
}

function inputForLabel(
  container: HTMLElement,
  labelText: string,
): HTMLInputElement | undefined {
  const label = [...container.querySelectorAll("label")].find(
    (candidate) => candidate.textContent === labelText,
  );
  const id = label?.getAttribute("for");
  if (id === null || id === undefined) return undefined;
  return container.querySelector<HTMLInputElement>(`#${id}`) ?? undefined;
}

function titleInput(container: HTMLElement) {
  return inputForLabel(container, "Title");
}

function authorInput(container: HTMLElement) {
  return inputForLabel(container, "Author");
}

// React tracks an input's last-known value on the DOM node itself and skips its onChange dispatch when a plain `input.value = ...` assignment already matches what it already recorded — going through the native setter (bypassing React's own patched one) keeps its tracked value stale, so the subsequent "input" event is seen as a real change.
function typeInto(input: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

afterEach(() => {
  resetOpenDocumentCapture();
  notifyError.mockReset();
  notifySuccess.mockReset();
  saveFile.mockReset();
  vi.mocked(getRpcClient).mockReset();
});

describe("MetadataPage", () => {
  it("prompts to open a document before anything is open", () => {
    const client = createMockRpcClient();
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountMetadataPage();
    expect(mounted.container.textContent).toContain(
      "Open a document above to see its metadata.",
    );
    expect(mounted.container.querySelector("table")).toBeNull();
    mounted.unmount();
  });

  it("shows the unrecognised-format alert and skips reading metadata for an unrecognised extension", () => {
    const client = createMockRpcClient();
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountMetadataPage();

    act(() => {
      openDocument(openedFile("notes.xyz"));
    });

    expect(mounted.container.textContent).toContain(
      `Could not recognise "notes.xyz"'s format from its extension.`,
    );
    expect(client.metadata.read).not.toHaveBeenCalled();
    expect(mounted.container.querySelector("table")).toBeNull();
    mounted.unmount();
  });

  it("reads metadata for a recognised extension and seeds the title/author fields", async () => {
    const client = createMockRpcClient();
    vi.mocked(client.metadata.read).mockResolvedValue({
      title: "Existing title",
      author: "Existing author",
      creator: "Word",
      createdIso: "2020-01-01T00:00:00Z",
      modifiedIso: "2020-06-01T00:00:00Z",
      producer: "documents.js",
    });
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountMetadataPage();

    act(() => {
      openDocument(openedFile("report.docx"));
    });
    await vi.waitFor(() => {
      expect(mounted.container.querySelector("table")).not.toBeNull();
    });

    const [input] = vi.mocked(client.metadata.read).mock.calls[0]!;
    expect(input.format).toBe("docx");
    expect(input.bytes).toBeInstanceOf(Uint8Array);

    expect(titleInput(mounted.container)?.value).toBe("Existing title");
    expect(authorInput(mounted.container)?.value).toBe("Existing author");
    expect(mounted.container.textContent).toContain("Word");
    expect(mounted.container.textContent).toContain("2020-01-01T00:00:00Z");
    expect(mounted.container.textContent).toContain("2020-06-01T00:00:00Z");
    expect(mounted.container.textContent).toContain("documents.js");
    expect(mounted.container.textContent).not.toContain("Could not recognise");
    mounted.unmount();
  });

  it("clears the previous document's data table when the next open's extension is unrecognised", async () => {
    const client = createMockRpcClient();
    vi.mocked(client.metadata.read).mockResolvedValue({ title: "Existing" });
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountMetadataPage();

    act(() => {
      openDocument(openedFile("report.docx"));
    });
    await vi.waitFor(() => {
      expect(mounted.container.querySelector("table")).not.toBeNull();
    });

    act(() => {
      openDocument(openedFile("notes.xyz"));
    });

    expect(mounted.container.querySelector("table")).toBeNull();
    expect(titleInput(mounted.container)).toBeUndefined();
    expect(mounted.container.textContent).toContain("Could not recognise");
    mounted.unmount();
  });

  it("does not carry a previous document's edited title/author into the next document's fields", async () => {
    const client = createMockRpcClient();
    vi.mocked(client.metadata.read).mockResolvedValue({ title: "Original" });
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountMetadataPage();

    act(() => {
      openDocument(openedFile("first.docx"));
    });
    await vi.waitFor(() => {
      expect(mounted.container.querySelector("table")).not.toBeNull();
    });
    typeInto(titleInput(mounted.container)!, "Edited title");
    typeInto(authorInput(mounted.container)!, "Edited author");

    vi.mocked(client.metadata.read).mockResolvedValue({
      title: "Second document's title",
    });
    act(() => {
      openDocument(openedFile("second.docx"));
    });
    await vi.waitFor(() => {
      expect(titleInput(mounted.container)?.value).toBe(
        "Second document's title",
      );
    });
    expect(authorInput(mounted.container)?.value).toBe("");
    mounted.unmount();
  });

  it("does not carry a previous document's in-flight save state into the next document's Save button", async () => {
    const client = createMockRpcClient();
    vi.mocked(client.metadata.read).mockResolvedValue({});
    let resolveWrite!: (
      value: Awaited<ReturnType<typeof client.metadata.write>>,
    ) => void;
    vi.mocked(client.metadata.write).mockReturnValue(
      new Promise((resolve) => {
        resolveWrite = resolve;
      }),
    );
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountMetadataPage();

    act(() => {
      openDocument(openedFile("first.docx"));
    });
    await vi.waitFor(() => {
      expect(mounted.container.querySelector("table")).not.toBeNull();
    });
    const firstSaveButton = [
      ...mounted.container.querySelectorAll("button"),
    ].find((candidate) => candidate.textContent === "Save and download")!;
    act(() => {
      firstSaveButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    act(() => {
      openDocument(openedFile("second.docx"));
    });
    await vi.waitFor(() => {
      expect(mounted.container.querySelector("table")).not.toBeNull();
    });

    const secondSaveButton = [
      ...mounted.container.querySelectorAll("button"),
    ].find((candidate) => candidate.textContent === "Save and download")!;
    expect(secondSaveButton.getAttribute("data-loading")).not.toBe("true");

    resolveWrite(new Uint8Array([1]));
    mounted.unmount();
  });

  it("falls back to empty title/author and omits every optional row when the metadata carries none of them", async () => {
    const client = createMockRpcClient();
    vi.mocked(client.metadata.read).mockResolvedValue({});
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountMetadataPage();

    act(() => {
      openDocument(openedFile("report.docx"));
    });
    await vi.waitFor(() => {
      expect(mounted.container.querySelector("table")).not.toBeNull();
    });

    expect(titleInput(mounted.container)?.value).toBe("");
    expect(authorInput(mounted.container)?.value).toBe("");
    expect(mounted.container.querySelectorAll("tr")).toHaveLength(0);
    mounted.unmount();
  });

  it("calls notifyError and shows no data panel when the read rejects", async () => {
    const client = createMockRpcClient();
    vi.mocked(client.metadata.read).mockRejectedValue(new Error("bad header"));
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountMetadataPage();

    act(() => {
      openDocument(openedFile("report.docx"));
    });
    await vi.waitFor(() => {
      expect(notifyError).toHaveBeenCalledWith(
        "Could not read metadata",
        expect.any(Error),
      );
    });
    expect(mounted.container.querySelector("table")).toBeNull();
    mounted.unmount();
  });

  it("edits the title and author fields via their own inputs", async () => {
    const client = createMockRpcClient();
    vi.mocked(client.metadata.read).mockResolvedValue({});
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountMetadataPage();

    act(() => {
      openDocument(openedFile("report.docx"));
    });
    await vi.waitFor(() => {
      expect(mounted.container.querySelector("table")).not.toBeNull();
    });

    typeInto(titleInput(mounted.container)!, "New title");
    expect(titleInput(mounted.container)?.value).toBe("New title");

    typeInto(authorInput(mounted.container)!, "New author");
    expect(authorInput(mounted.container)?.value).toBe("New author");
    mounted.unmount();
  });

  it("saves the edited overrides, notifies success, and downloads the written bytes", async () => {
    const client = createMockRpcClient();
    vi.mocked(client.metadata.read).mockResolvedValue({ title: "Old" });
    const writtenBytes = new Uint8Array([9, 9, 9]);
    vi.mocked(client.metadata.write).mockResolvedValue(writtenBytes);
    saveFile.mockResolvedValue({});
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountMetadataPage();

    act(() => {
      openDocument(openedFile("report.docx"));
    });
    await vi.waitFor(() => {
      expect(mounted.container.querySelector("table")).not.toBeNull();
    });

    typeInto(titleInput(mounted.container)!, "New title");

    const button = [...mounted.container.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === "Save and download",
    )!;
    act(() => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await vi.waitFor(() => {
      expect(notifySuccess).toHaveBeenCalledWith("Metadata saved");
    });

    const [input] = vi.mocked(client.metadata.write).mock.calls[0]!;
    expect(input.sourceFormat).toBe("docx");
    expect(input.targetFormat).toBe("docx");
    expect(input.overrides).toEqual({ title: "New title", author: "" });
    expect(saveFile).toHaveBeenCalledWith(writtenBytes, {
      suggestedName: "report.docx",
      mimeType: "application/octet-stream",
    });
    mounted.unmount();
  });

  it("calls notifyError and skips downloading when the write rejects", async () => {
    const client = createMockRpcClient();
    vi.mocked(client.metadata.read).mockResolvedValue({});
    vi.mocked(client.metadata.write).mockRejectedValue(
      new Error("write failed"),
    );
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountMetadataPage();

    act(() => {
      openDocument(openedFile("report.docx"));
    });
    await vi.waitFor(() => {
      expect(mounted.container.querySelector("table")).not.toBeNull();
    });

    const button = [...mounted.container.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === "Save and download",
    )!;
    act(() => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await vi.waitFor(() => {
      expect(notifyError).toHaveBeenCalledWith(
        "Could not save metadata",
        expect.any(Error),
      );
    });
    expect(saveFile).not.toHaveBeenCalled();
    mounted.unmount();
  });
});
