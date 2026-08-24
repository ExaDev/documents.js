import type { XmlElement } from "../../model/node";
import { describe, expect, it } from "vitest";
import { el } from "../../xml/fragment";
import { EMPTY_THEME } from "../shared/drawingml";
import { resolveParagraphProperties, resolveRunProperties } from "./styles";

// Ported verbatim from documents.js's src/ooxml/docx/styles.test.ts.

const THEME = {
  colorScheme: new Map(),
  majorFont: "Major Font",
  minorFont: "Minor Font",
};

function styleEl(
  id: string,
  type: "paragraph" | "character",
  options: {
    basedOn?: string;
    isDefault?: boolean;
    pPr?: XmlElement;
    rPr?: XmlElement;
  } = {},
): XmlElement {
  const attrs: Record<string, string> = { "w:type": type, "w:styleId": id };
  if (options.isDefault === true) {
    attrs["w:default"] = "1";
  }
  const children: XmlElement[] = [];
  if (options.basedOn !== undefined) {
    children.push(el("w:basedOn", { "w:val": options.basedOn }));
  }
  if (options.pPr !== undefined) {
    children.push(options.pPr);
  }
  if (options.rPr !== undefined) {
    children.push(options.rPr);
  }
  return el("w:style", attrs, children);
}

function stylesRoot(
  styles: XmlElement[],
  docDefaultsPPr?: XmlElement,
  docDefaultsRPr?: XmlElement,
): XmlElement {
  const docDefaultsChildren: XmlElement[] = [];
  if (docDefaultsPPr !== undefined) {
    docDefaultsChildren.push(el("w:pPrDefault", {}, [docDefaultsPPr]));
  }
  if (docDefaultsRPr !== undefined) {
    docDefaultsChildren.push(el("w:rPrDefault", {}, [docDefaultsRPr]));
  }
  const children =
    docDefaultsChildren.length > 0
      ? [el("w:docDefaults", {}, docDefaultsChildren), ...styles]
      : styles;
  return el("w:styles", {}, children);
}

// Builds a paragraph containing `run` and returns both, so tests never need to re-extract the run from the paragraph's own children (which would require a type assertion to narrow XmlNode back to XmlElement).
function paragraphWithRun(
  pPrChildren: XmlElement[],
  run: XmlElement,
): { paragraph: XmlElement; run: XmlElement } {
  return { paragraph: el("w:p", {}, [el("w:pPr", {}, pPrChildren), run]), run };
}

function paragraphEl(pPrChildren: XmlElement[]): XmlElement {
  return el("w:p", {}, [el("w:pPr", {}, pPrChildren)]);
}

function runEl(rPrChildren: XmlElement[]): XmlElement {
  return el("w:r", {}, [el("w:rPr", {}, rPrChildren)]);
}

describe("resolveRunProperties: toggle properties", () => {
  it("bare presence of a toggle element means on", () => {
    const { paragraph, run } = paragraphWithRun(
      [],
      runEl([el("w:b"), el("w:i")]),
    );
    const props = resolveRunProperties(run, paragraph, {
      stylesRoot: undefined,
      theme: EMPTY_THEME,
    });
    expect(props.bold).toBe(true);
    expect(props.italic).toBe(true);
  });

  it('w:val="0"/"false"/"off" turns a toggle off', () => {
    const { paragraph, run } = paragraphWithRun(
      [],
      runEl([
        el("w:b", { "w:val": "0" }),
        el("w:i", { "w:val": "false" }),
        el("w:strike", { "w:val": "off" }),
      ]),
    );
    const props = resolveRunProperties(run, paragraph, {
      stylesRoot: undefined,
      theme: EMPTY_THEME,
    });
    expect(props.bold).toBe(false);
    expect(props.italic).toBe(false);
    expect(props.strike).toBe(false);
  });

  it("absence of a toggle element leaves the property undefined, not off", () => {
    const { paragraph, run } = paragraphWithRun([], runEl([]));
    const props = resolveRunProperties(run, paragraph, {
      stylesRoot: undefined,
      theme: EMPTY_THEME,
    });
    expect(props.bold).toBeUndefined();
  });
});

describe("resolveRunProperties: underline", () => {
  it('any value other than "none" means underlined', () => {
    const { paragraph, run } = paragraphWithRun(
      [],
      runEl([el("w:u", { "w:val": "single" })]),
    );
    expect(
      resolveRunProperties(run, paragraph, {
        stylesRoot: undefined,
        theme: EMPTY_THEME,
      }).underline,
    ).toBe(true);
  });

  it('"none" means not underlined', () => {
    const { paragraph, run } = paragraphWithRun(
      [],
      runEl([el("w:u", { "w:val": "none" })]),
    );
    expect(
      resolveRunProperties(run, paragraph, {
        stylesRoot: undefined,
        theme: EMPTY_THEME,
      }).underline,
    ).toBe(false);
  });
});

