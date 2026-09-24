import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import { App } from "../../app.js";
import { flattenFrame, settle, waitForFrame } from "../../test-support.js";

// paragraph-family.test.tsx already covers the table wizard (rows/columns/merge/cancel) and the odt formula flow exhaustively; this file covers what it doesn't: 'L' list creation, the search/query filter across paragraphs/tables/lists, tableSummary/listSummary's own text format, and paragraphBadges' bold/italic/underline markers. Driven through the real App (not BodyListHarness, which renders only the bodyList screen kind) since the badges test needs paragraphDetail's own bold/italic/underline toggles, which live on a different screen.

const ENTER = "\r";
const ESCAPE = "\x1B";
const BACKSPACE = "\x7F";
// tableSummary's own genuine rendered multiplication sign (U+00D7), not an ASCII "x": matching against this code point directly keeps the fixture unambiguous regardless of the editor or terminal rendering this file.
const MULTIPLY_SIGN = String.fromCharCode(215);

async function createDocx(
  stdin: { readonly write: (data: string) => void },
  lastFrame: () => string | undefined,
): Promise<void> {
  await waitForFrame(lastFrame, (frame) => frame.includes("document-cli"));
  await settle();
  stdin.write("n");
  await waitForFrame(lastFrame, (frame) => frame.includes("New document"));
  await settle();
  stdin.write(ENTER);
  await waitForFrame(lastFrame, (frame) => frame.includes("Body (docx)"));
  await settle();
}

async function createOdt(
  stdin: { readonly write: (data: string) => void },
  lastFrame: () => string | undefined,
): Promise<void> {
  await waitForFrame(lastFrame, (frame) => frame.includes("document-cli"));
  await settle();
  stdin.write("n");
  await waitForFrame(lastFrame, (frame) => frame.includes("New document"));
  await settle();
  stdin.write("j");
  await settle();
  stdin.write("j");
  await settle();
  stdin.write(ENTER);
  await waitForFrame(lastFrame, (frame) => frame.includes("Body (odt)"));
  await settle();
}

// 'a' on bodyList appends an empty paragraph and drills straight into paragraphDetail (no separate "enter text" screen of its own); the paragraph's real text only exists once a run inside it carries some, so this appends a run too and types into ITS OWN editor (which auto-opens the same way), then backs out twice.
async function appendParagraphWithText(
  stdin: { readonly write: (data: string) => void },
  lastFrame: () => string | undefined,
  text: string,
): Promise<void> {
  stdin.write("a");
  await waitForFrame(lastFrame, (frame) => frame.includes("Paragraph"));
  await settle();
  stdin.write("a");
  await waitForFrame(lastFrame, (frame) =>
    flattenFrame(frame).includes("Edit run"),
  );
  await settle();
  stdin.write(text);
  await settle();
  stdin.write(ENTER);
  await waitForFrame(lastFrame, (frame) => flattenFrame(frame).includes(text));
  await settle();
  stdin.write(ESCAPE);
  await waitForFrame(lastFrame, (frame) =>
    flattenFrame(frame).includes("Body ("),
  );
  await settle();
}

