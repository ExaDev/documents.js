/// <reference lib="dom" />
import { MantineProvider } from "@mantine/core";
import { act } from "react";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

// Any component using a Mantine primitive (Stack, List, Badge, Tree, ...) throws "MantineProvider was not found in component tree" unless one wraps it, even in a plain react-dom/client mount with no other Mantine feature exercised -- this is the shared harness for exactly that case, mirroring src/ui/contentBlocks.test.tsx's own bare react-dom/client pattern (no @testing-library dependency) but with the one extra wrapper Mantine components need.
export interface MountedComponent {
  container: HTMLDivElement;
  rerender: (node: ReactNode) => void;
  unmount: () => void;
}

export function mountWithMantine(node: ReactNode): MountedComponent {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);

  function rerender(next: ReactNode) {
    act(() => {
      root.render(<MantineProvider>{next}</MantineProvider>);
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
