import { Box, Text } from "ink";
import { render } from "ink-testing-library";
import { useEffect, type ReactElement } from "react";
import { describe, expect, it } from "vitest";
import {
  AppStateProvider,
  useAppDispatch,
  useAppState,
} from "../state/context.js";
import { settle, waitForFrame } from "../test-support.js";
import { SearchOverlay } from "./search-overlay.js";

// Opens the search overlay on mount, matching app.tsx's own gating.
function Harness(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();

  useEffect(() => {
    dispatch({ type: "OPEN_OVERLAY", overlay: "search" });
  }, [dispatch]);

  return (
    <Box flexDirection="column">
      {state.overlays.search ? <SearchOverlay /> : undefined}
      <Text>searchOpen:{String(state.overlays.search)}</Text>
      <Text>query:{JSON.stringify(state.searchQuery)}</Text>
    </Box>
  );
}

function renderHarness(): ReturnType<typeof render> {
  return render(
    <AppStateProvider>
      <Harness />
    </AppStateProvider>,
  );
}

describe("SearchOverlay", () => {
  it("renders the '/' prefix and its hint", async () => {
    const { lastFrame } = renderHarness();
    const frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("searchOpen:true"),
    );
    expect(frame).toContain("/");
    expect(frame).toContain("Enter to keep the filter, Esc to clear it");
  });

  it("writes every keystroke live to state.searchQuery", async () => {
    const { lastFrame, stdin } = renderHarness();
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("searchOpen:true"),
    );
    await settle();

    stdin.write("bud");
    const frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes('query:"bud"'),
    );
    expect(frame).toContain('query:"bud"');
  });

  it("keeps the query and closes on Enter", async () => {
    const { lastFrame, stdin } = renderHarness();
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("searchOpen:true"),
    );
    await settle();

    stdin.write("total");
    await settle();
    stdin.write("\r");

    const frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("searchOpen:false"),
    );
    expect(frame).toContain('query:"total"');
  });

  it("clears the query and closes on Escape", async () => {
    const { lastFrame, stdin } = renderHarness();
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("searchOpen:true"),
    );
    await settle();

    stdin.write("total");
    await settle();
    stdin.write("\x1B");

    const frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("searchOpen:false"),
    );
    expect(frame).toContain('query:""');
  });

  it("starts pre-filled from an already-set search query", async () => {
    function PrefilledHarness(): ReactElement {
      const state = useAppState();
      const dispatch = useAppDispatch();

      useEffect(() => {
        dispatch({ type: "SET_SEARCH_QUERY", query: "existing" });
        dispatch({ type: "OPEN_OVERLAY", overlay: "search" });
      }, [dispatch]);

      return state.overlays.search ? <SearchOverlay /> : <Text>loading</Text>;
    }

    const { lastFrame } = render(
      <AppStateProvider>
        <PrefilledHarness />
      </AppStateProvider>,
    );
    const frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("existing"),
    );
    expect(frame).toContain("existing");
  });
});
