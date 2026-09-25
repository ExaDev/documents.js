import { describe, expect, it } from "vitest";
import type { DefinitionEntry } from "document-schema.js";
import { el } from "../../xml/fragment";
import {} from "./constructs";
import {} from "./constructs-markers";
import {
  collectOdfDataStyleDefinitions,
  collectOdfFieldMasterDefinitions,
  collectOdfFontFaceDefinitions,
  collectOdfNamedExpressions,
} from "./constructs-definitions";

// Every fixture here is a programmatic package/element built with el/txt, matching the sibling odt/constructs.test.ts's own fixture-gate convention.

describe("collectOdfFieldMasterDefinitions (readOdfFieldMasterEntry)", () => {
  it("skips a declaration with no text:name at all", () => {
    const out: Record<string, DefinitionEntry> = {};
    collectOdfFieldMasterDefinitions(
      [el("text:variable-decls", {}, [el("text:variable-decl", {})])],
      out,
    );
    expect(out).toEqual({});
  });

  it("carries no valueType/value/stringValue/formula when their attributes are absent", () => {
    const out: Record<string, DefinitionEntry> = {};
    collectOdfFieldMasterDefinitions(
      [
        el("text:variable-decls", {}, [
          el("text:variable-decl", { "text:name": "v1" }),
        ]),
      ],
      out,
    );
    const entry = out["variable:v1"];
    expect(entry).not.toHaveProperty("valueType");
    expect(entry).not.toHaveProperty("value");
    expect(entry).not.toHaveProperty("stringValue");
    expect(entry).not.toHaveProperty("formula");
  });

  it("reads office:string-value specifically, not some other attribute", () => {
    const out: Record<string, DefinitionEntry> = {};
    collectOdfFieldMasterDefinitions(
      [
        el("text:variable-decls", {}, [
          el("text:variable-decl", {
            "text:name": "v1",
            "office:string-value": "hello",
          }),
        ]),
      ],
      out,
    );
    expect(out["variable:v1"]?.stringValue).toBe("hello");
  });

  it("omits displayOutlineLevel for a negative value", () => {
    const out: Record<string, DefinitionEntry> = {};
    collectOdfFieldMasterDefinitions(
      [
        el("text:sequence-decls", {}, [
          el("text:sequence-decl", {
            "text:name": "s1",
            "text:display-outline-level": "-1",
          }),
        ]),
      ],
      out,
    );
    expect(out["sequence:s1"]).not.toHaveProperty("displayOutlineLevel");
  });

  it("keeps displayOutlineLevel for a valid non-negative integer", () => {
    const out: Record<string, DefinitionEntry> = {};
    collectOdfFieldMasterDefinitions(
      [
        el("text:sequence-decls", {}, [
          el("text:sequence-decl", {
            "text:name": "s1",
            "text:display-outline-level": "2",
          }),
        ]),
      ],
      out,
    );
    expect(out["sequence:s1"]).toHaveProperty("displayOutlineLevel", 2);
  });
});

describe("collectOdfDataStyleDefinitions", () => {
  it("skips a data style element with no style:name", () => {
    const out: Record<string, DefinitionEntry> = {};
    collectOdfDataStyleDefinitions([el("number:date-style", {})], out);
    expect(out).toEqual({});
  });
});

describe("collectOdfFontFaceDefinitions", () => {
  it("skips a font face with a name but no font family", () => {
    const out: Record<string, DefinitionEntry> = {};
    collectOdfFontFaceDefinitions(
      [el("style:font-face", { "style:name": "F1" })],
      out,
    );
    expect(out).toEqual({});
  });

  it("skips a font face with a font family but no name", () => {
    const out: Record<string, DefinitionEntry> = {};
    collectOdfFontFaceDefinitions(
      [el("style:font-face", { "svg:font-family": "Arial" })],
      out,
    );
    expect(out).toEqual({});
  });

  it("carries no familyGeneric/pitch when their attributes are absent", () => {
    const out: Record<string, DefinitionEntry> = {};
    collectOdfFontFaceDefinitions(
      [
        el("style:font-face", {
          "style:name": "F1",
          "svg:font-family": "Arial",
        }),
      ],
      out,
    );
    const entry = out["fontFace:F1"];
    expect(entry).not.toHaveProperty("familyGeneric");
    expect(entry).not.toHaveProperty("pitch");
  });
});

