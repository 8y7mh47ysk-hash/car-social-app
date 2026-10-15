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
| Data       | PostgreSQL, Redis                                                         | Containers in place; schema in Phase 2 (#25) |
| AI         | Ollama (local LLM, never publicly exposed)                                | Phase 5                                      |
| Billing    | Stripe Checkout, Customer Portal and webhooks                             | Phase 6                                      |
| Hosting    | Docker Compose on a home server, reached only through Cloudflare Tunnel   | Compose in place; Tunnel in Phase 7 (#99)    |
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
docs/         Playbook, architecture, build log, decisions, dependency register and review log.
.husky/       Git hooks (see "Git hooks"); their tests are in git-hooks.test.ts.
```

## Prerequisites

- macOS, Linux or WSL: the package scripts use a POSIX shell.
- Node.js 24, release 24.15 or later: some dependencies need it (jsdom 30, which the web app's
  tests use), and `pnpm install` refuses an older Node.js. `.nvmrc` and `.node-version` hold only
  the major version, so `nvm install` gets the latest 24, while `nvm use` picks the newest 24
  already installed.
- pnpm 12. The exact version is pinned in `package.json` (`packageManager`). Run
  `corepack enable` once (Corepack ships with Node.js 24), or install pnpm 12 any other way;
  either picks up the pinned version.
- Docker with Compose (Docker Desktop or OrbStack on macOS, Docker Engine 28 or later on Linux) to
  run PostgreSQL and Redis; see [Local services](#local-services). The apps do not use them yet,
  so `pnpm dev` works without it.

## Quick start

```sh
pnpm install   # also installs the git hooks (see "Git hooks" below)
pnpm dev
```

- Web app: <http://127.0.0.1:3000>
- API: <http://127.0.0.1:4000/health> returns `{"status":"ok"}`

Press Ctrl+C to stop both. Both servers listen on 127.0.0.1 only. To use other ports, set
`WEB_PORT` and `API_PORT`, for example `WEB_PORT=3010 API_PORT=4010 pnpm dev`. `WEB_HOST` and
`API_HOST` change the bind address; only widen it (for example to `0.0.0.0`) on purpose.

## Local services

PostgreSQL (with pgvector) and Redis run in Docker, defined in
[docker-compose.yml](docker-compose.yml):

```sh
cp .env.example .env && chmod 600 .env   # then set both passwords in it (see the file)
docker compose up -d --wait              # starts both and waits until they are healthy
```

Both listen on 127.0.0.1 only (ports 5432 and 6379). Day-to-day commands, connection details and
how to reset the data are in [infra/README.md](infra/README.md).

## Common commands

Run these from the repository root.

| Command                         | What it does                                                            |
| ------------------------------- | ----------------------------------------------------------------------- |
| `pnpm dev`                      | Runs the web app and the API in watch mode.                             |
| `pnpm build`                    | Compiles packages/shared and the API to `dist/` and builds the web app. |
| `pnpm start`                    | Runs the production builds. Run `pnpm build` first.                     |
| `pnpm lint`                     | ESLint across the repository; any warning fails.                        |
| `pnpm typecheck`                | Type-checks every package, the root files, `infra/` and `scripts/`.     |
| `pnpm test`                     | Every Vitest suite in one run.                                          |
| `pnpm format`                   | Formats all files with Prettier.                                        |
| `pnpm format:check`             | Checks formatting without changing files.                               |
| `pnpm docker:up`                | Starts PostgreSQL and Redis in Docker and waits until both are healthy. |
| `pnpm docker:down`              | Removes the containers (app placeholders too); keeps the data volumes.  |
| `pnpm docker:logs`              | Follows their logs (`pnpm docker:logs postgres` for one); Ctrl+C stops. |
| `pnpm db:migrate`               | Not available yet (instruction 26): prints a notice and fails.          |
| `pnpm db:seed`                  | Not available yet (instruction 26): prints a notice and fails.          |
| `pnpm --filter <package> <cmd>` | Runs one package's script, for example `pnpm --filter @apex/api test`.  |

The `docker:*` scripts first check that Docker, its Compose plugin and its engine are ready (on
Linux, Docker Engine 28 or later), and say what to do if one is not. Docker Compose reads its
passwords from the root `.env` file (see [infra/README.md](infra/README.md)). `pnpm run` with no
arguments lists every script.

## Configuration

Each app reads its settings from environment variables and validates them with Zod: the API as
it starts, the web app whenever Next.js starts or builds it. If a variable is missing or invalid,
the command stops and names every problem, without ever printing a value. Settings can also live
in a gitignored `.env` file next to the app: copy the app's template to create one.

| File            | Read by                                                       | Template                |
| --------------- | ------------------------------------------------------------- | ----------------------- |
| `.env`          | Docker Compose, for `docker-compose.yml` (see Local services) | `.env.example`          |
| `apps/api/.env` | The API, in `pnpm dev` and `pnpm start`                       | `apps/api/.env.example` |
| `apps/web/.env` | Next.js, in `pnpm dev`, `pnpm build`, `pnpm start`            | `apps/web/.env.example` |

Variables set in the shell win over the files. `WEB_HOST` and `WEB_PORT` work only from the
shell, because Next.js opens its port before it reads `.env` files. The templates explain each
variable and the rules for adding one; the design is in [docs/DECISIONS.md](docs/DECISIONS.md).

The API logs one JSON object per line. To read its log in a terminal while developing, add
`LOG_FORMAT=pretty` to `apps/api/.env`; how logging works is in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#observability).

## Continuous integration

GitHub Actions runs [.github/workflows/ci.yml](.github/workflows/ci.yml) for every push to `main`
and every pull request. It installs the locked dependencies (`pnpm install --frozen-lockfile`,
with pnpm's package store cached between runs), runs `pnpm peers check`, `pnpm format:check`,
`pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build`, starts the production build to
check that both apps answer, and validates `docker-compose.yml`. Each check runs even when an
earlier one fails, so one run lists every problem.

CI fails on any warning: ESLint warnings, unformatted files, unmet peer dependencies, warnings in
the build output and errors that did not stop the build (Next.js prints both but still finishes
the build), and Docker Compose warnings. [docs/DECISIONS.md](docs/DECISIONS.md) lists exactly
what is enforced, what is not and why. To run the same checks before pushing:

```sh
pnpm peers check && pnpm format:check && pnpm lint && pnpm typecheck && pnpm test
pnpm build > build.log 2>&1 && node scripts/check-build-warnings.ts build.log
node scripts/check-start.ts
```

The second line saves the build's output in `build.log` (git ignores `*.log` files) and runs CI's
check on it. If the build itself fails, the reason is in `build.log`. The third starts both
production builds with `pnpm start` on free ports, as CI does, and stops them once both answer;
if one does not, it says which and prints what the apps printed. Ctrl+C stops it and the apps
it started. With Docker and the root `.env` (see [Local services](#local-services)),
`docker compose --profile '*' config --quiet` runs CI's last check, on `docker-compose.yml`: it
prints nothing when the file is valid.

## How the packages fit together

The apps import `@apex/shared` as TypeScript source: Next.js, Vitest and Node.js (in
`pnpm dev`) compile or strip its types directly, so there is no build step during development.
The production API (`pnpm start`) runs plain JavaScript: `pnpm build` compiles `packages/shared`
first, and Node.js loads that output through the `@apex/dist` export condition. The start script
also turns Node.js's TypeScript support off, so it fails rather than fall back to the TypeScript
source. The reasons and trade-offs are in [docs/DECISIONS.md](docs/DECISIONS.md).

## Git hooks

`pnpm install` installs three git hooks with [husky](https://typicode.github.io/husky) (the
`prepare` script). Run it once in every clone and every git worktree: until then, commits there
are not checked.

- **pre-commit** ([`.husky/pre-commit`](.husky/pre-commit), tasks in
  [`lint-staged.config.ts`](lint-staged.config.ts)) checks exactly what you are committing:
  unstaged changes and untracked files are set aside while it runs and put back afterwards. In
  order, it runs ESLint with `--fix` and then Prettier on the staged files (fixes are added to the
  commit; any ESLint warning fails), `pnpm typecheck` for the whole repository when a staged file
  is TypeScript, JSON or a pnpm workspace file, and `vitest related` for the unit tests that
  import a staged file. Staging a `package.json`, a pnpm lockfile or workspace file, a tsconfig,
  a Vitest config or setup file, a git hook or its config, the API's entrypoint
  (`apps/api/src/server.ts`, which its tests start as a separate process) or a file that tests
  read instead of importing (`docker-compose.yml`, an `.env.example` template, a `.gitignore`, a
  CI workflow or `eslint.config.mjs`) runs every test instead. Deleted files count as staged, so
  deleting a module that is still imported fails the type check. A failing step does not stop the
  others, so one run shows every problem.
- **pre-merge-commit** ([`.husky/pre-merge-commit`](.husky/pre-merge-commit)) runs the same
  checks on what a merge brings in when `git merge` (or a `git pull` that merges) commits without
  conflicts; git runs pre-commit only for commits you make with `git commit`.
- **commit-msg** ([`.husky/commit-msg`](.husky/commit-msg)) checks the message with commitlint
  (see "Commit messages").

If a hook fails, or you press Ctrl+C while it runs, the commit is not made and your files are
left as they were: fix the problem, stage the fix and commit again. A merge whose checks fail is
left in progress with its changes staged: fix the problem and run `git commit`, or give up with
`git merge --abort`. The `git commit` that finishes a merge, after failed checks or after
conflicts, checks everything the merge brings in again, not only the files with conflicts.

`pnpm typecheck` installs dependencies first when `node_modules` is out of date (pnpm's
`verifyDepsBeforeRun` setting), and the hook runs it. So if you stage a `package.json` whose
dependencies no longer match `pnpm-lock.yaml`, the hook installs them and the updated lockfile
becomes part of the commit. To review that change first, run `pnpm install` and stage the
lockfile yourself.

While the pre-commit hook runs, it keeps a backup of your changes in the git stash, in an entry
named `lint-staged automatic backup`. Only Ctrl+C (SIGINT) lets it tidy up. If it is stopped in
any other way (a closed terminal, an editor or tool that cancels the commit or gives up waiting,
`kill`), your unstaged changes and untracked files stay in that entry and the working tree holds
only what was staged. To get everything back exactly as it was, staged and unstaged:

```sh
git stash list                      # find the "lint-staged automatic backup" entry: stash@{n}
git reset --hard                    # the backup also holds what was staged
git stash apply --index stash@{n}   # restores the staged, unstaged and untracked files
git stash drop stash@{n}
```

These are the steps the hook itself takes after a failed check. Run them before you edit again,
because `git reset --hard` discards changes made since the hook stopped. A plain `git stash pop`
is not enough: it stops with a merge conflict on any file that was partly staged.

All worktrees of a repository share one stash list, so the top entry may be another worktree's
backup: pick the entry that names your branch. Two worktrees committing at the same moment can
occasionally leave a stray `lint-staged automatic backup` entry behind; it is only a copy, and
safe to drop.

Typical run times on an Apple M5, measured after the wave w0 review was merged (555 tests) while
other work used the machine: about 1 s for a documentation change, 4 to 5 s for a source change
with related tests, and about 19 s when every test runs.

Hooks also run from scripts and IDEs. They need `node` and `pnpm` on `PATH`; if a GUI git client
cannot find them, set `PATH` in `~/.config/husky/init.sh`, which husky reads before every hook.

In an emergency only, `HUSKY=0 git commit ...` (or `git commit --no-verify`, or
`git merge --no-verify`) skips the hooks, and `HUSKY=0 pnpm install` skips installing them. CI
still runs the lint, format, type and test checks either way, but it does not check commit
messages: only the commit-msg hook does.

## Commit messages

Commits follow [Conventional Commits](https://www.conventionalcommits.org/):

```text
feat(api): add the garage list route

Optional body, after a blank line, explaining what changed and why.

Co-Authored-By: Name <email@example.com>
```

- `type` is one of `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`,
  `style` or `test`. The `(scope)` is optional, for example `api`, `web`, `shared` or `infra`.
  Add `!` after the type or scope for a breaking change.
- The type, scope and subject are lowercase. Put names that need capitals in backticks or
  quotes, which the case rule skips: `` fix(api): validate `API_PORT` ``.
- The subject has at most 72 characters and does not end with a full stop; the first line has
  at most 100.
- Body and footer lines have at most 100 characters (a line that holds a URL may be longer).
- A blank line comes before the body and before the footer. A line that starts with one word
  followed by a colon and a space, such as `Co-Authored-By: ...` or `Refs: ...`, starts the
  footer, so it too needs a blank line before it; reword such a line if it belongs to the body.
  So does a line that starts with one word, a space and `#`, such as `the #6 entry ...`: when a
  body line wraps there, rewrap it or write "instruction 6" instead.
- Messages that git writes itself are accepted as they are: merges, reverts, and `fixup!`,
  `squash!` and `amend!` commits.

To check a message without committing: `printf 'feat: add x\n' | pnpm exec commitlint`.

## Documentation

- [docs/PLAYBOOK.md](docs/PLAYBOOK.md): the owner's build playbook. It is the source document;
  do not edit it.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how the system fits together, with diagrams of
  every component, the trust boundaries, the request flow and the deployment.
- [docs/BUILD_LOG.md](docs/BUILD_LOG.md): what changed for each instruction and how to verify it.
- [docs/DECISIONS.md](docs/DECISIONS.md): key decisions and their trade-offs.
- [docs/DEPENDENCIES.md](docs/DEPENDENCIES.md): why each dependency is here.
- [docs/REVIEW_LOG.md](docs/REVIEW_LOG.md): issues found in cross-review and how each was fixed.

## Conventions

- Commit messages follow Conventional Commits: `type(scope): subject` (see "Commit messages").
- Strict TypeScript, Zod validation at every input boundary, and tests for every feature.
- Every new dependency gets a row in [docs/DEPENDENCIES.md](docs/DEPENDENCIES.md).
- Next.js collects anonymous telemetry by default. To opt out on your machine, run
  `pnpm --filter @apex/web exec next telemetry disable`.
