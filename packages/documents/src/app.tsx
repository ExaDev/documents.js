import { localStorageColorSchemeManager, MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';

import { router } from './router';
import { theme } from './theme';

const queryClient = new QueryClient();

// No cookie-based colorSchemeManager or <ColorSchemeScript> needed here (unlike a Next.js SSR shell) -- this is a pure client-only static SPA with no server-rendered HTML to flash-mismatch, so Mantine's own localStorage manager is sufficient.
const colorSchemeManager = localStorageColorSchemeManager({ key: 'documents-color-scheme' });

export function App() {
  return (
    <MantineProvider theme={theme} defaultColorScheme="auto" colorSchemeManager={colorSchemeManager}>
      <Notifications position="bottom-right" limit={4} />
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </MantineProvider>
  );
}
