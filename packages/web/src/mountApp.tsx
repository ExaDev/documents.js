import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app";

// Extracted out of main.tsx so mountApp.test.tsx can drive the missing-#root failure path directly against a throwaway jsdom Document, without ever importing main.tsx itself -- main.tsx calls this unconditionally at module scope (the real entry point's own job), so importing it in a test would mount the real app against whatever #root element happens to exist in the test environment's own global document.
export function mountApp(rootDocument: Document): void {
  const container = rootDocument.getElementById("root");
  if (container === null)
    throw new Error("#root element is missing from index.html");

  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
