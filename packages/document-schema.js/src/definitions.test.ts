import { describe, expect, it } from "vitest";
import type { ContentParagraph, ContentRun } from "./content";
import {
  applyParagraphStyleProperties,
  applyRunStyleProperties,
  DefinitionEntrySchema,
  DefinitionsTableSchema,
  overlayStyleEntries,
  resolveStyleChain,
  StyleEntrySchema,
  StylesTableSchema,
  type StyleEntry,
  type StylesTable,
} from "./definitions";

const BODY: StyleEntry = {
  paragraph: { alignment: "justify", spacingAfterPt: 6 },
  run: { sizePt: 11 },
};
const EMPHASIS: StyleEntry = {
  paragraph: { alignment: "left" },
  run: { italic: true, sizePt: 14 },
};

describe("StyleEntrySchema enforces the entry shape", () => {
  it("accepts resolved canonical paragraph and run properties, either or both halves", () => {
    expect(StyleEntrySchema.safeParse(BODY).success).toBe(true);
    expect(
      StyleEntrySchema.safeParse({ paragraph: { lineSpacing: 1.5 } }).success,
    ).toBe(true);
    expect(
      StyleEntrySchema.safeParse({ run: { fontFamily: "Carlito", bold: true } })
        .success,
    ).toBe(true);
    expect(StyleEntrySchema.safeParse({}).success).toBe(true);
  });

  it("rejects the banned per-node facts wherever they appear -- frames, sourcePath, and styleId fail outright, they are not silently stripped", () => {
    for (const banned of ["frames", "sourcePath", "styleId"]) {
      expect(StyleEntrySchema.safeParse({ [banned]: "x" }).success).toBe(false);
      expect(
        StyleEntrySchema.safeParse({ paragraph: { [banned]: "x" } }).success,
      ).toBe(false);
      expect(
        StyleEntrySchema.safeParse({ run: { [banned]: "x" } }).success,
      ).toBe(false);
    }
    expect(
      StyleEntrySchema.safeParse({
        paragraph: {
          frames: [{ pageIndex: 0, xPt: 1, yPt: 1, widthPt: 1, heightPt: 1 }],
        },
      }).success,
    ).toBe(false);
  });

  it("rejects misnested properties -- run fields do not belong at entry level or under paragraph, and sizePt is the run field name, not fontPt", () => {
    expect(StyleEntrySchema.safeParse({ bold: true }).success).toBe(false);
    expect(
      StyleEntrySchema.safeParse({ paragraph: { bold: true } }).success,
    ).toBe(false);
    expect(StyleEntrySchema.safeParse({ run: { fontPt: 11 } }).success).toBe(
      false,
    );
    expect(
      StyleEntrySchema.safeParse({ paragraph: { alignment: "diagonal" } })
        .success,
    ).toBe(false);
  });

  it("rejects a basedOn-style graph edge inside the table", () => {
    expect(StyleEntrySchema.safeParse({ basedOn: "other" }).success).toBe(
      false,
    );
  });

  it("accepts the page-break properties on the paragraph half, matching the node field set", () => {
    expect(
      StyleEntrySchema.safeParse({ paragraph: { pageBreakBefore: true } })
        .success,
    ).toBe(true);
    expect(
      StyleEntrySchema.safeParse({ paragraph: { pageBreakAfter: true } })
        .success,
    ).toBe(true);
    expect(
      StyleEntrySchema.safeParse({ run: { pageBreakBefore: true } }).success,
    ).toBe(false);
  });
});

describe("StylesTableSchema", () => {
  it("accepts a table of named entries and rejects a non-entry value under a key", () => {
    expect(
      StylesTableSchema.safeParse({ s1: BODY, s2: EMPHASIS }).success,
    ).toBe(true);
    expect(
      StylesTableSchema.safeParse({ s1: { paragraph: { frames: [] } } })
        .success,
    ).toBe(false);
  });
});

