import { Text } from "ink";
import { render } from "ink-testing-library";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { settle } from "../test-support.js";
import { useNavigationInput } from "./use-navigation-input.js";

function Harness(props: {
  readonly itemCount: number;
  readonly onSelect: (index: number) => void;
  readonly onBack: () => void;
  readonly onAppend?: () => void;
}): ReactElement {
  const { selectedIndex } = useNavigationInput({
    itemCount: props.itemCount,
    onSelect: props.onSelect,
    onBack: props.onBack,
    onAppend: props.onAppend,
    isActive: true,
  });
  return <Text>selected:{selectedIndex}</Text>;
}

async function pressKey(
  stdin: { readonly write: (data: string) => void },
  key: string,
): Promise<void> {
  await settle();
  stdin.write(key);
  await settle();
}

const UP = "[A";
const DOWN = "[B";
const PAGE_UP = "[5~";
const PAGE_DOWN = "[6~";
const HOME = "[H";
const END = "[F";
const ESCAPE = "";
const ENTER = "\r";
const RIGHT = "[C";
const LEFT = "[D";

describe("useNavigationInput", () => {
  it("moves the selection down with the down arrow or 'j'", async () => {
    const { lastFrame, stdin } = render(
      <Harness
        itemCount={5}
        onSelect={() => undefined}
        onBack={() => undefined}
      />,
    );
    await pressKey(stdin, DOWN);
    expect(lastFrame()).toContain("selected:1");
    await pressKey(stdin, "j");
    expect(lastFrame()).toContain("selected:2");
  });

  it("moves the selection up with the up arrow or 'k'", async () => {
    const { lastFrame, stdin } = render(
      <Harness
        itemCount={5}
        onSelect={() => undefined}
        onBack={() => undefined}
      />,
    );
    await pressKey(stdin, DOWN);
    await pressKey(stdin, DOWN);
    await pressKey(stdin, UP);
    expect(lastFrame()).toContain("selected:1");
    await pressKey(stdin, "k");
    expect(lastFrame()).toContain("selected:0");
  });

  it("clamps at zero: up from the first item stays put", async () => {
    const { lastFrame, stdin } = render(
      <Harness
        itemCount={5}
        onSelect={() => undefined}
        onBack={() => undefined}
      />,
    );
    await pressKey(stdin, UP);
    expect(lastFrame()).toContain("selected:0");
  });

  it("clamps at the last index: down from the last item stays put", async () => {
    const { lastFrame, stdin } = render(
      <Harness
        itemCount={2}
        onSelect={() => undefined}
        onBack={() => undefined}
      />,
    );
    await pressKey(stdin, DOWN);
    await pressKey(stdin, DOWN);
    await pressKey(stdin, DOWN);
    expect(lastFrame()).toContain("selected:1");
  });

  it("jumps a page at a time with PageUp/PageDown, clamped to the list bounds", async () => {
    const { lastFrame, stdin } = render(
      <Harness
        itemCount={20}
        onSelect={() => undefined}
        onBack={() => undefined}
      />,
    );
    await pressKey(stdin, PAGE_DOWN);
    expect(lastFrame()).toContain("selected:10");
    await pressKey(stdin, PAGE_UP);
    expect(lastFrame()).toContain("selected:0");
  });

  it("jumps to the first item with Home and the last with End", async () => {
    const { lastFrame, stdin } = render(
      <Harness
        itemCount={5}
        onSelect={() => undefined}
        onBack={() => undefined}
      />,
    );
    await pressKey(stdin, END);
    expect(lastFrame()).toContain("selected:4");
    await pressKey(stdin, HOME);
    expect(lastFrame()).toContain("selected:0");
  });

  it("calls onBack on Escape, left arrow, or 'h'", async () => {
    const onBack = vi.fn();
    const { stdin } = render(
      <Harness itemCount={5} onSelect={() => undefined} onBack={onBack} />,
    );
    await pressKey(stdin, ESCAPE);
    expect(onBack).toHaveBeenCalledTimes(1);
    await pressKey(stdin, LEFT);
    expect(onBack).toHaveBeenCalledTimes(2);
    await pressKey(stdin, "h");
    expect(onBack).toHaveBeenCalledTimes(3);
  });

  it("calls onSelect with the current index on Enter, right arrow, or 'l'", async () => {
    const onSelect = vi.fn();
    const { stdin } = render(
      <Harness itemCount={5} onSelect={onSelect} onBack={() => undefined} />,
    );
    await pressKey(stdin, DOWN);
    await pressKey(stdin, ENTER);
    expect(onSelect).toHaveBeenCalledWith(1);
    await pressKey(stdin, RIGHT);
    expect(onSelect).toHaveBeenCalledTimes(2);
    await pressKey(stdin, "l");
    expect(onSelect).toHaveBeenCalledTimes(3);
  });

  it("never calls onSelect when the list is empty", async () => {
    const onSelect = vi.fn();
    const { stdin } = render(
      <Harness itemCount={0} onSelect={onSelect} onBack={() => undefined} />,
    );
    await pressKey(stdin, ENTER);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("calls onAppend on 'a' when provided", async () => {
    const onAppend = vi.fn();
    const { stdin } = render(
      <Harness
        itemCount={5}
        onSelect={() => undefined}
        onBack={() => undefined}
        onAppend={onAppend}
      />,
    );
    await pressKey(stdin, "a");
    expect(onAppend).toHaveBeenCalledTimes(1);
  });

  it("does not throw on 'a' when onAppend is not provided", async () => {
    const { stdin } = render(
      <Harness
        itemCount={5}
        onSelect={() => undefined}
        onBack={() => undefined}
      />,
    );
    await pressKey(stdin, "a");
  });
});
