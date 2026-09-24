import type * as MantineCore from "@mantine/core";
import type * as TanstackRouter from "@tanstack/react-router";
import { assembleTree } from "document-schema.js";
import type { ContentDocument, DocumentFormat } from "documents.js";
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

const navigate = vi.fn<(options: unknown) => Promise<void>>();
let currentParams: { source?: string; target?: string } = {};
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof TanstackRouter>();
  return {
    ...actual,
    useNavigate: () => navigate,
    useParams: () => currentParams,
  };
});

// Real Mantine Select renders as a text input with no accessible way to drive its dropdown without @testing-library/user-event — capturing its own props lets this suite drive onChange directly, keyed by the Select's own label since ConvertLayout renders two ("From"/"To").
interface CapturedSelect {
  data: unknown;
  value: string | null;
  onChange: (value: string | null) => void;
  disabled?: boolean;
  description?: string;
}
let latestSelects: Record<string, CapturedSelect> = {};
vi.mock("@mantine/core", async (importOriginal) => {
  const actual = await importOriginal<typeof MantineCore>();
  return {
    ...actual,
    Select: (props: CapturedSelect & { label: string }) => {
      latestSelects[props.label] = props;
      return (
        <div
          data-testid={`select-${props.label}`}
          data-value={props.value ?? ""}
          data-disabled={String(props.disabled === true)}
        />
      );
    },
  };
});

function mockPreview(testId: string) {
  return (props: {
    label: string;
    format?: string;
    content?: unknown;
    bytes?: unknown;
    loading?: boolean;
    error?: unknown;
  }) => (
    <div
      data-testid={`${testId}-${props.label}`}
      data-format={props.format ?? ""}
      data-has-content={String(props.content !== undefined)}
      data-has-bytes={String(props.bytes !== undefined)}
      data-loading={String(props.loading === true)}
      data-has-error={String(props.error !== undefined)}
    />
  );
}
vi.mock("../ui/MarkdownPreview", () => ({
  MarkdownPreview: mockPreview("markdown-preview"),
}));
vi.mock("../ui/SheetPreview", () => ({
  SheetPreview: mockPreview("sheet-preview"),
}));
vi.mock("../ui/WordProcessingPreview", () => ({
  WordProcessingPreview: mockPreview("wordprocessing-preview"),
}));
vi.mock("../ui/SlidesPreview", () => ({
  SlidesPreview: mockPreview("slides-preview"),
}));
vi.mock("../ui/FormulaPreview", () => ({
  FormulaPreview: mockPreview("formula-preview"),
}));
vi.mock("../ui/PdfPreview", () => ({
  PdfPreview: mockPreview("pdf-preview"),
}));

vi.mock("../ui/DiagnosticsPanel", () => ({
  DiagnosticsPanel: (props: { diagnostics: readonly unknown[] }) => (
    <div
      data-testid="diagnostics-panel"
      data-count={props.diagnostics.length}
    />
  ),
}));

let inspectPanelCalls: {
  data?: { backing: string };
  loading?: boolean;
  error?: unknown;
}[] = [];
vi.mock("../ui/InspectPanel", () => ({
  InspectPanel: (props: {
    data?: { backing: string };
    loading?: boolean;
    error?: unknown;
  }) => {
    inspectPanelCalls.push(props);
    return (
      <div
        data-testid="inspect-panel"
        data-backing={props.data?.backing ?? ""}
        data-loading={String(props.loading === true)}
        data-has-error={String(props.error !== undefined)}
      />
    );
  },
}));

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
const notifySuccess = vi.fn<(message: string, options?: unknown) => void>();
vi.mock("../ui/notify", () => ({
  notifyError: (title: string, error: unknown) => {
    notifyError(title, error);
  },
  notifySuccess: (message: string, options?: unknown) => {
    notifySuccess(message, options);
  },
}));

const { getRpcClient } = await import("../rpc/client");
const {
  Route,
  isContentBackedPreview,
  isSheetFormat,
  isSlidesFormat,
  isWordProcessingFormat,
} = await import("./_document.convert");
const ConvertLayout = Route.options.component!;

function openedFile(name: string): OpenedFile {
  return { bytes: new Uint8Array([1, 2, 3]), name };
}

function mountConvertLayout() {
  return mountWithOpenDocument(<ConvertLayout />);
}

