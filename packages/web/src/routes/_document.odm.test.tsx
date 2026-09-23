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

// Stands in for the real FileUpload (already covered by its own dedicated test suite): OdmPage's own chapter-handling logic — rendering against whichever chapters are on hand, replacing a re-picked chapter rather than duplicating it — is what this file exercises. The master is now opened via the shared layout's own FileUpload (the openDocument harness), not this panel's own.
let latestChapterProps:
  | {
      onFile: (file: OpenedFile) => void;
      accept: Record<string, string[]>;
      formatHint?: string;
    }
  | undefined;
vi.mock("../ui/FileUpload", () => ({
  FileUpload: (props: {
    onFile: (file: OpenedFile) => void;
    accept: Record<string, string[]>;
    formatHint?: string;
  }) => {
    latestChapterProps = props;
    return (
      <div
        data-testid="file-upload-chapter"
        data-format-hint={props.formatHint}
      />
    );
  },
}));

const notifyError = vi.fn<(title: string, error: unknown) => void>();
vi.mock("../ui/notify", () => ({
  notifyError: (title: string, error: unknown) => {
    notifyError(title, error);
  },
}));

const { getRpcClient } = await import("../rpc/client");
const { Route } = await import("./_document.odm");
const OdmPage = Route.options.component!;

function openedFile(name: string): OpenedFile {
  return { bytes: new Uint8Array([1, 2, 3]), name };
}

function mountOdmPage() {
  return mountWithOpenDocument(<OdmPage />);
}

afterEach(() => {
  resetOpenDocumentCapture();
  latestChapterProps = undefined;
  notifyError.mockReset();
  vi.mocked(getRpcClient).mockReset();
  vi.restoreAllMocks();
});

