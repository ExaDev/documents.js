import { describe, expect, it } from "vitest";

import {
  mountWithOpenDocument,
  openDocument,
  resetOpenDocumentCapture,
} from "./openDocumentHarness";

describe("openDocument", () => {
  it("throws when called before mountWithOpenDocument() has captured a provider", () => {
    expect(() => {
      openDocument({ bytes: new Uint8Array([1]), name: "a.docx" });
    }).toThrow(
      "openDocument() called before mountWithOpenDocument() captured a provider",
    );
  });

  it("stops throwing once mountWithOpenDocument() has captured a provider, and resetOpenDocumentCapture() restores the guard", () => {
    const mounted = mountWithOpenDocument(null);
    expect(() => {
      openDocument({ bytes: new Uint8Array([1]), name: "a.docx" });
    }).not.toThrow();
    mounted.unmount();

    resetOpenDocumentCapture();
    expect(() => {
      openDocument({ bytes: new Uint8Array([1]), name: "a.docx" });
    }).toThrow(
      "openDocument() called before mountWithOpenDocument() captured a provider",
    );
  });
});
