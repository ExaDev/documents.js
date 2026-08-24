import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  formulaOfBlock,
  readDocxContent,
  readOdtContent,
  type ContentDocument,
} from "documents.js";
import { Box, Text, useInput } from "ink";
import { render } from "ink-testing-library";
import { useEffect, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StatusLine } from "../../../components/status-line.js";
import {
  AppStateProvider,
  useAppDispatch,
  useAppState,
} from "../../../state/context.js";
import {
  currentScreen,
  type DocxOpenDocument,
  type OdtOpenDocument,
} from "../../../state/types.js";
import {
  createParagraphFamilyAdapter,
  ParagraphFamilyBodyList,
} from "../../shared/paragraph-family.js";
import { ParagraphDetailScreen } from "./paragraph-detail.js";

// A real, minimal PNG -- the signature bytes plus a few arbitrary trailing ones, matching documents.js's own edit/docx/image.test.ts fixture. insertImageAfter only stores/embeds these bytes and declares the media part's type from the caller's own explicit `format`, so a genuine 1x1 decodable pixel grid is not needed to prove the round trip.
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4,
]);

// Matching paragraph-family.test.tsx's own SETTLE_TICKS/flush pattern exactly -- this suite renders the identical ParagraphFamilyBodyList component one screen deeper (into ParagraphDetailScreen), so the same real-elapsed-time requirements around Ink's own Escape disambiguation and reconciler settling apply.
const SETTLE_TICKS = 4;
const ESCAPE_FLUSH_MARGIN_MS = 30;

async function flush(
  options: { readonly afterEscape?: boolean } = {},
): Promise<void> {
  await Array.from({ length: SETTLE_TICKS }).reduce<Promise<void>>(
    (previous) =>
      previous.then(
        () =>
          new Promise<void>((resolve) => {
            setImmediate(resolve);
          }),
      ),
    Promise.resolve(),
  );
  if (options.afterEscape === true) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, ESCAPE_FLUSH_MARGIN_MS);
    });
  }
}

const ENTER = "\r";
const BACKSPACE = "\x7F";

// Each keystroke must reach ink-text-input as its own write/flush round trip -- writing several backspaces concatenated into one stdin.write() call was empirically observed to be silently ignored, unlike paragraph-family.test.tsx's own replaceField helper, which writes a single backspace this way already. `count` clears a field's own pre-filled default (the TextField cursor starts at its end, per that file's own comment), then `value` is typed fresh and confirmed rendered (see writeAndConfirm below) before returning, so a caller's own immediately-following Enter never races the draft's own commit.
async function replaceField(
  stdin: { readonly write: (data: string) => void },
  lastFrame: () => string | undefined,
  count: number,
  value: string,
): Promise<void> {
  for (let step = 0; step < count; step += 1) {
    stdin.write(BACKSPACE);
    await flush();
  }
  stdin.write(value);
  await vi.waitFor(() => {
    expect(lastFrame()).toContain(value);
  });
}

// Confirms a just-typed draft actually reached the rendered frame before the caller sends anything else -- see replaceField's own comment for the race this closes. Every raw-text TextField write in this suite (an image path, raw MathML) goes through this rather than a bare stdin.write()+flush(). A further short REAL wait (not a setImmediate tick) follows the frame confirmation itself: ink-text-input's own onSubmit closes over whatever `originalValue` prop its own most recent render saw, and the frame showing the typed text is not proof that render (and Ink's own listener-ref update alongside it) has fully settled -- confirmed empirically, since without this extra margin an immediately-following Enter sometimes submitted the pre-typing empty default instead of the just-confirmed value.
async function writeAndConfirm(
  stdin: { readonly write: (data: string) => void },
  lastFrame: () => string | undefined,
  value: string,
): Promise<void> {
  stdin.write(value);
  await vi.waitFor(() => {
    expect(lastFrame()).toContain(value);
  });
  await new Promise((resolve) => {
    setTimeout(resolve, ESCAPE_FLUSH_MARGIN_MS);
  });
}

function Marker(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const screen = currentScreen(state);

  useInput((_input, key) => {
    if (key.escape && screen.kind !== "bodyList") {
      dispatch({ type: "POP_SCREEN" });
    }
  });

  return <Text>top:{screen.kind}</Text>;
}

// ContentEmbeddedObjectBlock has no top-level re-export from documents.js (only the ContentBlock union itself does) -- narrowed via Extract from that union's own block-array element type instead, the same trick paragraph-family.test.tsx's own TableProbe already uses for its table-block narrowing.
type WordprocessingBlock = Extract<
  ContentDocument,
  { readonly kind: "wordprocessing" }
>["sections"][number]["blocks"][number];

