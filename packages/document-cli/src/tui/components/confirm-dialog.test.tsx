import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vitest";
import { settle, waitForFrame } from "../test-support.js";
import { ConfirmDialog } from "./confirm-dialog.js";

describe("ConfirmDialog", () => {
  it("renders the message and the y/Enter, n/Esc hint", async () => {
    const { lastFrame } = render(
      <ConfirmDialog
        message="Discard unsaved changes?"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    const frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("Discard unsaved changes?"),
    );
    expect(frame).toContain("y / Enter to confirm, n / Esc to cancel");
  });

  it('confirms on "y"', async () => {
    const onConfirm = vi.fn();
    const { lastFrame, stdin } = render(
      <ConfirmDialog
        message="Discard unsaved changes?"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    await waitForFrame(lastFrame, (candidate) => candidate.includes("Discard"));
    stdin.write("y");
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('confirms on "Y"', async () => {
    const onConfirm = vi.fn();
    const { lastFrame, stdin } = render(
      <ConfirmDialog
        message="Discard unsaved changes?"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    await waitForFrame(lastFrame, (candidate) => candidate.includes("Discard"));
    stdin.write("Y");
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("confirms on Enter", async () => {
    const onConfirm = vi.fn();
    const { lastFrame, stdin } = render(
      <ConfirmDialog
        message="Discard unsaved changes?"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    await waitForFrame(lastFrame, (candidate) => candidate.includes("Discard"));
    stdin.write("\r");
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('cancels on "n"', async () => {
    const onCancel = vi.fn();
    const { lastFrame, stdin } = render(
      <ConfirmDialog
        message="Discard unsaved changes?"
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    );
    await waitForFrame(lastFrame, (candidate) => candidate.includes("Discard"));
    stdin.write("n");
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('cancels on "N"', async () => {
    const onCancel = vi.fn();
    const { lastFrame, stdin } = render(
      <ConfirmDialog
        message="Discard unsaved changes?"
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    );
    await waitForFrame(lastFrame, (candidate) => candidate.includes("Discard"));
    stdin.write("N");
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("cancels on Escape", async () => {
    const onCancel = vi.fn();
    const { lastFrame, stdin } = render(
      <ConfirmDialog
        message="Discard unsaved changes?"
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    );
    await waitForFrame(lastFrame, (candidate) => candidate.includes("Discard"));
    await settle();
    stdin.write("\x1B");
    await settle();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("does nothing on an unrelated key", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const { lastFrame, stdin } = render(
      <ConfirmDialog
        message="Discard unsaved changes?"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    await waitForFrame(lastFrame, (candidate) => candidate.includes("Discard"));
    stdin.write("x");
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });
});
