# Apex Garage

Apex Garage is a car-themed, self-hosted web app (installable as a PWA on phone and desktop) for
people who own and modify cars. Its centrepiece is **Crew Chief**, an AI assistant that runs on
the owner's home server through Ollama, so there are no per-token API costs. There is a free tier
and paid plans: Pro (£5/month or £40/year) and Max (£8/month or £70/year).

What users will get:

- **Garage:** a profile for each car (make, model, year, trim, mileage, photos, VIN, notes).
- **Build Log:** a timeline of mods, costs, dyno or lap results and before/after photos.
- **Maintenance:** service schedules, mileage and date reminders, receipts.
- **Parts Locker:** parts you own or plan to buy, with fitment notes and a budget tracker.
- **Crew Chief AI:** questions about your specific car, plans from your build log, symptom
  diagnosis and service-history summaries.
- **Print Service:** upload a 3D model of a car part, get an itemised quote, pay, and have it
  printed and shipped.
- **Social and Journeys:** share photos and journeys with friends and crews, with leaderboards
  designed to be safe.

**Status:** early development. The foundation (playbook Phase 0) is being built: the web app
shows a placeholder page and the API has a smoke-test `/health` route. The full plan, with 211
numbered instructions, is in [docs/PLAYBOOK.md](docs/PLAYBOOK.md).

## Stack

| Area       | Technology                                                                | Status                                       |
| ---------- | ------------------------------------------------------------------------- | -------------------------------------------- |
| Frontend   | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4             | In place                                     |
| Animation  | Motion (formerly Framer Motion)                                           | Phase 1 (design system)                      |
| Backend    | Fastify 5, TypeScript, ES modules                                         | In place                                     |
| Validation | Zod 4, at every input boundary                                            | In place                                     |
| Data       | PostgreSQL, Redis                                                         | Instruction 3 (containers), Phase 2 (schema) |
| AI         | Ollama (local LLM, never publicly exposed)                                | Phase 5                                      |
| Billing    | Stripe Checkout, Customer Portal and webhooks                             | Phase 6                                      |
| Hosting    | Docker Compose on a home server, reached only through Cloudflare Tunnel   | Instruction 3 (Compose), Phase 7 (Tunnel)    |
| Tooling    | pnpm 12 workspaces, TypeScript 6 (strict), ESLint 9, Prettier 3, Vitest 4 | In place                                     |

## Repository layout

```text
apps/
  api/        @apex/api     Fastify HTTP API. src/app.ts builds the app; src/server.ts runs it.
  web/        @apex/web     Next.js web app (App Router, in src/app).
packages/
  shared/     @apex/shared  Zod schemas, types and helpers shared by the apps.
infra/        Deployment and operations files (see infra/README.md).
scripts/      Developer and CI scripts and their tests (not a workspace package).
.github/      The CI workflow (see "Continuous integration").
docs/         Playbook, build log, decisions, dependency register and review log.
```

## Prerequisites

- macOS, Linux or WSL: the package scripts use a POSIX shell.
- Node.js 24. The version is in `.nvmrc` and `.node-version` (for example, run `nvm use`).
- pnpm 12. The exact version is pinned in `package.json` (`packageManager`). Run
  `corepack enable` once (Corepack ships with Node.js 24), or install pnpm 12 any other way;
  either picks up the pinned version.
- Docker, from instruction 3 onwards (PostgreSQL and Redis). It is not needed yet.

## Quick start

```sh
pnpm install
pnpm dev
```

- Web app: <http://127.0.0.1:3000>
- API: <http://127.0.0.1:4000/health> returns `{"status":"ok"}`

Press Ctrl+C to stop both. Both servers listen on 127.0.0.1 only. To use other ports, set
`WEB_PORT` and `API_PORT`, for example `WEB_PORT=3010 API_PORT=4010 pnpm dev`. `WEB_HOST` and
`API_HOST` change the bind address; only widen it (for example to `0.0.0.0`) on purpose.

## Common commands

Run these from the repository root.

