import { assembleTree } from "document-schema.js";
import type { ContentDocument } from "documents.js";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { OpenedFile } from "../ports/fileAccess";
import { createMockRpcClient } from "../test/mockRpcClient";
import { mountWithProviders } from "../test/mountComponent";

// A minimal but genuinely schema-valid wordprocessing document, and the tree-form dump PackagePage actually renders for it -- assembleTree is the same structural transform the real content.read handler applies (src/rpc/router.ts), so this fixture's package shape matches what the route really receives rather than an ad hoc stand-in.
const sampleContent: ContentDocument = {
  kind: "wordprocessing",
  metadata: {},
  sections: [],
};
const samplePackage = {
  ...assembleTree(sampleContent),
  $schema: "test-schema",
};

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

// Stands in for the real FileUpload (already covered by its own dedicated test suite): PackagePage's own logic -- inferring the format, calling readContent.mutate, rendering/editing the dumped JSON, and restoring it -- is what this file exercises.
let latestOnFile: ((file: OpenedFile) => void) | undefined;
vi.mock("../ui/FileUpload", () => ({
  FileUpload: (props: { onFile: (file: OpenedFile) => void }) => {
    latestOnFile = props.onFile;
    return <div data-testid="file-upload" />;
  },
}));

const { getRpcClient } = await import("../rpc/client");
const { Route } = await import("./package");
const PackagePage = Route.options.component!;

function openedFile(name: string): OpenedFile {
  return { bytes: new Uint8Array([1, 2, 3]), name };
}

function mountPackagePage() {
  return mountWithProviders(<PackagePage />);
}

function jsonTextarea(container: HTMLElement) {
  return container.querySelector("textarea") ?? undefined;
}

// React tracks a textarea's last-known value on the DOM node itself and skips its onChange dispatch when a plain `textarea.value = ...` assignment already matches what it already recorded -- going through the native setter (bypassing React's own patched one) keeps its tracked value stale, so the subsequent "input" event is seen as a real change.
function typeInto(textarea: HTMLTextAreaElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    )?.set?.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

afterEach(() => {
  latestOnFile = undefined;
  notifyError.mockReset();
  notifySuccess.mockReset();
  saveFile.mockReset();
  vi.mocked(getRpcClient).mockReset();
});

