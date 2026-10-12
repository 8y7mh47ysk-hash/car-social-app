# Build log

One entry per playbook instruction, following the Master Context rule "after each task, list what
changed and how I verify it works". Each entry has the heading `## #N - <title>` and five parts:
**What changed**, **How to verify** (exact commands and what you should see), **Dependencies
added**, **Owner actions** and **Notes & limitations**.

## #1 - Monorepo foundation

**What changed**

- A pnpm 12 workspace with `apps/web`, `apps/api`, `packages/shared` and `infra/` (documentation
  only for now). Node.js 24 and pnpm 12.11.2 are pinned (`.nvmrc`, `.node-version`,
  `packageManager`, `engines`).
- `tsconfig.base.json`: strict TypeScript shared by every package, plus a root `tsconfig.json`
  for the root config files.
- `@apex/shared`: `healthResponseSchema` and its `HealthResponse` type (Zod), and `APP_NAME`.
  Apps consume it as TypeScript source; the production API loads its compiled `dist/` output.
- `@apex/api`: Fastify 5 app factory `buildApp(options)` in `src/app.ts`, `GET /health`
  returning `{"status":"ok"}` in `src/routes/health.ts`, and the entrypoint `src/server.ts`. The
  entrypoint listens on `127.0.0.1:4000` by default (`API_HOST` and `API_PORT`, validated with
  Zod) and shuts down cleanly on SIGINT or SIGTERM.
- `@apex/web`: Next.js 16 (App Router, React 19) with Tailwind CSS 4 and a placeholder home page
  that lists the first planned features. It listens on `127.0.0.1:3000` by default (`WEB_HOST`
  and `WEB_PORT`).
- Tooling: one ESLint 9 flat config for the whole repository (type-aware TypeScript rules,
  Next.js, React Hooks and strict jsx-a11y rules for the web app, Prettier compatibility),
  Prettier 3, and Vitest 4 projects with tests in every package (27 tests).
- Root scripts: `dev`, `build`, `start`, `lint`, `typecheck`, `test`, `format`, `format:check`.
- Repository conventions: `.gitattributes` (LF line endings, union merges for the shared docs
  logs), `.gitignore`, `.editorconfig`, `.prettierignore` (protects `docs/PLAYBOOK.md`), the
  README, `infra/README.md` and these docs logs.

**How to verify**