describe("OdmPage", () => {
  it("prompts to open a master document, with no chapter upload, missing-chapters alert, or rendered PDF, before anything is open", () => {
    const client = createMockRpcClient();
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountOdmPage();

    expect(mounted.container.textContent).toContain(
      "Open an .odm master document above to render it.",
    );
    expect(
      mounted.container.querySelector('[data-testid="file-upload-chapter"]'),
    ).toBeNull();
    expect(mounted.container.textContent).not.toContain(
      "Chapters still missing",
    );
    expect(mounted.container.querySelector("iframe")).toBeNull();
    mounted.unmount();
  });

  it("shows the chapter upload, restricted to .odt, once a master is open", () => {
    const client = createMockRpcClient();
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountOdmPage();

    act(() => {
      openDocument(openedFile("book.odm"));
    });

    expect(latestChapterProps?.formatHint).toBe(
      "the linked chapter .odt files",
    );
    expect(latestChapterProps?.accept).toEqual({
      "application/vnd.oasis.opendocument.text": [".odt"],
    });
    mounted.unmount();
  });

  it("renders the PDF once the master alone resolves with no chapters needed", async () => {
    const client = createMockRpcClient();
    vi.mocked(client.odm.render).mockResolvedValue({
      ok: true,
      pdf: new Uint8Array([9, 9]),
    });
    vi.mocked(getRpcClient).mockReturnValue(client);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:rendered");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const mounted = mountOdmPage();

    act(() => {
      openDocument(openedFile("book.odm"));
    });
    await vi.waitFor(() => {
      expect(mounted.container.querySelector("iframe")).not.toBeNull();
    });

    const [input] = vi.mocked(client.odm.render).mock.calls[0]!;
    expect(input.master).toBeInstanceOf(Uint8Array);
    expect(input.chapters).toEqual([]);
    const iframe = mounted.container.querySelector("iframe")!;
    expect(iframe.getAttribute("src")).toBe("blob:rendered");
    expect(iframe.style.width).toBe("100%");
    expect(iframe.style.height).toBe("70vh");
    expect(iframe.style.borderStyle).toBe("none");
    expect(mounted.container.textContent).toContain("book.odm");
    mounted.unmount();
  });

  it("re-renders with the chapter included once a chapter is picked, and replaces a same-name re-pick instead of duplicating it", async () => {
    const client = createMockRpcClient();
    vi.mocked(client.odm.render).mockResolvedValue({
      ok: true,
      pdf: new Uint8Array([1]),
    });
    vi.mocked(getRpcClient).mockReturnValue(client);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:one");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const mounted = mountOdmPage();

    act(() => {
      openDocument(openedFile("book.odm"));
    });
    await vi.waitFor(() => {
      expect(vi.mocked(client.odm.render).mock.calls.length).toBe(1);
    });

    act(() => {
      latestChapterProps?.onFile({
        bytes: new Uint8Array([1]),
        name: "ch1.odt",
      });
    });
    await vi.waitFor(() => {
      expect(latestChapterProps?.formatHint).toBe(
        "chapters: ch1.odt — add more or re-pick to replace",
      );
    });
    const secondInput = vi.mocked(client.odm.render).mock.calls[1]![0];
    expect(secondInput.chapters).toEqual([
      { href: "ch1.odt", bytes: new Uint8Array([1]) },
    ]);

    // A second, differently-named chapter must join the set rather than replace ch1.
    act(() => {
      latestChapterProps?.onFile({
        bytes: new Uint8Array([2]),
        name: "ch2.odt",
      });
    });
    await vi.waitFor(() => {
      // A real comma-space join, not a bare concatenation — proves the separator, not just that both names appear.
      expect(latestChapterProps?.formatHint).toBe(
        "chapters: ch1.odt, ch2.odt — add more or re-pick to replace",
      );
    });

    // Re-picking ch1 with different bytes must replace only ch1, leaving ch2 untouched.
    act(() => {
      latestChapterProps?.onFile({
        bytes: new Uint8Array([9, 9]),
        name: "ch1.odt",
      });
    });
    await vi.waitFor(() => {
      expect(vi.mocked(client.odm.render).mock.calls.length).toBe(4);
    });
    const fourthInput = vi.mocked(client.odm.render).mock.calls[3]![0];
    expect(fourthInput.chapters).toEqual([
      { href: "ch2.odt", bytes: new Uint8Array([2]) },
      { href: "ch1.odt", bytes: new Uint8Array([9, 9]) },
    ]);
    mounted.unmount();
  });

  it("shows the still-missing chapters alert, and no rendered PDF, when the render reports unresolved hrefs", async () => {
    const client = createMockRpcClient();
    vi.mocked(client.odm.render).mockResolvedValue({
      ok: false,
      unresolved: ["intro.odt", "appendix.odt"],
    });
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountOdmPage();

    act(() => {
      openDocument(openedFile("book.odm"));
    });
    await vi.waitFor(() => {
      expect(mounted.container.textContent).toContain("Chapters still missing");
    });
    expect(mounted.container.textContent).toContain("intro.odt");
    expect(mounted.container.textContent).toContain("appendix.odt");
    expect(mounted.container.querySelector("iframe")).toBeNull();
    mounted.unmount();
  });

  it("shows no missing-chapters alert when the render reports an empty unresolved list", async () => {
    const client = createMockRpcClient();
    vi.mocked(client.odm.render).mockResolvedValue({
      ok: false,
      unresolved: [],
    });
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountOdmPage();

    act(() => {
      openDocument(openedFile("book.odm"));
    });
    await vi.waitFor(() => {
      expect(vi.mocked(client.odm.render).mock.calls.length).toBe(1);
    });
    expect(mounted.container.textContent).not.toContain(
      "Chapters still missing",
    );
    mounted.unmount();
  });

  it("re-renders from a clean slate, dropping the previous master's chapters, when a new master is opened", async () => {
    const client = createMockRpcClient();
    vi.mocked(client.odm.render).mockResolvedValue({
      ok: true,
      pdf: new Uint8Array([1]),
    });
    vi.mocked(getRpcClient).mockReturnValue(client);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:one");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const mounted = mountOdmPage();

    act(() => {
      openDocument(openedFile("first.odm"));
    });
    await vi.waitFor(() => {
      expect(vi.mocked(client.odm.render).mock.calls.length).toBe(1);
    });
    act(() => {
      latestChapterProps?.onFile({
        bytes: new Uint8Array([1]),
        name: "ch1.odt",
      });
    });
    await vi.waitFor(() => {
      expect(vi.mocked(client.odm.render).mock.calls.length).toBe(2);
    });

    act(() => {
      openDocument(openedFile("second.odm"));
    });
    await vi.waitFor(() => {
      expect(vi.mocked(client.odm.render).mock.calls.length).toBe(3);
    });
    const thirdInput = vi.mocked(client.odm.render).mock.calls[2]![0];
    expect(thirdInput.chapters).toEqual([]);
    expect(latestChapterProps?.formatHint).toBe(
      "the linked chapter .odt files",
    );
    mounted.unmount();
  });

  it("calls notifyError when the render rejects", async () => {
    const client = createMockRpcClient();
    vi.mocked(client.odm.render).mockRejectedValue(new Error("bad master"));
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountOdmPage();

    act(() => {
      openDocument(openedFile("book.odm"));
    });
    await vi.waitFor(() => {
      expect(notifyError).toHaveBeenCalledWith(
        "Could not render master document",
        expect.any(Error),
      );
    });
    mounted.unmount();
  });
});
