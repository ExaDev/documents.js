import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { render } from "ink-testing-library";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { App } from "../../../app.js";
import {
  flattenFrame,
  settle as appSettle,
  waitForFrame,
} from "../../../test-support.js";
import { OdgHarness } from "./test-support.js";

// page-detail.test.tsx already covers the "empty page" and "open the add-item kind menu" cases; this file covers what it doesn't: all six addable item kinds' own field-by-field walk and their own applyAddKind dispatch (including the image kind's format-inference success/failure and file-read success/failure branches), previewText's truncation, describeItem's vector-versus-shape branches, the search/select/back navigation, and the "N items" pluralisation in the header.

const ENTER = "\r";
const ESCAPE = "\x1B";
const BACKSPACE = "\x7F";
const EFFECT_SETTLE_MS = 50;
// The header's own genuine rendered em dash (U+2014), not a source-code dash substitute: matching against this code point directly keeps the fixture unambiguous regardless of the editor or terminal rendering this file.
const EM_DASH = String.fromCharCode(8212);

async function settle(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, EFFECT_SETTLE_MS);
  });
}

// The rows/columns/etc. TextFields all start pre-filled with their own default value and the cursor at the end, so typing a value first needs one backspace per character of that default to clear it, matching this codebase's own established pattern (see paragraph-family.test.tsx's own replaceField).
// ink-text-input keeps its own internal cursor position across a FieldWizard's field transitions (the same <TextField> element stays mounted; only its `value` prop swaps), so a fresh field's cursor is wherever the PREVIOUS field's editing session left it, clamped to the new default's length, not reliably at the end. A generous run of right-arrow presses first forces the cursor to the true end regardless of where it started, then a generous run of backspaces clears the whole default from there; both counts are fixed safety margins, never derived from the field's own default length, since a further arrow-press or backspace on an already-at-the-boundary field is a no-op.
const RIGHT_ARROW = "\x1B[C";
const SAFETY_PRESSES = 20;
async function replaceField(
  stdin: { readonly write: (data: string) => void },
  value: string,
): Promise<void> {
  for (let step = 0; step < SAFETY_PRESSES; step += 1) {
    stdin.write(RIGHT_ARROW);
    await settle();
  }
  for (let step = 0; step < SAFETY_PRESSES; step += 1) {
    stdin.write(BACKSPACE);
    await settle();
  }
  stdin.write(value);
  await settle();
}

async function navigateToPageDetail(
  stdin: { readonly write: (data: string) => void },
  lastFrame: () => string | undefined,
): Promise<void> {
  await vi.waitFor(() => {
    expect(lastFrame()).toContain("top:pageList");
  });
  await settle();

  stdin.write("a");
  await vi.waitFor(() => {
    expect(lastFrame()).toContain("Page 1");
  });

  stdin.write(ENTER);
  await vi.waitFor(() => {
    expect(lastFrame()).toContain("top:pageDetail");
  });
  await settle();
}

// Opens the add-item menu and selects the Nth kind (0-indexed, matching ADD_KIND_OPTIONS' own order: rect, ellipse, line, path, textbox, image).
async function openAddKind(
  stdin: { readonly write: (data: string) => void },
  lastFrame: () => string | undefined,
  index: number,
): Promise<void> {
  stdin.write("a");
  await vi.waitFor(() => {
    expect(lastFrame()).toContain("Add item");
  });
  await settle();
  for (let step = 0; step < index; step += 1) {
    stdin.write("j");
    await settle();
  }
  stdin.write(ENTER);
  await settle();
}

