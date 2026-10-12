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

## #5 - GitHub Actions CI

**What changed**

- `.github/workflows/ci.yml`: on every push to `main` and every pull request, one job ("Checks")
  on `ubuntu-26.04` sets up pnpm (the `packageManager` version) and Node.js (`.nvmrc`), restores
  pnpm's package store from the cache, runs `pnpm install --frozen-lockfile`, then
  `pnpm peers check`, `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test` and
  `pnpm build`, fails on warnings in the build output and validates `docker-compose.yml` (with
  every profile, failing on any warning). Every check runs even when an earlier one failed.
  Read-only token, no stored credentials, every action pinned to a commit SHA, 15-minute limit,
  superseded pull-request runs cancelled.
- `scripts/check-build-warnings.ts`: reads the saved `pnpm build` output and fails if Next.js,
  Node.js or pnpm printed a warning, or an error that did not stop the build, because Next.js
  prints both and still finishes the build.
- `scripts/ci-workflow.test.ts`: holds every workflow to the rules above (pinned actions,
  explicit permissions, time limits, no stored credentials) and checks that every `pnpm` script
  and `scripts/` file CI calls exists. It also runs the Build, build-warning and Compose steps'
  scripts the way GitHub runs them, with stand-ins for `pnpm` and `docker`, so a failed build,
  a warning or Compose output is shown to fail its step. `scripts/check-build-warnings.test.ts`
  uses real build output from this repository.
- `.github/actionlint.yaml`: tells actionlint that `ubuntu-26.04` is a real runner label.
- README section "Continuous integration"; DECISIONS entries on the CI design, on what "fail on
  any warning" covers and on supply-chain safety.

**How to verify**

GitHub runs the workflow only once the repository is on GitHub (see Owner actions). Locally,
from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm exec vitest run --project scripts            # "Test Files  4 passed (4)", "Tests  53 passed (53)"
pnpm peers check                                  # "No peer dependency issues found"
pnpm build 2>&1 | tee build.log                   # the route table, then "Done"
node scripts/check-build-warnings.ts build.log    # "The build printed no warnings or errors.", status 0
printf 'apps/web build: ⚠ Example warning\n' >> build.log
node scripts/check-build-warnings.ts build.log    # lists the line and exits with status 1
rm build.log
```

With [actionlint](https://github.com/rhysd/actionlint) installed, `actionlint` in the repository
root prints nothing and exits with status 0. With [zizmor](https://docs.zizmor.sh) installed,
`zizmor --offline .github/workflows/ci.yml` ends with "No findings to report. Good job!". Neither
runs in CI (docs/DECISIONS.md explains why). With Docker installed and the root `.env` created
(instruction 3), `docker compose --profile '*' config --quiet` prints nothing.

After the first push to GitHub: the repository's Actions tab shows the "CI" workflow, and its
"Checks" job is green with every step ticked, from "Check out the repository" to "Validate
docker-compose.yml". To see CI fail on a warning, use GitHub's web editor, which runs no local git
hooks (the pre-commit hook from instruction 2 would stop this change on your machine): on a new
branch, add the line `// eslint-disable-next-line no-console` at the top of
`apps/api/src/routes/health.ts` and open a pull request. The Lint step fails with "Unused
eslint-disable directive" and "ESLint found too many warnings (maximum: 0).", the later checks
still run, and the pull request shows "Checks" as failed. Close it and delete the branch.

**Dependencies added**

`yaml` (root devDependency) to parse workflows in the tests; `zod` (root devDependency, added for
instruction 7) also validates them. GitHub Actions, pinned to commit SHAs: `actions/checkout`
v7.0.1, `pnpm/action-setup` v6.1.0 and `actions/setup-node` v7.1.0. Reasons and alternatives are
in `docs/DEPENDENCIES.md`.

**Owner actions**

- Create the GitHub repository (private) and push `main`: for example
  `git remote add origin git@github.com:<you>/apex-garage.git`, then `git push -u origin main`.
  The first push runs CI.
- Protect `main` with a branch ruleset (Settings → Rules → Rulesets) that requires the "Checks"
  status check to pass, so nothing merges with failing checks.
- Under Settings → Actions → General, keep "Workflow permissions" at "Read repository contents
  and packages permissions". If your plan offers it, also turn on the policy that requires
  actions to be pinned to a full-length commit SHA.

**Notes & limitations**