describe("the definitions facility stays tenant-generic", () => {
  it("accepts and PRESERVES any tenant body -- unknown keys ride through a parse rather than being stripped", () => {
    const parsed = DefinitionEntrySchema.parse({
      kind: "link",
      url: "https://example.com",
      title: "Example",
    });
    expect(parsed).toEqual({
      kind: "link",
      url: "https://example.com",
      title: "Example",
    });
    const footnote = DefinitionEntrySchema.parse({
      kind: "footnote",
      marker: "1",
      blocks: [],
    });
    expect(footnote).toEqual({ kind: "footnote", marker: "1", blocks: [] });
  });

  it("requires the tenant discriminator and rejects a non-string kind", () => {
    expect(
      DefinitionEntrySchema.safeParse({ url: "https://example.com" }).success,
    ).toBe(false);
    expect(DefinitionEntrySchema.safeParse({ kind: 7 }).success).toBe(false);
  });

  it("carries no styles vocabulary of its own -- a StyleEntry is not a DefinitionEntry and vice versa", () => {
    expect(DefinitionEntrySchema.safeParse(BODY).success).toBe(false);
    expect(
      StyleEntrySchema.safeParse({ kind: "link", url: "https://example.com" })
        .success,
    ).toBe(false);
  });

  it("holds both tenants side by side in one table", () => {
    const table = {
      l1: { kind: "link", url: "https://example.com" },
      f1: { kind: "footnote", marker: "1" },
    };
    expect(DefinitionsTableSchema.safeParse(table).success).toBe(true);
  });
});

describe("overlayStyleEntries", () => {
  it("innermost wins per property; a property only outer carries falls through", () => {
    const merged = overlayStyleEntries(BODY, EMPHASIS);
    expect(merged.paragraph).toEqual({ alignment: "left", spacingAfterPt: 6 });
    expect(merged.run).toEqual({ sizePt: 14, italic: true });
  });

  it("emits no key for a half neither side carries", () => {
    const merged = overlayStyleEntries({}, { run: { bold: true } });
    expect(merged).toEqual({ run: { bold: true } });
    expect("paragraph" in merged).toBe(false);
  });

  it("emits no run key when neither side carries a run half", () => {
    const merged = overlayStyleEntries(
      { paragraph: { alignment: "left" } },
      {},
    );
    expect("run" in merged).toBe(false);
  });

  it("returns the inner run object by reference when outer carries no run half", () => {
    const innerRun = { bold: true };
    const merged = overlayStyleEntries({}, { run: innerRun });
    expect(merged.run).toBe(innerRun);
  });

  it("explicitly-present-undefined inner values do not overwrite outer -- absence is not a value", () => {
    const merged = overlayStyleEntries(BODY, {
      paragraph: { alignment: undefined },
    });
    expect(merged.paragraph).toEqual({
      alignment: "justify",
      spacingAfterPt: 6,
    });
  });
});

describe("resolveStyleChain", () => {
  const styles: StylesTable = { base: BODY, emphasis: EMPHASIS };

  it("folds refs outermost-first with innermost winning", () => {
    expect(resolveStyleChain(styles, ["base", "emphasis"])).toEqual(
      overlayStyleEntries(BODY, EMPHASIS),
    );
    expect(resolveStyleChain(styles, ["emphasis", "base"])).toEqual(
      overlayStyleEntries(EMPHASIS, BODY),
    );
  });

  it("resolves one ref to itself and zero refs to an empty entry", () => {
    expect(resolveStyleChain(styles, ["base"])).toEqual(BODY);
    expect(resolveStyleChain(styles, [])).toEqual({});
  });

  it("throws on a ref naming no entry -- an unresolvable ref is loud, never a silent skip", () => {
    expect(() => resolveStyleChain(styles, ["base", "missing"])).toThrow(
      /missing/,
    );
  });
});

describe("applyParagraphStyleProperties and applyRunStyleProperties", () => {
  it("fills only the gaps: the node's own direct properties win, style values supply the rest", () => {
    const paragraph: ContentParagraph = {
      kind: "paragraph",
      runs: [],
      alignment: "center",
    };
    const effective = applyParagraphStyleProperties(BODY.paragraph, paragraph);
    expect(effective.alignment).toBe("center");
    expect(effective.spacingAfterPt).toBe(6);
    expect(effective).not.toBe(paragraph);
    expect(paragraph.spacingAfterPt).toBeUndefined();
  });

  it("returns the input object itself when there is nothing to apply", () => {
    const paragraph: ContentParagraph = { kind: "paragraph", runs: [] };
    expect(applyParagraphStyleProperties(undefined, paragraph)).toBe(paragraph);
    const run: ContentRun = { text: "x" };
    expect(applyRunStyleProperties(undefined, run)).toBe(run);
  });

  it("fills a page-break gap from the entry without overwriting the node's own flag", () => {
    const paragraph: ContentParagraph = {
      kind: "paragraph",
      runs: [],
      pageBreakBefore: false,
    };
    const effective = applyParagraphStyleProperties(
      { pageBreakBefore: true, pageBreakAfter: true },
      paragraph,
    );
    expect(effective.pageBreakBefore).toBe(false);
    expect(effective.pageBreakAfter).toBe(true);
  });

  it("applies run defaults under the run's own properties -- the chain's one extra level down", () => {
    const run: ContentRun = { text: "x", sizePt: 9 };
    const effective = applyRunStyleProperties(EMPHASIS.run, run);
    expect(effective.sizePt).toBe(9);
    expect(effective.italic).toBe(true);
  });

  it("leaves non-style fields (text, hyperlink, sourcePath, frames) untouched", () => {
    const run: ContentRun = { text: "x", hyperlink: "https://example.com" };
    const effective = applyRunStyleProperties({ bold: true }, run);
    expect(effective.hyperlink).toBe("https://example.com");
    expect(effective.text).toBe("x");
  });
});

