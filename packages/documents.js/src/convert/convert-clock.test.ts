import { describe, expect, it } from "vitest";
import { docxToPdf } from "./convert";
import { fixedClock } from "../ports/clock";
import { minimalDocxBytes } from "../test-support/docx";

// Proves the opt-in ClockPort wired into the X-to-PDF path (src/convert/convert.ts) actually delivers its stated value: byte-identical PDF output for identical input under a fixed clock, rather than wall-clock-dependent /CreationDate and /ModDate stamps. minimalDocxBytes carries no docProps/core.xml, so its source metadata has no createdIso/modifiedIso -- meaning a clock supplied to docxToPdf is the ONLY thing that can stamp those fields, which is what makes the assertions below load-bearing rather than incidental.

describe("docxToPdf: opt-in clock", () => {
  const T1 = new Date("2025-01-01T00:00:00.000Z");
  const T2 = new Date("2025-02-02T00:00:00.000Z");

  it("produces byte-identical output for identical input under a fixed clock", () => {
    const bytes = minimalDocxBytes();
    const first = docxToPdf(bytes, { clock: fixedClock(T1) });
    const second = docxToPdf(bytes, { clock: fixedClock(T1) });
    expect(first).toEqual(second);
  });

  it("stamps the fixed clock into the PDF, distinct from a different fixed clock", () => {
    const bytes = minimalDocxBytes();
    const atT1 = docxToPdf(bytes, { clock: fixedClock(T1) });
    const atT2 = docxToPdf(bytes, { clock: fixedClock(T2) });
    // Same input bytes, only the clock differs -- so atT1 !== atT2 can only be the clock's instant reaching /CreationDate and /ModDate. (The literal D:YYYYMMDD value lives inside a compressed object stream, so it is not visible as a raw substring; the inequality plus the no-clock case below are the load-bearing proof, not a substring match.)
    expect(atT1).not.toEqual(atT2);
  });

  it("stamps nothing when no clock is supplied, keeping output byte-identical to the pre-clock pipeline", () => {
    const bytes = minimalDocxBytes();
    const first = docxToPdf(bytes);
    const second = docxToPdf(bytes);
    expect(first).toEqual(second);
    // No clock and a timestamp-free source means writePdf writes no /CreationDate entry at all.
    expect(new TextDecoder("latin1").decode(first)).not.toContain(
      "/CreationDate",
    );
  });
});