Run from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm lint           # prints only the eslint command line and exits with code 0
pnpm typecheck      # shared, api and web each report "Done"
pnpm test           # "Test Files  5 passed (5)" and "Tests  27 passed (27)"
pnpm format:check   # "All matched files use Prettier code style!"
pnpm build          # Next.js lists route "/" as "(Static)"; creates packages/shared/dist and apps/api/dist
```

Development servers (two terminals):

```sh
pnpm dev                                         # terminal 1: starts both apps
curl http://127.0.0.1:4000/health                # terminal 2: prints {"status":"ok"}
curl -s http://127.0.0.1:3000 | grep -o '<h1[^>]*>[^<]*</h1>'   # ends in >Apex Garage</h1>
```

Then press Ctrl+C in terminal 1: both apps stop and the API logs `"msg":"shutting down"`. Open
<http://127.0.0.1:3000> in a browser to see the placeholder page. To use other ports, run
`WEB_PORT=3010 API_PORT=4010 pnpm dev`.

Production servers: run `pnpm build`, then `pnpm start`, and repeat the two `curl` commands.

**Dependencies added**

TypeScript 6.0, `@types/node` 24, ESLint 9.39 with `@eslint/js`, typescript-eslint,
eslint-config-next, eslint-plugin-jsx-a11y and eslint-config-prettier, Prettier 3.9, Vitest 4.1,
Zod 4.6, Fastify 5.12, Next.js 16.4, React 19.3, Tailwind CSS 4.3 with `@tailwindcss/postcss`,
jsdom and Testing Library (`react`, `dom`, `jest-dom`). Reasons and alternatives for each are in
`docs/DEPENDENCIES.md`.

**Owner actions**

None for this instruction.

**Notes & limitations**

- Scripts need a POSIX shell (macOS, Linux or WSL).
- `pnpm start` needs `pnpm build` first: the production API loads packages/shared from `dist/`
  through `node --conditions=@apex/dist`. Running `node dist/server.js` without that flag fails
  with `ERR_MODULE_NOT_FOUND`.
- Pressing Ctrl+C on `pnpm start` makes pnpm print `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL`, because
  `next start` exits with code 130 when interrupted. Both servers do stop.
- `GET /health` is only a smoke check; real health and readiness checks are instruction 33.
- API logging is Fastify's default pino output, which logs each request's full URL. Structured
  logging with request IDs, and bounding what gets logged, is instruction 8.
- The API's environment handling covers only `API_HOST` and `API_PORT`. The typed environment
  loader and `.env.example` files are instruction 4.
- There are no git hooks yet (instruction 2) and no CI yet (instruction 5).
- Next.js collects anonymous telemetry by default; the README explains how to opt out.

## #2 - Git hooks and conventional commits

**What changed**

- `pnpm install` now installs two git hooks with husky 9: the root `prepare` script points git's
  `core.hooksPath` at `.husky/_`, a generated and gitignored folder. Run `pnpm install` once in
  every clone and git worktree.
- `.husky/pre-commit` runs lint-staged with `lint-staged.config.ts` on exactly what is being
  committed (unstaged changes and untracked files are set aside meanwhile and restored after, and
  deleted files count as staged). One task at a time: ESLint `--max-warnings=0 --fix`, then
  Prettier, on staged code; Prettier on other staged files; `pnpm typecheck` for the whole
  repository when a staged file is TypeScript, JSON or a pnpm workspace file; then
  `vitest related --run --passWithNoTests` for the tests that import a staged file. ESLint and
  Prettier fixes are added to the commit. A failing task does not stop the others.
- `.husky/commit-msg` runs commitlint with `commitlint.config.mjs`: Conventional Commits
  (`@commitlint/config-conventional`) plus the team rules (lowercase scope and subject, subject at
  most 72 characters, a blank line before the body and before the footer, so the
  `Co-Authored-By:` trailer passes when it has a paragraph of its own).
- Root `vitest.config.ts`: a `tooling` project for tests at the repository root, and
  `forceRerunTriggers` so that staging dependency, tsconfig, Vitest, hook or hook-config files
  runs every test.
- `git-hooks.test.ts` (48 tests): 27 commit messages through the real commit-msg hook and
  commitlint config; 10 pre-commit scenarios that run the real lint-staged with this
  repository's config in scratch git repositories, with stand-ins for ESLint, Prettier, pnpm and
  Vitest that record their calls (order, files, hiding and restoring, deleted files, fixes being
  staged, a failure in each tool); and 11 runs of the real `vitest related` in this checkout,
  which check that staging a rerun-trigger file runs every test and an unrelated file runs none.
- README: "Git hooks" and "Commit messages" sections and a `.husky/` line in the layout.

**How to verify**

Run from the repository root:

```sh
pnpm install --frozen-lockfile          # a fresh install prints ". prepare$ husky"
git config --get core.hooksPath         # prints .husky/_
pnpm exec vitest run --project tooling  # "Tests  48 passed (48)"
pnpm lint && pnpm typecheck && pnpm test
```

Then try the hooks in a scratch clone (not in your main checkout). Each rejected commit prints
the reason and leaves your files as they were:

```sh
git clone . /tmp/apex-hooks-try && cd /tmp/apex-hooks-try && pnpm install --frozen-lockfile
git commit --allow-empty -m "Add stuff"         # rejected: [subject-empty] [type-empty]
git commit --allow-empty -m "feat: Add stuff"   # rejected: [subject-case]
printf 'export const parse = (text: string): any => JSON.parse(text);\n' > apps/api/src/try.ts
git add apps/api/src/try.ts
git commit -m "feat(api): add a parser"         # rejected: @typescript-eslint/no-explicit-any
printf 'export const port: number = "4000";\n' > apps/api/src/try.ts
git add apps/api/src/try.ts
git commit -m "feat(api): add a port"           # rejected: error TS2322
git rm --quiet --force apps/api/src/try.ts
sed -i.bak 's/z.strictObject(/z.object(/' packages/shared/src/health.ts
rm packages/shared/src/health.ts.bak
git add packages/shared/src/health.ts
git commit -m "fix(shared): relax the schema"   # rejected: × rejects an unexpected extra field
git restore --staged --worktree packages/shared/src/health.ts
printf '\nA note.\n' >> infra/README.md && git add infra/README.md
git commit -m "docs(infra): add a note"         # passes in about a second
cd - && rm -rf /tmp/apex-hooks-try
```

Measured on the Apple M5 in a scratch clone, committing from a non-interactive shell:

| Commit                                                  | Result   | Time   |
| ------------------------------------------------------- | -------- | ------ |
| Nothing staged (`--allow-empty`): the hooks' overhead   | passes   | 0.3 s  |
| A bad message                                           | rejected | 0.3 s  |
| A documentation change                                  | passes   | 0.7 s  |
| A deleted module that is still imported                 | rejected | 1.2 s  |
| A type error                                            | rejected | 2.6 s  |
| A lint error                                            | rejected | 2.7 s  |
| A change that breaks a related test                     | rejected | 3.2 s  |
| A source file and its test (ESLint and Prettier fix it) | passes   | 3.0 s  |
| `git commit -a` with two changed files                  | passes   | 2.9 s  |
| `package.json` staged, so every test runs               | passes   | 12.9 s |

That run also checked that a rejected commit keeps the staged file, its unstaged edit and an
untracked file; that a new git worktree runs the hooks once `pnpm install` has run in it; and
that `HUSKY=0` skips them. Separate checks in a scratch clone showed that Ctrl+C during
the type check restores everything and leaves no stash behind, and that a merge-conflict
resolution commit passes the hooks and is still a merge commit with both parents.

**Dependencies added**

`husky`, `lint-staged`, `@commitlint/cli` and `@commitlint/config-conventional`, as root
development dependencies. They add 57 packages to the lockfile: husky; lint-staged and 2 of its
dependencies that were not there yet; and 53 for commitlint. None has an install script. Reasons
and alternatives are in `docs/DEPENDENCIES.md`.

**Owner actions**

None. If you commit from a GUI git client that cannot find `node` or `pnpm`, add a `PATH` line to
`~/.config/husky/init.sh` (see the README section "Git hooks").

**Notes & limitations**

- Hooks are local and can be skipped (`git commit --no-verify`, `HUSKY=0`); CI (instruction 5) is
  the check that cannot be bypassed. Skip them only in an emergency.
- husky stores `core.hooksPath` in the repository's git config, which every worktree shares; a
  worktree runs the hooks only once `pnpm install` has run in it.
- `vitest related` follows imports only. Tests that run code in a separate process are not
  selected when that code changes: editing `apps/api/src/server.ts` runs no tests in the hook,
  because `server.test.ts` starts it with `node`. CI runs every test.
- Changing `eslint.config.mjs` or the Prettier settings lints and formats only the staged files;
  run `pnpm lint` and `pnpm format:check` to check the whole repository.
- Untracked files are stashed and restored on every commit; keep large scratch files gitignored.
- The hook's backup lives in the git stash, which all worktrees of a repository share. Committing
  in two worktrees at the same moment worked every time (30 commits in 15 simultaneous pairs, no
  failures, nothing lost) but left a stray `lint-staged automatic backup` entry 3 times; such an
  entry is a copy and safe to drop. With several worktrees, pop your own stash entry by name, not
  the top one, which may be another worktree's backup during a commit.
- When the type check fails in one package, `pnpm --recursive` stops the other packages' checks,
  so the output also shows `Command failed with signal SIGKILL` for them.
- The commit message rules are stricter than `config-conventional`: names in a subject must be
  lowercase or in backticks or quotes. A body line such as `Note: ...` directly after other body
  text is read as the start of the footer and rejected; add a blank line before it.

## #3 - Docker Compose services

**What changed**

- `docker-compose.yml` at the repository root, project name `apex-garage`:
  - `postgres`: PostgreSQL 18.6 with pgvector 0.8.7 available (`pgvector/pgvector`, Debian 13),
    data in the named volume `postgres-data`, health check `pg_isready` over TCP.
  - `redis`: Redis 8.10.2 (Alpine) with a required password and the append-only file on, data in
    the named volume `redis-data`, health check `redis-cli -e ping`.
  - `api` and `web`: placeholders in the `app` profile, so a plain `docker compose up -d` starts
    only `postgres` and `redis`. Each prints a reminder to run the app on the host with
    `pnpm dev` and exits with status 1; `api` starts only after both services are healthy.
  - Secure defaults: ports published on `127.0.0.1` only (5432 and 6379, changeable), no default
    passwords (Compose refuses to run without them), every image pinned to a tag and a
    multi-platform digest, restart policy `unless-stopped`, log rotation (Docker's `local`
    driver, at most 100 MB per container).
- `.env.example` at the root: the template for the root `.env` that Compose reads. Both passwords
  are blank and required; the optional settings (user, database, ports, project name) are
  commented out with their defaults.
- `infra/compose.test.ts` (17 tests, Vitest project `infra`): static checks of the compose file
  and the template, which need no Docker. The root `vitest.config.ts` runs them and the root
  `tsconfig.json` type-checks them.
- `infra/README.md` explains the services: first run, everyday commands, connecting, changing a
  password, resetting data, health checks, the placeholders and security notes. The root README
  gained a short "Local services" section, an updated Docker prerequisite and the stack status.

**How to verify**

Without Docker (this is what ran on the build machine):

```sh
pnpm install --frozen-lockfile
pnpm exec vitest run --project infra   # "Tests  17 passed (17)"
pnpm test                              # "Test Files  6 passed (6)" and "Tests  44 passed (44)"
pnpm typecheck && pnpm lint            # both exit with code 0
```

With Docker installed (see Owner actions; Docker is not installed on the build machine, so these
were not run here):

```sh
cp .env.example .env     # then set POSTGRES_PASSWORD and REDIS_PASSWORD; `openssl rand -hex 32`
                         # prints a suitable value (run it once for each)
