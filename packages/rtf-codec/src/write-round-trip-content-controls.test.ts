import { describe, expect, it } from "vitest";
import type { ContentDocument } from "document-schema.js";
import { readRtfContent } from "./read";
import { asciiText } from "./test-support/bytes";
import { writeRtfContent } from "./write";
import { wordprocessing } from "./test-support/wordprocessing-document";
import { roundTrip } from "./test-support/round-trip";

describe("round trip: contentControl form fields", () => {
  it("round-trips a checkbox contentControl's checked state and tag back onto the same point extent", () => {
    const back = roundTrip(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "before " }, { text: " after" }],
          constructs: [
            {
              descriptor: {
                kind: "contentControl",
                controlType: "checkbox",
                checked: true,
                tag: "Check1",
              },
              startRun: 1,
              endRun: 1,
            },
          ],
        },
      ]),
    );
    const block =
      back.kind === "wordprocessing" ? back.sections[0]?.blocks[0] : undefined;
    const paragraph = block?.kind === "paragraph" ? block : undefined;
    const extent = paragraph?.constructs?.[0];
    expect(extent?.descriptor).toEqual({
      kind: "contentControl",
      controlType: "checkbox",
      checked: true,
      tag: "Check1",
    });
    expect(extent?.startRun).toBe(extent?.endRun);
    expect(paragraph?.runs.map((run) => run.text).join("")).toBe(
      "before  after",
    );
  });

  // A dropDown minted with no recorded selection round-trips with no `value` at all, not a fabricated first-entry default: this writer mints neither \ffres nor \ffdefres for exactly this case (see "writes \ffhaslistbox for a dropDown with options but no recorded selection" above), and the reader leaves `value` unset when it finds neither control word (see read-form-fields.test.ts's "leaves a FORMDROPDOWN's value unset..."). This is the genuine stable fixed point — writing this descriptor again reproduces byte-identical output, with nothing to drift.
  it("round-trips a dropDown contentControl's options back onto the runs it wraps, with no fabricated default selection", () => {
    const back = roundTrip(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "Guten Tag" }],
          constructs: [
            {
              descriptor: {
                kind: "contentControl",
                controlType: "dropDown",
                options: ["Hello", "Guten Tag"],
              },
              startRun: 0,
              endRun: 1,
            },
          ],
        },
      ]),
    );
    const block =
      back.kind === "wordprocessing" ? back.sections[0]?.blocks[0] : undefined;
    const paragraph = block?.kind === "paragraph" ? block : undefined;
    const extent = paragraph?.constructs?.[0];
    expect(extent?.descriptor).toEqual({
      kind: "contentControl",
      controlType: "dropDown",
      options: ["Hello", "Guten Tag"],
    });
    expect(
      paragraph?.runs
        .slice(extent?.startRun ?? 0, extent?.endRun ?? 0)
        .map((run) => run.text)
        .join(""),
    ).toBe("Guten Tag");
  });

  // The round-trip stability fix this round exists for: an unmatched value must stay unmatched across repeated write/read cycles, never drifting onto a fabricated match. Before this fix, writing an unmatched value correctly minted no \ffres/\ffdefres (signalling loss), but reading that back gave `value: undefined` — indistinguishable from "no value was ever set" — so a SECOND write hit the other branch and minted \ffdefres0, silently turning "value was Bonjour, now lost" into "value is now definitely Hello".
  it("keeps a dropDown's unmatched value unmatched across two full write-read cycles, rather than drifting onto a fabricated match on the second pass", () => {
    const original = wordprocessing([
      {
        kind: "paragraph",
        runs: [{ text: "x" }],
        constructs: [
          {
            descriptor: {
              kind: "contentControl",
              controlType: "dropDown",
              options: ["Hello", "Guten Tag"],
              value: "Bonjour",
            },
            startRun: 0,
            endRun: 1,
          },
        ],
      },
    ]);
    const firstPassBytes = writeRtfContent(original);
    const firstPassDocument = readRtfContent(firstPassBytes).document;
    const secondPassBytes = writeRtfContent(firstPassDocument);
    const secondPassDocument = readRtfContent(secondPassBytes).document;

    const descriptorOf = (document: ContentDocument) => {
      const block =
        document.kind === "wordprocessing"
          ? document.sections[0]?.blocks[0]
          : undefined;
      const paragraph = block?.kind === "paragraph" ? block : undefined;
      return paragraph?.constructs?.[0]?.descriptor;
    };

    // Neither pass may recover "Bonjour" (it was never a valid option) nor drift onto "Hello" (the entry-0 fabrication this round's fix removes).
    expect(descriptorOf(firstPassDocument)).toEqual({
      kind: "contentControl",
      controlType: "dropDown",
      options: ["Hello", "Guten Tag"],
    });
    expect(descriptorOf(secondPassDocument)).toEqual(
      descriptorOf(firstPassDocument),
    );
    // The bytes themselves are the strongest form of this assertion: a true fixed point produces byte-identical RTF on the second pass, not merely an equal descriptor.
    expect(asciiText(secondPassBytes)).toBe(asciiText(firstPassBytes));
  });

  it("round-trips a dropDown contentControl's selected value back onto the same options", () => {
    const back = roundTrip(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "Guten Tag" }],
          constructs: [
            {
              descriptor: {
                kind: "contentControl",
                controlType: "dropDown",
                options: ["Hello", "Guten Tag"],
                value: "Guten Tag",
              },
              startRun: 0,
              endRun: 1,
            },
          ],
        },
      ]),
    );
    const block =
      back.kind === "wordprocessing" ? back.sections[0]?.blocks[0] : undefined;
    const paragraph = block?.kind === "paragraph" ? block : undefined;
    expect(paragraph?.constructs?.[0]?.descriptor).toEqual({
      kind: "contentControl",
      controlType: "dropDown",
      options: ["Hello", "Guten Tag"],
      value: "Guten Tag",
    });
  });

  it("round-trips a plainText contentControl's tag and its wrapped text", () => {
    const back = roundTrip(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "Lorem ipsum." }],
          constructs: [
            {
              descriptor: {
                kind: "contentControl",
                controlType: "plainText",
                tag: "Text1",
              },
              startRun: 0,
              endRun: 1,
            },
          ],
        },
      ]),
    );
    const block =
      back.kind === "wordprocessing" ? back.sections[0]?.blocks[0] : undefined;
    const paragraph = block?.kind === "paragraph" ? block : undefined;
    const extent = paragraph?.constructs?.[0];
    expect(extent?.descriptor).toEqual({
      kind: "contentControl",
      controlType: "plainText",
      tag: "Text1",
    });
    expect(
      paragraph?.runs
        .slice(extent?.startRun ?? 0, extent?.endRun ?? 0)
        .map((run) => run.text)
        .join(""),
    ).toBe("Lorem ipsum.");
  });

  // Deliberately NOT a round trip, despite the writer minting {\*\ffdeftext ...} from `value` (see "writes a plainText contentControl's value as {\*\ffdeftext ...}" above): `\ffdeftext` names the field's DEFAULT/reset text, and this reader never promotes it onto `value`, which document-schema.js defines as the control's CURRENT value — for a text field, that current value is the wrapped-run text, which this document never set. Writing `value` here is a one-directional degradation, the mirror image of the writer's own documented 'both'->'content' lock degradation: real, useful on the way out (documents.js's own PDF AcroForm-to-contentControl reconstruction genuinely produces this shape), but not something a generic reader of the resulting RTF should read back as the field's current content.
  it("writes a plainText contentControl's value into \\ffdeftext but does not read it back as `value`, since \\ffdeftext names the field's default text, not its current one", () => {
    const back = roundTrip(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "Lorem ipsum." }],
          constructs: [
            {
              descriptor: {
                kind: "contentControl",
                controlType: "plainText",
                tag: "Text1",
                value: "Jane Doe",
              },
              startRun: 0,
              endRun: 1,
            },
          ],
        },
      ]),
    );
    const block =
      back.kind === "wordprocessing" ? back.sections[0]?.blocks[0] : undefined;
    const paragraph = block?.kind === "paragraph" ? block : undefined;
    expect(paragraph?.constructs?.[0]?.descriptor).toEqual({
      kind: "contentControl",
      controlType: "plainText",
      tag: "Text1",
    });
  });

  it("round-trips a plainText contentControl's alias and lock alongside its tag", () => {
    const back = roundTrip(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "Lorem ipsum." }],
          constructs: [
            {
              descriptor: {
                kind: "contentControl",
                controlType: "plainText",
                tag: "Text1",
                alias: "Client name",
                lock: "content",
              },
              startRun: 0,
              endRun: 1,
            },
          ],
        },
      ]),
    );
    const block =
      back.kind === "wordprocessing" ? back.sections[0]?.blocks[0] : undefined;
    const paragraph = block?.kind === "paragraph" ? block : undefined;
    expect(paragraph?.constructs?.[0]?.descriptor).toEqual({
      kind: "contentControl",
      controlType: "plainText",
      tag: "Text1",
      alias: "Client name",
      lock: "content",
    });
  });

  // 'both' has no RTF spelling of its own — \ffprot is a single bit — so this is the writer's own documented, one-directional degradation: a 'both' lock survives the round trip as 'content', the half RTF can actually state.
  it("round-trips a 'both'-locked contentControl's lock down to 'content', the half RTF's \\ffprot can actually state", () => {
    const back = roundTrip(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "x" }],
          constructs: [
            {
              descriptor: {
                kind: "contentControl",
                controlType: "plainText",
                lock: "both",
              },
              startRun: 0,
              endRun: 1,
            },
          ],
        },
      ]),
    );
    const block =
      back.kind === "wordprocessing" ? back.sections[0]?.blocks[0] : undefined;
    const paragraph = block?.kind === "paragraph" ? block : undefined;
    expect(paragraph?.constructs?.[0]?.descriptor).toEqual({
      kind: "contentControl",
      controlType: "plainText",
      lock: "content",
    });
  });
});
