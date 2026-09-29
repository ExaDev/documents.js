import { describe, expect, it } from "vitest";
import type { XmlElement, XmlNode } from "ooxml.js";
import { el } from "../../xml/fragment";
import {
  collectBodyParagraphs,
  collectBodyTables,
  equationFrame,
} from "./formula";

// The body-walk helpers embedded-objects.ts splices against, pinned independently of the splice: every w:p and w:tbl in the containers the upstream reader descends into, with the AlternateContent branch preference the reader itself applies.

function textNode(): XmlNode {
  return { type: "text", value: " between " };
}

function para(name: string): XmlElement {
  return el("w:p", {}, [
    el("w:r", {}, [el("w:t", {}, [{ type: "text", value: name }])]),
  ]);
}

function tbl(): XmlElement {
  return el("w:tbl", {}, [el("w:tr", {}, [el("w:tc", {}, [para("cell")])])]);
}

describe("collectBodyParagraphs", () => {
  it("collects every top-level paragraph, ignoring text nodes", () => {
    const out: XmlElement[] = [];
    collectBodyParagraphs([para("a"), textNode(), para("b")], out);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe(out[0]);
  });

  it("descends into w:sdt content, w:ins, and both AlternateContent branches", () => {
    const out: XmlElement[] = [];
    collectBodyParagraphs(
      [
        el("w:sdt", {}, [el("w:sdtContent", {}, [para("sdt")])]),
        el("w:ins", {}, [para("ins")]),
        el("mc:AlternateContent", {}, [
          el("mc:Choice", {}, [para("choice")]),
          el("mc:Fallback", {}, [para("fallback")]),
        ]),
      ],
      out,
    );
    expect(out.map((p) => p.children.length)).toHaveLength(3);
  });

  it("prefers mc:Fallback over mc:Choice, matching the upstream reader", () => {
    const out: XmlElement[] = [];
    collectBodyParagraphs(
      [
        el("mc:AlternateContent", {}, [
          el("mc:Choice", {}, [para("choice")]),
          el("mc:Fallback", {}, [para("fallback")]),
        ]),
      ],
      out,
    );
    expect(out).toHaveLength(1);
    const run = out[0]!.children[0];
    expect(
      run?.type === "element" &&
        run.children[0]?.type === "element" &&
        run.children[0].children[0]?.type === "text" &&
        run.children[0].children[0].value,
    ).toBe("fallback");
  });

  it("takes mc:Choice only when no mc:Fallback exists", () => {
    const out: XmlElement[] = [];
    collectBodyParagraphs(
      [el("mc:AlternateContent", {}, [el("mc:Choice", {}, [para("choice")])])],
      out,
    );
    expect(out).toHaveLength(1);
    const run = out[0]!.children[0];
    expect(
      run?.type === "element" &&
        run.children[0]?.type === "element" &&
        run.children[0].children[0]?.type === "text" &&
        run.children[0].children[0].value,
    ).toBe("choice");
  });
});

describe("collectBodyTables", () => {
  it("collects every table through the same wrappers the paragraph walk descends into", () => {
    const out: XmlElement[] = [];
    collectBodyTables(
      [
        tbl(),
        el("w:ins", {}, [tbl()]),
        el("mc:AlternateContent", {}, [el("mc:Fallback", {}, [tbl()])]),
      ],
      out,
    );
    expect(out.every((t) => t.tag === "w:tbl")).toBe(true);
    expect(out).toHaveLength(3);
  });
});

describe("equationFrame", () => {
  it("gives a sizeless equation Word's default body size doubled", () => {
    const equation = el("m:oMath", {}, [el("m:r", {}, [el("m:t", {}, [])])]);
    expect(equationFrame(equation)).toEqual({
      xPt: 0,
      yPt: 0,
      widthPt: 0,
      heightPt: 22,
    });
  });

  it("takes the equation's own first explicit run size, in half-points", () => {
    const equation = el("m:oMath", {}, [
      el("m:r", {}, [
        el("w:rPr", {}, [el("w:sz", { "w:val": "28" })]),
        el("m:t", {}, []),
      ]),
    ]);
    expect(equationFrame(equation).heightPt).toBe(28);
  });

  it("skips a non-numeric or non-positive size and keeps walking", () => {
    for (const bad of ["not-a-number", "0", "-4"]) {
      const equation = el("m:oMath", {}, [
        el("m:r", {}, [
          el("w:rPr", {}, [el("w:sz", { "w:val": bad })]),
          el("m:t", {}, []),
        ]),
        el("m:r", {}, [
          el("w:rPr", {}, [el("w:sz", { "w:val": "40" })]),
          el("m:t", {}, []),
        ]),
      ]);
      expect(equationFrame(equation).heightPt, bad).toBe(40);
    }
  });
});