- The workflow has not run on GitHub yet, because there is no repository. It was checked with
  actionlint 1.7.12 (with shellcheck 0.11.0 for the `run:` scripts) and zizmor 1.30.1 (offline
  audits; its online audits need a GitHub token), both without findings. A local simulation then
  ran every `run:` step of `ci.yml` in order, with GitHub's shell command
  `bash --noprofile --norc -eo pipefail`, the workflow's environment variables and `if:`
  conditions, and Docker Compose 5.1.3 (the runner image's version), in fresh clones:
  - of this branch alone: every check passed (9 test files, 80 tests) except the Compose step,
    which stops at `cp .env.example .env` because `docker-compose.yml` and `.env.example` come
    from instruction 3 (Bravo's branch);
  - of this branch merged with the committed branches of instructions 1-4 (Echo's work for
    instructions 6 and 8 was not committed yet): every step passed, with 16 test files and 262
    tests, and the merge commit passed the git hooks of instruction 2;
  - of that merge with five problems added at once (a formatting error, an ESLint warning, a
    failing test, a page that logs an error while it is prerendered and an unset Compose
    variable): each failed its own step, while the peer check, type check and build still ran
    and passed;
  - with a stale lockfile: the install step failed with `ERR_PNPM_OUTDATED_LOCKFILE`.
- A frozen install for the runner's platform,
  `pnpm install --frozen-lockfile --os linux --cpu x64 --libc glibc`, succeeded and fetched the
  Linux builds of Next.js's SWC, Rolldown, Tailwind's Oxide, Lightning CSS, sharp and
  unrs-resolver, with no install script missing from `allowBuilds`. The action steps, the runner
  image and the cache can only be confirmed by the first real run.
- `pnpm/action-setup` must stay before `actions/setup-node`: setup-node asks pnpm where its store
  is (`pnpm store path`). Next.js's own build cache is not cached, so every run prints its "No
  build cache found" notice, which the warning check ignores.
- The build-log check recognises warnings and errors by how they are written (docs/DECISIONS.md
  lists the formats). It cannot see a plain `console.warn` that runs while Next.js prerenders a
  page: Next.js prints the bare message (tested). Console output from passing tests is not checked
  either.
- After Alpha's git hooks (instruction 2) are merged, a commit that changes only
  `.github/workflows/ci.yml` runs no tests in the pre-commit hook ("No test files found"), because
  `vitest related` cannot see that `scripts/ci-workflow.test.ts` reads the workflow. Adding
  `` `${root}.github/workflows/*` `` to `forceRerunTriggers` in `vitest.config.ts` makes such a
  commit run every test (checked on a trial merge: 262 tests). CI runs them either way.
- `scripts/check-build-warnings.ts` and `scripts/check-docker.ts` need Node.js 24.2 or later
  (`import.meta.main`). CI and `.nvmrc` install the latest Node.js 24; on an older one the tests
  fail, so the checks cannot pass quietly. `engines` still allows 24.0 (see docs/DECISIONS.md).
- The action SHAs do not update themselves; Dependabot arrives with instruction 106.

## #7 - Developer scripts

**What changed**

- Root `package.json` scripts, next to `dev`, `build`, `test` and the others:
  - `docker:up` (`docker compose up --detach --wait`: starts PostgreSQL and Redis and returns
    once both are healthy), `docker:down` (removes the containers and keeps the data volumes)
    and `docker:logs` (follows the logs; `pnpm docker:logs postgres` for one service).
  - `db:migrate` and `db:seed`: placeholders that print "not available yet" and exit with status
    1 until instruction 26 adds migrations and seed data.
- `scripts/check-docker.ts` runs before each `docker:*` script. It explains what to do when
  Docker is not installed, has no Compose plugin (`docker compose`) or its engine is not running
  or not reachable, with a link to Docker's documentation for each case.
- Tests: `scripts/check-docker.test.ts`, and `scripts/package-scripts.test.ts`, which runs the
  real `package.json` scripts the way pnpm does against a stand-in `docker` command.
  `scripts/vitest.config.ts` makes them a Vitest project of the root config; the root
  `tsconfig.json` now type-checks `scripts/`.
- No Makefile (see docs/DECISIONS.md). README: the new commands and the repository layout.

**How to verify**

```sh
pnpm run                              # lists db:migrate, db:seed, docker:up, docker:down, docker:logs
pnpm db:migrate; echo "status $?"     # db:migrate: not available yet. ... instruction 26. ... status 1
pnpm db:seed; echo "status $?"        # db:seed: not available yet. ... instruction 26. ... status 1
pnpm exec vitest run --project scripts  # "Tests  53 passed (53)"
```

Without Docker, `pnpm docker:up` prints "Docker is not installed, or the `docker` command is not
on your PATH." with an install link, and exits with status 1. With Docker installed but not
running (Docker Desktop quit), it prints "Docker is installed, but its engine is not running, or
this user cannot reach it." instead.

With Docker running and the root `.env` set up (instruction 3, `cp .env.example .env` and set
both passwords):

```sh
pnpm docker:up          # returns once both services are healthy
docker compose ps       # postgres and redis show "(healthy)"
pnpm docker:logs redis  # follows the Redis log; press Ctrl+C to stop
pnpm docker:down        # removes the containers
docker volume ls        # apex-garage_postgres-data and apex-garage_redis-data are still there
```

**Dependencies added**

`zod` (root devDependency) to validate `package.json` in the tests. See `docs/DEPENDENCIES.md`.

**Owner actions**

To use the `docker:*` scripts, install Docker Desktop or OrbStack (macOS) or Docker Engine with
the Compose plugin (Linux), as instruction 3 describes. Nothing else.

**Notes & limitations**

- The `docker:*` scripts have not been run against a real Docker engine: this machine has no
  Docker. The tests use a stand-in `docker` command, and CI validates the Compose file.
- `db:migrate` and `db:seed` fail on purpose until instruction 26 replaces them.
- The scripts need a POSIX shell, like the existing ones. The tests pass with `/bin/sh` as bash
  (macOS) and as dash (as on Ubuntu, checked with macOS's `/bin/dash`).
- The Docker check adds about 0.1 to 0.3 seconds to each `docker:*` command.
