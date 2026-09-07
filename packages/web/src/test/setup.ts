/// <reference lib="dom" />

declare global {
  // React's own opt-in flag (no ambient type ships for it) -- see the assignment below for what it does. eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

// React's act() (imported from "react" itself since React 19) only wraps state updates/effects synchronously when it knows it's running inside a test harness -- without this flag it warns "not configured to support act(...)" on every render and the flush act() exists to guarantee is no longer guaranteed. Set once, here, rather than per test file, since every jsdom-environment test that mounts a real component (contentBlocks.test.tsx today, any future one) needs it.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
