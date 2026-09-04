import { describe, expect, it } from "vitest";

import { toTreeData } from "./jsonTree";

describe("toTreeData", () => {
  it("renders each object key as its own node, with a primitive leaf inline in the label", () => {
    const nodes = toTreeData({ title: "Report", pageCount: 3, ok: true });
    expect(nodes).toEqual([
      { value: "root.title", label: 'title: "Report"', children: undefined },
      { value: "root.pageCount", label: "pageCount: 3", children: undefined },
      { value: "root.ok", label: "ok: true", children: undefined },
    ]);
  });

  it("renders null as a leaf, not an expandable object", () => {
    const nodes = toTreeData({ producer: null });
    expect(nodes).toEqual([
      { value: "root.producer", label: "producer: null", children: undefined },
    ]);
  });

  it("labels an array node with its length and expands into index-labeled children", () => {
    const nodes = toTreeData({ items: ["a", "b"] });
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ value: "root.items", label: "items [2]" });
    expect(nodes[0]?.children).toEqual([
      { value: "root.items[0]", label: '[0]: "a"', children: undefined },
      { value: "root.items[1]", label: '[1]: "b"', children: undefined },
    ]);
  });

  it("prefers a discriminant kind field for an array item of objects, over a bare index label", () => {
    const nodes = toTreeData({ items: [{ kind: "text", text: "hi" }] });
    const itemNode = nodes[0]?.children?.[0];
    expect(itemNode?.label).toBe("[0]: text");
    expect(itemNode?.children).toEqual([
      {
        value: "root.items[0].kind",
        label: 'kind: "text"',
        children: undefined,
      },
      { value: "root.items[0].text", label: 'text: "hi"', children: undefined },
    ]);
  });

  it("recurses through nested objects", () => {
    const nodes = toTreeData({ metadata: { title: "Report" } });
    expect(nodes[0]).toMatchObject({
      value: "root.metadata",
      label: "metadata",
    });
    expect(nodes[0]?.children).toEqual([
      {
        value: "root.metadata.title",
        label: 'title: "Report"',
        children: undefined,
      },
    ]);
  });

  it("omits children entirely for an empty object or array", () => {
    const nodes = toTreeData({ tags: [], extra: {} });
    expect(nodes[0]?.children).toBeUndefined();
    expect(nodes[1]?.children).toBeUndefined();
  });

  it("returns an empty array for a bare primitive or empty object at the root", () => {
    expect(toTreeData("just a string")).toEqual([]);
    expect(toTreeData({})).toEqual([]);
    expect(toTreeData(null)).toEqual([]);
  });

  it("truncates a leaf value longer than the cap, keeping the start so it stays identifiable", () => {
    const longBase64 = `data:image/png;base64,${"A".repeat(300)}`;
    const nodes = toTreeData({ image: longBase64 });
    const label = nodes[0]?.label as string;
    // The label is "image: " + the capped value -- the value itself is truncated to MAX_LEAF_LENGTH (100), the key prefix is not part of the cap.
    expect(label).toMatch(/…$/);
    expect(label).toContain("data:image/png;base64,");
    // No more than key + space + cap + ellipsis.
    expect(label.length).toBeLessThanOrEqual("image: ".length + 100);
  });
});