describe("resolveRunProperties: colour", () => {
  it("reads a literal hex colour", () => {
    const { paragraph, run } = paragraphWithRun(
      [],
      runEl([el("w:color", { "w:val": "FF0000" })]),
    );
    expect(
      resolveRunProperties(run, paragraph, {
        stylesRoot: undefined,
        theme: EMPTY_THEME,
      }).color,
    ).toEqual({ r: 1, g: 0, b: 0 });
  });

  it('"auto" defers rather than asserting a colour', () => {
    const { paragraph, run } = paragraphWithRun(
      [],
      runEl([el("w:color", { "w:val": "auto" })]),
    );
    expect(
      resolveRunProperties(run, paragraph, {
        stylesRoot: undefined,
        theme: EMPTY_THEME,
      }).color,
    ).toBeUndefined();
  });

  it("resolves w:themeColor against the theme colour scheme, taking precedence over w:val", () => {
    const themedTheme = {
      colorScheme: new Map([["accent1", { r: 0.2, g: 0.4, b: 0.6 }]]),
      majorFont: "Major Font",
      minorFont: "Minor Font",
    };
    const { paragraph, run } = paragraphWithRun(
      [],
      runEl([el("w:color", { "w:val": "FF0000", "w:themeColor": "accent1" })]),
    );
    expect(
      resolveRunProperties(run, paragraph, {
        stylesRoot: undefined,
        theme: themedTheme,
      }).color,
    ).toEqual({ r: 0.2, g: 0.4, b: 0.6 });
  });

  it("resolves the background1/text1/background2/text2 logical theme colour names to their dark/light slot pair", () => {
    const themedTheme = {
      colorScheme: new Map([
        ["dk1", { r: 0, g: 0, b: 0 }],
        ["lt1", { r: 1, g: 1, b: 1 }],
      ]),
      majorFont: "Major Font",
      minorFont: "Minor Font",
    };
    const text1 = paragraphWithRun(
      [],
      runEl([el("w:color", { "w:themeColor": "text1" })]),
    );
    const background1 = paragraphWithRun(
      [],
      runEl([el("w:color", { "w:themeColor": "background1" })]),
    );
    expect(
      resolveRunProperties(text1.run, text1.paragraph, {
        stylesRoot: undefined,
        theme: themedTheme,
      }).color,
    ).toEqual({ r: 0, g: 0, b: 0 });
    expect(
      resolveRunProperties(background1.run, background1.paragraph, {
        stylesRoot: undefined,
        theme: themedTheme,
      }).color,
    ).toEqual({ r: 1, g: 1, b: 1 });
  });

  it("falls back to w:val when the theme colour reference does not resolve", () => {
    const { paragraph, run } = paragraphWithRun(
      [],
      runEl([el("w:color", { "w:val": "00FF00", "w:themeColor": "accent1" })]),
    );
    expect(
      resolveRunProperties(run, paragraph, {
        stylesRoot: undefined,
        theme: EMPTY_THEME,
      }).color,
    ).toEqual({ r: 0, g: 1, b: 0 });
  });
});

describe("resolveRunProperties: fonts and size", () => {
  it("w:ascii takes precedence over w:asciiTheme when both are present", () => {
    const { paragraph, run } = paragraphWithRun(
      [],
      runEl([
        el("w:rFonts", {
          "w:ascii": "Literal Font",
          "w:asciiTheme": "majorHAnsi",
        }),
      ]),
    );
    expect(
      resolveRunProperties(run, paragraph, {
        stylesRoot: undefined,
        theme: THEME,
      }).fontFamily,
    ).toBe("Literal Font");
  });

  it("resolves majorHAnsi/minorHAnsi theme references", () => {
    const major = paragraphWithRun(
      [],
      runEl([el("w:rFonts", { "w:asciiTheme": "majorHAnsi" })]),
    );
    const minor = paragraphWithRun(
      [],
      runEl([el("w:rFonts", { "w:asciiTheme": "minorHAnsi" })]),
    );
    expect(
      resolveRunProperties(major.run, major.paragraph, {
        stylesRoot: undefined,
        theme: THEME,
      }).fontFamily,
    ).toBe("Major Font");
    expect(
      resolveRunProperties(minor.run, minor.paragraph, {
        stylesRoot: undefined,
        theme: THEME,
      }).fontFamily,
    ).toBe("Minor Font");
  });

  it("converts w:sz from half-points to points", () => {
    const { paragraph, run } = paragraphWithRun(
      [],
      runEl([el("w:sz", { "w:val": "36" })]),
    );
    expect(
      resolveRunProperties(run, paragraph, {
        stylesRoot: undefined,
        theme: EMPTY_THEME,
      }).sizePt,
    ).toBe(18);
  });
});

