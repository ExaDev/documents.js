import { describe, expect, it } from "vitest";
import { EpubDiagnosticCodes } from "../diagnostics";
import type { EpubDiagnostic } from "../diagnostics";
import { isInertElement, reportInertElementSkip } from "./context";
import type { XhtmlReadContext } from "./context";

function fakeContext(sink: XhtmlReadContext["sink"]): XhtmlReadContext {
  return {
    resolveImage: () => undefined,
    sink,
    sourceHref: "OEBPS/chapter1.xhtml",
    idElements: new Map(),
    anchorTargets: new Map(),
    resolveAnchorHref: () => undefined,
    quoteDepth: 0,
  };
}

describe("isInertElement", () => {
  it("is true for script, template, style, and noscript", () => {
    expect(isInertElement("script")).toBe(true);
    expect(isInertElement("template")).toBe(true);
    expect(isInertElement("style")).toBe(true);
    expect(isInertElement("noscript")).toBe(true);
  });

  it("is false for an ordinary content element", () => {
    expect(isInertElement("p")).toBe(false);
  });
});

describe("reportInertElementSkip", () => {
  it("reports a diagnostic for a skipped noscript element", () => {
    const diagnostics: EpubDiagnostic[] = [];
    reportInertElementSkip(
      "noscript",
      fakeContext((d) => diagnostics.push(d)),
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      code: EpubDiagnosticCodes.NOSCRIPT_CONTENT_SKIPPED,
      severity: "info",
      href: "OEBPS/chapter1.xhtml",
    });
    expect(diagnostics[0]?.message).toContain("noscript");
  });

  it("reports nothing for script, template, or style -- only noscript's loss is worth naming", () => {
    const diagnostics: EpubDiagnostic[] = [];
    const context = fakeContext((d) => diagnostics.push(d));
    reportInertElementSkip("script", context);
    reportInertElementSkip("template", context);
    reportInertElementSkip("style", context);
    expect(diagnostics).toEqual([]);
  });
});
