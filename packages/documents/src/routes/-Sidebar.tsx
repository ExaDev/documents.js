import { Anchor, NavLink, Stack, Tooltip } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import {
  IconArrowsExchange,
  IconBooks,
  IconDatabase,
  IconEdit,
  IconFileSearch,
  IconGitCommit,
  IconHistory,
  IconJson,
  IconTag,
  IconTags,
  IconTypography,
} from '@tabler/icons-react';

import { relativeTime } from '../shared/relativeTime';

// Not a route -- the '-' prefix keeps TanStack Router's file-based generator from treating this as one.
const NAV_ITEMS = [
  { to: '/convert', label: 'Convert', icon: IconArrowsExchange },
  { to: '/metadata', label: 'Metadata', icon: IconTags },
  { to: '/inspect', label: 'Inspect', icon: IconFileSearch },
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

// Build-time git state (see vite.config.ts's `define` block) rather than a dry-run prediction: whenever this build's HEAD is an exact semantic-release tag, CI's own job graph guarantees that tag already exists on disk (the deploy job checks out `ref: main` fresh, strictly after the release job pushed) -- there is nothing to predict, only real state to read.
const versionLabel = __APP_RELEASE_TAG__ ?? __APP_COMMIT_SHA__.slice(0, 7);
const versionHref = __APP_RELEASE_TAG__ !== null ? `${__APP_REPO_URL__}/releases/tag/${__APP_RELEASE_TAG__}` : `${__APP_REPO_URL__}/commit/${__APP_COMMIT_SHA__}`;
const VersionIcon = __APP_RELEASE_TAG__ !== null ? IconTag : IconGitCommit;

export function Sidebar() {
  // Computed at render time, not module scope, so it stays roughly fresh across a long-lived session -- Tooltip only mounts its content while open, so there's no need for a ticking interval to keep it accurate.
  const tooltipLabel =
    __APP_RELEASE_TAG__ !== null
      ? `Released ${relativeTime(__APP_COMMIT_TIMESTAMP__)}`
      : `Commit ${__APP_COMMIT_SHA__} · ${relativeTime(__APP_COMMIT_TIMESTAMP__)}`;

  return (
    <Stack h="100%" justify="space-between" gap={4}>
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
      <Tooltip label={tooltipLabel} position="right">
        <Anchor
          href={versionHref}
          target="_blank"
          rel="noopener noreferrer"
          underline="never"
          c="dimmed"
          size="xs"
          display="flex"
          style={{ alignItems: 'center', gap: 6, padding: '8px 12px' }}
        >
          <VersionIcon size={14} />
          {versionLabel}
        </Anchor>
      </Tooltip>
    </Stack>
  );
}
