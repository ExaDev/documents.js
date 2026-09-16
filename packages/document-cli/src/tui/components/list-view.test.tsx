import { Text } from "ink";
import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import { ListView, selectedColor } from "./list-view.js";

describe("selectedColor", () => {
  it("returns cyan when selected", () => {
    expect(selectedColor(true)).toBe("cyan");
  });

  it("returns undefined when not selected", () => {
    expect(selectedColor(false)).toBeUndefined();
  });
});

describe("ListView", () => {
  it("renders the empty message and nothing else when there are no items", () => {
    const { lastFrame } = render(
      <ListView<string>
        items={[]}
        selectedIndex={0}
        emptyMessage="nothing here"
        renderItem={(item) => <Text>{item}</Text>}
      />,
    );
    expect(lastFrame()).toContain("nothing here");
  });

  it("marks only the item at selectedIndex as selected, not its neighbours", () => {
    const calls: { item: string; isSelected: boolean }[] = [];
    render(
      <ListView<string>
        items={["a", "b", "c", "d"]}
        selectedIndex={2}
        renderItem={(item, isSelected) => {
          calls.push({ item, isSelected });
          return <Text>{item}</Text>;
        }}
      />,
    );
    expect(calls).toEqual([
      { item: "a", isSelected: false },
      { item: "b", isSelected: false },
      { item: "c", isSelected: true },
      { item: "d", isSelected: false },
    ]);
  });

  it("windows the list to reservedRows-derived viewportRows, clamping the start so the selected item's own window never runs past the list's own end", () => {
    // rows=24 (ink-testing-library's own fixed default) minus reservedRows=20 leaves a 4-row viewport. With selectedIndex at the very last item (9), an unclamped centring would start the window at 7 (9 - floor(4/2)), which would overrun the list; clamping must instead pin it to items.length - viewportRows = 6, so the window is exactly the last four items.
    const items = Array.from({ length: 10 }, (_, index) => `item${index}`);
    const { lastFrame } = render(
      <ListView<string>
        items={items}
        selectedIndex={9}
        reservedRows={20}
        renderItem={(item) => <Text>{item}</Text>}
      />,
    );
    const frame = lastFrame() ?? "";
    for (const visible of ["item6", "item7", "item8", "item9"]) {
      expect(frame).toContain(visible);
    }
    for (const hidden of [
      "item0",
      "item1",
      "item2",
      "item3",
      "item4",
      "item5",
    ]) {
      expect(frame).not.toContain(hidden);
    }
  });
});
