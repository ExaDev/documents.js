/// <reference lib="dom" />
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// A minimal, dependency-free stand-in for @testing-library/react's renderHook: mounts the given hook inside a real jsdom tree (via react-dom/client, the same approach src/ui/contentBlocks.test.tsx already established for component-level tests) wrapped in a fresh QueryClientProvider, since every hook under src/hooks/** is a useMutation/useQuery/useLiveQuery consumer that throws without one. `result.current` is updated on every render, so awaiting a mutate call and then reading it back observes the hook's latest state.
export interface RenderedHook<T> {
  result: { current: T };
  unmount: () => void;
}

export function renderHookWithQueryClient<T>(
  useHookFn: () => T,
): RenderedHook<T> {
  const queryClient = new QueryClient();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const result = {} as { current: T };

  function Harness() {
    result.current = useHookFn();
    return null;
  }

  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <Harness />
      </QueryClientProvider>,
    );
  });

  return {
    result,
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}