describe("resolveRunProperties: cascade", () => {
  it("docDefaults provides the lowest-priority layer", () => {
    const docDefaultsRPr = el("w:rPr", {}, [el("w:sz", { "w:val": "20" })]);
    const styles = stylesRoot([], undefined, docDefaultsRPr);
    const { paragraph, run } = paragraphWithRun([], runEl([]));
    expect(
      resolveRunProperties(run, paragraph, {
        stylesRoot: styles,
        theme: EMPTY_THEME,
      }).sizePt,
    ).toBe(10);
  });

  it("the default paragraph style overrides docDefaults", () => {
    const docDefaultsRPr = el("w:rPr", {}, [el("w:sz", { "w:val": "20" })]);
    const normalStyle = styleEl("Normal", "paragraph", {
      isDefault: true,
      rPr: el("w:rPr", {}, [el("w:sz", { "w:val": "24" })]),
    });
    const styles = stylesRoot([normalStyle], undefined, docDefaultsRPr);
    const { paragraph, run } = paragraphWithRun([], runEl([]));
    expect(
      resolveRunProperties(run, paragraph, {
        stylesRoot: styles,
        theme: EMPTY_THEME,
      }).sizePt,
    ).toBe(12);
  });

  it("resolves a basedOn chain root-first, so a child style overrides its ancestor", () => {
    const grandparent = styleEl("Grandparent", "paragraph", {
      rPr: el("w:rPr", {}, [el("w:sz", { "w:val": "20" }), el("w:b")]),
    });
    const parent = styleEl("Parent", "paragraph", {
      basedOn: "Grandparent",
      rPr: el("w:rPr", {}, [el("w:sz", { "w:val": "28" })]),
    });
    const styles = stylesRoot([grandparent, parent]);
    const { paragraph, run } = paragraphWithRun(
      [el("w:pStyle", { "w:val": "Parent" })],
      runEl([]),
    );
    const props = resolveRunProperties(run, paragraph, {
      stylesRoot: styles,
      theme: EMPTY_THEME,
    });
    expect(props.sizePt).toBe(14); // Parent's own size wins over Grandparent's
    expect(props.bold).toBe(true); // inherited from Grandparent, since Parent doesn't set it
  });

  it("is cycle-guarded against a malformed basedOn loop", () => {
    const a = styleEl("A", "paragraph", {
      basedOn: "B",
      rPr: el("w:rPr", {}, [el("w:sz", { "w:val": "20" })]),
    });
    const b = styleEl("B", "paragraph", { basedOn: "A" });
    const styles = stylesRoot([a, b]);
    const { paragraph, run } = paragraphWithRun(
      [el("w:pStyle", { "w:val": "A" })],
      runEl([]),
    );
    expect(() =>
      resolveRunProperties(run, paragraph, {
        stylesRoot: styles,
        theme: EMPTY_THEME,
      }),
    ).not.toThrow();
  });

  it("the paragraph-mark run properties (w:pPr/w:rPr) provide a baseline every run inherits", () => {
    const { paragraph, run } = paragraphWithRun(
      [el("w:rPr", {}, [el("w:sz", { "w:val": "32" })])],
      runEl([]),
    );
    expect(
      resolveRunProperties(run, paragraph, {
        stylesRoot: undefined,
        theme: EMPTY_THEME,
      }).sizePt,
    ).toBe(16);
  });

  it("a run's own character style overrides the paragraph-mark baseline, and direct rPr overrides everything", () => {
    const charStyle = styleEl("Emphasis", "character", {
      rPr: el("w:rPr", {}, [el("w:i")]),
    });
    const styles = stylesRoot([charStyle]);
    const { paragraph, run } = paragraphWithRun(
      [el("w:rPr", {}, [el("w:sz", { "w:val": "20" })])],
      runEl([
        el("w:rStyle", { "w:val": "Emphasis" }),
        el("w:sz", { "w:val": "40" }),
      ]),
    );
    const props = resolveRunProperties(run, paragraph, {
      stylesRoot: styles,
      theme: EMPTY_THEME,
    });
    expect(props.italic).toBe(true); // from the character style
    expect(props.sizePt).toBe(20); // the run's own direct w:sz overrides both the character style and the paragraph mark
  });
});

