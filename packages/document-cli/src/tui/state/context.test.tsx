import { renderToString } from "ink";
import { Text } from "ink";
import { render } from "ink-testing-library";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { AppStateProvider, useAppDispatch, useAppState } from "./context.js";

function ReadCwd(): ReactElement {
  const state = useAppState();
  return <Text>cwd:{state.cwd}</Text>;
}

describe("AppStateProvider", () => {
  it("threads its own cwd prop into the reducer's initial state", () => {
    const { lastFrame } = render(
      <AppStateProvider cwd="/a/given/directory">
        <ReadCwd />
      </AppStateProvider>,
    );
    expect(lastFrame()).toContain("cwd:/a/given/directory");
  });
});

function ReadStateAlone(): ReactElement {
  useAppState();
  return <Text>unreachable</Text>;
}

function DispatchAlone(): ReactElement {
  useAppDispatch();
  return <Text>unreachable</Text>;
}

describe("useAppState", () => {
  it("throws when called outside AppStateProvider", () => {
    expect(() => renderToString(<ReadStateAlone />)).toThrow(
      "useAppState was called outside AppStateProvider; wrap the tree in <AppStateProvider> (App already does).",
    );
  });
});

describe("useAppDispatch", () => {
  it("throws when called outside AppStateProvider", () => {
    expect(() => renderToString(<DispatchAlone />)).toThrow(
      "useAppDispatch was called outside AppStateProvider; wrap the tree in <AppStateProvider> (App already does).",
    );
  });
});
