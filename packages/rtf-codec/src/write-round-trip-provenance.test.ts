import { describe, expect, it } from "vitest";
import { asciiText } from "./test-support/bytes";
import { expectBalancedBraces } from "./test-support/brace-balance";
import { writeRtfContent } from "./write";
import { wordprocessing, write } from "./test-support/wordprocessing-document";
import { roundTrip } from "./test-support/round-trip";

describe("round trip: provenance and revision marks", () => {
  it("writes a run-level provenance extent as the <chrev> character properties, minting a \\*\\revtbl for its author", () => {
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "kept " }, { text: "added" }],
          constructs: [
            {
              descriptor: {
                kind: "provenance",
                change: "insertion",
                author: "A. Reviewer",
                dateIso: "2024-01-01T09:30:00",
              },
              startRun: 1,
              endRun: 2,
            },
          ],
        },
      ]),
    );
    expect(out).toContain("{\\*\\revtbl");
    expect(out).toContain("A. Reviewer;");
    expect(out).toContain("\\revised");
    // 30 | (9 << 6) | (1 << 11) | (1 << 16) | (124 << 20) — the DTTM bit field the spec tabulates.
    const dttm = 30 | (9 << 6) | (1 << 11) | (1 << 16) | (124 << 20);
    expect(out).toContain(`\\revdttm${String(dttm)}`);
  });

  it("writes a provenance extent's own \\revised flag with no \\revauthN at all when it carries no author", () => {
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "added" }],
          constructs: [
            {
              descriptor: { kind: "provenance", change: "insertion" },
              startRun: 0,
              endRun: 1,
            },
          ],
        },
      ]),
    );
    expect(out).toContain("\\revised");
    expect(out).not.toContain("\\revauth");
  });

  it("excludes the run exactly at a provenance extent's own endRun, which is exclusive", () => {
    // Each covered run is written inside its own group with its own freshly-computed \revised (there is no shared \revised0 "off" spelling), so the run exactly at endRun getting the flag too would show up as one extra occurrence, not a missing "off" marker.
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "before " }, { text: "inside " }, { text: "after" }],
          constructs: [
            {
              descriptor: {
                kind: "provenance",
                change: "insertion",
                author: "R",
              },
              startRun: 1,
              endRun: 2,
            },
          ],
        },
      ]),
    );
    expect(out.match(/\\revised(?!0)/g)).toHaveLength(1);
  });

  it("does not treat a non-provenance construct extent as a revision mark", () => {
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "a" }, { text: "b" }],
          constructs: [
            {
              descriptor: { kind: "anchor", anchorType: "bookmark", name: "x" },
              startRun: 0,
              endRun: 2,
            },
          ],
        },
      ]),
    );
    expect(out).not.toContain("\\revised");
    expect(out).not.toContain("\\deleted");
  });

  it("still writes a real {\\*\\bkmkstart ...} for a bookmark alongside an unrelated construct, rather than misreading the bookmark as a contentControl extent", () => {
    // isContentControlExtent gates selectNestableFormFields' own input — a bookmark wrongly let through would be handed to formFieldOpenGroup, which has no controlType field to read on an AnchorDescriptor at all, and would report it as an unrepresentable contentControl construct: checking for zero diagnostics is what actually proves the bookmark was excluded, since formFieldOpenGroup degrades a misrouted extent to a diagnostic rather than a crash.
    const diagnostics: unknown[] = [];
    const out = asciiText(
      writeRtfContent(
        wordprocessing([
          {
            kind: "paragraph",
            runs: [{ text: "a" }, { text: "b" }],
            constructs: [
              {
                descriptor: {
                  kind: "anchor",
                  anchorType: "bookmark",
                  name: "x",
                },
                startRun: 0,
                endRun: 2,
              },
            ],
          },
        ]),
        {
          sink: (diagnostic) => {
            diagnostics.push(diagnostic);
          },
        },
      ),
    );
    expect(diagnostics).toEqual([]);
    expect(out).toContain("{\\*\\bkmkstart x}");
    expect(out).not.toContain("\\field");
    expectBalancedBraces(out);
  });

  it("mints a \\*\\revtbl entry for a block-scoped provenance marker's own author too, not only a run-level extent's", () => {
    // noteBlock's own constructStart case (a block-level marker, distinct from a paragraph's run-level constructs array) must reach noteDescriptor on its own path.
    const out = write(
      wordprocessing([
        {
          kind: "constructStart",
          descriptor: {
            kind: "provenance",
            change: "insertion",
            author: "Block Author",
          },
        },
        { kind: "paragraph", runs: [{ text: "x" }] },
        { kind: "constructEnd" },
      ]),
    );
    expect(out).toContain("{\\*\\revtbl");
    expect(out).toContain("Block Author;");
  });

  it("round-trips every provenance change kind back onto the same runs", () => {
    for (const change of [
      "insertion",
      "deletion",
      "moveFrom",
      "moveTo",
      "formatChange",
    ] as const) {
      const back = roundTrip(
        wordprocessing([
          {
            kind: "paragraph",
            runs: [{ text: "a" }, { text: "b" }],
            constructs: [
              {
                descriptor: { kind: "provenance", change, author: "R" },
                startRun: 1,
                endRun: 2,
              },
            ],
          },
        ]),
      );
      const block =
        back.kind === "wordprocessing"
          ? back.sections[0]?.blocks[0]
          : undefined;
      const paragraph = block?.kind === "paragraph" ? block : undefined;
      expect(paragraph?.constructs?.[0]?.descriptor).toEqual({
        kind: "provenance",
        change,
        author: "R",
      });
      expect(
        paragraph?.runs
          .slice(
            paragraph.constructs?.[0]?.startRun ?? 0,
            paragraph.constructs?.[0]?.endRun ?? 0,
          )
          .map((run) => run.text)
          .join(""),
      ).toBe("b");
    }
  });

  it("round-trips a deletion's own text, which the provenance kind exists to carry", () => {
    const back = roundTrip(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "kept " }, { text: "gone" }],
          constructs: [
            {
              descriptor: {
                kind: "provenance",
                change: "deletion",
                author: "R",
              },
              startRun: 1,
              endRun: 2,
            },
          ],
        },
      ]),
    );
    const block =
      back.kind === "wordprocessing" ? back.sections[0]?.blocks[0] : undefined;
    expect(
      block?.kind === "paragraph"
        ? block.runs.map((run) => run.text).join("")
        : undefined,
    ).toBe("kept gone");
  });

  it("omits \\revdttmN entirely for a dateIso it cannot pack, rather than writing a zero one", () => {
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "x" }],
          constructs: [
            {
              descriptor: {
                kind: "provenance",
                change: "insertion",
                dateIso: "not a date",
              },
              startRun: 0,
              endRun: 1,
            },
          ],
        },
      ]),
    );
    expect(out).toContain("\\revised");
    expect(out).not.toContain("\\revdttm");
  });
});
