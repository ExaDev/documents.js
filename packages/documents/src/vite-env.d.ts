/// <reference types="vite/client" />

// Injected by vite.config.ts's `define` -- the real git state this build was produced from (see the comment there for why that's read directly rather than dry-run from semantic-release).
declare const __APP_COMMIT_SHA__: string;
declare const __APP_RELEASE_TAG__: string | null;
declare const __APP_REPO_URL__: string;