// OdgHarness deliberately omits StatusLine and the global overlay/search key handlers (see its own comment: it only routes pageList/pageDetail/shapeOrVectorDetail), so a SET_STATUS warning/error and the SearchOverlay's own "/" flow are both invisible through it. The three tests below that need either one use the real App instead, walking from the launcher exactly as a real user would: 'n', down 5 times to select odg (CREATABLE_FORMATS' own order), Enter to create, 'a' to add a page, Enter to open it.
async function navigateAppToOdgPageDetail(
  stdin: { readonly write: (data: string) => void },
  lastFrame: () => string | undefined,
): Promise<void> {
  await waitForFrame(lastFrame, (frame) => frame.includes("document-cli"));
  await appSettle();
  stdin.write("n");
  await waitForFrame(lastFrame, (frame) => frame.includes("New document"));
  await appSettle();
  for (let step = 0; step < 5; step += 1) {
    stdin.write("j");
    await appSettle();
  }
  stdin.write(ENTER);
  await waitForFrame(lastFrame, (frame) => frame.includes("New odg document"));
  await appSettle();
  stdin.write("a");
  await waitForFrame(lastFrame, (frame) =>
    flattenFrame(frame).includes("Drawing pages (1)"),
  );
  await appSettle();
  stdin.write(ENTER);
  await waitForFrame(lastFrame, (frame) =>
    /Page 1 . 0 items?/.test(flattenFrame(frame)),
  );
  await appSettle();
}

