/// <reference lib="dom" />
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

// Any component using a Mantine primitive (Stack, List, Badge, Tree, ...) throws "MantineProvider was not found in component tree" unless one wraps it, even in a plain react-dom/client mount with no other Mantine feature exercised -- this is the shared harness for exactly that case, mirroring src/ui/contentBlocks.test.tsx's own bare react-dom/client pattern (no @testing-library dependency) but with the one extra wrapper Mantine components need.
export interface MountedComponent {
  container: HTMLDivElement;
  rerender: (node: ReactNode) => void;
  unmount: () => void;
}

function mount(
  wrap: (node: ReactNode) => ReactNode,
  node: ReactNode,
): MountedComponent {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);

  function rerender(next: ReactNode) {
    act(() => {
      root.render(wrap(next));
    });
  }

  rerender(node);

  return {
    container,
    rerender,
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

export function mountWithMantine(node: ReactNode): MountedComponent {
  return mount((n) => <MantineProvider>{n}</MantineProvider>, node);
}

// For a route component that reaches for a react-query hook (useMutation/useQuery/useLiveQuery) itself, not just via a hook this package already tests in isolation -- a fresh QueryClient per mount, exactly as renderHookWithQueryClient (src/test/renderHook.tsx) already establishes for hook-only tests.
export function mountWithProviders(node: ReactNode): MountedComponent {
  const queryClient = new QueryClient();
  return mount(
    (n) => (
      <MantineProvider>
        <QueryClientProvider client={queryClient}>{n}</QueryClientProvider>
      </MantineProvider>
    ),
    node,
  );
}
