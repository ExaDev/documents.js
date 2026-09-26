import { describe, expect, it } from "vitest";
import { flattenTree } from "document-schema.js";
import type { FontSubstitution } from "pdf-codec";
import { createDocx } from "../edit/docx/editor";
import { minimalDocxBytes } from "../test-support/docx";
import { caladeaRegularBytes } from "../test-support/fonts";
import { minimalOdtBytes } from "../test-support/odt";
import { createLocalDocumentConverter } from "./local";

describe("createLocalDocumentConverter: fonts", () => {
  it("reports a vendored font substitution as a diagnostic even with no callback supplied", async () => {
    const converter = createLocalDocumentConverter();
    const result = await converter.convert(
      {
        source: { format: "docx", bytes: minimalDocxBytes() },
        targetFormat: "pdf",
      },
      { signal: new AbortController().signal },
    );
    expect(result.diagnostics).toContainEqual({
      severity: "info",
      code: "font/substituted",
      message:
        '"Calibri" is not available; substituted the metric-compatible "carlito"',
    });
  });

  it("names the requested weight and style in the substitution message for a bold italic run", async () => {
    const editor = createDocx();
    editor.body.appendParagraph().appendRun({
      text: "Bold italic Calibri",
      bold: true,
      italic: true,
      fontFamily: "Calibri",
    });
    const converter = createLocalDocumentConverter();
    const result = await converter.convert(
      {
        source: { format: "docx", bytes: editor.toBytes() },
        targetFormat: "pdf",
      },
      { signal: new AbortController().signal },
    );
    expect(result.diagnostics).toContainEqual({
      severity: "info",
      code: "font/substituted",
      message:
        '"Calibri bold italic" is not available; substituted the metric-compatible "carlito"',
    });
  });

  // The "missing-face" reason (a caller-supplied family exists but not the exact bold/italic combination requested, so the family's regular face substitutes) reaches a message distinct from "vendored-substitute"'s — "substituted another face of ..." rather than "substituted the metric-compatible ...". Requesting bold text while supplying only a regular caller face for the same family is what triggers it, rather than falling through to the vendored table.
  it("names a caller-supplied family's own regular face, not the metric-compatible vendored table, when only the exact weight is missing", async () => {
    const editor = createDocx();
    editor.body.appendParagraph().appendRun({
      text: "Bold Calibri",
      bold: true,
      fontFamily: "Calibri",
    });
    const converter = createLocalDocumentConverter();
    const result = await converter.convert(
      {
        source: { format: "docx", bytes: editor.toBytes() },
        targetFormat: "pdf",
      },
      {
        signal: new AbortController().signal,
        fonts: [
          {
            family: "Calibri",
            bold: false,
            italic: false,
            bytes: caladeaRegularBytes(),
          },
        ],
      },
    );
    expect(result.diagnostics).toContainEqual({
      severity: "info",
      code: "font/substituted",
      message:
        '"Calibri bold" is not available; substituted another face of "Calibri"',
    });
  });

  it("forwards the structured substitution to the caller own callback as well", async () => {
    const converter = createLocalDocumentConverter();
    const substitutions: FontSubstitution[] = [];
    await converter.convert(
      {
        source: { format: "docx", bytes: minimalDocxBytes() },
        targetFormat: "pdf",
      },
      {
        signal: new AbortController().signal,
        onFontSubstitution: (substitution) => {
          substitutions.push(substitution);
        },
      },
    );
    expect(substitutions).toEqual([
      {
        requestedFamily: "Calibri",
        requestedBold: false,
        requestedItalic: false,
        reason: "vendored-substitute",
        resolvedFamily: "carlito",
      },
    ]);
  });

  // Threading proof rather than a font-resolution proof (src/convert/convert-fonts.test.ts asserts on the real PDF font resource): a caller-supplied face for the requested family means nothing falls back, so the substitution diagnostic that would otherwise be reported is absent.
  it("threads caller-supplied faces into the conversion that lays text out", async () => {
    const converter = createLocalDocumentConverter();
    const result = await converter.convert(
      {
        source: { format: "docx", bytes: minimalDocxBytes() },
        targetFormat: "pdf",
      },
      {
        signal: new AbortController().signal,
        fonts: [
          {
            family: "Calibri",
            bold: false,
            italic: false,
            bytes: caladeaRegularBytes(),
          },
        ],
      },
    );
    expect(
      result.diagnostics.some(
        (diagnostic) => diagnostic.code === "font/substituted",
      ),
    ).toBe(false);
  });

  // A bridge runs no layout engine and resolves no face, so supplying fonts to one is accepted and reports nothing rather than silently changing its output.
  it("reports no font diagnostics for a PDF-bypassing bridge conversion", async () => {
    const converter = createLocalDocumentConverter();
    const result = await converter.convert(
      {
        source: { format: "odt", bytes: minimalOdtBytes() },
        targetFormat: "docx",
      },
      {
        signal: new AbortController().signal,
        fonts: [
          {
            family: "Calibri",
            bold: false,
            italic: false,
            bytes: caladeaRegularBytes(),
          },
        ],
      },
    );
    expect(result.diagnostics).toEqual([]);
  });
});

describe("createLocalDocumentConverter: markdown image resolution", () => {
  // The port threads options.images through to markdown-codec's MarkdownImageResolver port for the markdown-sourced conversions — the port-level counterpart to src/convert/markdown-image.test.ts's own ergonomic-function assertions. A relative-path image that a resolver turns into real PNG bytes reaches the converted document's own ContentDocument as a genuine ContentImageBlock rather than the alt-text degradation it becomes with no resolver.
  it("threads options.images through a markdown -> pdf conversion", async () => {
    const onePixelPng = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      ),
      (char) => char.codePointAt(0)!,
    );
    const converter = createLocalDocumentConverter();
    const result = await converter.convert(
      {
        source: {
          format: "markdown",
          bytes: new TextEncoder().encode("![a local image](./local.png)"),
        },
        targetFormat: "pdf",
      },
      {
        signal: new AbortController().signal,
        images: (destination) =>
          destination === "./local.png" ? { bytes: onePixelPng } : undefined,
      },
    );
    const content =
      result.package === undefined ? undefined : flattenTree(result.package);
    expect(content?.kind).toBe("wordprocessing");
    if (content?.kind === "wordprocessing") {
      const hasImage = content.sections.some((section) =>
        section.blocks.some((block) => block.kind === "image"),
      );
      expect(hasImage).toBe(true);
    }
  });
});