describe("collectOdfNamedExpressions", () => {
  it("skips a child with no table:name, even though it is otherwise complete enough to mint an entry", () => {
    // table:cell-range-address is present so a bypassed name guard would actually reach out[...] = entry, rather than being masked by the inner "no cell-range-address" guard further down.
    const out: Record<string, DefinitionEntry> = {};
    collectOdfNamedExpressions(
      [
        el("table:named-expressions", {}, [
          el("table:named-range", { "table:cell-range-address": "$A$1:$A$2" }),
        ]),
      ],
      out,
    );
    expect(out).toEqual({});
  });

  it("skips a named-range with no table:cell-range-address", () => {
    const out: Record<string, DefinitionEntry> = {};
    collectOdfNamedExpressions(
      [
        el("table:named-expressions", {}, [
          el("table:named-range", { "table:name": "n1" }),
        ]),
      ],
      out,
    );
    expect(out).toEqual({});
  });

  it("carries no baseCellAddress for a named-range when it is absent", () => {
    const out: Record<string, DefinitionEntry> = {};
    collectOdfNamedExpressions(
      [
        el("table:named-expressions", {}, [
          el("table:named-range", {
            "table:name": "n1",
            "table:cell-range-address": "$A$1:$A$2",
          }),
        ]),
      ],
      out,
    );
    expect(out["named-range:n1"]).not.toHaveProperty("baseCellAddress");
  });

  it("carries baseCellAddress for a named-range when present", () => {
    const out: Record<string, DefinitionEntry> = {};
    collectOdfNamedExpressions(
      [
        el("table:named-expressions", {}, [
          el("table:named-range", {
            "table:name": "n1",
            "table:cell-range-address": "$A$1:$A$2",
            "table:base-cell-address": "$A$1",
          }),
        ]),
      ],
      out,
    );
    expect(out["named-range:n1"]?.baseCellAddress).toBe("$A$1");
  });

  it("does not treat a child of neither known tag as a named-expression even when it carries an expression attribute", () => {
    const out: Record<string, DefinitionEntry> = {};
    collectOdfNamedExpressions(
      [
        el("table:named-expressions", {}, [
          el("table:not-a-real-tag", {
            "table:name": "n1",
            "table:expression": "1+1",
          }),
        ]),
      ],
      out,
    );
    expect(out).toEqual({});
  });

  it("carries no baseCellAddress for a named-expression when it is absent", () => {
    const out: Record<string, DefinitionEntry> = {};
    collectOdfNamedExpressions(
      [
        el("table:named-expressions", {}, [
          el("table:named-expression", {
            "table:name": "e1",
            "table:expression": "1+1",
          }),
        ]),
      ],
      out,
    );
    expect(out["named-expression:e1"]).not.toHaveProperty("baseCellAddress");
  });

  it("skips a named-expression with no table:expression", () => {
    const out: Record<string, DefinitionEntry> = {};
    collectOdfNamedExpressions(
      [
        el("table:named-expressions", {}, [
          el("table:named-expression", { "table:name": "e1" }),
        ]),
      ],
      out,
    );
    expect(out).toEqual({});
  });

  it("carries baseCellAddress for a named-expression when present", () => {
    const out: Record<string, DefinitionEntry> = {};
    collectOdfNamedExpressions(
      [
        el("table:named-expressions", {}, [
          el("table:named-expression", {
            "table:name": "e1",
            "table:expression": "1+1",
            "table:base-cell-address": "$A$1",
          }),
        ]),
      ],
      out,
    );
    expect(out["named-expression:e1"]?.baseCellAddress).toBe("$A$1");
  });
});
