import type { XmlElement } from "../../model/node";
import { describe, expect, it } from "vitest";
import { el } from "../../xml/fragment";
import { EMPTY_THEME } from "../shared/drawingml";
import { resolveParagraphProperties, resolveRunProperties } from "./styles";
const THEME = {
  colorScheme: new Map(),
  majorFont: "Major Font",
  minorFont: "Minor Font",
};

// The theme's own accent1 colour, in resolveRunProperties' normalised 0-1 RGB space, shared by every w:themeTint/w:themeShade test below so a fixture value and its own assertion never drift independently of one another.
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
  styles: readonly XmlElement[],
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
  pPrChildren: readonly XmlElement[],
  run: XmlElement,
): { paragraph: XmlElement; run: XmlElement } {
  return { paragraph: el("w:p", {}, [el("w:pPr", {}, pPrChildren), run]), run };
}

function paragraphEl(pPrChildren: readonly XmlElement[]): XmlElement {
  return el("w:p", {}, [el("w:pPr", {}, pPrChildren)]);
}

function runEl(rPrChildren: readonly XmlElement[]): XmlElement {
  return el("w:r", {}, [el("w:rPr", {}, rPrChildren)]);
}

const HALF_INCH_INDENT_PT = 36;

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

  it("resolves an unrecognised w:asciiTheme value to no font family at all, not a false minor-font default", () => {
    const { paragraph, run } = paragraphWithRun(
      [],
      runEl([el("w:rFonts", { "w:asciiTheme": "majorBidi" })]),
    );
    expect(
      resolveRunProperties(run, paragraph, {
        stylesRoot: undefined,
        theme: THEME,
      }).fontFamily,
    ).toBeUndefined();
  });

  it("resolves majorAscii/minorAscii theme references too, not just their HAnsi spellings", () => {
    const major = paragraphWithRun(
      [],
      runEl([el("w:rFonts", { "w:asciiTheme": "majorAscii" })]),
    );
    const minor = paragraphWithRun(
      [],
      runEl([el("w:rFonts", { "w:asciiTheme": "minorAscii" })]),
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
    const EXPECTED_SIZE_PT = 18; // half of w:sz's own 36 half-points
    expect(
      resolveRunProperties(run, paragraph, {
        stylesRoot: undefined,
        theme: EMPTY_THEME,
      }).sizePt,
    ).toBe(EXPECTED_SIZE_PT);
  });
});

