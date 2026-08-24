import { describe, expect, it } from "vitest";
import { el, txt } from "./fragment";

describe("xml/fragment", () => {
  it("el() builds an XmlElement literal with attributes in insertion order", () => {
    expect(el("w:r", { "w:id": "1" }, [txt("hi")])).toEqual({
      type: "element",
      tag: "w:r",
      attributes: [{ name: "w:id", value: "1" }],
      children: [{ type: "text", value: "hi" }],
    });
  });

  it("el() defaults to no attributes and no children", () => {
    expect(el("w:br")).toEqual({
      type: "element",
      tag: "w:br",
      attributes: [],
      children: [],
    });
  });

  it("txt() builds an XmlText literal", () => {
    expect(txt("Hi")).toEqual({ type: "text", value: "Hi" });
  });
});
