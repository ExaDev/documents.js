import { createFileRoute } from '@tanstack/react-router';

// Renders nothing -- convert.tsx (the parent layout route) owns the real UI directly rather than through <Outlet/>, so this file exists purely to register the '/convert/' path in the route tree.
export const Route = createFileRoute('/convert/')({});
