import { describe, expect, it } from "vitest";
import type { Package } from "../../model/package";
import type { XmlElement } from "../../model/node";
import { el } from "../../xml/fragment";
import { buildNumberingElement, readNumberingDefinitions } from "./numbering";

function lvlEl(
  ilvl: string,
  format: string,
  text: string,
  options: { start?: string; restart?: string } = {},
): XmlElement {
  const children = [
    el("w:numFmt", { "w:val": format }),
    el("w:lvlText", { "w:val": text }),
  ];
  if (options.start !== undefined) {
    children.unshift(el("w:start", { "w:val": options.start }));
  }
  if (options.restart !== undefined) {
    children.push(el("w:lvlRestart", { "w:val": options.restart }));
  }
  return el("w:lvl", { "w:ilvl": ilvl }, children);
}

function packageWithNumbering(numberingNodes: XmlElement[]): Package {
  return {
    parts: {
      "word/numbering.xml": {
        kind: "xml",
        nodes: [el("w:numbering", {}, numberingNodes)],
      },
    },
  };
}

describe("readNumberingDefinitions", () => {
  it("returns an empty record when word/numbering.xml is absent", () => {
    expect(readNumberingDefinitions({ parts: {} })).toEqual({});
  });

  it("resolves a num to its abstractNum level table via w:abstractNumId", () => {
    const abstractNum = el("w:abstractNum", { "w:abstractNumId": "0" }, [
      lvlEl("0", "decimal", "%1.", { start: "1" }),
      lvlEl("1", "lowerRoman", "%2)", { start: "1" }),
    ]);
    const num = el("w:num", { "w:numId": "5" }, [
      el("w:abstractNumId", { "w:val": "0" }),
    ]);
    const definitions = readNumberingDefinitions(
      packageWithNumbering([abstractNum, num]),
    );
    expect(definitions["5"]?.levels["0"]).toEqual({
      format: "decimal",
      text: "%1.",
      startAt: 1,
    });
    expect(definitions["5"]?.levels["1"]).toEqual({
      format: "lowerRoman",
      text: "%2)",
      startAt: 1,
    });
  });

  it("defaults startAt to 1 when w:start is absent", () => {
    const abstractNum = el("w:abstractNum", { "w:abstractNumId": "0" }, [
      lvlEl("0", "bullet", "•"),
    ]);
    const num = el("w:num", { "w:numId": "1" }, [
      el("w:abstractNumId", { "w:val": "0" }),
    ]);
    const definitions = readNumberingDefinitions(
      packageWithNumbering([abstractNum, num]),
    );
    expect(definitions["1"]?.levels["0"]?.startAt).toBe(1);
  });

  it("reads w:lvlRestart as the raw restart level", () => {
    const abstractNum = el("w:abstractNum", { "w:abstractNumId": "0" }, [
      lvlEl("2", "decimal", "%3.", { start: "1", restart: "1" }),
    ]);
    const num = el("w:num", { "w:numId": "9" }, [
      el("w:abstractNumId", { "w:val": "0" }),
    ]);
    const definitions = readNumberingDefinitions(
      packageWithNumbering([abstractNum, num]),
    );
    expect(definitions["9"]?.levels["2"]?.restart).toBe(1);
  });

  it("applies a w:lvlOverride/w:startOverride to just that level's startAt, leaving format/text unchanged", () => {
    const abstractNum = el("w:abstractNum", { "w:abstractNumId": "0" }, [
      lvlEl("0", "decimal", "%1.", { start: "1" }),
    ]);
    const num = el("w:num", { "w:numId": "3" }, [
      el("w:abstractNumId", { "w:val": "0" }),
      el("w:lvlOverride", { "w:ilvl": "0" }, [
        el("w:startOverride", { "w:val": "5" }),
      ]),
    ]);
    const definitions = readNumberingDefinitions(
      packageWithNumbering([abstractNum, num]),
    );
    expect(definitions["3"]?.levels["0"]).toEqual({
      format: "decimal",
      text: "%1.",
      startAt: 5,
    });
  });

  it("applies a w:lvlOverride carrying a full nested w:lvl, replacing that level wholesale", () => {
    const abstractNum = el("w:abstractNum", { "w:abstractNumId": "0" }, [
      lvlEl("0", "decimal", "%1.", { start: "1" }),
    ]);
    const num = el("w:num", { "w:numId": "4" }, [
      el("w:abstractNumId", { "w:val": "0" }),
      el("w:lvlOverride", { "w:ilvl": "0" }, [
        lvlEl("0", "bullet", "●", { start: "1" }),
      ]),
    ]);
    const definitions = readNumberingDefinitions(
      packageWithNumbering([abstractNum, num]),
    );
    expect(definitions["4"]?.levels["0"]).toEqual({
      format: "bullet",
      text: "●",
      startAt: 1,
    });
  });

  it("skips a num whose abstractNumId does not resolve to a known abstractNum", () => {
    const num = el("w:num", { "w:numId": "7" }, [
      el("w:abstractNumId", { "w:val": "99" }),
    ]);
    const definitions = readNumberingDefinitions(packageWithNumbering([num]));
    expect(definitions["7"]).toBeUndefined();
  });

  it("skips a w:startOverride whose own ilvl names a level the base abstractNum does not define, rather than fabricating one", () => {
    const abstractNum = el("w:abstractNum", { "w:abstractNumId": "0" }, [
      lvlEl("0", "decimal", "%1.", { start: "1" }),
    ]);
    const num = el("w:num", { "w:numId": "8" }, [
      el("w:abstractNumId", { "w:val": "0" }),
      el("w:lvlOverride", { "w:ilvl": "5" }, [
        el("w:startOverride", { "w:val": "9" }),
      ]),
    ]);
    const definitions = readNumberingDefinitions(
      packageWithNumbering([abstractNum, num]),
    );
    expect(Object.keys(definitions["8"]?.levels ?? {})).toEqual(["0"]);
  });
});

