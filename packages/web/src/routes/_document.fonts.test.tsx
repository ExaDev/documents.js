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

const notifyError = vi.fn<(title: string, error: unknown) => void>();
vi.mock("../ui/notify", () => ({
  notifyError: (title: string, error: unknown) => {
    notifyError(title, error);
  },
}));

const { getRpcClient } = await import("../rpc/client");
const { Route } = await import("./_document.fonts");
const FontsPage = Route.options.component!;

function openedFile(name: string): OpenedFile {
  return { bytes: new Uint8Array([1, 2, 3]), name };
}

function mountFontsPage() {
  return mountWithOpenDocument(<FontsPage />);
}

afterEach(() => {
  resetOpenDocumentCapture();
  notifyError.mockReset();
  vi.mocked(getRpcClient).mockReset();
});

describe("FontsPage", () => {
  it("prompts to open a document before anything is open", () => {
    const client = createMockRpcClient();
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountFontsPage();
    expect(mounted.container.textContent).toContain(
      "Open a document above to see its embedded fonts.",
    );
    expect(mounted.container.querySelector("table")).toBeNull();
    mounted.unmount();
  });

  it("shows the unrecognised-format alert and skips extracting fonts for an unrecognised extension", () => {
    const client = createMockRpcClient();
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountFontsPage();

    act(() => {
      openDocument(openedFile("notes.xyz"));
    });

    expect(mounted.container.textContent).toContain(
      `Could not recognise "notes.xyz"'s format from its extension.`,
    );
    expect(client.fonts.extractSourceFonts).not.toHaveBeenCalled();
    mounted.unmount();
  });

  it("extracts fonts for a recognised extension and lists each one", async () => {
    const client = createMockRpcClient();
    vi.mocked(client.fonts.extractSourceFonts).mockResolvedValue([
      { family: "Calibri", bold: false, italic: false },
      { family: "Arial", bold: true, italic: false },
    ]);
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountFontsPage();

    act(() => {
      openDocument(openedFile("report.docx"));
    });
    await vi.waitFor(() => {
      expect(mounted.container.querySelector("table")).not.toBeNull();
    });

    const [input] = vi.mocked(client.fonts.extractSourceFonts).mock.calls[0]!;
    expect(input.format).toBe("docx");
    expect(mounted.container.textContent).toContain("Calibri");
    expect(mounted.container.textContent).toContain("Arial");
    mounted.unmount();
  });

  it("shows a 'no fonts found' message when the document has none embedded", async () => {
    const client = createMockRpcClient();
    vi.mocked(client.fonts.extractSourceFonts).mockResolvedValue([]);
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountFontsPage();

    act(() => {
      openDocument(openedFile("report.docx"));
    });
    await vi.waitFor(() => {
      expect(mounted.container.textContent).toContain(
        "No embedded fonts found.",
      );
    });
    mounted.unmount();
  });

  it("re-extracts for a newly opened document, replacing the previous result", async () => {
    const client = createMockRpcClient();
    vi.mocked(client.fonts.extractSourceFonts).mockResolvedValueOnce([
      { family: "First", bold: false, italic: false },
    ]);
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountFontsPage();

    act(() => {
      openDocument(openedFile("first.docx"));
    });
    await vi.waitFor(() => {
      expect(mounted.container.textContent).toContain("First");
    });

    vi.mocked(client.fonts.extractSourceFonts).mockResolvedValueOnce([
      { family: "Second", bold: false, italic: false },
    ]);
    act(() => {
      openDocument(openedFile("second.docx"));
    });
    await vi.waitFor(() => {
      expect(mounted.container.textContent).toContain("Second");
    });
    expect(mounted.container.textContent).not.toContain("First");
    mounted.unmount();
  });

  it("calls notifyError when the extraction rejects", async () => {
    const client = createMockRpcClient();
    vi.mocked(client.fonts.extractSourceFonts).mockRejectedValue(
      new Error("bad header"),
    );
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountFontsPage();

    act(() => {
      openDocument(openedFile("report.docx"));
    });
    await vi.waitFor(() => {
      expect(notifyError).toHaveBeenCalledWith(
        "Could not read fonts",
        expect.any(Error),
      );
    });
    mounted.unmount();
  });
});
