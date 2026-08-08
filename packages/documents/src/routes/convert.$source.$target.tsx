import { createFileRoute } from '@tanstack/react-router';

// Renders nothing -- convert.tsx (the parent layout route) owns the real UI directly rather than through <Outlet/>, so this file exists purely to register '/convert/$source/$target' and its typed params in the route tree (used by ConvertLayout's useParams({ strict: false }) and by every Link elsewhere in the app that deep-links into a specific conversion pair).
export const Route = createFileRoute('/convert/$source/$target')({});
