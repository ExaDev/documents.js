import { describe, expect, it } from "vitest";

import { Route } from "./index";

describe("the / route", () => {
  it("redirects to /convert in beforeLoad, rather than rendering a landing page", () => {
    const beforeLoad = Route.options.beforeLoad;
    if (beforeLoad === undefined) {
      throw new Error("expected the / route to declare beforeLoad");
    }
    let thrown: unknown;
    try {
      // TanStack Router's own beforeLoad context type is large and mostly irrelevant here -- this route's beforeLoad reads none of it, it unconditionally throws a redirect.
      (beforeLoad as (context: unknown) => void)(undefined);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response & { options: { to: string } }).options.to).toBe(
      "/convert",
    );
  });
});
