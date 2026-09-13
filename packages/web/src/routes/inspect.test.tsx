import type * as MantineCore from "@mantine/core";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { OpenedFile } from "../ports/fileAccess";
import { createMockRpcClient } from "../test/mockRpcClient";
import { mountWithProviders } from "../test/mountComponent";

vi.mock("../rpc/client", () => ({ getRpcClient: vi.fn() }));

// Stands in for the real FileUpload (already covered by its own dedicated test suite): InspectPage's own logic -- auto-detecting a picked file's format and starting inspection immediately, or falling through to the format Select when detection fails -- is what this file exercises.
let latestOnFile: ((file: OpenedFile) => void) | undefined;
let latestFormatHint: string | undefined;
vi.mock("../ui/FileUpload", () => ({
  FileUpload: (props: {
    onFile: (file: OpenedFile) => void;
    formatHint?: string;
    file?: OpenedFile;
    loading: boolean;
  }) => {
    latestOnFile = props.onFile;
    latestFormatHint = props.formatHint;
    return (
      <div
        data-testid="file-upload"
        data-loading={String(props.loading)}
        data-file-name={props.file?.name ?? ""}
      />
    );
  },
}));

// Real Mantine Select renders as a text input with no accessible way to drive its dropdown without @testing-library/user-event -- capturing its own props (as the mocked FileUpload above already does) lets this suite drive onChange directly, the same way it drives FileUpload's onFile.
let latestSelect:
  | {
      data: string[];
      value: string | null;
      onChange: (value: string | null) => void;
    }
  | undefined;
vi.mock("@mantine/core", async (importOriginal) => {
  const actual = await importOriginal<typeof MantineCore>();
  return {
    ...actual,
    Select: (props: {
      data: string[];
      value: string | null;
      onChange: (value: string | null) => void;
    }) => {
      latestSelect = props;
      return (
        <div
          data-testid="format-select"
          data-value={props.value ?? ""}
          data-options={props.data.join(",")}
        />
      );
    },
  };
});

vi.mock("../ui/DiagnosticsPanel", () => ({
  DiagnosticsPanel: (props: { diagnostics: readonly unknown[] }) => (
    <div
      data-testid="diagnostics-panel"
      data-count={props.diagnostics.length}
    />
  ),
}));

vi.mock("../ui/InspectPanel", () => ({
  InspectPanel: (props: { data?: { backing: string }; loading?: boolean }) => (
    <div
      data-testid="inspect-panel"
      data-backing={props.data?.backing ?? ""}
      data-loading={String(props.loading)}
    />
  ),
}));

const notifyError = vi.fn<(title: string, error: unknown) => void>();
vi.mock("../ui/notify", () => ({
  notifyError: (title: string, error: unknown) => {
    notifyError(title, error);
  },
}));

const { getRpcClient } = await import("../rpc/client");
const { Route } = await import("./inspect");
const InspectPage = Route.options.component!;

function openedFile(name: string): OpenedFile {
  return { bytes: new Uint8Array([1, 2, 3]), name };
}

function mountInspectPage() {
  return mountWithProviders(<InspectPage />);
}

afterEach(() => {
  latestOnFile = undefined;
  latestFormatHint = undefined;
  latestSelect = undefined;
  notifyError.mockReset();
  vi.mocked(getRpcClient).mockReset();
});