// Reads the document's own content fresh through readDocxContent/readOdtContent on every render -- the real proof an 'I'/'m'-driven dispatch reached the package, not merely that the reducer ran.
function ContentProbe({
  doc,
}: {
  readonly doc: DocxOpenDocument | OdtOpenDocument;
}): ReactElement {
  const content =
    doc.format === "docx"
      ? readDocxContent(doc.editor.toPackage())
      : readOdtContent(doc.editor.toPackage());
  if (content.kind !== "wordprocessing") {
    throw new Error(
      `expected a wordprocessing ContentDocument, got ${content.kind}`,
    );
  }
  const blocks = content.sections.flatMap((section) => section.blocks);
  const imageBlock = blocks.find((block) => block.kind === "image");
  const formulaBlock = blocks.find(
    (
      block,
    ): block is Extract<
      WordprocessingBlock,
      { readonly kind: "embeddedObject" }
    > => block.kind === "embeddedObject",
  );
  const formula =
    formulaBlock === undefined ? undefined : formulaOfBlock(formulaBlock);
  const rootTag =
    formula?.mathml[0]?.type === "element" ? formula.mathml[0].tag : undefined;
  return (
    <Text>
      probe:image=
      {imageBlock === undefined
        ? "none"
        : `${imageBlock.format} ${imageBlock.widthPt}x${imageBlock.heightPt} alt="${imageBlock.altText ?? ""}"`}{" "}
      probe:formula=
      {formula === undefined ? "none" : `present root=${rootTag ?? "?"}`}
    </Text>
  );
}

function Harness({
  format,
}: {
  readonly format: "docx" | "odt";
}): ReactElement | null {
  const state = useAppState();
  const dispatch = useAppDispatch();

  useEffect(() => {
    dispatch({ type: "CREATE_DOCUMENT", format });
  }, [format, dispatch]);

  const doc = state.openDocument;
  if (doc?.format !== format) {
    return null;
  }

  const adapter = createParagraphFamilyAdapter({
    formatLabel: format,
    paragraphs: () => doc.editor.paragraphs(),
    tables: () => doc.editor.tables(),
    dispatch,
  });

  const screen = currentScreen(state);
  return (
    <Box flexDirection="column">
      {screen.kind === "bodyList" ? (
        <ParagraphFamilyBodyList adapter={adapter} />
      ) : undefined}
      {screen.kind === "paragraphDetail" ? (
        <ParagraphDetailScreen />
      ) : undefined}
      <ContentProbe doc={doc} />
      <StatusLine />
      <Marker />
    </Box>
  );
}

function renderHarness(format: "docx" | "odt"): ReturnType<typeof render> {
  return render(
    <AppStateProvider>
      <Harness format={format} />
    </AppStateProvider>,
  );
}

// Appends a paragraph and drills into it, mirroring paragraph-family.test.tsx's own "a real user's own interaction path" convention.
async function openFreshParagraph(stdin: {
  readonly write: (data: string) => void;
}): Promise<void> {
  stdin.write("a");
  await flush();
}

const WIZARD_TEST_TIMEOUT_MS = 20_000;

describe.each(["docx", "odt"] as const)(
  'ParagraphDetailScreen "I" image insertion on %s',
  (format) => {
    let workspace: string;
    let imagePath: string;

    beforeEach(async () => {
      workspace = await mkdtemp(
        join(tmpdir(), "document-cli-paragraph-image-"),
      );
      imagePath = join(workspace, "fixture.png");
      await writeFile(imagePath, PNG_BYTES);
    });

    afterEach(async () => {
      await rm(workspace, { recursive: true, force: true });
    });

    it(
      "reads a real file off disk and inserts it as a genuine, recoverable inline image",
      async () => {
        const { lastFrame, stdin } = renderHarness(format);
        await flush();
        await openFreshParagraph(stdin);
        expect(lastFrame()).toContain("top:paragraphDetail");
        expect(lastFrame()).toContain("probe:image=none");

        stdin.write("I");
        await flush();
        expect(lastFrame()).toContain("Image file path");

        await writeAndConfirm(stdin, lastFrame, imagePath);
        stdin.write(ENTER);
        await flush();
        expect(lastFrame()).toContain("Width (pt)");

        // The width field starts pre-filled with '100' -- clear it and type a distinct value so the assertion below proves the typed value reached the action, not merely that the default survived.
        await replaceField(stdin, lastFrame, 3, "150");
        stdin.write(ENTER);
        await flush();
        expect(lastFrame()).toContain("Height (pt)");

        await replaceField(stdin, lastFrame, 2, "75");
        stdin.write(ENTER);
        await flush();
        expect(lastFrame()).toContain("Alt text");

        await writeAndConfirm(stdin, lastFrame, "a caption");
        stdin.write(ENTER);
        // The image-reading step is async (readInput awaits a real fs read) -- vi.waitFor polls until the probe reflects the real dispatch rather than gambling on a fixed number of flush() ticks. odt's own readOdtContent recovers altText (confirmed directly against documents.js); docx's readDocx (ooxml.js) does not populate ContentImageBlock.altText at all yet, for either name it was written under -- a genuine, confirmed upstream gap on the read side, not something this dispatch/wizard chain can be wrong about. The wizard's own altText field is still exercised for both formats (typed, submitted, reaches the dispatched action -- confirmed independently by inspecting the actual INSERT_PARAGRAPH_IMAGE action), so this only narrows the READ-BACK assertion, not the write.
        const expectedAlt = format === "odt" ? "a caption" : "";
        await vi.waitFor(() => {
          expect(lastFrame()).toContain(
            `probe:image=png 150x75 alt="${expectedAlt}"`,
          );
        });
      },
      WIZARD_TEST_TIMEOUT_MS,
    );

    it(
      "reports a warning and inserts nothing for a non-image file extension",
      async () => {
        const { lastFrame, stdin } = renderHarness(format);
        await flush();
        await openFreshParagraph(stdin);

        stdin.write("I");
        await flush();
        await writeAndConfirm(stdin, lastFrame, "/not/a/real/file.txt");
        stdin.write(ENTER);
        await flush();
        stdin.write(ENTER);
        await flush();
        stdin.write(ENTER);
        await flush();
        stdin.write(ENTER);
        await vi.waitFor(() => {
          expect(lastFrame()).toContain(
            "is not a .png or .jpg/.jpeg file -- image not inserted",
          );
        });
        expect(lastFrame()).toContain("probe:image=none");
      },
      WIZARD_TEST_TIMEOUT_MS,
    );
  },
);