describe("resolveRunProperties: cascade", () => {
  it("docDefaults provides the lowest-priority layer", () => {
    const docDefaultsRPr = el("w:rPr", {}, [el("w:sz", { "w:val": "20" })]);
    const styles = stylesRoot([], undefined, docDefaultsRPr);
    const { paragraph, run } = paragraphWithRun([], runEl([]));
    const EXPECTED_SIZE_PT = 10; // half of docDefaults' own 20 half-points
    expect(
      resolveRunProperties(run, paragraph, {
        stylesRoot: styles,
        theme: EMPTY_THEME,
      }).sizePt,
    ).toBe(EXPECTED_SIZE_PT);
  });

  it("the default paragraph style overrides docDefaults", () => {
    const docDefaultsRPr = el("w:rPr", {}, [el("w:sz", { "w:val": "20" })]);
    const normalStyle = styleEl("Normal", "paragraph", {
      isDefault: true,
      rPr: el("w:rPr", {}, [el("w:sz", { "w:val": "24" })]),
    });
    const styles = stylesRoot([normalStyle], undefined, docDefaultsRPr);
    const { paragraph, run } = paragraphWithRun([], runEl([]));
    const EXPECTED_SIZE_PT = 12; // half of the Normal style's own 24 half-points, overriding docDefaults' 20
    expect(
      resolveRunProperties(run, paragraph, {
        stylesRoot: styles,
        theme: EMPTY_THEME,
      }).sizePt,
    ).toBe(EXPECTED_SIZE_PT);
  });

  it("finds the default style by BOTH its own type and w:default=1, ignoring a same-typed non-default style and a differently-typed default style", () => {
    const wrongType = styleEl("CharDefault", "character", {
      isDefault: true,
      rPr: el("w:rPr", {}, [el("w:sz", { "w:val": "60" })]),
    });
    const notDefault = styleEl("NotDefault", "paragraph", {
      rPr: el("w:rPr", {}, [el("w:sz", { "w:val": "40" })]),
    });
    const realDefault = styleEl("Normal", "paragraph", {
      isDefault: true,
      rPr: el("w:rPr", {}, [el("w:sz", { "w:val": "24" })]),
    });
    const styles = stylesRoot([wrongType, notDefault, realDefault]);
    const { paragraph, run } = paragraphWithRun([], runEl([]));
    const EXPECTED_SIZE_PT = 12; // half of realDefault's own 24 half-points, the only style that is both the right type AND w:default=1
    expect(
      resolveRunProperties(run, paragraph, {
        stylesRoot: styles,
        theme: EMPTY_THEME,
      }).sizePt,
    ).toBe(EXPECTED_SIZE_PT);
  });

  it("resolves a w:pStyle reference against a style of the SAME id but the WRONG type as a miss, not a match", () => {
    const wrongTypeSameId = styleEl("Shared", "character", {
      rPr: el("w:rPr", {}, [el("w:sz", { "w:val": "60" })]),
    });
    const rightTypeSameId = styleEl("Shared", "paragraph", {
      rPr: el("w:rPr", {}, [el("w:sz", { "w:val": "24" })]),
    });
    const styles = stylesRoot([wrongTypeSameId, rightTypeSameId]);
    const { paragraph, run } = paragraphWithRun(
      [el("w:pStyle", { "w:val": "Shared" })],
      runEl([]),
    );
    const EXPECTED_SIZE_PT = 12; // half of rightTypeSameId's own 24 half-points; wrongTypeSameId's 60 must not win despite sharing the id
    expect(
      resolveRunProperties(run, paragraph, {
        stylesRoot: styles,
        theme: EMPTY_THEME,
      }).sizePt,
    ).toBe(EXPECTED_SIZE_PT);
  });

  it("inherits strike from an ancestor style when a descendant style doesn't set it", () => {
    const grandparent = styleEl("Grandparent", "paragraph", {
      rPr: el("w:rPr", {}, [el("w:strike")]),
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
    expect(
      resolveRunProperties(run, paragraph, {
        stylesRoot: styles,
        theme: EMPTY_THEME,
      }).strike,
    ).toBe(true);
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
    const EXPECTED_SIZE_PT = 14; // half of Parent's own 28 half-points, winning over Grandparent's
    expect(props.sizePt).toBe(EXPECTED_SIZE_PT); // Parent's own size wins over Grandparent's
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
    const EXPECTED_SIZE_PT = 16; // half of the paragraph mark's own 32 half-points
    expect(
      resolveRunProperties(run, paragraph, {
        stylesRoot: undefined,
        theme: EMPTY_THEME,
      }).sizePt,
    ).toBe(EXPECTED_SIZE_PT);
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
    const EXPECTED_SIZE_PT = 20; // half of the run's own direct 40 half-points
    expect(props.italic).toBe(true); // from the character style
    expect(props.sizePt).toBe(EXPECTED_SIZE_PT); // the run's own direct w:sz overrides both the character style and the paragraph mark
  });
});

// A w:ind left/start value of 720 twips (half an inch, a common paragraph-indent value in real documents) converts to this many points via the fixed 20-twips-per-point ratio; shared by every test below that uses exactly this indent so the fixture value and its own assertion never drift independently of one another.
describe("resolveParagraphProperties", () => {
  it("reads alignment from w:jc", () => {
    for (const [val, expected] of [
      ["left", "left"],
      ["start", "left"],
      ["center", "center"],
      ["right", "right"],
      ["end", "right"],
      ["both", "justify"],
      ["distribute", "justify"],
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
    const EXPECTED_SPACING_BEFORE_PT = 12; // 240 twips (w:spacing's own unit) / 20 twips-per-point
    const EXPECTED_SPACING_AFTER_PT = 6; // 120 twips / 20 twips-per-point
    const EXPECTED_LINE_SPACING_MULTIPLIER = 1.5; // w:line's own 360 / 240, the fixed OOXML denominator for a lineRule=auto multiplier
    expect(props.spacingBeforePt).toBe(EXPECTED_SPACING_BEFORE_PT);
    expect(props.spacingAfterPt).toBe(EXPECTED_SPACING_AFTER_PT);
    expect(props.lineSpacing).toBe(EXPECTED_LINE_SPACING_MULTIPLIER);
    expect(props.indentLeftPt).toBe(HALF_INCH_INDENT_PT);
  });

  it("ignores w:line when lineRule is exact/atLeast, since it is then an absolute height, not a multiplier", () => {
    const exactParagraph = paragraphEl([
      el("w:spacing", { "w:line": "360", "w:lineRule": "exact" }),
    ]);
    const atLeastParagraph = paragraphEl([
      el("w:spacing", { "w:line": "360", "w:lineRule": "atLeast" }),
    ]);
    expect(
      resolveParagraphProperties(exactParagraph, {
        stylesRoot: undefined,
        theme: EMPTY_THEME,
      }).lineSpacing,
    ).toBeUndefined();
    expect(
      resolveParagraphProperties(atLeastParagraph, {
        stylesRoot: undefined,
        theme: EMPTY_THEME,
      }).lineSpacing,
    ).toBeUndefined();
  });

  it("falls back to w:ind/@w:start when w:left is absent", () => {
    const paragraph = paragraphEl([el("w:ind", { "w:start": "720" })]);
    expect(
      resolveParagraphProperties(paragraph, {
        stylesRoot: undefined,
        theme: EMPTY_THEME,
      }).indentLeftPt,
    ).toBe(HALF_INCH_INDENT_PT);
  });

  it("reads w:firstLine as a positive indent and w:hanging as its negative", () => {
    const firstLineParagraph = paragraphEl([
      el("w:ind", { "w:firstLine": "360" }),
    ]);
    const hangingParagraph = paragraphEl([el("w:ind", { "w:hanging": "360" })]);
    const FIRST_LINE_INDENT_PT = 18; // 360 twips (w:ind's own unit) / 20 twips-per-point
    expect(
      resolveParagraphProperties(firstLineParagraph, {
        stylesRoot: undefined,
        theme: EMPTY_THEME,
      }).indentFirstLinePt,
    ).toBe(FIRST_LINE_INDENT_PT);
    expect(
      resolveParagraphProperties(hangingParagraph, {
        stylesRoot: undefined,
        theme: EMPTY_THEME,
      }).indentFirstLinePt,
    ).toBe(-FIRST_LINE_INDENT_PT);
  });

  it("the default paragraph style's own w:pPr is merged in, above docDefaults", () => {
    const docDefaultsPPr = el("w:pPr", {}, [el("w:jc", { "w:val": "left" })]);
    const normalStyle = styleEl("Normal", "paragraph", {
      isDefault: true,
      pPr: el("w:pPr", {}, [el("w:jc", { "w:val": "center" })]),
    });
    const styles = stylesRoot([normalStyle], docDefaultsPPr);
    const paragraph = paragraphEl([]);
    expect(
      resolveParagraphProperties(paragraph, {
        stylesRoot: styles,
        theme: EMPTY_THEME,
      }).alignment,
    ).toBe("center");
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
    expect(props.indentLeftPt).toBe(HALF_INCH_INDENT_PT); // Parent's own
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
