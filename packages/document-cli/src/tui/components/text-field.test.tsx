import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vitest";
import { settle } from "../test-support.js";
import { TextField } from "./text-field.js";

describe("TextField", () => {
  it("calls onCancel on Escape while focused", async () => {
    const onCancel = vi.fn();
    render(
      <TextField
        value=""
        isFocused
        onChange={() => undefined}
        onSubmit={() => undefined}
        onCancel={onCancel}
      />,
    ).stdin.write("\x1B");
    await settle();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("ignores Escape while not focused, leaving onCancel uncalled", async () => {
    const onCancel = vi.fn();
    render(
      <TextField
        value=""
        isFocused={false}
        onChange={() => undefined}
        onSubmit={() => undefined}
        onCancel={onCancel}
      />,
    ).stdin.write("\x1B");
    await settle();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("renders the given value and placeholder through the underlying text input", () => {
    const { lastFrame } = render(
      <TextField
        value="hello"
        isFocused
        placeholder="type here"
        onChange={() => undefined}
        onSubmit={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(lastFrame()).toContain("hello");
  });
});