describe("overlayStyleEntries isolates each paragraph property's own overlay guard", () => {
  const outerParagraph: StyleEntry = {
    paragraph: {
      list: { level: 0 },
      spacingBeforePt: 1,
      lineSpacing: 1.5,
      indentLeftPt: 10,
      indentFirstLinePt: 20,
    },
  };

  it("list: fills from inner, and leaves spacingBeforePt untouched", () => {
    const merged = overlayStyleEntries(outerParagraph, {
      paragraph: { list: { level: 1 } },
    });
    expect(merged.paragraph?.list).toEqual({ level: 1 });
    expect(merged.paragraph?.spacingBeforePt).toBe(1);
  });

  it("spacingBeforePt: fills from inner, and leaves lineSpacing untouched", () => {
    const merged = overlayStyleEntries(outerParagraph, {
      paragraph: { spacingBeforePt: 5 },
    });
    expect(merged.paragraph?.spacingBeforePt).toBe(5);
    expect(merged.paragraph?.lineSpacing).toBe(1.5);
  });

  it("lineSpacing: fills from inner, and leaves indentLeftPt untouched", () => {
    const merged = overlayStyleEntries(outerParagraph, {
      paragraph: { lineSpacing: 3 },
    });
    expect(merged.paragraph?.lineSpacing).toBe(3);
    expect(merged.paragraph?.indentLeftPt).toBe(10);
  });

  it("indentLeftPt: fills from inner, and leaves indentFirstLinePt untouched", () => {
    const merged = overlayStyleEntries(outerParagraph, {
      paragraph: { indentLeftPt: 99 },
    });
    expect(merged.paragraph?.indentLeftPt).toBe(99);
    expect(merged.paragraph?.indentFirstLinePt).toBe(20);
  });

  it("indentFirstLinePt: fills from inner, and leaves list untouched -- closing the cycle back to the first field", () => {
    const merged = overlayStyleEntries(outerParagraph, {
      paragraph: { indentFirstLinePt: 99 },
    });
    expect(merged.paragraph?.indentFirstLinePt).toBe(99);
    expect(merged.paragraph?.list).toEqual({ level: 0 });
  });
});

describe("overlayStyleEntries isolates each run property's own overlay guard", () => {
  const outerRun: StyleEntry = {
    run: {
      bold: true,
      italic: true,
      underline: true,
      strike: true,
      fontFamily: "Arial",
      sizePt: 10,
      color: { r: 0, g: 0, b: 0 },
    },
  };

  it("bold: fills from inner, and leaves italic untouched", () => {
    const merged = overlayStyleEntries(outerRun, { run: { bold: false } });
    expect(merged.run?.bold).toBe(false);
    expect(merged.run?.italic).toBe(true);
  });

  it("italic: fills from inner, and leaves underline untouched", () => {
    const merged = overlayStyleEntries(outerRun, { run: { italic: false } });
    expect(merged.run?.italic).toBe(false);
    expect(merged.run?.underline).toBe(true);
  });

  it("underline: fills from inner, and leaves strike untouched", () => {
    const merged = overlayStyleEntries(outerRun, {
      run: { underline: false },
    });
    expect(merged.run?.underline).toBe(false);
    expect(merged.run?.strike).toBe(true);
  });

  it("strike: fills from inner, and leaves fontFamily untouched", () => {
    const merged = overlayStyleEntries(outerRun, { run: { strike: false } });
    expect(merged.run?.strike).toBe(false);
    expect(merged.run?.fontFamily).toBe("Arial");
  });

  it("fontFamily: fills from inner, and leaves sizePt untouched", () => {
    const merged = overlayStyleEntries(outerRun, {
      run: { fontFamily: "Times" },
    });
    expect(merged.run?.fontFamily).toBe("Times");
    expect(merged.run?.sizePt).toBe(10);
  });

  it("sizePt: fills from inner, and leaves color untouched -- also proving the merge starts from a copy of outer, not an empty object", () => {
    const merged = overlayStyleEntries(outerRun, { run: { sizePt: 20 } });
    expect(merged.run?.sizePt).toBe(20);
    expect(merged.run?.color).toEqual({ r: 0, g: 0, b: 0 });
  });

  it("color: fills from inner, and leaves bold untouched -- closing the cycle back to the first field", () => {
    const merged = overlayStyleEntries(outerRun, {
      run: { color: { r: 1, g: 1, b: 1 } },
    });
    expect(merged.run?.color).toEqual({ r: 1, g: 1, b: 1 });
    expect(merged.run?.bold).toBe(true);
  });
});

