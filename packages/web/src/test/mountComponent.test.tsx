import { useEffect } from "react";
import { describe, expect, it } from "vitest";

import { mountWithMantine, mountWithProviders } from "./mountComponent";

function CleanupProbe({ onCleanup }: { onCleanup: () => void }) {
  useEffect(() => onCleanup, [onCleanup]);
  return null;
}

describe("mountWithMantine", () => {
  it("appends the mounted container to document.body and renders the given node inside it", () => {
    const mounted = mountWithMantine(<div data-testid="probe">hello</div>);
    expect(document.body.contains(mounted.container)).toBe(true);
    expect(
      mounted.container.querySelector('[data-testid="probe"]')?.textContent,
    ).toBe("hello");
    mounted.unmount();
  });

  it("rerenders new content into the same container", () => {
    const mounted = mountWithMantine(<div data-testid="probe">first</div>);
    mounted.rerender(<div data-testid="probe">second</div>);
    expect(
      mounted.container.querySelector('[data-testid="probe"]')?.textContent,
    ).toBe("second");
    mounted.unmount();
  });

  it("removes the container from document.body on unmount", () => {
    const mounted = mountWithMantine(<div>hello</div>);
    mounted.unmount();
    expect(document.body.contains(mounted.container)).toBe(false);
  });

  it("runs the React root's own unmount, not just a DOM removal, so effect cleanups fire", () => {
    let cleanedUp = false;
    const mounted = mountWithMantine(
      <CleanupProbe
        onCleanup={() => {
          cleanedUp = true;
        }}
      />,
    );
    expect(cleanedUp).toBe(false);
    mounted.unmount();
    expect(cleanedUp).toBe(true);
  });
});

describe("mountWithProviders", () => {
  it("appends the container to document.body and renders the given node wrapped with a query client", () => {
    const mounted = mountWithProviders(<div data-testid="probe">hello</div>);
    expect(document.body.contains(mounted.container)).toBe(true);
    expect(
      mounted.container.querySelector('[data-testid="probe"]')?.textContent,
    ).toBe("hello");
    mounted.unmount();
  });

  it("removes the container from document.body and runs the React root's own unmount on unmount", () => {
    let cleanedUp = false;
    const mounted = mountWithProviders(
      <CleanupProbe
        onCleanup={() => {
          cleanedUp = true;
        }}
      />,
    );
    mounted.unmount();
    expect(document.body.contains(mounted.container)).toBe(false);
    expect(cleanedUp).toBe(true);
  });
});