describe('ParagraphDetailScreen "m" formula insertion (docx paragraph-scoped)', () => {
  it(
    "inserts the first preset as a real, recoverable embedded OMML formula",
    async () => {
      const { lastFrame, stdin } = renderHarness("docx");
      await flush();
      await openFreshParagraph(stdin);
      expect(lastFrame()).toContain("probe:formula=none");

      stdin.write("m");
      await flush();
      expect(lastFrame()).toContain("Insert formula");
      expect(lastFrame()).toContain("Fraction: x / 2");

      stdin.write(ENTER);
      await vi.waitFor(() => {
        expect(lastFrame()).toContain("probe:formula=present root=mfrac");
      });
    },
    WIZARD_TEST_TIMEOUT_MS,
  );

  it(
    "inserts a raw MathML entry, parsed via parseXml, as a real embedded formula",
    async () => {
      const { lastFrame, stdin } = renderHarness("docx");
      await flush();
      await openFreshParagraph(stdin);

      stdin.write("m");
      await flush();
      // Six presets precede the "Raw MathML..." row -- navigate down to it.
      for (let step = 0; step < 6; step += 1) {
        stdin.write("j");
        await flush();
      }
      expect(lastFrame()).toContain("Raw MathML...");
      stdin.write(ENTER);
      await flush();
      expect(lastFrame()).toContain("Raw MathML (the children");

      await writeAndConfirm(
        stdin,
        lastFrame,
        "<msup><mi>x</mi><mn>3</mn></msup>",
      );
      stdin.write(ENTER);
      await vi.waitFor(() => {
        expect(lastFrame()).toContain("probe:formula=present root=msup");
      });
    },
    WIZARD_TEST_TIMEOUT_MS,
  );

  it(
    "reports a warning, not a crash, for raw MathML that fails to parse",
    async () => {
      const { lastFrame, stdin } = renderHarness("docx");
      await flush();
      await openFreshParagraph(stdin);

      stdin.write("m");
      await flush();
      for (let step = 0; step < 6; step += 1) {
        stdin.write("j");
        await flush();
      }
      stdin.write(ENTER);
      await flush();

      // A closing tag missing its final '>' -- fast-xml-parser (parseXml's own implementation) is lenient about several malformed shapes (an unclosed element with no closing tag at all silently parses as whatever it did see), but a truncated closing tag is a genuine, confirmed throw.
      await writeAndConfirm(stdin, lastFrame, "<mfrac><mi>x</mi></mfrac");
      stdin.write(ENTER);
      await vi.waitFor(() => {
        expect(lastFrame()).toContain("Could not parse MathML");
      });
      expect(lastFrame()).toContain("probe:formula=none");
      // The picker itself stays open (back at the row list) so the user can retry, rather than the whole flow closing on a failed parse.
      expect(lastFrame()).toContain("Insert formula");
    },
    WIZARD_TEST_TIMEOUT_MS,
  );

  it("does not expose the formula picker for an odt document", async () => {
    const { lastFrame, stdin } = renderHarness("odt");
    await flush();
    await openFreshParagraph(stdin);

    stdin.write("m");
    await flush();

    expect(lastFrame()).not.toContain("Insert formula");
  });
});