| Command                         | What it does                                                            |
| ------------------------------- | ----------------------------------------------------------------------- |
| `pnpm dev`                      | Runs the web app and the API in watch mode.                             |
| `pnpm build`                    | Compiles packages/shared and the API to `dist/` and builds the web app. |
| `pnpm start`                    | Runs the production builds. Run `pnpm build` first.                     |
| `pnpm lint`                     | ESLint across the repository; any warning fails.                        |
| `pnpm typecheck`                | TypeScript checks for every package and the root config files.          |
| `pnpm test`                     | Every Vitest suite in one run.                                          |
| `pnpm format`                   | Formats all files with Prettier.                                        |
| `pnpm format:check`             | Checks formatting without changing files.                               |
| `pnpm docker:up`                | Starts PostgreSQL and Redis in Docker and waits until both are healthy. |
| `pnpm docker:down`              | Stops and removes those containers; their data volumes are kept.        |
| `pnpm docker:logs`              | Follows their logs (`pnpm docker:logs postgres` for one); Ctrl+C stops. |
| `pnpm db:migrate`               | Not available yet (instruction 26): prints a notice and fails.          |
| `pnpm db:seed`                  | Not available yet (instruction 26): prints a notice and fails.          |
| `pnpm --filter <package> <cmd>` | Runs one package's script, for example `pnpm --filter @apex/api test`.  |

The `docker:*` scripts first check that Docker, its Compose plugin and its engine are ready, and
say what to do if one is not. Docker Compose reads its passwords from the root `.env` file (see
[infra/README.md](infra/README.md)). `pnpm run` with no arguments lists every script.

## Continuous integration

GitHub Actions runs [.github/workflows/ci.yml](.github/workflows/ci.yml) for every push to `main`
and every pull request. It installs the locked dependencies (`pnpm install --frozen-lockfile`,
with pnpm's package store cached between runs), runs `pnpm peers check`, `pnpm format:check`,
`pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build`, and validates `docker-compose.yml`.
Each check runs even when an earlier one fails, so one run lists every problem.

CI fails on any warning: ESLint warnings, unformatted files, unmet peer dependencies, warnings in
the build output and errors that did not stop the build (Next.js prints both but still finishes
the build), and Docker Compose warnings. [docs/DECISIONS.md](docs/DECISIONS.md) lists exactly
what is enforced, what is not and why. To run the same checks before pushing:

```sh
pnpm peers check && pnpm format:check && pnpm lint && pnpm typecheck && pnpm test
pnpm build > build.log 2>&1 && node scripts/check-build-warnings.ts build.log
```

The second line saves the build's output in `build.log` (git ignores `*.log` files) and runs CI's
check on it. If the build itself fails, the reason is in `build.log`.

## How the packages fit together

The apps import `@apex/shared` as TypeScript source: Next.js, Vitest and Node.js (in
`pnpm dev`) compile or strip its types directly, so there is no build step during development.
The production API (`pnpm start`) runs plain JavaScript: `pnpm build` compiles `packages/shared`
first, and Node.js loads that output through the `@apex/dist` export condition. The reasons and
trade-offs are in [docs/DECISIONS.md](docs/DECISIONS.md).

## Documentation

- [docs/PLAYBOOK.md](docs/PLAYBOOK.md): the owner's build playbook. It is the source document;
  do not edit it.
- [docs/BUILD_LOG.md](docs/BUILD_LOG.md): what changed for each instruction and how to verify it.
- [docs/DECISIONS.md](docs/DECISIONS.md): key decisions and their trade-offs.
- [docs/DEPENDENCIES.md](docs/DEPENDENCIES.md): why each dependency is here.
- [docs/REVIEW_LOG.md](docs/REVIEW_LOG.md): issues found in cross-review and how each was fixed.

## Conventions

- Commit messages follow Conventional Commits: `type(scope): subject`.
- Strict TypeScript, Zod validation at every input boundary, and tests for every feature.
- Every new dependency gets a row in [docs/DEPENDENCIES.md](docs/DEPENDENCIES.md).
- Next.js collects anonymous telemetry by default. To opt out on your machine, run
  `pnpm --filter @apex/web exec next telemetry disable`.