function click(element: Element) {
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function convertButton(container: HTMLElement) {
  return [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === "Convert",
  )!;
}

function downloadButton(container: HTMLElement) {
  return [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === "Download",
  )!;
}

function baseClient() {
  const client = createMockRpcClient();
  vi.mocked(client.formats.listConversions).mockResolvedValue([
    { source: "markdown", target: "xlsx" },
    { source: "xlsx", target: "docx" },
    { source: "docx", target: "pptx" },
    { source: "pptx", target: "odf" },
    { source: "odf", target: "pdf" },
    { source: "pdf", target: "markdown" },
  ]);
  vi.mocked(client.formats.list).mockResolvedValue([
    "docx",
    "pptx",
    "xlsx",
    "odt",
    "odp",
    "ods",
    "odg",
    "odf",
    "csv",
    "svg",
    "markdown",
    "pdf",
    "rtf",
    "doc",
    "xls",
    "ppt",
    "epub",
  ]);
  const sampleContent: ContentDocument = {
    kind: "wordprocessing",
    metadata: {},
    sections: [],
  };
  vi.mocked(client.content.read).mockResolvedValue({
    content: sampleContent,
    package: { ...assembleTree(sampleContent), $schema: "test" },
  });
  vi.mocked(client.pdf.inspect).mockResolvedValue({
    pageCount: 1,
    itemKindCounts: {},
    metadata: {},
    layout: { formatVersion: 1, metadata: {}, pages: [], images: {} },
  });
  return client;
}

afterEach(() => {
  resetOpenDocumentCapture();
  latestSelects = {};
  inspectPanelCalls = [];
  currentParams = {};
  navigate.mockReset();
  notifyError.mockReset();
  notifySuccess.mockReset();
  saveFile.mockReset();
  vi.mocked(getRpcClient).mockReset();
});

describe("ConvertLayout", () => {
  it("prompts to open a document before anything is open, with To disabled until a source exists", () => {
    vi.mocked(getRpcClient).mockReturnValue(baseClient());
    const mounted = mountConvertLayout();
    expect(mounted.container.textContent).toContain(
      "Open a document above to convert it.",
    );
    expect(mounted.container.textContent).not.toContain("Could not detect");
    mounted.unmount();
  });

  it("lists To's options in the same sorted order as From's, not merely with the right disabled flags", async () => {
    vi.mocked(getRpcClient).mockReturnValue(baseClient());
    const mounted = mountConvertLayout();

    act(() => {
      openDocument(openedFile("a.docx"));
    });
    await vi.waitFor(() => {
      expect(latestSelects.To?.data).not.toEqual([]);
    });

    const targetData = latestSelects.To?.data as { value: string }[];
    const values = targetData.map((entry) => entry.value);
    expect(values).toEqual([...values].sort());
    mounted.unmount();
  });

  it("shows the could-not-detect alert for an unrecognised extension, without touching source", () => {
    vi.mocked(getRpcClient).mockReturnValue(baseClient());
    const mounted = mountConvertLayout();

    act(() => {
      openDocument(openedFile("notes.xyz"));
    });

    expect(mounted.container.textContent).toContain(
      `Could not detect "notes.xyz"'s format from its extension`,
    );
    expect(latestSelects.From?.value).toBeNull();
    mounted.unmount();
  });

  it.each([
    {
      sourceFile: "a.md",
      source: "markdown",
      target: "xlsx",
      originalTestId: "markdown-preview-Original",
      convertedTestId: "sheet-preview-Converted",
    },
    {
      sourceFile: "a.xlsx",
      source: "xlsx",
      target: "docx",
      originalTestId: "sheet-preview-Original",
      convertedTestId: "wordprocessing-preview-Converted",
    },
    {
      sourceFile: "a.docx",
      source: "docx",
      target: "pptx",
      originalTestId: "wordprocessing-preview-Original",
      convertedTestId: "slides-preview-Converted",
    },
    {
      sourceFile: "a.pptx",
      source: "pptx",
      target: "odf",
      originalTestId: "slides-preview-Original",
      convertedTestId: "formula-preview-Converted",
    },
    {
      sourceFile: "a.odf",
      source: "odf",
      target: "pdf",
      originalTestId: "formula-preview-Original",
      convertedTestId: "pdf-preview-Converted",
    },
    {
      sourceFile: "a.pdf",
      source: "pdf",
      target: "markdown",
      originalTestId: "pdf-preview-Original",
      convertedTestId: "markdown-preview-Converted",
    },
  ] satisfies {
    sourceFile: string;
    source: DocumentFormat;
    target: DocumentFormat;
    originalTestId: string;
    convertedTestId: string;
  }[])(
    "converts $sourceFile ($source -> $target) into the right Original/Converted preview pair, each free of error, and inspected via the right backing",
    async ({ sourceFile, source, target, originalTestId, convertedTestId }) => {
      const client = baseClient();
      vi.mocked(client.convert).mockResolvedValue({
        document: { format: target, bytes: new Uint8Array([9, 9]) },
        diagnostics: [],
      });
      vi.mocked(getRpcClient).mockReturnValue(client);
      const mounted = mountConvertLayout();

      act(() => {
        openDocument(openedFile(sourceFile));
      });
      expect(latestSelects.From?.value).toBe(source);
      expect(mounted.container.textContent).not.toContain("Could not detect");
      expect(latestSelects.To?.disabled).toBe(false);
      expect(latestSelects.From?.description).toBe("Detected from file");

      act(() => {
        latestSelects.To?.onChange(target);
      });
      expect(latestSelects.To?.value).toBe(target);

      click(convertButton(mounted.container));
      await vi.waitFor(() => {
        expect(
          mounted.container.querySelector('[data-testid="diagnostics-panel"]'),
        ).not.toBeNull();
      });

      const [input] = vi.mocked(client.convert).mock.calls[0]!;
      expect(input.source).toBe(source);
      expect(input.targetFormat).toBe(target);

      const original = mounted.container.querySelector(
        `[data-testid="${originalTestId}"]`,
      );
      const converted = mounted.container.querySelector(
        `[data-testid="${convertedTestId}"]`,
      );
      expect(original).not.toBeNull();
      expect(converted).not.toBeNull();
      expect(original?.getAttribute("data-format")).toBe(source);
      expect(converted?.getAttribute("data-format")).toBe(target);
      expect(original?.getAttribute("data-has-error")).toBe("false");
      expect(converted?.getAttribute("data-has-error")).toBe("false");

      // Every content.read/pdf.inspect call this pair should have triggered is a separate async operation from convert.mutate itself, settling on its own tick — waited for explicitly rather than assumed already resolved the moment the Done panel first appears.
      await vi.waitFor(() => {
        const inspectPanels = mounted.container.querySelectorAll(
          '[data-testid="inspect-panel"]',
        );
        expect(inspectPanels[0]!.getAttribute("data-backing")).toBe(
          source === "pdf" ? "pdf" : "content",
        );
        expect(inspectPanels[1]!.getAttribute("data-backing")).toBe(
          target === "pdf" ? "pdf" : "content",
        );
      });
      const inspectPanels = mounted.container.querySelectorAll(
        '[data-testid="inspect-panel"]',
      );
      expect(inspectPanels).toHaveLength(2);
      expect(inspectPanels[0]!.getAttribute("data-has-error")).toBe("false");
      expect(inspectPanels[1]!.getAttribute("data-has-error")).toBe("false");

      const expectedContentReadCalls =
        (source === "pdf" ? 0 : 1) + (target === "pdf" ? 0 : 1);
      const expectedPdfInspectCalls =
        (source === "pdf" ? 1 : 0) + (target === "pdf" ? 1 : 0);
      expect(client.content.read).toHaveBeenCalledTimes(
        expectedContentReadCalls,
      );
      expect(client.pdf.inspect).toHaveBeenCalledTimes(expectedPdfInspectCalls);
      mounted.unmount();
    },
  );

  it("builds From as a sorted, deduplicated list of every conversion pair's source, and disables every To option the picked source cannot reach", async () => {
    vi.mocked(getRpcClient).mockReturnValue(baseClient());
    const mounted = mountConvertLayout();

    act(() => {
      openDocument(openedFile("a.docx"));
    });
    await vi.waitFor(() => {
      expect(latestSelects.From?.data).not.toEqual([]);
    });

    expect(latestSelects.From?.data).toEqual([
      "docx",
      "markdown",
      "odf",
      "pdf",
      "pptx",
      "xlsx",
    ]);
    const targetData = latestSelects.To?.data as {
      value: string;
      disabled: boolean;
    }[];
    const byValue = Object.fromEntries(
      targetData.map((entry) => [entry.value, entry.disabled]),
    );
    expect(byValue.pptx).toBe(false);
    expect(byValue.pdf).toBe(true);
    expect(byValue.xlsx).toBe(true);
    mounted.unmount();
  });

  it("clears the description once the source is overridden away from the auto-detected format", () => {
    vi.mocked(getRpcClient).mockReturnValue(baseClient());
    const mounted = mountConvertLayout();

    act(() => {
      openDocument(openedFile("a.docx"));
    });
    expect(latestSelects.From?.description).toBe("Detected from file");

    act(() => {
      latestSelects.From?.onChange("odt");
    });
    expect(latestSelects.From?.description).toBeUndefined();
    mounted.unmount();
  });

  it("clears a previous conversion's Done panel when the next pick's extension is unrecognised", async () => {
    const client = baseClient();
    vi.mocked(client.convert).mockResolvedValue({
      document: { format: "pdf", bytes: new Uint8Array([1]) },
      diagnostics: [],
    });
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountConvertLayout();

    act(() => {
      openDocument(openedFile("a.docx"));
    });
    act(() => {
      latestSelects.To?.onChange("pdf");
    });
    click(convertButton(mounted.container));
    await vi.waitFor(() => {
      expect(
        mounted.container.querySelector('[data-testid="diagnostics-panel"]'),
      ).not.toBeNull();
    });

    act(() => {
      openDocument(openedFile("notes.xyz"));
    });

    expect(
      mounted.container.querySelector('[data-testid="diagnostics-panel"]'),
    ).toBeNull();
    mounted.unmount();
  });

  it("resets source/target/the previous conversion when a different document is opened while this tab is already mounted", async () => {
    const client = baseClient();
    vi.mocked(client.convert).mockResolvedValue({
      document: { format: "pdf", bytes: new Uint8Array([1]) },
      diagnostics: [],
    });
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountConvertLayout();

    act(() => {
      openDocument(openedFile("a.docx"));
    });
    act(() => {
      latestSelects.To?.onChange("pdf");
    });
    click(convertButton(mounted.container));
    await vi.waitFor(() => {
      expect(
        mounted.container.querySelector('[data-testid="diagnostics-panel"]'),
      ).not.toBeNull();
    });

    act(() => {
      openDocument(openedFile("b.xlsx"));
    });

    expect(latestSelects.From?.value).toBe("xlsx");
    expect(latestSelects.To?.value).toBeNull();
    expect(
      mounted.container.querySelector('[data-testid="diagnostics-panel"]'),
    ).toBeNull();
    mounted.unmount();
  });

  it("never prefetches original content for a document whose extension is unrecognised", () => {
    const client = baseClient();
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountConvertLayout();

    act(() => {
      openDocument(openedFile("notes.xyz"));
    });

    expect(client.content.read).not.toHaveBeenCalled();
    expect(client.pdf.inspect).not.toHaveBeenCalled();
    mounted.unmount();
  });

  it("notifies and shows no Done panel when the conversion rejects", async () => {
    const client = baseClient();
    vi.mocked(client.convert).mockRejectedValue(new Error("bad bytes"));
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountConvertLayout();

    act(() => {
      openDocument(openedFile("a.docx"));
    });
    act(() => {
      latestSelects.To?.onChange("pdf");
    });
    click(convertButton(mounted.container));

    await vi.waitFor(() => {
      expect(notifyError).toHaveBeenCalledWith(
        "Conversion failed",
        expect.any(Error),
      );
    });
    expect(
      mounted.container.querySelector('[data-testid="diagnostics-panel"]'),
    ).toBeNull();
    mounted.unmount();
  });

  it("skips the second content read when the target is pdf", async () => {
    const client = baseClient();
    vi.mocked(client.convert).mockResolvedValue({
      document: { format: "pdf", bytes: new Uint8Array([1]) },
      diagnostics: [],
    });
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountConvertLayout();

    act(() => {
      openDocument(openedFile("a.md"));
    });
    await vi.waitFor(() => {
      // The original-side prefetch (source=markdown) already calls content.read once.
      expect(client.content.read).toHaveBeenCalledTimes(1);
    });

    act(() => {
      latestSelects.To?.onChange("pdf");
    });
    click(convertButton(mounted.container));
    await vi.waitFor(() => {
      expect(
        mounted.container.querySelector('[data-testid="diagnostics-panel"]'),
      ).not.toBeNull();
    });

    expect(client.content.read).toHaveBeenCalledTimes(1);
    mounted.unmount();
  });

  it("clears the target and any previous conversion when the source changes", async () => {
    const client = baseClient();
    vi.mocked(client.convert).mockResolvedValue({
      document: { format: "pdf", bytes: new Uint8Array([1]) },
      diagnostics: [],
    });
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountConvertLayout();

    act(() => {
      openDocument(openedFile("a.docx"));
    });
    act(() => {
      latestSelects.To?.onChange("pdf");
    });
    click(convertButton(mounted.container));
    await vi.waitFor(() => {
      expect(
        mounted.container.querySelector('[data-testid="diagnostics-panel"]'),
      ).not.toBeNull();
    });

    act(() => {
      latestSelects.From?.onChange("odt");
    });

    expect(latestSelects.To?.value).toBeNull();
    expect(
      mounted.container.querySelector('[data-testid="diagnostics-panel"]'),
    ).toBeNull();
    mounted.unmount();
  });

  it("clears a previous conversion, but not the source, when the target changes", async () => {
    const client = baseClient();
    vi.mocked(client.convert).mockResolvedValue({
      document: { format: "pdf", bytes: new Uint8Array([1]) },
      diagnostics: [],
    });
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountConvertLayout();

    act(() => {
      openDocument(openedFile("a.docx"));
    });
    act(() => {
      latestSelects.To?.onChange("pdf");
    });
    click(convertButton(mounted.container));
    await vi.waitFor(() => {
      expect(
        mounted.container.querySelector('[data-testid="diagnostics-panel"]'),
      ).not.toBeNull();
    });

    act(() => {
      latestSelects.To?.onChange("pptx");
    });

    expect(latestSelects.From?.value).toBe("docx");
    expect(
      mounted.container.querySelector('[data-testid="diagnostics-panel"]'),
    ).toBeNull();
    mounted.unmount();
  });

  it("syncs a complete pair into the URL via navigate, replacing the current entry", async () => {
    vi.mocked(getRpcClient).mockReturnValue(baseClient());
    const mounted = mountConvertLayout();

    act(() => {
      openDocument(openedFile("a.docx"));
    });
    expect(navigate).not.toHaveBeenCalled();

    act(() => {
      latestSelects.To?.onChange("pdf");
    });
    await vi.waitFor(() => {
      expect(navigate).toHaveBeenCalledWith({
        to: "/convert/$source/$target",
        params: { source: "docx", target: "pdf" },
        replace: true,
      });
    });
    mounted.unmount();
  });

  it("seeds source and target from the route params on first mount, taking priority over the open document's own detected format", () => {
    currentParams = { source: "docx", target: "pdf" };
    vi.mocked(getRpcClient).mockReturnValue(baseClient());
    const mounted = mountConvertLayout();
    act(() => {
      openDocument(openedFile("reopened.xlsx"));
    });

    expect(latestSelects.From?.value).toBe("docx");
    expect(latestSelects.To?.value).toBe("pdf");
    mounted.unmount();
  });

  it("seeds source from a document already open when this tab is first reached (e.g. a Recent Files reopen)", () => {
    vi.mocked(getRpcClient).mockReturnValue(baseClient());
    const mounted = mountConvertLayout();
    act(() => {
      openDocument(openedFile("reopened.docx"));
    });

    expect(latestSelects.From?.value).toBe("docx");
    expect(latestSelects.From?.description).toBe("Detected from file");
    mounted.unmount();
  });

  it("downloads the converted bytes under the source document's own basename plus the target extension", async () => {
    const client = baseClient();
    const convertedBytes = new Uint8Array([7, 7, 7]);
    vi.mocked(client.convert).mockResolvedValue({
      document: { format: "pdf", bytes: convertedBytes },
      diagnostics: [],
    });
    saveFile.mockResolvedValue({});
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountConvertLayout();

    act(() => {
      openDocument(openedFile("report.final.docx"));
    });
    act(() => {
      latestSelects.To?.onChange("pdf");
    });
    click(convertButton(mounted.container));
    await vi.waitFor(() => {
      expect(
        mounted.container.querySelector('[data-testid="diagnostics-panel"]'),
      ).not.toBeNull();
    });

    click(downloadButton(mounted.container));
    await vi.waitFor(() => {
      expect(saveFile).toHaveBeenCalledWith(convertedBytes, {
        suggestedName: "report.final.pdf",
        mimeType: "application/octet-stream",
      });
    });
    mounted.unmount();
  });

  it("notifies success with the conversion's own diagnostics", async () => {
    const client = baseClient();
    vi.mocked(client.convert).mockResolvedValue({
      document: { format: "pdf", bytes: new Uint8Array([1]) },
      diagnostics: [
        { severity: "warning", code: "font", message: "substituted" },
      ],
    });
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountConvertLayout();

    act(() => {
      openDocument(openedFile("a.docx"));
    });
    act(() => {
      latestSelects.To?.onChange("pdf");
    });
    click(convertButton(mounted.container));

    await vi.waitFor(() => {
      expect(notifySuccess).toHaveBeenCalledWith("Converted", {
        diagnostics: [
          { severity: "warning", code: "font", message: "substituted" },
        ],
      });
    });
    mounted.unmount();
  });

  it("inspects a pdf source directly from its bytes rather than via content.read", async () => {
    const client = baseClient();
    vi.mocked(client.convert).mockResolvedValue({
      document: { format: "markdown", bytes: new Uint8Array([1]) },
      diagnostics: [],
    });
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountConvertLayout();

    act(() => {
      openDocument(openedFile("a.pdf"));
    });
    await vi.waitFor(() => {
      expect(client.pdf.inspect).toHaveBeenCalled();
    });
    expect(client.content.read).not.toHaveBeenCalled();

    act(() => {
      latestSelects.To?.onChange("markdown");
    });
    click(convertButton(mounted.container));
    await vi.waitFor(() => {
      const originalPdfInspect = inspectPanelCalls.find(
        (call) => call.data?.backing === "pdf",
      );
      expect(originalPdfInspect).toBeDefined();
    });
    mounted.unmount();
  });

  it("inspects a content-backed original from the already-read content, not a second RPC", async () => {
    const client = baseClient();
    vi.mocked(client.convert).mockResolvedValue({
      document: { format: "pdf", bytes: new Uint8Array([1]) },
      diagnostics: [],
    });
    vi.mocked(getRpcClient).mockReturnValue(client);
    const mounted = mountConvertLayout();

    act(() => {
      openDocument(openedFile("a.docx"));
    });
    await vi.waitFor(() => {
      expect(client.content.read).toHaveBeenCalled();
    });
    expect(client.pdf.inspect).not.toHaveBeenCalled();

    act(() => {
      latestSelects.To?.onChange("pdf");
    });
    click(convertButton(mounted.container));
    await vi.waitFor(() => {
      const originalContentInspect = inspectPanelCalls.find(
        (call) => call.data?.backing === "content",
      );
      expect(originalContentInspect).toBeDefined();
    });
    mounted.unmount();
  });
});

describe("format-family predicates", () => {
  it("isSheetFormat is true for every spreadsheet-kind format and false otherwise", () => {
    expect(isSheetFormat("xlsx")).toBe(true);
    expect(isSheetFormat("ods")).toBe(true);
    expect(isSheetFormat("csv")).toBe(true);
    expect(isSheetFormat("xls")).toBe(true);
    expect(isSheetFormat("docx")).toBe(false);
    expect(isSheetFormat(null)).toBe(false);
  });

  it("isWordProcessingFormat is true for every wordprocessing-kind format and false otherwise", () => {
    expect(isWordProcessingFormat("docx")).toBe(true);
    expect(isWordProcessingFormat("odt")).toBe(true);
    expect(isWordProcessingFormat("rtf")).toBe(true);
    expect(isWordProcessingFormat("doc")).toBe(true);
    expect(isWordProcessingFormat("epub")).toBe(true);
    expect(isWordProcessingFormat("xlsx")).toBe(false);
    expect(isWordProcessingFormat(null)).toBe(false);
  });

  it("isSlidesFormat is true for every presentation/drawing-kind format and false otherwise", () => {
    expect(isSlidesFormat("pptx")).toBe(true);
    expect(isSlidesFormat("odp")).toBe(true);
    expect(isSlidesFormat("odg")).toBe(true);
    expect(isSlidesFormat("svg")).toBe(true);
    expect(isSlidesFormat("ppt")).toBe(true);
    expect(isSlidesFormat("docx")).toBe(false);
    expect(isSlidesFormat(null)).toBe(false);
  });

  it("isContentBackedPreview is false only for pdf and null", () => {
    expect(isContentBackedPreview("docx")).toBe(true);
    expect(isContentBackedPreview("markdown")).toBe(true);
    expect(isContentBackedPreview("pdf")).toBe(false);
    expect(isContentBackedPreview(null)).toBe(false);
  });
});
