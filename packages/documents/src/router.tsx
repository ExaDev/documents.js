import { createHashHistory, createRouter } from '@tanstack/react-router';

import { routeTree } from './routeTree.gen';

// Hash-based history: the app deploys to a GitHub Pages subpath with no server-side rewrites, so everything after '#' is resolved entirely client-side.
export const router = createRouter({ routeTree, history: createHashHistory() });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