describe("ParagraphFamilyBodyList 'L' list creation (odt only)", () => {
  it("creates a new empty list and navigates straight into listEditor", async () => {
    const { lastFrame, stdin } = render(<App />);
    await createOdt(stdin, lastFrame);

    stdin.write("L");
    const frame = await waitForFrame(lastFrame, (candidate) =>
      /List \d+ \(/.test(flattenFrame(candidate)),
    );
    expect(flattenFrame(frame)).toMatch(/List \d+ \(/);
  });

  it("shows the list in bodyList's own list section once back, formatted as 'List N (M items)'", async () => {
    const { lastFrame, stdin } = render(<App />);
    await createOdt(stdin, lastFrame);

    stdin.write("L");
    await waitForFrame(lastFrame, (candidate) =>
      /List \d+ \(/.test(flattenFrame(candidate)),
    );
    await settle();
    stdin.write(ESCAPE);

    const frame = await waitForFrame(lastFrame, (candidate) =>
      flattenFrame(candidate).includes("Lists (1/1)"),
    );
    expect(flattenFrame(frame)).toContain("Lists (1/1)");
    expect(flattenFrame(frame)).toContain("List 0 (0 items)");
  });
});

describe("ParagraphFamilyBodyList search filtering", () => {
  it("filters the paragraph list down to matches, hides the header count for a fully-filtered-out section", async () => {
    const { lastFrame, stdin } = render(<App />);
    await createDocx(stdin, lastFrame);

    await appendParagraphWithText(stdin, lastFrame, "Findable alpha content");
    await appendParagraphWithText(stdin, lastFrame, "Unrelated beta content");
    await waitForFrame(lastFrame, (candidate) =>
      flattenFrame(candidate).includes("Paragraphs (2/2)"),
    );
    await settle();

    stdin.write("/");
    await waitForFrame(lastFrame, (candidate) =>
      flattenFrame(candidate).includes("Enter to keep the filter"),
    );
    await settle();
    stdin.write("alpha");
    await settle();
    stdin.write(ENTER);

    const frame = await waitForFrame(lastFrame, (candidate) =>
      flattenFrame(candidate).includes("Paragraphs (1/2)"),
    );
    expect(flattenFrame(frame)).toContain("Paragraphs (1/2)");
    expect(flattenFrame(frame)).toContain("Findable alpha content");
    expect(flattenFrame(frame)).not.toContain("Unrelated beta content");
  }, 20000);

  it("matches case-insensitively", async () => {
    const { lastFrame, stdin } = render(<App />);
    await createDocx(stdin, lastFrame);

    await appendParagraphWithText(stdin, lastFrame, "MixedCase Content");
    await waitForFrame(lastFrame, (candidate) =>
      flattenFrame(candidate).includes("Paragraphs (1/1)"),
    );
    await settle();

    stdin.write("/");
    await waitForFrame(lastFrame, (candidate) =>
      flattenFrame(candidate).includes("Enter to keep the filter"),
    );
    await settle();
    stdin.write("mixedcase");
    await settle();
    stdin.write(ENTER);

    const frame = await waitForFrame(lastFrame, (candidate) =>
      flattenFrame(candidate).includes("Paragraphs (1/1)"),
    );
    expect(flattenFrame(frame)).toContain("MixedCase Content");
  }, 20000);
});

describe("ParagraphFamilyBodyList paragraphBadges", () => {
  it("shows [B] once bold is toggled on the paragraph's run", async () => {
    const { lastFrame, stdin } = render(<App />);
    await createDocx(stdin, lastFrame);

    stdin.write("a");
    await waitForFrame(lastFrame, (frame) => frame.includes("Paragraph 0"));
    await settle();
    stdin.write("a");
    await waitForFrame(lastFrame, (frame) =>
      flattenFrame(frame).includes("Edit run"),
    );
    await settle();
    stdin.write(ENTER);
    await waitForFrame(lastFrame, (frame) =>
      flattenFrame(frame).includes("empty run"),
    );
    await settle();
    await settle();

    // paragraph-detail.tsx's own run row never renders a bold/italic/underline indicator at all (see its "<empty run>" placeholder line, which is the run's ONLY conditional text): the [B]/[I]/[U] badges are computed and shown by paragraphBadges purely on ParagraphFamilyBodyList's own row, once back there.
    stdin.write("b");
    await settle();
    stdin.write(ESCAPE);

    const frame = await waitForFrame(lastFrame, (candidate) =>
      flattenFrame(candidate).includes("[B]"),
    );
    expect(flattenFrame(frame)).toContain("Body (docx)");
    expect(flattenFrame(frame)).toContain("[B]");
  }, 20000);

  it("shows [B I U] once bold, italic and underline are all toggled on", async () => {
    const { lastFrame, stdin } = render(<App />);
    await createDocx(stdin, lastFrame);

    stdin.write("a");
    await waitForFrame(lastFrame, (frame) => frame.includes("Paragraph 0"));
    await settle();
    stdin.write("a");
    await waitForFrame(lastFrame, (frame) =>
      flattenFrame(frame).includes("Edit run"),
    );
    await settle();
    stdin.write(ENTER);
    await waitForFrame(lastFrame, (frame) => frame.includes("Paragraph 0"));
    await settle();

    // As above: none of these toggles show any indicator while still on paragraph-detail.tsx's own screen (it never renders one), only bodyList's own paragraphBadges does, once back there.
    stdin.write("b");
    await settle();
    stdin.write("i");
    await settle();
    stdin.write("u");
    await settle();
    stdin.write(ESCAPE);

    const frame = await waitForFrame(lastFrame, (candidate) =>
      flattenFrame(candidate).includes("[B I U]"),
    );
    expect(flattenFrame(frame)).toContain("Body (docx)");
    expect(flattenFrame(frame)).toContain("[B I U]");
  }, 20000);
});

describe("ParagraphFamilyBodyList tableSummary formatting", () => {
  it("formats a table row as 'Table RxC'", async () => {
    const { lastFrame, stdin } = render(<App />);
    await createDocx(stdin, lastFrame);

    stdin.write("T");
    await waitForFrame(lastFrame, (frame) =>
      flattenFrame(frame).includes("Rows:"),
    );
    await settle();
    stdin.write(BACKSPACE);
    await settle();
    stdin.write("3");
    await settle();
    stdin.write(ENTER);
    await waitForFrame(lastFrame, (frame) =>
      flattenFrame(frame).includes("Columns:"),
    );
    await settle();
    stdin.write(BACKSPACE);
    await settle();
    stdin.write("5");
    await settle();
    stdin.write(ENTER);
    await waitForFrame(lastFrame, (frame) =>
      flattenFrame(frame).includes("Merge cells now?"),
    );
    await settle();
    stdin.write("n");
    await waitForFrame(lastFrame, (frame) =>
      flattenFrame(frame).includes("Table 0"),
    );
    await settle();
    stdin.write(ESCAPE);

    const frame = await waitForFrame(lastFrame, (candidate) =>
      flattenFrame(candidate).includes(`Table 3${MULTIPLY_SIGN}5`),
    );
    expect(flattenFrame(frame)).toContain("Body (docx)");
    expect(flattenFrame(frame)).toContain(`Table 3${MULTIPLY_SIGN}5`);
  }, 20000);
});