describe("resolveParagraphProperties", () => {
  it("reads alignment from w:jc", () => {
    for (const [val, expected] of [
      ["left", "left"],
      ["start", "left"],
      ["center", "center"],
      ["right", "right"],
      ["end", "right"],
      ["both", "justify"],
    ] as const) {
      const paragraph = paragraphEl([el("w:jc", { "w:val": val })]);
      expect(
        resolveParagraphProperties(paragraph, {
          stylesRoot: undefined,
          theme: EMPTY_THEME,
        }).alignment,
      ).toBe(expected);
    }
  });

  it("converts spacing and indent from twips to points", () => {
    const paragraph = paragraphEl([
      el("w:spacing", {
        "w:before": "240",
        "w:after": "120",
        "w:line": "360",
        "w:lineRule": "auto",
      }),
      el("w:ind", { "w:left": "720" }),
    ]);
    const props = resolveParagraphProperties(paragraph, {
      stylesRoot: undefined,
      theme: EMPTY_THEME,
    });
    expect(props.spacingBeforePt).toBe(12);
    expect(props.spacingAfterPt).toBe(6);
    expect(props.lineSpacing).toBe(1.5);
    expect(props.indentLeftPt).toBe(36);
  });

  it("ignores w:line when lineRule is exact/atLeast, since it is then an absolute height, not a multiplier", () => {
    const paragraph = paragraphEl([
      el("w:spacing", { "w:line": "360", "w:lineRule": "exact" }),
    ]);
    expect(
      resolveParagraphProperties(paragraph, {
        stylesRoot: undefined,
        theme: EMPTY_THEME,
      }).lineSpacing,
    ).toBeUndefined();
  });

  it("reads w:firstLine as a positive indent and w:hanging as its negative", () => {
    const firstLineParagraph = paragraphEl([
      el("w:ind", { "w:firstLine": "360" }),
    ]);
    const hangingParagraph = paragraphEl([el("w:ind", { "w:hanging": "360" })]);
    expect(
      resolveParagraphProperties(firstLineParagraph, {
        stylesRoot: undefined,
        theme: EMPTY_THEME,
      }).indentFirstLinePt,
    ).toBe(18);
    expect(
      resolveParagraphProperties(hangingParagraph, {
        stylesRoot: undefined,
        theme: EMPTY_THEME,
      }).indentFirstLinePt,
    ).toBe(-18);
  });

  it("resolves the named paragraph style chain, root-first", () => {
    const grandparent = styleEl("Grandparent", "paragraph", {
      pPr: el("w:pPr", {}, [el("w:jc", { "w:val": "center" })]),
    });
    const parent = styleEl("Parent", "paragraph", {
      basedOn: "Grandparent",
      pPr: el("w:pPr", {}, [el("w:ind", { "w:left": "720" })]),
    });
    const styles = stylesRoot([grandparent, parent]);
    const paragraph = paragraphEl([el("w:pStyle", { "w:val": "Parent" })]);
    const props = resolveParagraphProperties(paragraph, {
      stylesRoot: styles,
      theme: EMPTY_THEME,
    });
    expect(props.alignment).toBe("center"); // inherited from Grandparent
    expect(props.indentLeftPt).toBe(36); // Parent's own
  });

  it("the paragraph's own direct w:pPr overrides its style chain", () => {
    const style = styleEl("Body", "paragraph", {
      pPr: el("w:pPr", {}, [el("w:jc", { "w:val": "left" })]),
    });
    const styles = stylesRoot([style]);
    const paragraph = paragraphEl([
      el("w:pStyle", { "w:val": "Body" }),
      el("w:jc", { "w:val": "right" }),
    ]);
    expect(
      resolveParagraphProperties(paragraph, {
        stylesRoot: styles,
        theme: EMPTY_THEME,
      }).alignment,
    ).toBe("right");
  });

  it("reads w:outlineLvl through the style cascade, so a custom style based on a heading inherits its level", () => {
    const heading2 = styleEl("Heading2", "paragraph", {
      pPr: el("w:pPr", {}, [el("w:outlineLvl", { "w:val": "1" })]),
    });
    const customSection = styleEl("CustomSection", "paragraph", {
      basedOn: "Heading2",
    });
    const styles = stylesRoot([heading2, customSection]);
    const paragraph = paragraphEl([
      el("w:pStyle", { "w:val": "CustomSection" }),
    ]);
    expect(
      resolveParagraphProperties(paragraph, {
        stylesRoot: styles,
        theme: EMPTY_THEME,
      }).outlineLvl,
    ).toBe(1);
  });

  it("the paragraph's own direct w:outlineLvl overrides its style chain", () => {
    const style = styleEl("Body", "paragraph", {
      pPr: el("w:pPr", {}, [el("w:outlineLvl", { "w:val": "3" })]),
    });
    const styles = stylesRoot([style]);
    const paragraph = paragraphEl([
      el("w:pStyle", { "w:val": "Body" }),
      el("w:outlineLvl", { "w:val": "0" }),
    ]);
    expect(
      resolveParagraphProperties(paragraph, {
        stylesRoot: styles,
        theme: EMPTY_THEME,
      }).outlineLvl,
    ).toBe(0);
  });
});