describe("applyParagraphStyleProperties isolates each field's own gap-fill guard", () => {
  const paragraphBase: ContentParagraph = { kind: "paragraph", runs: [] };

  it("adds no property at all when the style entry supplies nothing, for every field", () => {
    const untouched = applyParagraphStyleProperties({}, paragraphBase);
    for (const field of [
      "alignment",
      "list",
      "spacingBeforePt",
      "spacingAfterPt",
      "lineSpacing",
      "indentLeftPt",
      "indentFirstLinePt",
      "pageBreakBefore",
      "pageBreakAfter",
    ]) {
      expect(field in untouched).toBe(false);
    }
  });

  it("alignment: the node's own value wins, and the style fills a real gap", () => {
    const node: ContentParagraph = { ...paragraphBase, alignment: "center" };
    expect(
      applyParagraphStyleProperties({ alignment: "left" }, node).alignment,
    ).toBe("center");
    expect(
      applyParagraphStyleProperties({ alignment: "left" }, paragraphBase)
        .alignment,
    ).toBe("left");
  });

  it("list: the node's own value wins, and the style fills a real gap", () => {
    const node: ContentParagraph = { ...paragraphBase, list: { level: 2 } };
    expect(
      applyParagraphStyleProperties({ list: { level: 5 } }, node).list,
    ).toEqual({ level: 2 });
    expect(
      applyParagraphStyleProperties({ list: { level: 5 } }, paragraphBase).list,
    ).toEqual({ level: 5 });
  });

  it("spacingBeforePt: the node's own value wins, and the style fills a real gap", () => {
    const node: ContentParagraph = { ...paragraphBase, spacingBeforePt: 3 };
    expect(
      applyParagraphStyleProperties({ spacingBeforePt: 9 }, node)
        .spacingBeforePt,
    ).toBe(3);
    expect(
      applyParagraphStyleProperties({ spacingBeforePt: 9 }, paragraphBase)
        .spacingBeforePt,
    ).toBe(9);
  });

  it("spacingAfterPt: the node's own value wins, and the style fills a real gap", () => {
    const node: ContentParagraph = { ...paragraphBase, spacingAfterPt: 3 };
    expect(
      applyParagraphStyleProperties({ spacingAfterPt: 9 }, node).spacingAfterPt,
    ).toBe(3);
    expect(
      applyParagraphStyleProperties({ spacingAfterPt: 9 }, paragraphBase)
        .spacingAfterPt,
    ).toBe(9);
  });

  it("lineSpacing: the node's own value wins, and the style fills a real gap", () => {
    const node: ContentParagraph = { ...paragraphBase, lineSpacing: 1 };
    expect(
      applyParagraphStyleProperties({ lineSpacing: 2 }, node).lineSpacing,
    ).toBe(1);
    expect(
      applyParagraphStyleProperties({ lineSpacing: 2 }, paragraphBase)
        .lineSpacing,
    ).toBe(2);
  });

  it("indentLeftPt: the node's own value wins, and the style fills a real gap", () => {
    const node: ContentParagraph = { ...paragraphBase, indentLeftPt: 3 };
    expect(
      applyParagraphStyleProperties({ indentLeftPt: 9 }, node).indentLeftPt,
    ).toBe(3);
    expect(
      applyParagraphStyleProperties({ indentLeftPt: 9 }, paragraphBase)
        .indentLeftPt,
    ).toBe(9);
  });

  it("indentFirstLinePt: the node's own value wins, and the style fills a real gap", () => {
    const node: ContentParagraph = {
      ...paragraphBase,
      indentFirstLinePt: 3,
    };
    expect(
      applyParagraphStyleProperties({ indentFirstLinePt: 9 }, node)
        .indentFirstLinePt,
    ).toBe(3);
    expect(
      applyParagraphStyleProperties({ indentFirstLinePt: 9 }, paragraphBase)
        .indentFirstLinePt,
    ).toBe(9);
  });

  it("pageBreakBefore: the node's own value wins, and the style fills a real gap", () => {
    const node: ContentParagraph = {
      ...paragraphBase,
      pageBreakBefore: false,
    };
    expect(
      applyParagraphStyleProperties({ pageBreakBefore: true }, node)
        .pageBreakBefore,
    ).toBe(false);
    expect(
      applyParagraphStyleProperties({ pageBreakBefore: true }, paragraphBase)
        .pageBreakBefore,
    ).toBe(true);
  });

  it("pageBreakAfter: the node's own value wins, and the style fills a real gap", () => {
    const node: ContentParagraph = {
      ...paragraphBase,
      pageBreakAfter: false,
    };
    expect(
      applyParagraphStyleProperties({ pageBreakAfter: true }, node)
        .pageBreakAfter,
    ).toBe(false);
    expect(
      applyParagraphStyleProperties({ pageBreakAfter: true }, paragraphBase)
        .pageBreakAfter,
    ).toBe(true);
  });
});