describe("OdgPageDetailScreen add-item kinds", () => {
  it("adds a rectangle with the default field values", async () => {
    const { lastFrame, stdin } = render(<OdgHarness />);
    await navigateToPageDetail(stdin, lastFrame);
    await openAddKind(stdin, lastFrame, 0);

    for (let step = 0; step < 6; step += 1) {
      stdin.write(ENTER);
      await settle();
    }
    const frame = await vi.waitFor(() => {
      const current = lastFrame();
      expect(current).toContain(`Page 1 ${EM_DASH} 1 item`);
      return current;
    });
    expect(frame).toContain("Rect");
    expect(frame).toContain("40.0,40.0 160.0x100.0pt");
  });

  it("adds an ellipse with a custom fill and no stroke", async () => {
    const { lastFrame, stdin } = render(<OdgHarness />);
    await navigateToPageDetail(stdin, lastFrame);
    await openAddKind(stdin, lastFrame, 1);

    for (let step = 0; step < 4; step += 1) {
      stdin.write(ENTER);
      await settle();
    }
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Fill "r g b"');
    });
    await replaceField(stdin, "1 0 0");
    stdin.write(ENTER);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Stroke "r g b widthPt"');
    });
    await replaceField(stdin, "");
    stdin.write(ENTER);

    const frame = await vi.waitFor(() => {
      const current = lastFrame();
      expect(current).toContain(`Page 1 ${EM_DASH} 1 item`);
      return current;
    });
    expect(frame).toContain("Ellipse");
    expect(frame).toContain("rgb(1.00, 0.00, 0.00)");
    expect(frame).not.toContain("Stroke:");
  });

  it("adds a line between two custom points", async () => {
    const { lastFrame, stdin } = render(<OdgHarness />);
    await navigateToPageDetail(stdin, lastFrame);
    await openAddKind(stdin, lastFrame, 2);

    await vi.waitFor(() => {
      expect(lastFrame()).toContain("From X (pt)");
    });
    await replaceField(stdin, "10");
    stdin.write(ENTER);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("From Y (pt)");
    });
    await replaceField(stdin, "20");
    stdin.write(ENTER);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("To X (pt)");
    });
    stdin.write(ENTER);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("To Y (pt)");
    });
    stdin.write(ENTER);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Stroke "r g b widthPt"');
    });
    stdin.write(ENTER);

    const frame = await vi.waitFor(() => {
      const current = lastFrame();
      expect(current).toContain(`Page 1 ${EM_DASH} 1 item`);
      return current;
    });
    expect(frame).toContain("Line");
    expect(frame).toContain("10.0,20.0");
  });

  it("adds a path (fixed triangle) with the default field values", async () => {
    const { lastFrame, stdin } = render(<OdgHarness />);
    await navigateToPageDetail(stdin, lastFrame);
    await openAddKind(stdin, lastFrame, 3);

    for (let step = 0; step < 6; step += 1) {
      stdin.write(ENTER);
      await settle();
    }
    const frame = await vi.waitFor(() => {
      const current = lastFrame();
      expect(current).toContain(`Page 1 ${EM_DASH} 1 item`);
      return current;
    });
    expect(frame).toContain("Path");
  });

  it("adds a text box with custom text", async () => {
    const { lastFrame, stdin } = render(<OdgHarness />);
    await navigateToPageDetail(stdin, lastFrame);
    await openAddKind(stdin, lastFrame, 4);

    for (let step = 0; step < 4; step += 1) {
      stdin.write(ENTER);
      await settle();
    }
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("Text");
    });
    await replaceField(stdin, "Hello from a fixture");
    stdin.write(ENTER);

    const frame = await vi.waitFor(() => {
      const current = lastFrame();
      expect(current).toContain(`Page 1 ${EM_DASH} 1 item`);
      return current;
    });
    expect(frame).toContain("Hello from a fixture");
  });

  it("truncates a text box's own preview past 40 characters with an ellipsis", async () => {
    const { lastFrame, stdin } = render(<OdgHarness />);
    await navigateToPageDetail(stdin, lastFrame);
    await openAddKind(stdin, lastFrame, 4);

    for (let step = 0; step < 4; step += 1) {
      stdin.write(ENTER);
      await settle();
    }
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("Text");
    });
    const longText =
      "This is a genuinely long piece of text that runs well past forty characters on its own";
    await replaceField(stdin, longText);
    stdin.write(ENTER);

    const frame = await vi.waitFor(() => {
      const current = lastFrame();
      expect(current).toContain(`Page 1 ${EM_DASH} 1 item`);
      return current;
    });
    expect(frame).toContain(`${longText.slice(0, 40)}…`);
    expect(frame).not.toContain(longText);
  });

  it("warns and does not add an image when the path has no .png/.jpg/.jpeg extension", async () => {
    const { lastFrame, stdin } = render(<App />);
    await navigateAppToOdgPageDetail(stdin, lastFrame);
    await openAddKind(stdin, lastFrame, 5);

    for (let step = 0; step < 4; step += 1) {
      stdin.write(ENTER);
      await settle();
    }
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("Image file path");
    });
    stdin.write(ENTER);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("Alt text");
    });
    stdin.write(ENTER);

    const frame = await vi.waitFor(() => {
      const current = lastFrame();
      expect(current).toContain("is not a .png or .jpg/.jpeg file");
      return current;
    });
    expect(frame).toContain("image not added");
    expect(frame).toContain("No items yet");
  }, 20000);

  describe("with a real image file on disk", () => {
    let workspace: string;
    let imagePath: string;
    const PNG_BYTES = new Uint8Array(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
        "base64",
      ),
    );

    beforeAll(async () => {
      workspace = await mkdtemp(
        join(tmpdir(), "document-cli-odg-page-detail-image-"),
      );
      imagePath = join(workspace, "fixture.png");
      await writeFile(imagePath, PNG_BYTES);
    });

    afterAll(async () => {
      await rm(workspace, { recursive: true, force: true });
    });

    it("adds an image with alt text when the file reads successfully", async () => {
      const { lastFrame, stdin } = render(<OdgHarness />);
      await navigateToPageDetail(stdin, lastFrame);
      await openAddKind(stdin, lastFrame, 5);

      for (let step = 0; step < 4; step += 1) {
        stdin.write(ENTER);
        await settle();
      }
      await vi.waitFor(() => {
        expect(lastFrame()).toContain("Image file path");
      });
      stdin.write(imagePath);
      await settle();
      stdin.write(ENTER);
      await vi.waitFor(() => {
        expect(lastFrame()).toContain("Alt text");
      });
      stdin.write("A fixture logo");
      await settle();
      stdin.write(ENTER);

      const frame = await vi.waitFor(() => {
        const current = lastFrame();
        expect(current).toContain(`Page 1 ${EM_DASH} 1 item`);
        return current;
      });
      expect(frame).toContain("Image");
    });

    it("reports an error and does not add an image when the file cannot be read", async () => {
      const { lastFrame, stdin } = render(<App />);
      await navigateAppToOdgPageDetail(stdin, lastFrame);
      await openAddKind(stdin, lastFrame, 5);

      for (let step = 0; step < 4; step += 1) {
        stdin.write(ENTER);
        await settle();
      }
      await vi.waitFor(() => {
        expect(lastFrame()).toContain("Image file path");
      });
      stdin.write(join(workspace, "does-not-exist.png"));
      await settle();
      stdin.write(ENTER);
      await vi.waitFor(() => {
        expect(lastFrame()).toContain("Alt text");
      });
      stdin.write(ENTER);

      const frame = await vi.waitFor(() => {
        const current = lastFrame();
        expect(current).toContain("Could not read");
        return current;
      });
      expect(frame).toContain("No items yet");
    }, 20000);
  });
});

