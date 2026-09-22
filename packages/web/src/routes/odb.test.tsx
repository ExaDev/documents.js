import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { OpenedFile } from "../ports/fileAccess";
import { createMockRpcClient } from "../test/mockRpcClient";
import { mountWithProviders } from "../test/mountComponent";

vi.mock("../rpc/client", () => ({ getRpcClient: vi.fn() }));

// Stands in for the real FileUpload (already covered by its own dedicated test suite): OdbPage's own logic — calling readOdb.mutate with the picked file's bytes and surfacing the inventory/error/pending states — is what this file exercises.
let latestOnFile: ((file: OpenedFile) => void) | undefined;
let latestAccept: Record<string, string[]> | undefined;
vi.mock("../ui/FileUpload", () => ({
  FileUpload: (props: {
    onFile: (file: OpenedFile) => void;
    accept: Record<string, string[]>;
  }) => {
    latestOnFile = props.onFile;
    latestAccept = props.accept;
    return <div data-testid="file-upload" />;
  },
}));

// Stands in for the real SheetPreview (already covered by its own dedicated test suite): asserting the label/format/content it is given is enough to prove OdbPage wired its own read result through correctly.
vi.mock("../ui/SheetPreview", () => ({
  SheetPreview: (props: {
    label: string;
    format: string;
    content: unknown;
  }) => (
    <div
      data-testid="sheet-preview"
      data-label={props.label}
      data-format={props.format}
      data-has-content={String(props.content !== undefined)}
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
const { Route } = await import("./odb");
const OdbPage = Route.options.component!;

function openedFile(name: string): OpenedFile {
  return { bytes: new Uint8Array([1, 2, 3]), name };
}

function mountOdbPage() {
  return mountWithProviders(<OdbPage />);
}

afterEach(() => {
  latestOnFile = undefined;
  latestAccept = undefined;
  notifyError.mockReset();
  vi.mocked(getRpcClient).mockReset();
});

describe("OdbPage", () => {
  it("renders the FileUpload, restricted to .odb, with no inventory, error, or preview before anything is picked", () => {
    const client = createMockRpcClient();
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountOdbPage();
    expect(
      mounted.container.querySelector('[data-testid="file-upload"]'),
    ).not.toBeNull();
    expect(
      mounted.container.querySelector('[data-testid="sheet-preview"]'),
    ).toBeNull();
    expect(latestAccept).toEqual({
      "application/vnd.oasis.opendocument.base": [".odb"],
    });
    expect(mounted.container.textContent).not.toContain("tables");
    expect(mounted.container.textContent).not.toContain("could not be read");
    mounted.unmount();
  });

  it("shows the pending message while the read is in flight", async () => {
    const client = createMockRpcClient();
    let resolveRead!: (
      value: Awaited<ReturnType<typeof client.odb.read>>,
    ) => void;
    vi.mocked(client.odb.read).mockReturnValue(
      new Promise((resolve) => {
        resolveRead = resolve;
      }),
    );
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountOdbPage();

    latestOnFile?.(openedFile("archive.odb"));
    await vi.waitFor(() => {
      expect(mounted.container.textContent).toContain("Reading database…");
    });

    resolveRead({
      inventory: {
        tables: [],
        queries: [],
        forms: [],
        reports: [],
      },
      content: { kind: "spreadsheet", metadata: {}, sheets: [] },
    });
    await vi.waitFor(() => {
      expect(mounted.container.textContent).not.toContain("Reading database…");
    });
    mounted.unmount();
  });

  it("renders the inventory summary, the queries list, and the sheet preview once the read resolves", async () => {
    const client = createMockRpcClient();
    vi.mocked(client.odb.read).mockResolvedValue({
      inventory: {
        connection: { type: "external", url: "jdbc:firebird://host/db" },
        tables: ["Customers", "Orders"],
        queries: [{ name: "TopSellers", command: "SELECT 1" }],
        forms: [{ name: "MainForm", href: "MainForm.xml" }],
        reports: [],
      },
      content: { kind: "spreadsheet", metadata: {}, sheets: [] },
    });
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountOdbPage();

    latestOnFile?.(openedFile("archive.odb"));
    await vi.waitFor(() => {
      expect(mounted.container.textContent).toContain("2 tables");
    });

    const [input] = vi.mocked(client.odb.read).mock.calls[0]!;
    expect(input.bytes).toBeInstanceOf(Uint8Array);
    expect(mounted.container.textContent).toContain(
      "Connection: external (jdbc:firebird://host/db)",
    );
    expect(mounted.container.textContent).toContain("1 queries");
    expect(mounted.container.textContent).toContain("1 forms");
    expect(mounted.container.textContent).toContain("0 reports");
    expect(mounted.container.textContent).toContain("TopSellers");

    const preview = mounted.container.querySelector(
      '[data-testid="sheet-preview"]',
    );
    expect(preview?.getAttribute("data-label")).toBe("archive.odb");
    expect(preview?.getAttribute("data-format")).toBe("ods");
    expect(preview?.getAttribute("data-has-content")).toBe("true");
    mounted.unmount();
  });

  it("falls back to the 'database' label and omits the connection URL/queries list when the inventory carries neither", async () => {
    const client = createMockRpcClient();
    vi.mocked(client.odb.read).mockResolvedValue({
      inventory: {
        connection: { type: "embedded" },
        tables: [],
        queries: [],
        forms: [],
        reports: [],
      },
      content: { kind: "spreadsheet", metadata: {}, sheets: [] },
    });
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountOdbPage();

    latestOnFile?.({ bytes: new Uint8Array([1]), name: "" });
    await vi.waitFor(() => {
      expect(mounted.container.textContent).toContain("0 tables");
    });

    const connectionText = /Connection: ([^]*?)(?=\d+ tables)/.exec(
      mounted.container.textContent,
    )?.[1];
    expect(connectionText).toBe("embedded");
    expect(mounted.container.querySelector("ul")).toBeNull();

    const preview = mounted.container.querySelector(
      '[data-testid="sheet-preview"]',
    );
    expect(preview?.getAttribute("data-label")).toBe("database");
    mounted.unmount();
  });

  it("shows 'none' for the connection type when the inventory carries no connection at all", async () => {
    const client = createMockRpcClient();
    vi.mocked(client.odb.read).mockResolvedValue({
      inventory: { tables: [], queries: [], forms: [], reports: [] },
      content: { kind: "spreadsheet", metadata: {}, sheets: [] },
    });
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountOdbPage();

    latestOnFile?.(openedFile("archive.odb"));
    await vi.waitFor(() => {
      expect(mounted.container.textContent).toContain("Connection: none");
    });
    mounted.unmount();
  });

  it("calls notifyError and shows the error alert when the read rejects", async () => {
    const client = createMockRpcClient();
    vi.mocked(client.odb.read).mockRejectedValue(new Error("bad header"));
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountOdbPage();

    latestOnFile?.(openedFile("archive.odb"));
    await vi.waitFor(() => {
      expect(notifyError).toHaveBeenCalledWith(
        "Could not read database",
        expect.any(Error),
      );
    });
    expect(mounted.container.textContent).toContain(
      "The database could not be read: Error: bad header",
    );
    expect(
      mounted.container.querySelector('[data-testid="sheet-preview"]'),
    ).toBeNull();
    mounted.unmount();
  });

  it("clears a previous error immediately on picking a new file, before its read settles", async () => {
    const client = createMockRpcClient();
    vi.mocked(client.odb.read).mockRejectedValueOnce(new Error("bad header"));
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountOdbPage();

    latestOnFile?.(openedFile("broken.odb"));
    await vi.waitFor(() => {
      expect(mounted.container.textContent).toContain("could not be read");
    });

    let resolveRead!: (
      value: Awaited<ReturnType<typeof client.odb.read>>,
    ) => void;
    vi.mocked(client.odb.read).mockReturnValue(
      new Promise((resolve) => {
        resolveRead = resolve;
      }),
    );
    act(() => {
      latestOnFile?.(openedFile("archive.odb"));
    });
    expect(mounted.container.textContent).not.toContain("could not be read");

    resolveRead({
      inventory: { tables: [], queries: [], forms: [], reports: [] },
      content: { kind: "spreadsheet", metadata: {}, sheets: [] },
    });
    await vi.waitFor(() => {
      expect(mounted.container.textContent).toContain("0 tables");
    });
    mounted.unmount();
  });
});
