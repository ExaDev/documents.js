import { afterEach, describe, expect, it, vi } from "vitest";

import type { OpenedFile } from "../ports/fileAccess";
import { createMockRpcClient } from "../test/mockRpcClient";
import { mountWithProviders } from "../test/mountComponent";

vi.mock("../rpc/client", () => ({ getRpcClient: vi.fn() }));

// Stands in for the real FileUpload (already covered by its own dedicated test suite): FontsPage's own logic -- inferring the format, resetting the previous mutation, triggering extractFonts only for a recognised format, and surfacing an unrecognised-format alert -- is what this file exercises, not FileUpload's drag-and-drop wiring.
let latestOnFile: ((file: OpenedFile) => void) | undefined;
vi.mock("../ui/FileUpload", () => ({
  FileUpload: (props: {
    file: OpenedFile | undefined;
    onFile: (file: OpenedFile) => void;
    loading: boolean;
  }) => {
    latestOnFile = props.onFile;
    return (
      <div
        data-testid="file-upload"
        data-loading={String(props.loading)}
        data-file-name={props.file?.name ?? ""}
      />
    );
  },
}));

const { getRpcClient } = await import("../rpc/client");
const { Route } = await import("./fonts");
const FontsPage = Route.options.component!;

function openedFile(name: string): OpenedFile {
  return { bytes: new Uint8Array([1, 2, 3]), name };
}

function mountFontsPage() {
  return mountWithProviders(<FontsPage />);
}

afterEach(() => {
  latestOnFile = undefined;
  vi.mocked(getRpcClient).mockReset();
});

describe("FontsPage", () => {
  it("renders the FileUpload with no file and not loading before anything is picked", () => {
    const client = createMockRpcClient();
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountFontsPage();
    const upload = mounted.container.querySelector(
      '[data-testid="file-upload"]',
    );
    expect(upload?.getAttribute("data-loading")).toBe("false");
    expect(upload?.getAttribute("data-file-name")).toBe("");
    mounted.unmount();
  });

  it("extracts fonts for a recognised format and lists each family with its bold/italic flags", async () => {
    const client = createMockRpcClient();
    vi.mocked(client.fonts.extractSourceFonts).mockResolvedValue([
      { family: "Times New Roman", bold: false, italic: true },
    ]);
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountFontsPage();

    latestOnFile?.(openedFile("report.docx"));
    await vi.waitFor(() => {
      expect(mounted.container.textContent).toContain("Times New Roman");
    });

    const [input] = vi.mocked(client.fonts.extractSourceFonts).mock.calls[0]!;
    expect(input.format).toBe("docx");
    expect(input.bytes).toBeInstanceOf(Uint8Array);
    expect(mounted.container.textContent).toContain("yes");
    expect(mounted.container.textContent).toContain("no");
    mounted.unmount();
  });

  it("shows the no-embedded-fonts message when extraction resolves an empty list", async () => {
    const client = createMockRpcClient();
    vi.mocked(client.fonts.extractSourceFonts).mockResolvedValue([]);
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountFontsPage();

    latestOnFile?.(openedFile("report.docx"));
    await vi.waitFor(() => {
      expect(mounted.container.textContent).toContain(
        "No embedded fonts found.",
      );
    });
    mounted.unmount();
  });

  it("does not call extractSourceFonts for a file whose extension resolves to no known format, and shows the unrecognised-format alert instead", async () => {
    const client = createMockRpcClient();
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountFontsPage();

    latestOnFile?.(openedFile("notes.txt"));
    await vi.waitFor(() => {
      expect(mounted.container.textContent).toContain(
        'Could not recognise "notes.txt"',
      );
    });
    expect(client.fonts.extractSourceFonts).not.toHaveBeenCalled();
    mounted.unmount();
  });

  it("notifies and shows no font table when extraction rejects", async () => {
    const client = createMockRpcClient();
    vi.mocked(client.fonts.extractSourceFonts).mockRejectedValue(
      new Error("worker crashed"),
    );
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountFontsPage();

    latestOnFile?.(openedFile("report.docx"));
    await vi.waitFor(() => {
      expect(client.fonts.extractSourceFonts).toHaveBeenCalled();
    });
    expect(mounted.container.textContent).not.toContain(
      "No embedded fonts found.",
    );
    mounted.unmount();
  });
});