describe("OdgPageDetailScreen list navigation", () => {
  it("filters items by the current search query", async () => {
    const { lastFrame, stdin } = render(<App />);
    await navigateAppToOdgPageDetail(stdin, lastFrame);
    await openAddKind(stdin, lastFrame, 4);
    for (let step = 0; step < 4; step += 1) {
      stdin.write(ENTER);
      await settle();
    }
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("Text");
    });
    await replaceField(stdin, "Findable box");
    stdin.write(ENTER);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain(`Page 1 ${EM_DASH} 1 item`);
    });
    await settle();

    stdin.write("/");
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("Enter to keep the filter");
    });
    await settle();
    stdin.write("nomatch");
    await settle();
    stdin.write(ENTER);

    const emptyFrame = await vi.waitFor(() => {
      const current = lastFrame();
      expect(current).toContain(`Page 1 ${EM_DASH} 1 item`);
      return current;
    });
    expect(emptyFrame).toContain("No items yet");
    expect(emptyFrame).not.toContain("Findable box");
  }, 20000);

  it("pops back to pageList on Esc from an empty page", async () => {
    const { lastFrame, stdin } = render(<OdgHarness />);
    await navigateToPageDetail(stdin, lastFrame);

    stdin.write(ESCAPE);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("top:pageList");
    });
    expect(lastFrame()).toContain("top:pageList");
  });

  it("selects an item with Enter and navigates to shapeOrVectorDetail", async () => {
    const { lastFrame, stdin } = render(<OdgHarness />);
    await navigateToPageDetail(stdin, lastFrame);
    await openAddKind(stdin, lastFrame, 0);
    for (let step = 0; step < 6; step += 1) {
      stdin.write(ENTER);
      await settle();
    }
    await vi.waitFor(() => {
      expect(lastFrame()).toContain(`Page 1 ${EM_DASH} 1 item`);
    });
    await settle();

    stdin.write(ENTER);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("top:shapeOrVectorDetail");
    });
    expect(lastFrame()).toContain("top:shapeOrVectorDetail");
  });

  it("cancels the add-item kind menu on Esc without adding anything", async () => {
    const { lastFrame, stdin } = render(<OdgHarness />);
    await navigateToPageDetail(stdin, lastFrame);

    stdin.write("a");
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("Add item");
    });
    await settle();
    stdin.write(ESCAPE);

    const frame = await vi.waitFor(() => {
      const current = lastFrame();
      expect(current).toContain("Page 1");
      return current;
    });
    expect(frame).toContain("No items yet");
    expect(frame).not.toContain("Add item");
  });

  it("shows plural 'items' in the header once a second item is added", async () => {
    const { lastFrame, stdin } = render(<OdgHarness />);
    await navigateToPageDetail(stdin, lastFrame);
    await openAddKind(stdin, lastFrame, 0);
    for (let step = 0; step < 6; step += 1) {
      stdin.write(ENTER);
      await settle();
    }
    await vi.waitFor(() => {
      expect(lastFrame()).toContain(`Page 1 ${EM_DASH} 1 item`);
    });
    await settle();

    await openAddKind(stdin, lastFrame, 1);
    for (let step = 0; step < 6; step += 1) {
      stdin.write(ENTER);
      await settle();
    }
    const frame = await vi.waitFor(() => {
      const current = lastFrame();
      expect(current).toContain(`Page 1 ${EM_DASH} 2 items`);
      return current;
    });
    expect(frame).toContain(`Page 1 ${EM_DASH} 2 items`);
  });
});
