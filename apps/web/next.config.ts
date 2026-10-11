import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

// Set the monorepo root explicitly instead of letting Next.js guess it from lockfiles, so builds
// behave the same in any checkout location (git worktrees, fresh clones, CI).
const monorepoRoot = fileURLToPath(new URL("../..", import.meta.url));

const nextConfig: NextConfig = {
  // Since 16.4, `next dev` writes an AGENTS.md into this app when it detects an AI coding
  // agent. Keep the repository free of generated files; the version-matched docs it points to
  // live in node_modules/next/dist/docs/.
  agentRules: false,
  poweredByHeader: false,
  // Workspace packages are consumed as TypeScript source and compiled by Next.js.
  transpilePackages: ["@apex/shared"],
  outputFileTracingRoot: monorepoRoot,
  turbopack: {
    root: monorepoRoot,
  },
};

export default nextConfig;