describe("buildNumberingElement", () => {
  it("returns undefined for an empty definitions record, rather than an empty w:numbering element", () => {
    expect(buildNumberingElement({})).toBeUndefined();
  });

  it("round-trips a multi-level, multi-numId definitions record through readNumberingDefinitions", () => {
    const definitions = {
      "1": {
        levels: {
          "0": { format: "bullet", text: "•", startAt: 1 },
          "1": { format: "decimal", text: "%2.", startAt: 1, restart: 1 },
        },
      },
      "5": {
        levels: { "0": { format: "lowerRoman", text: "%1)", startAt: 3 } },
      },
    };
    const element = buildNumberingElement(definitions);
    expect(element).toBeDefined();
    const written = packageWithNumbering(
      element === undefined
        ? []
        : element.children.filter(
            (child): child is XmlElement => child.type === "element",
          ),
    );
    expect(readNumberingDefinitions(written)).toEqual(definitions);
  });

  it("declares the WordprocessingML namespace on its own root element", () => {
    const element = buildNumberingElement({
      "1": { levels: { "0": { format: "decimal", text: "%1.", startAt: 1 } } },
    });
    expect(element?.tag).toBe("w:numbering");
    expect(element?.attributes).toEqual([
      {
        name: "xmlns:w",
        value: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
      },
    ]);
  });

  it("orders a definition's own levels NUMERICALLY by ilvl, not lexicographically (ilvl '10' sorts after '2', not before it)", () => {
    const definitions = {
      "1": {
        levels: {
          "10": { format: "decimal", text: "%2.", startAt: 1 },
          "2": { format: "decimal", text: "%1.", startAt: 1 },
        },
      },
    };
    const element = buildNumberingElement(definitions);
    const abstractNum = (element?.children ?? []).find(
      (child): child is XmlElement =>
        child.type === "element" && child.tag === "w:abstractNum",
    );
    const levelIlvls = (abstractNum?.children ?? [])
      .filter(
        (child): child is XmlElement =>
          child.type === "element" && child.tag === "w:lvl",
      )
      .map((child) => child.attributes.find((a) => a.name === "w:ilvl")?.value);
    expect(levelIlvls).toEqual(["2", "10"]);
  });
});
