import type * as TanstackRouter from "@tanstack/react-router";
import { act } from "react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { OpenedFile } from "../ports/fileAccess";
import { mountWithMantine } from "../test/mountComponent";

let currentMatch: string | false = false;
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof TanstackRouter>();
  return {
    ...actual,
    Outlet: () => <div data-testid="outlet" />,
    useMatchRoute: () => (options: Readonly<{ to: string }>) =>
      currentMatch === options.to ? {} : false,
    // Stands in for the real Link, which needs a live router context this test never mounts — forwards exactly the props DocumentTabs' Button-as-Link actually needs the test to see.
    Link: (props: {
      to: string;
      children?: ReactNode;
      className?: string;
      "data-active"?: string;
    }) => (
      <a
        href={props.to}
        className={props.className}
        data-active={props["data-active"]}
      >
        {props.children}
      </a>
    ),
  };
});

let latestOnFile: ((file: OpenedFile) => void) | undefined;
let latestFile: OpenedFile | undefined;
let latestFormatHint: string | undefined;
vi.mock("../ui/FileUpload", () => ({
  FileUpload: (props: {
    onFile: (file: OpenedFile) => void;
    file?: OpenedFile;
    formatHint?: string;
  }) => {
    latestOnFile = props.onFile;
    latestFile = props.file;
    latestFormatHint = props.formatHint;
    return <div data-testid="file-upload" />;
  },
}));

const { Route } = await import("./_document");
const DocumentLayout = Route.options.component!;

function openedFile(name: string): OpenedFile {
  return { bytes: new Uint8Array([1, 2, 3]), name };
}

function mountLayout() {
  return mountWithMantine(<DocumentLayout />);
}

afterEach(() => {
  latestOnFile = undefined;
  latestFile = undefined;
  latestFormatHint = undefined;
  currentMatch = false;
});

describe("DocumentLayout", () => {
  it("renders the shared FileUpload, every tab, and the routed outlet", () => {
    const mounted = mountLayout();
    expect(
      mounted.container.querySelector('[data-testid="file-upload"]'),
    ).not.toBeNull();
    expect(
      mounted.container.querySelector('[data-testid="outlet"]'),
    ).not.toBeNull();
    expect(mounted.container.textContent).toContain("Convert");
    expect(mounted.container.textContent).toContain("Metadata");
    expect(mounted.container.textContent).toContain("Inspect");
    expect(mounted.container.textContent).toContain("Fonts");
    expect(mounted.container.textContent).toContain("Package / JSON");
    expect(mounted.container.textContent).toContain(".odb");
    expect(mounted.container.textContent).toContain(".odm");
    expect(latestFormatHint).toBe("Any document format this app supports");
    mounted.unmount();
  });

  it("shows no detected-format line before anything is open", () => {
    const mounted = mountLayout();
    expect(mounted.container.textContent).not.toContain("Detected format");
    expect(mounted.container.textContent).not.toContain(
      "Could not detect a format",
    );
    mounted.unmount();
  });

  it("reports the detected format once a recognised file is opened", () => {
    const mounted = mountLayout();
    act(() => {
      latestOnFile?.(openedFile("report.docx"));
    });
    expect(mounted.container.textContent).toContain("Detected format: docx");
    expect(latestFile?.name).toBe("report.docx");
    mounted.unmount();
  });

  it("reports an undetected format neutrally rather than as an alarming error", () => {
    const mounted = mountLayout();
    act(() => {
      latestOnFile?.(openedFile("notes.xyz"));
    });
    expect(mounted.container.textContent).toContain(
      "Could not detect a format from the file's extension.",
    );
    mounted.unmount();
  });

  it("marks only the tab matching the current route active", () => {
    currentMatch = "/metadata";
    const mounted = mountLayout();
    const links = [...mounted.container.querySelectorAll("a")];
    const metadataLink = links.find((link) => link.textContent === "Metadata");
    const convertLink = links.find((link) => link.textContent === "Convert");
    expect(metadataLink?.getAttribute("data-active")).toBe("true");
    expect(convertLink?.getAttribute("data-active")).toBeNull();
    mounted.unmount();
  });
});