docker compose config --quiet                     # no output, exit code 0
docker compose config --services                  # postgres and redis only
docker compose --profile app config --services    # postgres, redis, api and web
docker compose up -d --wait                       # both containers reported "Healthy"
docker compose ps                                 # "(healthy)" for both; ports 127.0.0.1:5432
                                                  # and 127.0.0.1:6379
docker compose exec postgres psql -U postgres -d apex_garage -tAc "SHOW server_version"
                                                  # 18.6 (Debian 18.6-1.pgdg13+2)
docker compose exec postgres psql -U postgres -d apex_garage -tAc \
  "SELECT default_version FROM pg_available_extensions WHERE name = 'vector'"   # 0.8.7
docker compose exec redis redis-cli ping          # PONG
docker compose exec -e REDISCLI_AUTH=wrong redis redis-cli -e ping; echo "exit $?"
                                                  # AUTH failed: WRONGPASS ..., then exit 1
docker compose exec redis redis-cli SET apex:check kept
docker compose down && docker compose up -d --wait
docker compose exec redis redis-cli GET apex:check   # "kept": the named volume survived
docker compose exec redis redis-cli DEL apex:check
docker compose --profile app up api               # prints "Placeholder: the API has no image
                                                  # yet. Run it on the host: pnpm dev" and the
                                                  # container exits with code 1
