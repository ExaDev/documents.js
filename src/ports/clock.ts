// An explicit dependency for anything that needs "now" (PDF /CreationDate and /ModDate, chiefly) -- injecting this rather than calling `new Date()` directly is what makes byte-identical output for identical input testable at all: a test can supply a fixed clock and assert writePdf produces the exact same bytes twice, which would be untestable if the timestamp were wall-clock time.
export interface ClockPort {
  now(): Date;
}

export const systemClock: ClockPort = {
  now: () => new Date(),
};

export function fixedClock(date: Date): ClockPort {
  return { now: () => date };
}
