import { notifications } from "@mantine/notifications";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Diagnostic } from "../shared/diagnostics";
import { notifyError, notifySuccess } from "./notify";

vi.mock("@mantine/notifications", () => ({
  notifications: { show: vi.fn() },
}));

const show = vi.mocked(notifications.show);

afterEach(() => {
  show.mockClear();
});

function diagnostic(overrides: Partial<Diagnostic> = {}): Diagnostic {
  return { severity: "info", code: "x", message: "info", ...overrides };
}

describe("notifySuccess", () => {
  it("shows a plain, auto-closing teal toast when there are no diagnostics at all", () => {
    notifySuccess("Converted");
    expect(show).toHaveBeenCalledWith({
      color: "teal",
      title: "Converted",
      message: "",
      autoClose: 4000,
    });
  });

  it("shows the same plain teal toast when every diagnostic is info-severity", () => {
    notifySuccess("Converted", { diagnostics: [diagnostic(), diagnostic()] });
    expect(show).toHaveBeenCalledWith({
      color: "teal",
      title: "Converted",
      message: "",
      autoClose: 4000,
    });
  });

  it("shows a non-closing yellow toast with a review count when at least one diagnostic is a warning", () => {
    notifySuccess("Converted", {
      diagnostics: [diagnostic(), diagnostic({ severity: "warning" })],
    });
    expect(show).toHaveBeenCalledWith({
      color: "yellow",
      title: "Converted -- 1 to review",
      message: "See the details below for what changed.",
      autoClose: false,
    });
  });

  it("counts every warning-severity diagnostic, not just whether one exists", () => {
    notifySuccess("Converted", {
      diagnostics: [
        diagnostic({ severity: "warning" }),
        diagnostic({ severity: "warning" }),
        diagnostic({ severity: "warning" }),
      ],
    });
    expect(show).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Converted -- 3 to review" }),
    );
  });
});

describe("notifyError", () => {
  it("shows a real Error's own message", () => {
    notifyError("Conversion failed", new Error("boom"));
    expect(show).toHaveBeenCalledWith({
      color: "red",
      title: "Conversion failed",
      message: "boom",
      autoClose: false,
    });
  });

  it("stringifies a thrown non-Error value rather than reading a .message off it", () => {
    notifyError("Conversion failed", "a plain string reason");
    expect(show).toHaveBeenCalledWith({
      color: "red",
      title: "Conversion failed",
      message: "a plain string reason",
      autoClose: false,
    });
  });
});