describe("PackagePage", () => {
  it("renders only the FileUpload before anything is picked", () => {
    const client = createMockRpcClient();
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountPackagePage();
    expect(
      mounted.container.querySelector('[data-testid="file-upload"]'),
    ).not.toBeNull();
    expect(jsonTextarea(mounted.container)).toBeUndefined();
    expect(mounted.container.textContent).not.toContain(
      "does not identify a known document format",
    );
    mounted.unmount();
  });

  it("shows the unrecognised-format alert and skips reading for an unrecognised extension", () => {
    const client = createMockRpcClient();
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountPackagePage();

    act(() => {
      latestOnFile?.(openedFile("notes.xyz"));
    });

    expect(mounted.container.textContent).toContain(
      "The file extension does not identify a known document format.",
    );
    expect(client.content.read).not.toHaveBeenCalled();
    expect(jsonTextarea(mounted.container)).toBeUndefined();
    mounted.unmount();
  });

  it("shows the loading text while the read is in flight, then the dumped JSON once it resolves", async () => {
    const client = createMockRpcClient();
    let resolveRead!: (
      value: Awaited<ReturnType<typeof client.content.read>>,
    ) => void;
    vi.mocked(client.content.read).mockReturnValue(
      new Promise((resolve) => {
        resolveRead = resolve;
      }),
    );
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountPackagePage();

    act(() => {
      latestOnFile?.(openedFile("report.docx"));
    });
    await vi.waitFor(() => {
      expect(mounted.container.textContent).toContain(
        "Loading document structure…",
      );
    });

    resolveRead({ content: sampleContent, package: samplePackage });
    await vi.waitFor(() => {
      expect(jsonTextarea(mounted.container)).toBeDefined();
    });

    const [input] = vi.mocked(client.content.read).mock.calls[0]!;
    expect(input.format).toBe("docx");
    expect(input.bytes).toBeInstanceOf(Uint8Array);
    expect(mounted.container.textContent).not.toContain(
      "Loading document structure…",
    );
    expect(jsonTextarea(mounted.container)?.value).toContain(
      '"$schema": "test-schema"',
    );
    expect(mounted.container.textContent).toContain("real docx document");
    expect(mounted.container.textContent).not.toContain(
      "does not identify a known document format",
    );
    const textarea = jsonTextarea(mounted.container)!;
    expect(textarea.style.fontFamily).toBe(
      "var(--mantine-font-family-monospace)",
    );
    expect(textarea.style.fontSize).toBe("var(--mantine-font-size-xs)");
    expect(textarea.style.whiteSpace).toBe("pre");
    expect(textarea.style.overflowX).toBe("auto");
    mounted.unmount();
  });

  it("clears the previous read's JSON panel when the next pick's extension is unrecognised", async () => {
    const client = createMockRpcClient();
    vi.mocked(client.content.read).mockResolvedValue({
      content: sampleContent,
      package: samplePackage,
    });
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountPackagePage();

    act(() => {
      latestOnFile?.(openedFile("report.docx"));
    });
    await vi.waitFor(() => {
      expect(jsonTextarea(mounted.container)).toBeDefined();
    });

    act(() => {
      latestOnFile?.(openedFile("notes.xyz"));
    });

    expect(jsonTextarea(mounted.container)).toBeUndefined();
    expect(mounted.container.textContent).toContain(
      "does not identify a known document format",
    );
    mounted.unmount();
  });

  it("stops showing the loading text for a still-in-flight read once the next pick's extension is unrecognised", async () => {
    const client = createMockRpcClient();
    vi.mocked(client.content.read).mockReturnValue(new Promise(() => {}));
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountPackagePage();

    act(() => {
      latestOnFile?.(openedFile("report.docx"));
    });
    await vi.waitFor(() => {
      expect(mounted.container.textContent).toContain(
        "Loading document structure…",
      );
    });

    act(() => {
      latestOnFile?.(openedFile("notes.xyz"));
    });

    expect(mounted.container.textContent).not.toContain(
      "Loading document structure…",
    );
    mounted.unmount();
  });

  it("does not carry a previous file's in-flight restore state into the next file's Restore button", async () => {
    const client = createMockRpcClient();
    vi.mocked(client.content.read).mockResolvedValue({
      content: sampleContent,
      package: samplePackage,
    });
    let resolveRestore!: (
      value: Awaited<ReturnType<typeof client.content.restore>>,
    ) => void;
    vi.mocked(client.content.restore).mockReturnValue(
      new Promise((resolve) => {
        resolveRestore = resolve;
      }),
    );
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountPackagePage();

    act(() => {
      latestOnFile?.(openedFile("first.docx"));
    });
    await vi.waitFor(() => {
      expect(jsonTextarea(mounted.container)).toBeDefined();
    });
    const firstButton = [...mounted.container.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === "Restore to docx",
    )!;
    act(() => {
      firstButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    act(() => {
      latestOnFile?.(openedFile("second.docx"));
    });
    await vi.waitFor(() => {
      expect(jsonTextarea(mounted.container)).toBeDefined();
    });

    const secondButton = [...mounted.container.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === "Restore to docx",
    )!;
    expect(secondButton.getAttribute("data-loading")).not.toBe("true");

    resolveRestore({ bytes: new Uint8Array([1]) });
    mounted.unmount();
  });

  it("calls notifyError and shows no JSON panel when the read rejects", async () => {
    const client = createMockRpcClient();
    vi.mocked(client.content.read).mockRejectedValue(
      new Error("bad structure"),
    );
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountPackagePage();

    act(() => {
      latestOnFile?.(openedFile("report.docx"));
    });
    await vi.waitFor(() => {
      expect(notifyError).toHaveBeenCalledWith(
        "Could not read document",
        expect.any(Error),
      );
    });
    expect(jsonTextarea(mounted.container)).toBeUndefined();
    mounted.unmount();
  });

  it("edits the JSON via the textarea", async () => {
    const client = createMockRpcClient();
    vi.mocked(client.content.read).mockResolvedValue({
      content: sampleContent,
      package: samplePackage,
    });
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountPackagePage();

    act(() => {
      latestOnFile?.(openedFile("report.docx"));
    });
    await vi.waitFor(() => {
      expect(jsonTextarea(mounted.container)).toBeDefined();
    });

    typeInto(jsonTextarea(mounted.container)!, '{"kind":"edited"}');
    expect(jsonTextarea(mounted.container)?.value).toBe('{"kind":"edited"}');
    mounted.unmount();
  });

  it("restores the edited JSON, notifies success, and downloads the written bytes", async () => {
    const client = createMockRpcClient();
    vi.mocked(client.content.read).mockResolvedValue({
      content: sampleContent,
      package: samplePackage,
    });
    const writtenBytes = new Uint8Array([9, 9, 9]);
    vi.mocked(client.content.restore).mockResolvedValue({
      bytes: writtenBytes,
    });
    saveFile.mockResolvedValue({});
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountPackagePage();

    act(() => {
      latestOnFile?.(openedFile("report.docx"));
    });
    await vi.waitFor(() => {
      expect(jsonTextarea(mounted.container)).toBeDefined();
    });

    typeInto(jsonTextarea(mounted.container)!, '{"kind":"edited"}');

    const button = [...mounted.container.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === "Restore to docx",
    )!;
    act(() => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await vi.waitFor(() => {
      expect(notifySuccess).toHaveBeenCalledWith("Document restored");
    });

    const [input] = vi.mocked(client.content.restore).mock.calls[0]!;
    expect(input.format).toBe("docx");
    expect(input.package).toEqual({ kind: "edited" });
    expect(saveFile).toHaveBeenCalledWith(writtenBytes, {
      suggestedName: "report.docx",
      mimeType: "application/octet-stream",
    });
    mounted.unmount();
  });

  it("notifies a JSON parse failure and never calls restore when the edited text does not parse", async () => {
    const client = createMockRpcClient();
    vi.mocked(client.content.read).mockResolvedValue({
      content: sampleContent,
      package: samplePackage,
    });
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountPackagePage();

    act(() => {
      latestOnFile?.(openedFile("report.docx"));
    });
    await vi.waitFor(() => {
      expect(jsonTextarea(mounted.container)).toBeDefined();
    });

    typeInto(jsonTextarea(mounted.container)!, "{not valid json");

    const button = [...mounted.container.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === "Restore to docx",
    )!;
    act(() => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(notifyError).toHaveBeenCalledWith(
      "The JSON does not parse",
      expect.any(SyntaxError),
    );
    expect(client.content.restore).not.toHaveBeenCalled();
    mounted.unmount();
  });

  it("calls notifyError and skips downloading when restore rejects", async () => {
    const client = createMockRpcClient();
    vi.mocked(client.content.read).mockResolvedValue({
      content: sampleContent,
      package: samplePackage,
    });
    vi.mocked(client.content.restore).mockRejectedValue(new Error("bad tree"));
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountPackagePage();

    act(() => {
      latestOnFile?.(openedFile("report.docx"));
    });
    await vi.waitFor(() => {
      expect(jsonTextarea(mounted.container)).toBeDefined();
    });

    const button = [...mounted.container.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === "Restore to docx",
    )!;
    act(() => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await vi.waitFor(() => {
      expect(notifyError).toHaveBeenCalledWith(
        "Could not restore document",
        expect.any(Error),
      );
    });
    expect(saveFile).not.toHaveBeenCalled();
    mounted.unmount();
  });
});
