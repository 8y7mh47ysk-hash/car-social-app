import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

import { validateWebEnv } from "./src/env/validate";

// Set the monorepo root explicitly instead of letting Next.js guess it from lockfiles, so builds
// behave the same in any checkout location (git worktrees, fresh clones, CI).
const monorepoRoot = fileURLToPath(new URL("../..", import.meta.url));

const nextConfig: NextConfig = {
  // Since 16.4, `next dev` writes an AGENTS.md into this app when it detects an AI coding
  // agent. Keep the repository free of generated files; the version-matched docs it points to
  // live in node_modules/next/dist/docs/.
  agentRules: false,
  poweredByHeader: false,
  // `next build` type-checks with the same file as `pnpm typecheck`, which leaves out the route
  // types that `next dev` keeps in .next/dev (see tsconfig.typecheck.json). Editors and the rest of
  // Next.js still read tsconfig.json, which this file extends.
  typescript: { tsconfigPath: "tsconfig.typecheck.json" },
  // Workspace packages are consumed as TypeScript source and compiled by Next.js.
  transpilePackages: ["@apex/shared"],
  outputFileTracingRoot: monorepoRoot,
  turbopack: {
    root: monorepoRoot,
  },
};

/**
 * Next.js calls this each time it loads the config, after it has read the .env files, and passes
 * the phase (dev server, production build, production server...). A missing or invalid
 * environment variable therefore stops `next dev`, `next build` and `next start` with a message
 * that names it. Which variables are checked depends on the phase (see src/env/validate.ts), which
 * is why the check runs here rather than when this file is loaded.
 */
export default function config(phase: string): NextConfig {
  validateWebEnv(phase, process.env);
  return nextConfig;
}
