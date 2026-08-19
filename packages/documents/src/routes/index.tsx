import { createFileRoute, redirect } from '@tanstack/react-router';

// With a persistent sidebar present on every route, a marketing hero whose only content duplicates the sidebar's job forces a click before any tool is usable -- exactly what "combine into one page" argues against. Land directly in the flagship tool instead.
export const Route = createFileRoute('/')({
  beforeLoad: () => {
    throw redirect({ to: '/convert' });
  },
});
