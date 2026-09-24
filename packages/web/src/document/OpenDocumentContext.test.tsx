import { act, useEffect } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { mountWithMantine } from "../test/mountComponent";
import { OpenDocumentProvider, useOpenDocument } from "./OpenDocumentContext";

function openedFile(name: string) {
  return { bytes: new Uint8Array([1, 2, 3]), name };
}

// Stashed in an effect, not directly during render — a component/hook body must stay pure, and mutating an outer-scope variable is a side effect (react-hooks/globals).
let latestValue: ReturnType<typeof useOpenDocument> | undefined;
function Probe() {
  const value = useOpenDocument();
  useEffect(() => {
    latestValue = value;
  });
  return null;
}

function mountProbe() {
  return mountWithMantine(
    <OpenDocumentProvider>
      <Probe />
    </OpenDocumentProvider>,
  );
}

function Unwrapped() {
  useOpenDocument();
  return null;
}

function open(fileName: string) {
  act(() => {
    latestValue?.openDocument(openedFile(fileName));
  });
}

afterEach(() => {
  latestValue = undefined;
});

describe("useOpenDocument", () => {
  it("throws when rendered outside an OpenDocumentProvider", () => {
    expect(() => mountWithMantine(<Unwrapped />)).toThrow(
      "useOpenDocument must be used within an OpenDocumentProvider",
    );
  });

  it("starts with no document open", () => {
    const mounted = mountProbe();
    expect(latestValue?.document).toBeUndefined();
    mounted.unmount();
  });

  it("infers the format from the opened file's extension", () => {
    const mounted = mountProbe();
    open("report.docx");
    expect(latestValue?.document?.file.name).toBe("report.docx");
    expect(latestValue?.document?.format).toBe("docx");
    mounted.unmount();
  });

  it("leaves format undefined for an unrecognised extension rather than throwing or guessing", () => {
    const mounted = mountProbe();
    open("notes.xyz");
    expect(latestValue?.document?.file.name).toBe("notes.xyz");
    expect(latestValue?.document?.format).toBeUndefined();
    mounted.unmount();
  });

  it("replaces the whole document on a second open, not merging with the first", () => {
    const mounted = mountProbe();
    open("first.docx");
    open("second.pdf");
    expect(latestValue?.document?.file.name).toBe("second.pdf");
    expect(latestValue?.document?.format).toBe("pdf");
    mounted.unmount();
  });

  it("assigns each open a distinct, increasing id, even when re-opening the identical file", () => {
    const mounted = mountProbe();
    open("same.docx");
    const firstId = latestValue?.document?.id;
    open("same.docx");
    const secondId = latestValue?.document?.id;
    expect(firstId).toBeDefined();
    expect(secondId).toBeDefined();
    expect(secondId).not.toBe(firstId);
    expect(secondId!).toBeGreaterThan(firstId!);
    mounted.unmount();
  });

  it("numbers the very first open as 1, the sequence a panel keys its remount off", () => {
    const mounted = mountProbe();
    open("first.docx");
    expect(latestValue?.document?.id).toBe(1);
    mounted.unmount();
  });
});
