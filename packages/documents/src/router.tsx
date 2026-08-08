import { createBrowserHistory, createRouter } from '@tanstack/react-router';

import { routeTree } from './routeTree.gen';

// import.meta.env.BASE_URL mirrors vite.config.ts's own `base` exactly ('/documents/' in CI, '/' locally) -- using it here instead of a second hardcoded string is what keeps the router's basepath and Vite's asset base from drifting apart. GitHub Pages has no server-side rewrites, so deep links rely on the dist/404.html copy of index.html (see package.json's build script) to fall back into this router.
export const router = createRouter({ routeTree, history: createBrowserHistory(), basepath: import.meta.env.BASE_URL });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
