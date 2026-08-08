import { NavLink, Stack, Tooltip } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import {
  IconArrowsExchange,
  IconBooks,
  IconDatabase,
  IconEdit,
  IconFileSearch,
  IconHistory,
  IconJson,
  IconTags,
  IconTypography,
} from '@tabler/icons-react';

// Not a route -- the '-' prefix keeps TanStack Router's file-based generator from treating this as one.
const NAV_ITEMS = [
  { to: '/convert', label: 'Convert', icon: IconArrowsExchange },
  { to: '/metadata', label: 'Metadata', icon: IconTags },
  { to: '/pdf-inspect', label: 'PDF inspect', icon: IconFileSearch },
  { to: '/fonts', label: 'Fonts', icon: IconTypography },
  { to: '/recent', label: 'Recent', icon: IconHistory },
] as const;

// Tools already tracked as follow-up work -- headroom in the nav without inventing empty route files ahead of time.
const PLANNED_ITEMS = [
  { label: 'Editors', icon: IconEdit },
  { label: '.odb', icon: IconDatabase },
  { label: '.odm', icon: IconBooks },
  { label: 'Package / JSON', icon: IconJson },
] as const;

export function Sidebar() {
  return (
    <Stack gap={4}>
      {NAV_ITEMS.map((item) => (
        <Link key={item.to} to={item.to} style={{ textDecoration: 'none', color: 'inherit' }}>
          {({ isActive }) => (
            <NavLink component="div" label={item.label} leftSection={<item.icon size={18} />} active={isActive} />
          )}
        </Link>
      ))}
      {PLANNED_ITEMS.map((item) => (
        <Tooltip key={item.label} label="Coming soon" position="right">
          <NavLink
            component="div"
            label={item.label}
            leftSection={<item.icon size={18} />}
            disabled
            style={{ cursor: 'default' }}
          />
        </Tooltip>
      ))}
    </Stack>
  );
}
