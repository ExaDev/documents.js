import { tanstackRouter } from '@tanstack/router-plugin/vite';
import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// GitHub Pages serves this repo at /documents/ (exadev.github.io is already the org's own Pages root, so this app can never live at the bare domain). Local dev stays at '/'. Routing is hash-based (see src/router.tsx), so no 404.html SPA-fallback step is needed -- GitHub Pages only ever serves the single index.html at /documents/, and everything after '#' is resolved client-side.
const base = process.env.CI ? '/documents/' : '/';

export default defineConfig({
  base,
  plugins: [
    // Must precede react(): the router plugin's route-tree codegen needs to run before plugin-react's JSX transform sees the generated imports.
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    vanillaExtractPlugin(),
  ],
  build: {
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('@mantine')) return 'vendor-mantine';
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) return 'vendor-react';
          if (id.includes('/dexie') || id.includes('/zod/')) return 'vendor-data';
          if (id.includes('@tanstack')) return 'vendor-tanstack';
          return undefined;
        },
      },
    },
  },
});