describe("applyRunStyleProperties isolates each field's own gap-fill guard", () => {
  const runBase: ContentRun = { text: "x" };

  it("adds no property at all when the style entry supplies nothing, for every field", () => {
    const untouched = applyRunStyleProperties({}, runBase);
    for (const field of [
      "bold",
      "italic",
      "underline",
      "strike",
      "fontFamily",
      "sizePt",
      "color",
    ]) {
      expect(field in untouched).toBe(false);
    }
  });

  it("bold: the run's own value wins, and the style fills a real gap", () => {
    const run: ContentRun = { ...runBase, bold: false };
    expect(applyRunStyleProperties({ bold: true }, run).bold).toBe(false);
    expect(applyRunStyleProperties({ bold: true }, runBase).bold).toBe(true);
  });

  it("italic: the run's own value wins, and the style fills a real gap", () => {
    const run: ContentRun = { ...runBase, italic: false };
    expect(applyRunStyleProperties({ italic: true }, run).italic).toBe(false);
    expect(applyRunStyleProperties({ italic: true }, runBase).italic).toBe(
      true,
    );
  });

  it("underline: the run's own value wins, and the style fills a real gap", () => {
    const run: ContentRun = { ...runBase, underline: false };
    expect(applyRunStyleProperties({ underline: true }, run).underline).toBe(
      false,
    );
    expect(
      applyRunStyleProperties({ underline: true }, runBase).underline,
    ).toBe(true);
  });

  it("strike: the run's own value wins, and the style fills a real gap", () => {
    const run: ContentRun = { ...runBase, strike: false };
    expect(applyRunStyleProperties({ strike: true }, run).strike).toBe(false);
    expect(applyRunStyleProperties({ strike: true }, runBase).strike).toBe(
      true,
    );
  });

  it("fontFamily: the run's own value wins, and the style fills a real gap", () => {
    const run: ContentRun = { ...runBase, fontFamily: "Carlito" };
    expect(
      applyRunStyleProperties({ fontFamily: "Arial" }, run).fontFamily,
    ).toBe("Carlito");
    expect(
      applyRunStyleProperties({ fontFamily: "Arial" }, runBase).fontFamily,
    ).toBe("Arial");
  });

  it("sizePt: the run's own value wins, and the style fills a real gap", () => {
    const run: ContentRun = { ...runBase, sizePt: 9 };
    expect(applyRunStyleProperties({ sizePt: 20 }, run).sizePt).toBe(9);
    expect(applyRunStyleProperties({ sizePt: 20 }, runBase).sizePt).toBe(20);
  });

  it("color: the run's own value wins, and the style fills a real gap", () => {
    const run: ContentRun = { ...runBase, color: { r: 0, g: 0, b: 0 } };
    expect(
      applyRunStyleProperties({ color: { r: 1, g: 1, b: 1 } }, run).color,
    ).toEqual({ r: 0, g: 0, b: 0 });
    expect(
      applyRunStyleProperties({ color: { r: 1, g: 1, b: 1 } }, runBase).color,
    ).toEqual({ r: 1, g: 1, b: 1 });
  });
});
