import { Anchor, NavLink, Stack, Tooltip } from "@mantine/core";
import { Link } from "@tanstack/react-router";
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
} from "@tabler/icons-react";

import { relativeTime } from "../shared/relativeTime";
import { navLink, versionAnchor } from "./-Sidebar.css";

// Not a route -- the '-' prefix keeps TanStack Router's file-based generator from treating this as one.
const NAV_ITEMS = [
  { to: "/convert", label: "Convert", icon: IconArrowsExchange },
  { to: "/editors", label: "Editors", icon: IconEdit },
  { to: "/metadata", label: "Metadata", icon: IconTags },
  { to: "/inspect", label: "Inspect", icon: IconFileSearch },
  { to: "/fonts", label: "Fonts", icon: IconTypography },
  { to: "/recent", label: "Recent", icon: IconHistory },
  { to: "/package", label: "Package / JSON", icon: IconJson },
  { to: "/odb", label: ".odb", icon: IconDatabase },
  { to: "/odm", label: ".odm", icon: IconBooks },
] as const;

export interface VersionInfo {
  label: string;
  href: string;
  // IconTag and IconGitCommit share the identical generated component type, so naming both here would be a duplicate union constituent -- either one alone already types "whichever tabler icon component is picked".
  Icon: typeof IconTag;
}

// Pulled out of module scope so both branches (an exact release tag vs. a bare commit) are directly testable regardless of what this real build's own git state happens to be -- __APP_RELEASE_TAG__ (see vite.config.ts's `define` block) is whichever one is actually true of the checkout that built this bundle, not something a test run can choose between by picking an environment.
export function computeVersionInfo(
  releaseTag: string | null,
  commitSha: string,
  repoUrl: string,
): VersionInfo {
  if (releaseTag !== null)
    return {
      label: releaseTag,
      href: `${repoUrl}/releases/tag/${releaseTag}`,
      Icon: IconTag,
    };
  return {
    label: commitSha.slice(0, 7),
    href: `${repoUrl}/commit/${commitSha}`,
    Icon: IconGitCommit,
  };
}

// Same reasoning as computeVersionInfo: the tooltip text's two forms depend only on whether a release tag exists, factored out so a test can drive both without depending on this build's real git state.
export function computeVersionTooltip(
  releaseTag: string | null,
  commitSha: string,
  commitTimestampMs: number,
): string {
  const elapsed = relativeTime(commitTimestampMs);
  if (releaseTag !== null) return `Released ${elapsed}`;
  return `Commit ${commitSha} · ${elapsed}`;
}

// Build-time git state (see vite.config.ts's `define` block) rather than a dry-run prediction: whenever this build's HEAD is an exact semantic-release tag, CI's own job graph guarantees that tag already exists on disk (the deploy job checks out `ref: main` fresh, strictly after the release job pushed) -- there is nothing to predict, only real state to read.
const versionInfo = computeVersionInfo(
  __APP_RELEASE_TAG__,
  __APP_COMMIT_SHA__,
  __APP_REPO_URL__,
);

export function Sidebar() {
  // Computed at render time, not module scope, so it stays roughly fresh across a long-lived session -- Tooltip only mounts its content while open, so there's no need for a ticking interval to keep it accurate.
  const tooltipLabel = computeVersionTooltip(
    __APP_RELEASE_TAG__,
    __APP_COMMIT_SHA__,
    __APP_COMMIT_TIMESTAMP__,
  );

  return (
    <Stack h="100%" justify="space-between" gap={4}>
      <Stack gap={4}>
        {NAV_ITEMS.map((item) => (
          <Link key={item.to} to={item.to} className={navLink}>
            {({ isActive }) => (
              <NavLink
                component="div"
                label={item.label}
                leftSection={<item.icon size={18} />}
                active={isActive}
              />
            )}
          </Link>
        ))}
      </Stack>
      <Tooltip label={tooltipLabel} position="right">
        <Anchor
          href={versionInfo.href}
          target="_blank"
          rel="noopener noreferrer"
          underline="never"
          c="dimmed"
          size="xs"
          display="flex"
          className={versionAnchor}
        >
          <versionInfo.Icon size={14} />
          {versionInfo.label}
        </Anchor>
      </Tooltip>
    </Stack>
  );
}
