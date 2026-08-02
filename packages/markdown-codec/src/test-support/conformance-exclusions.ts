// The SHRINK-ONLY exclusion list for src/conformance.test.ts: CommonMark 0.31.2 examples this parser does not yet reproduce byte for byte.
//
// It supersedes and merges the inline-phase-only list that preceded it (src/inline/conformance-exclusions.ts, removed when the block phase landed). Every entry on that list was there for one reason -- the example's expected output needed a block-level construct the deliberately trivial paragraph-only test harness could not produce -- and every one of them is gone from here, because those constructs now exist.
//
// "Shrink-only" is enforced mechanically, not by convention: src/conformance.test.ts asserts that every example named here currently FAILS. Fixing one and forgetting to delete its entry turns the suite red, so the list can never quietly accumulate examples that already pass, and can never be padded to hide a regression.
export const COMMONMARK_EXCLUSIONS: ReadonlyMap<number, string> = new Map([]);