describe("InspectPage", () => {
  it("renders the FileUpload with the joined format list once it loads, and no format alert, select, or result panel before anything is picked", async () => {
    const client = createMockRpcClient();
    vi.mocked(client.formats.list).mockResolvedValue(["pdf", "csv", "docx"]);
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountInspectPage();

    await vi.waitFor(() => {
      expect(latestFormatHint).toBe("pdf, csv, docx");
    });
    expect(
      mounted.container.querySelector('[data-testid="format-select"]'),
    ).toBeNull();
    expect(mounted.container.textContent).not.toContain("pick it below");
    expect(
      mounted.container.querySelector('[data-testid="inspect-panel"]'),
    ).toBeNull();
    mounted.unmount();
  });

  it("auto-detects a recognised format and starts inspection immediately, surfacing the content-backed result", async () => {
    const client = createMockRpcClient();
    // Deliberately not already alphabetical -- proves the Select's own `data` is actually sorted, not just passed through in whatever order formats.list resolved with.
    vi.mocked(client.formats.list).mockResolvedValue(["pdf", "docx"]);
    vi.mocked(client.pdf.inspect).mockResolvedValue({
      pageCount: 3,
      itemKindCounts: {},
      metadata: {},
      layout: { formatVersion: 1, metadata: {}, pages: [], images: {} },
    });
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountInspectPage();

    latestOnFile?.(openedFile("report.pdf"));
    await vi.waitFor(() => {
      expect(
        mounted.container.querySelector('[data-testid="inspect-panel"]'),
      ).not.toBeNull();
    });

    expect(client.convert).not.toHaveBeenCalled();
    const [pdfInspectInput] = vi.mocked(client.pdf.inspect).mock.calls[0]!;
    expect(pdfInspectInput.bytes).toBeInstanceOf(Uint8Array);
    const panel = mounted.container.querySelector(
      '[data-testid="inspect-panel"]',
    );
    expect(panel?.getAttribute("data-backing")).toBe("pdf");
    const diagnostics = mounted.container.querySelector(
      '[data-testid="diagnostics-panel"]',
    );
    expect(diagnostics?.getAttribute("data-count")).toBe("0");
    expect(mounted.container.textContent).not.toContain("pick it below");
    const select = mounted.container.querySelector(
      '[data-testid="format-select"]',
    );
    expect(select).not.toBeNull();
    expect(select?.getAttribute("data-options")).toBe("docx,pdf");
    expect(select?.getAttribute("data-value")).toBe("pdf");
    mounted.unmount();
  });

  it("converts a non-pdf source to pdf before inspecting it, carrying the conversion's own diagnostics through", async () => {
    const client = createMockRpcClient();
    vi.mocked(client.formats.list).mockResolvedValue(["docx", "pdf"]);
    vi.mocked(client.convert).mockResolvedValue({
      document: { format: "pdf", bytes: new Uint8Array([9, 9]) },
      diagnostics: [
        {
          severity: "warning",
          code: "font-substituted",
          message: "substituted a missing font",
        },
      ],
    });
    vi.mocked(client.pdf.inspect).mockResolvedValue({
      pageCount: 1,
      itemKindCounts: {},
      metadata: {},
      layout: { formatVersion: 1, metadata: {}, pages: [], images: {} },
    });
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountInspectPage();

    latestOnFile?.(openedFile("report.docx"));
    await vi.waitFor(() => {
      expect(
        mounted.container.querySelector('[data-testid="inspect-panel"]'),
      ).not.toBeNull();
    });

    const [convertInput] = vi.mocked(client.convert).mock.calls[0]!;
    expect(convertInput.source).toBe("docx");
    expect(convertInput.targetFormat).toBe("pdf");
    expect(convertInput.bytes).toBeInstanceOf(Uint8Array);
    expect(client.pdf.inspect).toHaveBeenCalledWith({
      bytes: new Uint8Array([9, 9]),
    });
    const diagnostics = mounted.container.querySelector(
      '[data-testid="diagnostics-panel"]',
    );
    expect(diagnostics?.getAttribute("data-count")).toBe("1");
    mounted.unmount();
  });

  it("shows the unrecognised-format alert and the format Select, without starting inspection, when the extension is not recognised", async () => {
    const client = createMockRpcClient();
    vi.mocked(client.formats.list).mockResolvedValue(["docx", "pdf"]);
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountInspectPage();

    latestOnFile?.(openedFile("notes.xyz"));
    await vi.waitFor(() => {
      expect(mounted.container.textContent).toContain(
        'Could not detect "notes.xyz"',
      );
    });
    expect(mounted.container.textContent).toContain("pick it below");
    expect(client.pdf.inspect).not.toHaveBeenCalled();
    expect(client.convert).not.toHaveBeenCalled();

    const select = mounted.container.querySelector(
      '[data-testid="format-select"]',
    );
    expect(select?.getAttribute("data-value")).toBe("");
    mounted.unmount();
  });

  it("shows the format Select with no options while the format list is still pending", () => {
    const client = createMockRpcClient();
    vi.mocked(client.formats.list).mockReturnValue(new Promise(() => {}));
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountInspectPage();

    act(() => {
      latestOnFile?.(openedFile("notes.xyz"));
    });
    const select = mounted.container.querySelector(
      '[data-testid="format-select"]',
    );
    expect(select?.getAttribute("data-options")).toBe("");
    mounted.unmount();
  });

  it("runs inspection for the format picked from the Select after an unrecognised extension", async () => {
    const client = createMockRpcClient();
    vi.mocked(client.formats.list).mockResolvedValue(["docx", "pdf"]);
    vi.mocked(client.pdf.inspect).mockResolvedValue({
      pageCount: 2,
      itemKindCounts: {},
      metadata: {},
      layout: { formatVersion: 1, metadata: {}, pages: [], images: {} },
    });
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountInspectPage();

    latestOnFile?.(openedFile("notes.xyz"));
    await vi.waitFor(() => {
      expect(latestSelect).toBeDefined();
    });

    act(() => {
      latestSelect?.onChange("pdf");
    });
    await vi.waitFor(() => {
      expect(client.pdf.inspect).toHaveBeenCalled();
    });
    expect(mounted.container.textContent).not.toContain("pick it below");
    const select = mounted.container.querySelector(
      '[data-testid="format-select"]',
    );
    expect(select?.getAttribute("data-value")).toBe("pdf");
    mounted.unmount();
  });

  it("ignores an onChange of null, or one fired before any file is picked", async () => {
    const client = createMockRpcClient();
    vi.mocked(client.formats.list).mockResolvedValue(["docx", "pdf"]);
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountInspectPage();

    await vi.waitFor(() => {
      expect(latestFormatHint).toBeDefined();
    });
    latestSelect?.onChange("pdf");
    expect(client.pdf.inspect).not.toHaveBeenCalled();

    latestOnFile?.(openedFile("notes.xyz"));
    await vi.waitFor(() => {
      expect(
        mounted.container.querySelector('[data-testid="format-select"]'),
      ).not.toBeNull();
    });
    latestSelect?.onChange(null);
    expect(client.pdf.inspect).not.toHaveBeenCalled();
    mounted.unmount();
  });

  it("ignores an invalid format value from the Select", async () => {
    const client = createMockRpcClient();
    vi.mocked(client.formats.list).mockResolvedValue(["docx", "pdf"]);
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountInspectPage();

    latestOnFile?.(openedFile("notes.xyz"));
    await vi.waitFor(() => {
      expect(latestSelect).toBeDefined();
    });
    latestSelect?.onChange("not-a-real-format");
    expect(client.pdf.inspect).not.toHaveBeenCalled();
    expect(client.convert).not.toHaveBeenCalled();
    mounted.unmount();
  });

  it("notifies when inspection rejects", async () => {
    const client = createMockRpcClient();
    vi.mocked(client.formats.list).mockResolvedValue(["docx", "pdf"]);
    vi.mocked(client.pdf.inspect).mockRejectedValue(new Error("corrupt pdf"));
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountInspectPage();

    latestOnFile?.(openedFile("report.pdf"));
    await vi.waitFor(() => {
      expect(notifyError).toHaveBeenCalledWith(
        "Could not inspect document",
        expect.any(Error),
      );
    });
    mounted.unmount();
  });
});