docker compose down                               # removes the containers, keeps the data
```

To see that the passwords are required, run `POSTGRES_PASSWORD= docker compose config --quiet`
(an empty value in the shell overrides `.env`): it fails with "required variable
POSTGRES_PASSWORD is missing a value: set it in .env (see .env.example)" and exit code 1.

Checks run on the build machine without Docker, outside the repository:

- The real Compose parser: the standalone Docker Compose v5.6.0 binary for macOS (SHA-256
  checked against the release's `checksums.txt`) ran `docker compose config` on the file. With
  both passwords set it is valid, `config --services` lists only `postgres` and `redis`, and
  `--profile app` adds `api` and `web`. Without them, or with empty values, it fails with the
  messages above, also for `ps`, `logs` and `down`. `COMPOSE_PROJECT_NAME` in `.env` renames the
  project and its volumes.
- The compose-spec JSON Schema (draft 2020-12; the compose-spec repository's copy and the copy in
  compose-go v2.16.1, which Compose v5.6.0 uses), checked with Ajv 8.20.0: valid as written and
  after interpolation, and four deliberately invalid documents were rejected.
- Mutation check: 23 deliberate breakages of `docker-compose.yml` and `.env.example` (for
  example a port on all interfaces, a password default, the Redis check without `-e`, a missing
  digest, a drifted default in the template); `infra/compose.test.ts` failed on every one.
- The Redis health check, against Redis 8.10.2 built from the release tarball (SHA-256 checked
  against redis-hashes) over a Unix socket: `redis-cli -e ping` exits 0 only on `PONG`, and 1
  with a wrong or missing password, while the data loads and when the server is down.
- The images, read from the registry: each digest is a multi-platform index with linux/amd64 and
  linux/arm64, and the PostgreSQL image reports `PG_VERSION=18.6-1.pgdg13+2` and
  `PGDATA=/var/lib/postgresql/18/docker`.

**Dependencies added**

- `yaml` (root, dev): parses `docker-compose.yml` in the infra tests.
- `zod` is now also a root dev dependency (the catalog version), to validate the parsed file.
- Container images (not npm packages): `pgvector/pgvector:0.8.7-pg18-trixie`,
  `redis:8.10.2-alpine3.23` and `alpine:3.24.2`, each pinned to its digest.

Reasons and alternatives are in `docs/DEPENDENCIES.md` and `docs/DECISIONS.md`.

**Owner actions**

- Install Docker on the development Mac: Docker Desktop (free for personal use and for
  businesses with fewer than 250 employees and under $10 million revenue) or OrbStack (free for
  personal, non-commercial use; business use needs its paid Pro plan). Then run
  `cp .env.example .env`, set both passwords, run `docker compose up -d --wait` (or the
  `docker:up` script once instruction 7 adds it) and check that `docker compose ps` shows both
  services healthy. The commands under "How to verify" check the rest.
- Confirm the Redis licence choice: Redis 8 under its AGPLv3 option, used unmodified, or switch
  to Valkey (BSD-3-Clause), which is a one-line image change. The reasoning is in
  `docs/DECISIONS.md`; it is not legal advice.

**Notes & limitations**

- Docker is not installed on the build machine, so the containers were never started here. The
  file was checked with the real Compose parser, the JSON Schema and the tests above; the health
  check commands were checked against the images' entrypoints, the PostgreSQL documentation and
  a Redis source build.
- The apps do not use PostgreSQL or Redis yet; that starts in Phase 2. Connection URLs are in
  `infra/README.md`.
- Every `docker compose` command for this project needs the two passwords, so CI must pass
  throwaway values: `POSTGRES_PASSWORD=ci REDIS_PASSWORD=ci docker compose config --quiet`.
- The tests read `docker-compose.yml` and `.env.example` from disk, so `vitest related` (used by
  the pre-commit hook from instruction 2) cannot connect a change to those files with
  `infra/compose.test.ts`; they need to be listed in the root Vitest config's
  `forceRerunTriggers` once that config exists. `pnpm test` and CI always run them.
- `POSTGRES_PASSWORD`, `POSTGRES_USER` and `POSTGRES_DB` apply only when the data volume is
  first created; `infra/README.md` explains how to change the password later.
- The passwords are visible through `docker inspect` (instruction 104 moves them to Docker
  secrets); the API will connect as the PostgreSQL superuser until a least-privilege role arrives
  with the migrations (instruction 26); other containers on the Compose network can reach both
  services (instruction 103 adds an internal network); digest pins need deliberate updates
  (instruction 106 automates them).
- `docker compose --profile app up` ends with both placeholders exited with status 1, on purpose,
  until the apps get real images.
- The health checks' one-second polling while a service starts (`start_interval`) needs Docker
  Engine 25 or later and Compose 2.20.2 or later.
