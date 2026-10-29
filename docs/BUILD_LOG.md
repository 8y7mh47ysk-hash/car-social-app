# Build log

One entry per playbook instruction, following the Master Context rule "after each task, list what
changed and how I verify it works". Each entry has the heading `## #N - <title>` and five parts:
**What changed**, **How to verify** (exact commands and what you should see), **Dependencies
added**, **Owner actions** and **Notes & limitations**.

Test counts in an entry are those the repository had when that instruction was finished. Later
instructions add tests, so commands that run several instructions' tests (`pnpm test`, one
package's tests or a whole Vitest project) report more; a command that names a single test file
keeps its count unless the entry is updated.

The command blocks use `#` for comments, often to say what a command should print. zsh, the
default shell on macOS, does not treat `#` typed or pasted at its prompt as the start of a comment
unless its `interactivecomments` option is on, and passes the comment's words to the command: a
commit then fails on a pathspec named `#`, which looks like the hook rejecting it. So in zsh, run
`setopt interactivecomments` before you paste these commands (or add that line to `~/.zshrc`);
bash needs nothing.

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
  through `node --conditions=@apex/dist`, and fails with `ERR_MODULE_NOT_FOUND` when it has not
  been built. (This note said that `node dist/server.js` without the flag fails the same way; it
  started instead, see "Review fixes (wave w0, round 1)".)
- Pressing Ctrl+C on `pnpm start` makes pnpm print `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL`, because
  `next start` exits with code 130 when interrupted. Both servers do stop, but pnpm then stops the
  API at once instead of letting it finish open requests (corrected in the wave w0 review; see
  "Review fixes (wave w0, round 1)").
- `GET /health` is only a smoke check; real health and readiness checks are instruction 33.
- API logging is Fastify's default pino output, which logs each request's full URL. Structured
  logging with request IDs, and bounding what gets logged, is instruction 8.
- The API's environment handling covers only `API_HOST` and `API_PORT`. The typed environment
  loader and `.env.example` files are instruction 4.
- There are no git hooks yet (instruction 2) and no CI yet (instruction 5).
- Next.js collects anonymous telemetry by default; the README explains how to opt out.

**Review fixes (wave w0, round 1)**

Echo reviewed instructions 1 and 2 and took them over from Alpha. Checked by running them, in this
checkout and in scratch clones, with ports 3050 and 4050: the "How to verify" steps of both
instructions in a fresh clone; `pnpm dev` and `pnpm start`, for each app alone and both together,
stopped with Ctrl+C (SIGINT to the process group), the API also with a request still open, and
started with the web or the API port already taken (no process was left behind in any case); the
API signalled while it starts; `pnpm typecheck` while `next dev` runs, and `next dev` started
again after being killed with SIGKILL; offline (`--offline`) and production (`--prod`) installs,
and an install without `.git`; and Corepack fetching pnpm 12.11.2. Fixes, each with a test that
fails without it:

- `pnpm typecheck` failed after a route was deleted or renamed once `next dev` had run. Next.js
  keeps a copy of the route types in `apps/web/.next/dev/types`, which `next typegen` does not
  rewrite, and the stale copy still imported the deleted page (error TS2307, "Cannot find module
  '../../../src/app/probe/page.js'"). Until `.next` was deleted, the pre-commit hook rejected
  every commit that staged TypeScript or JSON. The web app's `typecheck` script now uses
  `apps/web/tsconfig.typecheck.json`, which leaves `.next/dev` out, as `next build` does (it did
  not: corrected in round 2, below); editors keep using tsconfig.json. Test: `typecheck.test.ts`,
  on a copy of the app.
- Nothing tested the production start. `apps/api/src/production.test.ts` copies packages/shared
  and the API to a temporary folder, runs their build scripts and then the API's start script:
  GET /health and a clean SIGTERM. It never touches this checkout's `dist/` folders, so it cannot
  race a `pnpm build` or `pnpm start` running at the same time.
- The note above claimed that the API without `--conditions=@apex/dist` fails with
  `ERR_MODULE_NOT_FOUND`. It started and ran packages/shared's TypeScript source, so a start
  command without the flag would have gone unnoticed. The start script now passes
  `--no-strip-types`, which turns Node.js's TypeScript support off, and fails instead
  (`ERR_UNKNOWN_FILE_EXTENSION`); tested.
- `engines.node` said `>=24`, and pnpm ignored the field altogether (no warning even with
  `>=99`). The real minimum is 24.15: jsdom 30 and three of its dependencies declare
  `^22.22.2 || ^24.15.0 || >=26.0.0`. It is now `>=24.15`, and `engineStrict: true` in
  `pnpm-workspace.yaml` makes `pnpm install` refuse an older Node.js with
  `ERR_PNPM_UNSUPPORTED_ENGINE`. `workspace.test.ts` checks both, on a copy of the workspace: an
  install for a Node.js that `engines` leaves out fails, and an install as the oldest Node.js that
  `engines` allows (pnpm's `node-version` setting) works, so a dependency that raises the minimum
  fails the test. An earlier commit of this review set `>=24.2`, the minimum of the scripts in
  `scripts/`; with `engineStrict`, installs on 24.2 to 24.14 failed on jsdom.
- Ctrl+C on `pnpm dev` stopped the API at once, cutting off open requests. `node --watch` passes
  the terminal's Ctrl+C on to the server, which then received SIGINT twice; its handler was
  registered with `once`, so the second SIGINT ended the process. The entrypoint now treats a
  stop signal within a second of the first as the same one; a later one still stops it at once,
  now with exit code 1 and a log line. Tests: two in `apps/api/src/server.test.ts`.

Docs: the note above on Ctrl+C with `pnpm start` called the error cosmetic; pnpm also stops the
API at once, which this review keeps (pnpm stops both apps when either fails, so a port that is
taken fails `pnpm start` loudly). To let the API finish open requests, run it on its own:
`pnpm --filter @apex/api start`.

How to verify, from the repository root:

```sh
pnpm exec vitest run typecheck.test.ts workspace.test.ts apps/api/src/production.test.ts \
  apps/api/src/server.test.ts
# "Test Files  4 passed (4)" and "Tests  52 passed (52)" since round 3 of the review
pnpm --filter @apex/shared build && pnpm --filter @apex/api build
cd apps/api && node --no-strip-types dist/server.js; cd ../..
# exits at once: ERR_UNKNOWN_FILE_EXTENSION for packages/shared/src/index.ts (no condition)
```

To see the type check fix with a real dev server:

```sh
mkdir apps/web/src/app/probe
printf 'export default function Page() {\n  return null;\n}\n' > apps/web/src/app/probe/page.tsx
pnpm --filter @apex/web dev   # wait for "Ready", then press Ctrl+C
rm -r apps/web/src/app/probe
pnpm typecheck                # passes; before the fix: TS2307 in .next/dev/types/validator.ts
```

To see Ctrl+C let an open request finish: run `pnpm --filter @apex/api dev` in terminal 1, then in
terminal 2 start a request whose body arrives after 5 seconds, and press Ctrl+C in terminal 1
while it waits:

```sh
(printf 'POST /health HTTP/1.1\r\nHost: x\r\nConnection: close\r\n'
 printf 'Content-Type: application/json\r\nContent-Length: 2\r\n\r\n{'; sleep 5; printf '}') |
  nc 127.0.0.1 4000
```

Terminal 1 logs `"msg":"shutting down"`, terminal 2 prints `HTTP/1.1 404 Not Found` when the
5 seconds are up, and then the API exits. Before the fix, `nc` printed nothing and the API
stopped at once.

No owner actions. The web app's production start (`next start`) is still checked only by hand,
and CI starts neither app (handed to the owner of instruction 5; since the round-1 integration CI
starts both, see instruction 5's integration note).

**Integration fixes (wave w0, round 1)**

- `workspace.test.ts` passed only while this machine's pnpm cache had already checked the lockfile
  or held every locked package's registry metadata. Before it installs, pnpm checks each locked
  version against the one-day release-age hold, which needs that metadata, and offline it fails
  with `ERR_PNPM_NO_OFFLINE_META` when some is missing. That happened in a scratch clone after the
  pre-commit hook had installed a hand-edited `package.json` (see instruction 2's integration
  note), and every time with an empty pnpm cache. The test's offline install now turns the hold
  off, since the test is about engines, and uses a cache folder of its own, so it neither depends
  on the machine's cache nor writes records of its temporary folders there. Removing the setting
  now fails the test every time.
- The merge added four entrypoint tests from the review of instruction 8 to `server.test.ts`, and
  the integration a test of the root type check to `typecheck.test.ts`, so the first command
  above now reports 22 tests.

**Review fixes (wave w0, round 2)**

Delta reviewed instructions 1 and 2 and took them over from Echo. Checked by running them, in this
checkout and in fresh clones, with ports 3040 and 4040: the "How to verify" steps of both
instructions from a fresh clone (frozen install, lint, type check, format check, 558 tests, the
build and the build-warning check; `pnpm dev` and `pnpm start`, each probed and then stopped with
SIGINT to its process group; the scratch-clone hook recipe; the hooks in a new worktree before and
after `pnpm install`). Every important behaviour was then broken on purpose, one change at a time,
and each change was run through the checks CI runs (format, lint, type check and tests, and for the
web app's build settings also the build, the build-warning check and the start check): 32 of a
first 45 changes passed every check, and 16 of 34 more (two of them, in `.gitignore`, failed the
format check here only because this checkout holds build output, and pass CI's checks in a fresh
checkout). All but three of those 48 now fail a test: one removed a setting that did nothing,
which is now gone (`transpilePackages`, below), and the two `.gitignore` changes are left as they
were (see the end of this note). Fixes, each with a test that fails without it:

- `pnpm build` failed once a route had been deleted or renamed after `next dev` ran, although
  `pnpm typecheck` passed (w0.V1.Bravo.1). The round-1 fix above assumed that `next build` leaves
  `.next/dev` out of its type check; Next.js 16.4's default checker (the TypeScript CLI) checks
  everything the tsconfig includes. `next.config.ts` now points `next build` at
  `tsconfig.typecheck.json` (`typescript.tsconfigPath`), the file `pnpm typecheck` uses. In a
  fresh clone, after the round-1 recipe above, `pnpm build` failed without the setting (TS2307
  and TS2344 in `.next/dev/types/validator.ts`) and passes with it. Test:
  `apps/web/src/next-config-settings.test.ts`, which also pins `poweredByHeader` and `agentRules`.
- A SIGINT or SIGTERM that arrived while the API was starting (a plugin's onReady hook) was lost:
  the API logged "shutting down", then listened, answered with 503 or 200 and never exited
  (w0.V1.Bravo.3). It now listens only if no stop signal arrived while the plugins started, and
  its shutdown waits for the start before it closes the app. Tests in `server.test.ts`: a signal
  during start-up (code 0, never listening) and one while the port is opened on `localhost`; both
  fail without the fix.
- Behaviour that no check covered now has tests: the 10-second shutdown limit (an open request
  that never finishes: code 1 after 10 s), a close that fails (code 1) and a repeated SIGTERM
  (`server.test.ts`); every tsconfig keeps the strict compiler settings (ESLint noticed only three
  of the nine flags missing) and packages/shared gets neither Node.js nor DOM types, and
  `pnpm typecheck` also checks the root files
  (`typecheck.test.ts`); `pnpm test` runs every test file in the repository (`test-suite.test.ts`;
  without the apps' Vitest projects it had run 289 of 558 tests and passed); the ESLint config
  gives every package typescript-eslint's strict and stylistic rules, React packages the React
  Hooks and strict jsx-a11y rules, the Next.js app Next.js's rules and the API `no-console`
  (`eslint-config.test.ts`); the web app's dev and production servers default to 127.0.0.1:3000
  (`apps/web/src/server-address.test.ts`); the root layout declares British English,
  `lang="en-GB"` (`apps/web/src/app/layout.test.tsx`; ESLint's jsx-a11y rules require a `lang`
  attribute but accept any language); `.nvmrc` and `.node-version` name the major version that
  `engines` asks for (`workspace.test.ts`).
- Dropping the root Vitest config's "tooling" project, which holds the root tests (159 of them,
  the git hook tests among them) and `test-suite.test.ts` itself, passed every check.
  `scripts/tooling-project.test.ts`, in another project, checks that it still runs
  `test-suite.test.ts`.
- The API's package scripts: nothing checked that `pnpm dev` and `pnpm start` read
  `apps/api/.env`, that stack traces from the production build point at the TypeScript source
  (both builds' source maps and the start script's `--enable-source-maps`), or that each build
  empties `dist/` first and compiles no test files. Tests: three in
  `apps/api/src/production.test.ts`, which run the scripts on its copy of the packages, and one in
  `server.test.ts`, which runs the dev script in a folder of its own.
- `pnpm lint` without `--max-warnings 0`, on which CI's "fail on any warning" rests for ESLint,
  passed every check. `eslint-config.test.ts` now runs the script on a folder whose config turns
  one rule on as a warning.
- The Tailwind CSS setup could be removed (`@import "tailwindcss"` in `globals.css`, the
  `@tailwindcss/postcss` plugin, or the layout's import of the stylesheet), and every check passed,
  CI's build and start check included. The web Vitest project now compiles `globals.css` as
  Next.js does: `apps/web/src/app/globals.test.ts` checks Tailwind's output and `layout.test.tsx`
  that the layout loads it (docs/DECISIONS.md, "The web tests compile the global stylesheet with
  Tailwind CSS").
- Dropping `next typegen` from the web app's `typecheck` script passed every check, although
  `pnpm typecheck` and the hook then no longer check pages' and layouts' exports against Next.js's
  route types (`.next/types/validator.ts`). `typecheck.test.ts` now gives a copy of the app a page
  whose default export is not a component and expects a type error from that validator.
- `transpilePackages` in `next.config.ts` did nothing: Next.js 16.4 compiles workspace packages
  by itself, and without it the tests, the build, CI's build-warning and start checks, and a Client
  Component that imports `@apex/shared` under `next dev` all worked. It is gone (docs/DECISIONS.md,
  "Next.js compiles @apex/shared without transpilePackages"). The comment there that said the rest
  of Next.js reads tsconfig.json is corrected: Next.js reads its TypeScript settings from
  `tsconfig.typecheck.json`. `next-config-settings.test.ts` now also checks `turbopack.root` and
  `outputFileTracingRoot`, which no check covered.

How to verify, from the repository root:

```sh
pnpm exec vitest run typecheck.test.ts workspace.test.ts apps/api/src/production.test.ts \
  apps/api/src/server.test.ts                  # "Test Files  4 passed (4)", "Tests  52 passed (52)"
pnpm exec vitest run test-suite.test.ts eslint-config.test.ts scripts/tooling-project.test.ts
                                               # "Test Files  3 passed (3)", "Tests  13 passed (13)"
pnpm --filter @apex/web test                   # "Tests  47 passed (47)"
```

To see one of these tests catch a broken setting, delete the line
`{ test: { name: "tooling", include: ["*.test.ts"] } },` from `vitest.config.ts` and run
`pnpm exec vitest run --project scripts`: `tooling-project.test.ts` fails with "No projects
matched the filter". Then run `git checkout vitest.config.ts`.

In a scratch clone, follow the round-1 recipe above with a real dev server, then run
`pnpm build` as well: it passes (before this round: "Failed to type check." with TS2307). To see
a stop signal arrive while the API starts, run this in `apps/api`, with port 4000 free:

```sh
printf '%s\n' 'import { subscribe } from "node:diagnostics_channel";' \
  'subscribe("fastify.initialization", ({ fastify }) => {' \
  '  fastify.addHook("onReady", () => new Promise((resolve) => setTimeout(resolve, 3000)));' \
  '});' > /tmp/slow-start.mjs
node --import /tmp/slow-start.mjs src/server.ts & sleep 1; kill -TERM $!; sleep 5
kill -0 $! 2>/dev/null && echo "still running" || echo "stopped"
```

It logs only `"msg":"shutting down"` and prints "stopped". Before this round it also logged
"Server listening at http://127.0.0.1:4000" and printed "still running" (stop it with
`kill -KILL %1`).

The final branch was checked again in a fresh clone: a frozen install, `pnpm peers check`, the
format check, lint, the type check, 610 tests, the build, CI's build-warning check and its start
check all passed; `pnpm dev` and `pnpm start` answered on ports 3040 and 4040 and stopped on
Ctrl+C, leaving no process behind; and every "How to verify" command of this note and of
instruction 2's round-2 note printed the counts it promises. In a fresh clone, a route that
`next dev` had served and that was then deleted no longer failed `pnpm typecheck` or
`pnpm build`; without the `tsconfigPath` setting, `next build` failed there with TS2307. Every
change above except the `transpilePackages` one was then made again on the final branch, one at a
time, and each failed a check: all that had passed every check now fail a test, apart from the two
`.gitignore` changes.

This round's tests change counts that the verify steps of other instructions quote, measured on
this branch: `pnpm exec vitest run --project web` 47 tests (instruction 4 says 35); the API's
`config.test.ts` and `server.test.ts` 52 (instruction 4's review fixes say 46);
`pnpm --filter @apex/api test` 240 (instruction 8 says 231); instruction 8's `server.test.ts`
filter "4 passed | 17 skipped (21)" (it says 15); and `--project scripts` 78 tests in 6 files
(instructions 5 and 7 say 59 in 4; main already ran 77 in 5). The round's integration updates
them, together with the other branches' tests.

No owner actions. Left without tests, because they show at once: removing `.next/` or `dist/`
from `.gitignore` passes CI's checks in a fresh checkout, but `git status` then lists the build
output; and a dev script without `--watch` stops restarting on a change.

**Integration fixes (wave w0, round 2)**

- Two branches of the round changed `workspace.test.ts`, and the merge keeps both: Delta's checks
  of `.nvmrc` and `.node-version` above, and Bravo's change from the review of instruction 5. The
  copies of the workspace now install from the checkout's own pnpm store (`pnpm store path`,
  passed as `--config.store-dir`; `--frozen-store` still keeps them from writing to it). Without
  it the test failed in an Ubuntu 26.04 VM, the release of CI's runner, whose `/tmp` is a tmpfs,
  so the copies there looked in an empty store (instruction 5's round-2 note, and
  docs/DECISIONS.md, "Workspace copies in tests use the checkout's pnpm store").
- With the two entrypoint tests from the round-2 review of instruction 8, the first command of
  the round-1 note above and of the round-2 note report 46 tests (44 on Delta's branch). The other
  counts that Delta's note lists are updated in their entries, with the other branches' tests.

**Review fixes (wave w0, round 3)**

Charlie reviewed instructions 1 and 2 and took them over from Delta, with the open items that the
verification of round 2 raised. Checked by running them, in this checkout and in fresh clones,
with ports 3030 and 4030: a frozen install, `pnpm peers check`, `pnpm audit`, the format check,
lint, the type check, every test (also under a terminal, through `script`), the build, the
build-warning check and the start check; `pnpm dev` and `pnpm start`, each probed and then stopped
with SIGINT to its process group, leaving no process behind; the API's start without the export
condition (it fails with `ERR_UNKNOWN_FILE_EXTENSION`, as the round-1 note says); and every count
that the "How to verify" steps of this entry and of instruction 2 quote. A search of every tracked
file and of the whole git history for key and token formats (Stripe, GitHub, AWS, Google, Slack,
npm, private keys, JWTs) and for passwords, secrets and tokens given values found no real or
realistic secret: the templates leave their passwords empty, and the tests use obviously fake
values such as `query-secret`. Fixes, each with a test that fails without it:

- A tsconfig could keep `strict: true` and turn off a flag that `strict` implies (w0.V2.Alpha.3):
  with `"noImplicitAny": false` in `apps/api/tsconfig.json`, an untyped parameter passed the type
  check and lint, and every test passed. `strict` sets its flags only where a tsconfig leaves them
  unset. `typecheck.test.ts` now takes those flags from the installed TypeScript and fails when
  `tsc --showConfig` shows one set to false; noImplicitAny, strictNullChecks,
  strictFunctionTypes, strictBuiltinIteratorReturn and useUnknownInCatchVariables were each tried.
- `eslint-config.test.ts` checked each rule set on one kind of file: typescript-eslint's on `.ts`
  files and the React, jsx-a11y and Next.js sets on `.tsx` files (w0.V2.Alpha.4). Narrowing
  `reactFiles` to `.tsx`, turning `react-hooks/rules-of-hooks` off for `.ts` files (where custom
  hooks live) or narrowing typescript-eslint's sets to `.ts` (so no `.tsx` component kept them)
  passed every check; a conditional `useState` in `src/lib/use-thing.ts`, or `any` in a `.tsx`
  file, then linted clean. The tests now check a file of every kind that each set covers, from
  the sets' own file patterns, in three places of every package. They found that `.mts` and `.cts`
  files in apps/web got none of the React and Next.js rules, which Next.js's own config gives them;
  `reactFiles` now lists them (docs/DECISIONS.md, "Lint and type-check tests take their lists from
  the tools").
- Removing `.next/`, `dist/`, `next-env.d.ts`, `node_modules/` or `*.log` from `.gitignore` passed
  every check, because CI starts from a fresh checkout with no build output (w0.R2.Delta.19, left
  without a test in round 2). `generated-files.test.ts` asks git about a file in each place where
  the tools write, including every tsconfig's `outDir`, and fails when a rule ignores a file that
  git tracks (docs/DECISIONS.md, "Tests check that git ignores what the tools generate").
- `apps/web/src/app/globals.test.ts` checks utilities that only the layout and the home page use,
  which Tailwind CSS finds by scanning those files, but imported neither: a home page change that
  dropped `sm:grid-cols-2` passed the pre-commit hook and failed only in `pnpm test`. The test now
  imports both, so the hook runs it when either changes. When instruction 17 replaces the page,
  the test's list of utilities has to change with it.
- The README's quick start stopped at its first line in zsh, the default shell on macOS:
  `pnpm install   # also installs the git hooks (see "Git hooks" below)` printed "zsh: number
  expected" and installed nothing, because zsh does not read `#` at its prompt as the start of a
  comment unless `interactivecomments` is on (zsh 5.9, with macOS's start-up files and the
  owner's). The README's command blocks now hold commands only, `readme.test.ts` fails on a `#`
  comment in any of them, and the README's prerequisites and this log's introduction say how to
  make zsh read the comments in the docs' blocks (docs/DECISIONS.md, "The README's command blocks
  hold no comments; the docs say how to make zsh read them").
- That prerequisite first named only the blocks in `docs/`, but infra/README.md, where the README
  sends readers for the containers' day-to-day commands, has commented blocks too: pasted into a
  stock zsh, its `openssl rand -hex 32   # prints a strong password; run it ...` printed "too many
  arguments" and no password. The prerequisite now names infra/README.md, and `readme.test.ts`
  fails when another tracked Markdown document outside `docs/` has `#` comments in its command
  blocks and the prerequisite does not name it.
- Nit: the comment in `apps/web/next.config.ts` on `transpilePackages` sat above
  `outputFileTracingRoot` (w0.V2.Alpha.6); it now closes the settings.
- Two advisories against Next.js 16.4.0 reached npm's advisory database during this review:
  GHSA-2464-fhr4-w9xw (critical: unauthenticated remote code execution in the Image Optimization
  API when SVG files are used) and GHSA-p3m5-59mp-jv5r (high: denial of service in the App Router
  with Server Actions), both for `>=16.0.0 <=16.4.0`. The final fresh-clone check found them:
  `next build` stopped with "SecurityFatalError: Your version of Next.js is affected by a known
  security vulnerability", because Next.js 16.4 checks the advisories when an AI agent runs it and
  stops the first such build. Its message also tells the agent to ask the user about running
  `next upgrade`; as tool output, that was not acted on. `pnpm audit` confirmed both, and two
  moderate advisories in Vitest 4.1.11's `@vitest/mocker`. The catalog now asks for `next` and
  `eslint-config-next` `^16.4.2` and `vitest` `^4.1.12`, the fixed releases, which are past the
  one-day hold; the lockfile changes only those packages and their `@next/*` and `@vitest/*` parts.
  `pnpm audit` now reports one advisory, in braces up to 3.0.3 (high), which only
  eslint-config-next's lint tooling uses and which has no fixed release (docs/DECISIONS.md,
  "Next.js 16.4.2 and Vitest 4.1.12 for security advisories").
- Right after that upgrade, `workspace.test.ts` failed with ERR_PNPM_NO_OFFLINE_TARBALL ("snapshot
  not present in local store") for packages that were in the store. pnpm 12 keeps the store's
  index in SQLite, and while another process has it open, newly added entries stay in the
  write-ahead log, which the test's `--frozen-store` install does not read; reproduced with a
  throwaway store. The test now runs such an install again without `--frozen-store`
  (docs/DECISIONS.md, "The engines test falls back when a frozen store cannot see new packages").
- A later `pnpm audit` found one more advisory: GHSA-389g-gv7q-r4x8 (low) against Fastify
  `>=5.12.2 <5.12.6`, and the lockfile held 5.12.5. A route's `headers` schema that allows or
  refuses header names through `propertyNames` with `enum` or `const` in their usual case, such as
  `X-Debug-Override`, never matched, because Node.js lowercases header names, so a refused header
  reached the handler. The API has no such schema (it validates with Zod), but the first route that
  added one would have been exposed. `apps/api/package.json` now asks for `fastify` `^5.12.7`, the
  latest release (13 October, past the one-day hold; it differs from the fixed 5.12.6 only in its
  version number), the lockfile changes only Fastify, and the API's 261 tests pass on it
  (docs/DECISIONS.md, "Fastify 5.12.7 for a security advisory").

How to verify, from the repository root:

```sh
pnpm exec vitest run typecheck.test.ts eslint-config.test.ts generated-files.test.ts readme.test.ts
# "Test Files  4 passed (4)" and "Tests  37 passed (37)"
pnpm audit                  # "1 vulnerabilities found", "Severity: 1 high": braces only
pnpm --filter @apex/web exec next --version   # Next.js v16.4.2
pnpm --filter @apex/api list fastify          # fastify@5.12.7
```

To see the strict check catch a weakened tsconfig, add `"noImplicitAny": false` to the
`compilerOptions` of `apps/api/tsconfig.json` and run
`pnpm exec vitest run typecheck.test.ts -t "strictly"`: the tests for `apps/api/tsconfig.json` and
`apps/api/tsconfig.build.json` fail. Then run `git checkout apps/api/tsconfig.json`.

The new tests change no count that the verify steps of the other instructions quote; instruction
2's round-3 note lists the hook tests' counts. No owner actions.

**Integration fixes (wave w0, round 3)**

- The same round's review of instruction 3 took the `#` comments out of infra/README.md's command
  blocks, so the README's prerequisites no longer name it (the note above says they do). Naming a
  document exempts it from the `readme.test.ts` check, so the check now fails if comments come
  back there. docs/DECISIONS.md has the fact correction ("The README's command blocks hold no
  comments; the docs say how to make zsh read them").
- After the round's merges, the first command of the round-1 note and of the round-2 note reports
  52 tests: 46 before the round, one more in `workspace.test.ts` from the review of instruction 5,
  four in `apps/api/src/server.test.ts` from the review of instruction 8 and one in
  `typecheck.test.ts` from this review (each branch counted only its own).

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
  Prettier fixes are added to the commit. A failing task does not stop the others. Since the
  round-3 review, two more tasks follow: `test-suite.test.ts` once when a test file is staged, and
  `env-files.test.ts` once when an env file is staged (see #4); since the round-4 review of
  instruction 3, a third: the infra tests once when a YAML file is staged (see #3).
- `.husky/commit-msg` runs commitlint with `commitlint.config.mjs`: Conventional Commits
  (`@commitlint/config-conventional`) plus the team rules (lowercase scope and subject, subject at
  most 72 characters, a blank line before the body and before the footer, so the
  `Co-Authored-By:` trailer passes when it has a paragraph of its own).
- Root `vitest.config.ts`: a `tooling` project for tests at the repository root, and
  `forceRerunTriggers` so that staging dependency, tsconfig, Vitest, hook or hook-config files
  runs every test. Since Phase 0 was merged, so does staging a file that other instructions'
  tests read instead of importing: `docker-compose.yml`, an `.env.example` template, a
  `.gitignore`, a CI workflow or (since the wave w0 review) `eslint.config.mjs`; since the
  round-2 review of this instruction, a PostCSS config; since the round-3 review of this
  instruction, `.nvmrc` and `.node-version`. From the round-3 to the round-4 review of
  instruction 3, so did another file that Docker Compose reads by default (`compose.yaml`,
  `docker-compose.override.yml` and the other lower-case names), which `infra/compose.test.ts`
  refuses; since round 4 a staged YAML file, in any letter case and any folder, runs only the infra
  tests, through a lint-staged task of its own (see #3). An env file staged with
  `git add --force` ran every test from the round-2 review of instruction 4; since round 3 it runs
  only `env-files.test.ts`, through a lint-staged task of its own (see #4).
- `git-hooks.test.ts` (54 tests): 28 commit messages through the real commit-msg hook and
  commitlint config; 10 pre-commit scenarios that run the real lint-staged with this
  repository's config in scratch git repositories, with stand-ins for ESLint, Prettier, pnpm and
  Vitest that record their calls (order, files, hiding and restoring, deleted files, fixes being
  staged, a failure in each tool); and 16 runs of the real `vitest related` in this checkout,
  which check that staging a rerun-trigger file runs every test and an unrelated file runs none.
- README: "Git hooks" and "Commit messages" sections and a `.husky/` line in the layout.

**How to verify**

Run from the repository root:

```sh
pnpm install --frozen-lockfile          # a fresh install prints ". prepare$ husky"
git config --get core.hooksPath         # prints .husky/_
pnpm exec vitest run git-hooks.test.ts  # "Tests  93 passed (93)" since the wave w0 round-4 review
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
  the check that cannot be bypassed. Skip them only in an emergency. (Corrected in the wave w0
  review: CI runs on every push and pull request, but it does not check commit messages, and on
  GitHub Free a private repository cannot require it to pass before a merge; see the owner
  actions of instruction 5.)
- husky stores `core.hooksPath` in the repository's git config, which every worktree shares; a
  worktree runs the hooks only once `pnpm install` has run in it.
- `vitest related` follows imports only. A test that runs code in a separate process is not
  selected when only that code changes. For the API's entrypoint, which `server.test.ts` starts
  with `node`, a rerun trigger makes up for it since the wave w0 review; the production test,
  which builds and starts a copy of the API, runs in the hook only when a rerun trigger or a
  packages/shared file is staged. CI runs every test.
- Changing `eslint.config.mjs` or the Prettier settings lints and formats only the staged files;
  run `pnpm lint` and `pnpm format:check` to check the whole repository.
- Untracked files are stashed and restored on every commit; keep large scratch files gitignored.
- The hook's backup lives in the git stash, which all worktrees of a repository share. Committing
  in two worktrees at the same moment worked every time (30 commits in 15 simultaneous pairs, no
  failures, nothing lost) but left a stray `lint-staged automatic backup` entry 3 times; such an
  entry is a copy and safe to drop. With several worktrees, restore your own stash entry by name
  (the steps are in the README section "Git hooks"), not the top one, which may be another
  worktree's backup during a commit.
- When the type check fails in one package, `pnpm --recursive` stops the other packages' checks,
  so the output also shows `Command failed with signal SIGKILL` for them. (Since the round-1
  integration, `--no-bail` lets every package's check finish, so one run shows all their errors;
  see "Integration fixes (wave w0, round 1)" below.)
- The commit message rules are stricter than `config-conventional`: names in a subject must be
  lowercase or in backticks or quotes. A body line such as `Note: ...` directly after other body
  text is read as the start of the footer and rejected; add a blank line before it.

**Review fixes (wave w0, round 1)**

Echo reviewed this instruction with instruction 1 (see its review note). Besides the scratch-clone
steps above, the hooks were run on `git commit -- <path>` with other files changed (a passing and
a failing commit), on files in `[id]` and `(group)` route folders, and on merges. Fixes, each with
a test that fails without it:

- `git merge` ran none of the checks when it committed a merge without conflicts: git runs the
  pre-merge-commit hook for those, not pre-commit, and there was none. Two branches that each
  passed could merge into code that failed the type check (tried: one renamed a constant, the
  other started using the old name). `.husky/pre-merge-commit` now runs the pre-commit hook, so
  such a merge stops with "Not committing merge", its changes staged, until it is fixed and
  committed with `git commit` or abandoned with `git merge --abort`. Tests: two in
  `git-hooks.test.ts` that install the hooks with husky in a scratch repository and run
  `git merge`.
- lint-staged puts unstaged changes and untracked files back only on Ctrl+C (SIGINT). A closed
  terminal (SIGHUP), an editor or tool that cancels the commit (SIGTERM) or SIGKILL leaves them in
  the `lint-staged automatic backup` stash entry, with only the staged changes in the working
  tree, and the README's advice, `git stash pop stash@{n}`, stops with a merge conflict on any
  partly staged file. The README section "Git hooks" now names these cases and gives the steps
  lint-staged takes itself (`git reset --hard`, `git stash apply --index`, `git stash drop`).
  Tests: one per signal in `git-hooks.test.ts`, which start the real hook in a process group of
  its own and signal the group while the type check runs.
- Staging only `apps/api/src/server.ts` ran no tests: `server.test.ts` starts it as a separate
  process, which `vitest related` cannot trace. It is now a rerun trigger, so it runs every test;
  `git-hooks.test.ts` checks it.

`git-hooks.test.ts` now has 64 tests (54 before): the seven above (two merges, four stopped
hooks and the entrypoint trigger), a trigger case for `eslint.config.mjs` from the review of
instruction 4 and two merge tests from the round's integration (see below). How to verify, from
the repository root:

```sh
pnpm exec vitest run git-hooks.test.ts   # "Tests  64 passed (64)"; 88 since the round-3 review
```

To see a merge stopped by the checks, in a scratch clone (a branch committed with `--no-verify`
stands in for one made without the hooks):

```sh
git clone . /tmp/apex-merge-try && cd /tmp/apex-merge-try && pnpm install --frozen-lockfile
git switch --create sloppy
printf 'export const parse = (text: string): any => JSON.parse(text);\n' > apps/api/src/try.ts
git add apps/api/src/try.ts && git commit --no-verify --message "feat(api): add a parser"
git switch -
git merge --no-ff --no-edit sloppy   # stopped by @typescript-eslint/no-explicit-any:
                                     # "Not committing merge; use 'git commit' ..."
git status --short                   # A  apps/api/src/try.ts
git merge --abort
cd - && rm -rf /tmp/apex-merge-try
```

A fast-forward merge makes no commit, so no hook runs for it; `--no-ff` above forces a merge
commit.

Run times measured again in a fresh clone of this branch, committing from a non-interactive
shell, three rounds of each, while other work used the machine (load average about 4): a
documentation change 0.8 s (1.6 s the first time), a source change with related tests 4.2 to
4.8 s, and a change that runs every test (450 tests) 16.4 to 16.6 s. Merges that bring in such a
documentation change or source change took the same: 0.8 s and 4.1 s.

No owner actions.

**Integration fixes (wave w0, round 1)**

Found while merging the round's five branches, and from the reviewers' hand-offs:

- The merge check above stopped short of the commit that finishes a merge. git runs the
  pre-commit hook for that `git commit`, after failed checks or after a conflict, and while a
  merge is in progress lint-staged checks only the staged files that also differ from the merged
  branch, in effect the files that both sides changed. So after a failed pre-merge-commit check,
  `git commit` made the merge commit without running any check, and after a conflict only the
  conflicted files were checked. While a merge is in progress, the pre-commit hook now passes
  `--diff=--staged --stash`, so lint-staged checks every staged file and keeps its backup (see
  "A commit that finishes a merge checks everything the merge brings in" in docs/DECISIONS.md).
  Tests: two in `git-hooks.test.ts`; both fail without the change, and the first also fails
  without `--stash`. With the real tools, in a scratch clone: the merge in the recipe above,
  stopped by ESLint, was finished with `git commit --no-edit`, which before the fix printed
  "lint-staged could not find any staged files." and made the merge commit, and now stops with
  the same ESLint error.
- When the type check failed in one package, `pnpm --recursive` stopped the other packages'
  checks (SIGKILL), so the hook and CI showed one package's errors (Echo's hand-off). The root
  `typecheck` script now runs `pnpm --recursive --no-bail typecheck`: every package's check
  finishes and the script still fails. Test: `typecheck.test.ts` runs the script on a stand-in
  workspace whose two packages fail.
- The hook's type check runs `pnpm typecheck`, and pnpm 12 installs dependencies first when
  `node_modules` is out of date (`verifyDepsBeforeRun: install`, its default). Charlie asked
  whether that can rewrite the lockfile during a commit; it does. In a scratch clone, a commit
  that staged only a `package.json` with a changed dependency range ran an install and the
  `prepare` script, and the commit held both `package.json` and the rewritten
  `pnpm-lock.yaml`. pnpm's default is kept, so that merges that bring in new dependencies install
  them before their type check (with `--config.verify-deps-before-run=error` such a merge stopped
  until `pnpm install` was run: tried in a scratch clone); the README section "Git hooks" now says
  so, and docs/DECISIONS.md records why ("The pre-commit type check may install dependencies
  first").
- The note above that CI is the check that cannot be bypassed is qualified (Charlie's hand-off):
  CI does not check commit messages, and on GitHub Free a private repository cannot require it to
  pass. The same correction is in the DECISIONS entry on the hooks.

How to verify, from the repository root:

```sh
pnpm exec vitest run git-hooks.test.ts -t "merge"            # "Tests  9 passed | 79 skipped (88)"
pnpm exec vitest run typecheck.test.ts -t "root type check"  # "Tests  2 passed | 13 skipped (15)"
```

In the scratch clone of the merge recipe above, run `git commit --no-edit` before
`git merge --abort`: it stops with the same `@typescript-eslint/no-explicit-any` error, and
`git status --short` still shows `A  apps/api/src/try.ts`.

**Review fixes (wave w0, round 2)**

Delta reviewed this instruction with instruction 1 (see its round-2 note). The scratch-clone
recipe above gave every result it promises, from a non-interactive shell: the bad messages were
rejected in 0.3 to 0.5 s, the lint error, type error and failing related test in 3 to 6 s, and
the documentation change passed in 0.9 s. A commit that only deletes an unused module passed with
the real tools, and in a new worktree the hooks ran only after `pnpm install`. Fixes, each with a
test that fails without it:

- The README's steps after a hook stopped by anything but Ctrl+C ended a merge in progress
  (w0.V1.Bravo.2). When the stopped commit was finishing a merge, `git reset --hard` and
  `git stash apply --index` each deleted `MERGE_HEAD`, so the next commit had one parent (with
  `--no-edit`, it had no message and stopped). When `git merge` itself was stopped during
  pre-merge-commit, as a closed terminal stops it, git had not recorded the merge, and after the
  steps its changes were staged as if they were the user's. lint-staged's working folder
  `.git/lint-staged/<id>` was also left behind. The README section "Git hooks" now gives the
  steps for each case, and `git-hooks.test.ts` runs the README's own code blocks: after SIGTERM,
  SIGHUP and SIGKILL, for a stopped commit that ends a conflicted merge (it then commits with two
  parents) and for a stopped `git merge` (merged again, keeping the user's edit and new file).
- The pre-commit tests staged only `.ts`, Markdown and lockfile changes, so the hook could stop
  linting `.tsx` or `.mjs` files, stop type-checking for `.tsx`, JSON or `pnpm-workspace.yaml`
  changes, or format only Markdown, and every check passed (6 of 6 such changes). One test now
  stages every kind of file and checks each task's files; four check what triggers the type
  check.
- Deleting the root `prepare` script, after which `pnpm install` installs no hooks, passed every
  check, because the tests installed the hooks by running husky. They now run the `prepare`
  script, as `pnpm install` does.
- The rerun triggers start with the checkout's own path, with the characters that globs treat
  specially escaped, and nothing tested the escaping: without it, staging `package.json` in a
  checkout such as `apex (copy) [1]` ran no tests in the hook, and every check passed.
  `git-hooks.test.ts` now copies the Vitest config into such a folder and runs the hook's
  `vitest related` there.
- A staged PostCSS config now runs every test. The web tests compile the stylesheet through
  `postcss.config.mjs` (see instruction 1's round-2 note), and Vite reads that file outside the
  module graph, so `vitest related` found no test for it. `git-hooks.test.ts` checks the new
  trigger.

The hook's other settings were broken on purpose too, one at a time, and the existing tests caught
every change: each lint-staged flag, the merge-time `--diff=--staged --stash`, the commit-msg
hook's message file and each team rule in `commitlint.config.mjs`.

`git-hooks.test.ts` now has 72 tests (64 before), so the counts of the commands above that run it
are updated. So is the integration note's count for the root type check tests: it said
`Tests  1 passed | 2 skipped (3)`, which was right until this round added a root type check test
and the settings tests to `typecheck.test.ts`. (Corrected in round 3 of the review: this note first
said that the count had already been wrong.)

`git-hooks.test.ts` is the longest test file and its pre-commit tests run one after another, so a
commit that runs every test now takes about 27 s instead of about 19 s (measured three times in a
fresh clone of this round's final branch, with 610 tests, at a load average of 3 to 4: 26.3 to
27.1 s; a documentation change still takes 0.8 to 0.9 s and a source change with related tests
4.7 to 5.1 s). How to verify, from the repository root:

```sh
pnpm exec vitest run git-hooks.test.ts -t "stopped"   # "Tests  10 passed | 78 skipped (88)"
```

No owner actions.

**Integration fixes (wave w0, round 2)**

- The merge brought together this round's two sets of new tests in `git-hooks.test.ts`: Delta's
  eight above and Alpha's four env-file trigger cases (instruction 4's round-2 note). The file
  has 76 tests (72 on Delta's branch and 68 on Alpha's), and every command above that runs it
  gives the merged count; the "What changed" list of rerun triggers names both branches'
  additions.
- Run times measured again on `main` after the merges, with 698 tests, in a fresh clone,
  committing from a non-interactive shell, three rounds of each at a load average of 2 to 6: a
  documentation change 0.8 to 1.0 s, a source change with related tests 4.5 to 4.6 s, and a
  change that runs every test 26.6 to 26.8 s. The README's figures still hold; it now gives this
  measurement's test count.

**Review fixes (wave w0, round 3)**

Charlie reviewed this instruction with instruction 1 (see its round-3 note). The scratch-clone
recipe above, run from a non-interactive shell, gave every result it promises: the bad messages
were rejected in 0.3 to 0.9 s, the lint error, the type error and the failing related test in 5
to 8 s, and the documentation change passed in 1.0 s. In a new `git worktree add` of the branch,
a commit with a bad message went through unchecked until `pnpm install` ran there, as the README
says; after it, from a non-interactive shell, a bad message and a staged lint error were rejected
and a documentation change passed in 1.0 s. Fixes, each with a test that fails without it:

- The README's steps after a stopped hook could lose the backup they restore (w0.V2.Alpha.2).
  Most lines had a `#` comment, which zsh, the default shell on macOS, does not read as a comment
  at its prompt. Pasted as one block, the apostrophe in "this worktree's git folder" opened a
  quote that swallowed the lines after it; typed one line at a time, every step failed except
  `git stash drop`, which dropped the only copy of the unstaged changes and untracked files (they
  were left in a dangling commit). In bash too, a `git stash apply` that failed, for example on a
  new file with the name of one in the backup, did not stop the `git stash drop` on the next line.
  The steps now hold commands only, and `git stash pop --index` replaces apply and drop: git drops
  the backup only once everything is back. `git-hooks.test.ts` pastes each set of steps into zsh
  (where zsh is installed; CI's runner may not have it, and `readme.test.ts` keeps comments out of
  the README there), and runs the steps after a restore that fails one line at a time, as a prompt
  does: the backup is kept (docs/DECISIONS.md, "The steps after a stopped hook pop the backup and
  hold no comments"). The first version of the zsh tests hung when the tests ran in a terminal,
  because an interactive zsh takes the terminal over; zsh now runs in a session of its own.
- Staging `.nvmrc` or `.node-version`, which `workspace.test.ts` reads, ran no tests in the hook:
  a commit that set `.nvmrc` to 22 passed it and would have failed only in CI. Both are now rerun
  triggers; in a scratch clone the same commit is rejected by `workspace.test.ts`. README.md,
  which `git-hooks.test.ts` reads for the steps above, is left out on purpose, so a README change
  still runs no tests in the hook (docs/DECISIONS.md, "README changes do not run every test").
  The hook test that stages every kind of file now also stages a dotfile and a file in a dot
  folder, as several triggers are, so lint-staged's handing of them to `vitest related` is
  checked from end to end.
- A failing test file that no Vitest project includes passed the hook, because `vitest related`
  found "No test files found" for it: tried with `packages/shared/src/probe.test.tsx`, which the
  shared project, with only `.test.ts` files, leaves out. When a test file is staged, the hook now
  also runs `test-suite.test.ts` (about 0.4 s), which fails for a test file that `pnpm test` does
  not run; in a scratch clone that commit is now rejected (docs/DECISIONS.md, "A staged test file
  makes the hook check that a Vitest project runs it").
- The round-2 note above said that the integration note's count for the root type check tests
  had already been wrong (w0.V2.Alpha.1, w0.V2.Alpha.5). It was right: `typecheck.test.ts`
  printed `Tests  1 passed | 2 skipped (3)` until round 2 added tests to it. The note is corrected.

Run times measured again in a fresh clone of this branch, with 716 tests, committing from a
non-interactive shell, three rounds of each at a load average of 2 to 7 while other work used the
machine: a documentation change 0.9 to 1.2 s, a source change with related tests 5.8 to 6.0 s,
and a change that runs every test 30.9 to 31.1 s. The README gave these figures until the
round's integration measured again (see below).

How to verify, from the repository root (the counts are those on a machine with zsh; without it,
the zsh tests are skipped):

```sh
pnpm exec vitest run git-hooks.test.ts -t "stopped"   # "Tests  10 passed | 78 skipped (88)"
pnpm exec vitest run readme.test.ts                    # "Tests  3 passed (3)"
```

To see a staged test file that no project runs stop a commit, in a scratch clone:

```sh
printf 'import { it } from "vitest";\n\nit("runs", () => undefined);\n' > packages/shared/src/x.test.tsx
git add packages/shared/src/x.test.tsx
git commit -m "test(shared): add a probe"   # rejected: test-suite.test.ts lists x.test.tsx
```

This round's hook tests change a count that instruction 4's round-2 note quotes:
`pnpm exec vitest run git-hooks.test.ts -t "runs every test when"` gave
`Tests  23 passed | 60 skipped (83)` on this branch (it says 21 and 55 of 76). With the round's
other branches merged it gives `Tests  21 passed | 67 skipped (88)`, which that note now quotes.
No owner actions.

**Integration fixes (wave w0, round 3)**

- The merges brought together three branches' changes to the hook: this review's task for staged
  test files and its `.nvmrc` and `.node-version` triggers; the trigger for other files that
  Docker Compose reads by default, from the review of instruction 3; and the task for staged env
  files, from the review of instruction 4, which replaced the env-file trigger. In
  `lint-staged.config.ts` the test-file task is the fifth and the env-file task the sixth (each
  branch had added a fifth). `git-hooks.test.ts` has 88 tests (83 on this branch, 78 on the
  instruction 3 branch and 79 on the instruction 4 branch), and every command in this log that
  runs it gives the merged count. The "What changed" list above now names the new tasks and the
  `.nvmrc` and `.node-version` triggers, and the README's hook section names the Compose files,
  which it had left out.
- Run times measured again on `main` after the merges, with 818 tests, in a fresh clone,
  committing from a non-interactive shell, three rounds of each at a load average of 1.6 to 6.2: a
  documentation change 0.8 s (3.0 s for the clone's first commit), a source change with related
  tests 4.9 s (6.6 s the first time), and a change that runs every test 33.0 to 34.5 s. The README
  gives these figures.

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
pnpm exec vitest run --project infra   # "Tests  46 passed (46)" since the wave w0 review, round 4
pnpm test                              # every test passes; when #3 was finished: "Test Files  6
                                       # passed (6)" and "Tests  44 passed (44)"
pnpm typecheck && pnpm lint            # both exit with code 0
```

With Docker installed (see Owner actions; Docker is not installed on the build machine, so these
were not run there; the reviews ran them in Linux VMs, see the review fixes below):

```sh
cp .env.example .env && chmod 600 .env   # then set POSTGRES_PASSWORD and REDIS_PASSWORD;
                         # `openssl rand -hex 32` prints a suitable value (run it once for each)
docker compose --profile '*' config --quiet       # no output, exit code 0 (every profile)
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
docker compose exec redis redis-cli CONFIG GET appendonly   # appendonly, then yes
docker inspect --format '{{json .Config.Cmd}}' "$(docker compose ps -q redis)"
# ["redis-server","/usr/local/etc/redis/redis.conf"]: the password is not on the command line
docker compose exec redis redis-cli SET apex:check kept
docker compose down && docker compose up -d --wait
docker compose exec redis redis-cli GET apex:check   # "kept": the named volume survived
docker compose exec redis redis-cli DEL apex:check
docker compose --profile app up api               # prints "Placeholder: the API has no image
                                                  # yet. Run it on the host: pnpm dev" and the
                                                  # container exits with code 1
docker compose --profile app down                 # removes every container, the placeholder
                                                  # too, and keeps the data (a plain `down`
                                                  # would leave the placeholder behind)
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
  `cp .env.example .env && chmod 600 .env`, set both passwords, run `docker compose up -d --wait`
  (or `pnpm docker:up`, from instruction 7) and check that `docker compose ps` shows both
  services healthy. The commands under "How to verify" check the rest.
- Done on 2026-10-22: confirm the Redis licence choice, Redis 8 under its AGPLv3 option, used
  unmodified, or a switch to Valkey (BSD-3-Clause), which would have changed the image, the first
  word of the `redis` service's command (`valkey-server`, or the server runs as root) and the
  tests that pin both. The owner chose Redis 8, accepted the AGPL-3.0 licence and does not want
  Valkey (docs/DECISIONS.md, "Redis 8 under AGPLv3, confirmed by the owner; Valkey is not
  wanted").

**Notes & limitations**

- Docker is not installed on the build machine, so the containers were not started there. The
  file was checked with the real Compose parser, the JSON Schema and the tests above; the health
  check commands were checked against the images' entrypoints, the PostgreSQL documentation and
  a Redis source build. The reviews then ran the containers in Linux VMs (see the review fixes
  below); they have not yet run under Docker Desktop or OrbStack (owner action).
- The apps do not use PostgreSQL or Redis yet; that starts in Phase 2. Connection URLs are in
  `infra/README.md`.
- Every `docker compose` command for this project needs the two passwords, so CI must pass
  throwaway values, as in
  `POSTGRES_PASSWORD=ci REDIS_PASSWORD=ci docker compose --profile '*' config --quiet`; without
  `--profile '*'`, Compose does not check the placeholders in the `app` profile.
- The tests read `docker-compose.yml` and `.env.example` from disk, so `vitest related` (used by
  the pre-commit hook from instruction 2) cannot connect a change to those files with
  `infra/compose.test.ts`. Since Phase 0 was merged, both are in the root Vitest config's
  `forceRerunTriggers`, so staging either one runs every test. `pnpm test` and CI always run them.
- `POSTGRES_PASSWORD`, `POSTGRES_USER` and `POSTGRES_DB` apply only when the data volume is
  first created; `infra/README.md` explains how to change the password later. The health check
  uses `POSTGRES_USER` and `POSTGRES_DB` on every check, so change them only together with a new,
  empty volume (since the wave w0 review, round 2).
- The passwords are visible through `docker inspect` (instruction 104 moves them to Docker
  secrets); the API will connect as the PostgreSQL superuser until a least-privilege role arrives
  with the migrations (instruction 26); other containers on the Compose network can reach both
  services (instruction 103 adds an internal network); digest pins need deliberate updates
  (instruction 106 automates them).
- `docker compose --profile app up` ends with both placeholders exited with status 1, on purpose,
  until the apps get real images. Remove them with `docker compose --profile app down`.
- The health checks' one-second polling while a service starts (`start_interval`) needs Docker
  Engine 25 or later and Compose 2.20.2 or later; since the wave w0 review, round 2, Redis's
  config file (`configs` with `content`) needs Compose 2.23.1 or later. On Linux, ports published
  on 127.0.0.1 stay out of other machines' reach only from Docker Engine 28.

**Review fixes (wave w0, round 1)**

Alpha reviewed this instruction, took it over and re-checked every requirement by running it:

- The containers ran for real in a throwaway Debian 13 VM (Lima 2.2.1, Docker Engine 29.9.0, Compose
  5.6.0) with this branch's `docker-compose.yml` and `.env.example`. The commands under "How to
  verify" (with `exec -T`, as there was no terminal) gave the results shown; only the old last step,
  a plain `docker compose down`, did not (fixed below). These checks passed too: PostgreSQL turned
  healthy only after the image's temporary set-up server had stopped and the real one was listening;
  pgvector 0.8.7 installed and ran a distance query; `/dev/shm` was 256 MB; both servers ran as
  unprivileged users; the VM's own network address was refused on both ports while 127.0.0.1
  answered; a TCP login without a password was refused by both; the Redis password did not appear in
  the process list of the running server (it did while the container started: see round 2);
  redis-server restarted on its own after a `kill -9`; data in both survived `down` and `up`.
- Fixed: the final `docker compose down` left the exited placeholder behind, and the next
  `docker compose --profile app up` failed with "failed to set up container networking: network
  ... not found": without `--profile`, `down` only handles the services outside a profile. The
  step, `infra/README.md` and the compose file now say `docker compose --profile app down`.
- Fixed: `infra/compose.test.ts` did not notice a PostgreSQL image without pgvector, Redis
  without its append-only file, a `pg_isready` without the configured user and database (which
  logs a FATAL line for every check), a placeholder that builds a Dockerfile or exits with
  status 0, or a `web` that stops waiting for `api`. New tests cover each one, and the image
  tags must name exact releases.
- Fixed: on Linux, Docker Engine before 28.0 lets machines on the same network reach ports
  published on 127.0.0.1, so the compose file's promise that other machines cannot reach the
  services needs that engine. The README files now ask for Docker Engine 28 or later on Linux
  (Debian 13's own `docker.io` is 26.1); the decision is in `docs/DECISIONS.md`.
- Fixed: `cp .env.example .env` creates a file that every local account can read; the copy
  commands for this instruction now add `chmod 600 .env`.
- Fixed: in the VM, a second checkout that changed only the ports took over the first one's
  containers, because the project name is fixed. `infra/README.md` explains
  `COMPOSE_PROJECT_NAME`, `docs/ARCHITECTURE.md` no longer says that ports alone are enough, and
  the fixed name is recorded in `docs/DECISIONS.md`.
- Fixed: the three container images had no rows in `docs/DEPENDENCIES.md`, although this entry
  pointed there for them.

How to verify the fixes:

```sh
pnpm exec vitest run --project infra   # "Tests  21 passed (21)" then; 26 since round 2
pnpm test && pnpm typecheck && pnpm lint && pnpm format:check   # all exit with code 0
```

With Docker, run the commands under "How to verify" above; after the final
`docker compose --profile app down`,
`docker ps --all --filter label=com.docker.compose.project=apex-garage` lists no containers.

**Integration fixes (wave w0, round 1)**

From the reviewers' hand-offs:

- In the review's Debian 13 VM, Redis 8.10.2 logged "WARNING Memory overcommit must be enabled!"
  as it started (Charlie). With the kernel's default `vm.overcommit_memory = 0`, the child process
  that writes a snapshot or rewrites the append-only file can fail to start when memory is short,
  and Redis then refuses writes until a snapshot succeeds. A container cannot change the setting:
  `infra/README.md` ("Redis's memory warning on Linux") says how to set it on a Linux host and
  that the home server must have it (instruction 105). `docker-compose.yml` is unchanged; the
  decision is in docs/DECISIONS.md.
- Nothing enforced Docker Engine 28 on Linux (Alpha): the `docker:*` scripts now refuse an older
  engine there, see instruction 7's integration note.

**Review fixes (wave w0, round 2)**

Echo reviewed this instruction, took it over and checked it again, with the containers running in
two throwaway Debian 13 VMs (Lima 2.2.1, Docker Engine 29.9.1, Compose 5.6.0):

- Fixed (security): Redis got its password as a command-line argument (`--requirepass`). On Linux
  every user can read any process's command line, and the Redis image's entrypoint runs with the
  container's full command line before Redis hides its arguments: a watcher running as `nobody`
  read the password from 36 command lines during 9 starts of the container. Round 1 looked only
  at the running server, where it no longer shows. Redis now reads `requirepass` and `appendonly`
  from a config file that Compose writes into the container (`configs` in `docker-compose.yml`,
  which needs Compose 2.23.1 or later), and its command is `redis-server` and that file. The same
  watcher found the password nowhere in 9 starts; auth, the health check, the append-only file,
  data across `down` and `up`, a restart after `kill -9` and a password change behaved as before.
  The decision is in `docs/DECISIONS.md`.
- Fixed (tests): 16 of 45 deliberate breakages passed `infra/compose.test.ts`, two of them the
  health-check timings, unpinned on purpose since round 1. The others included the PostgreSQL check
  in exec form or disabled and `POSTGRES_USER` or `POSTGRES_DB` no longer passed to the container
  (open item w0.V1.Charlie.1), `POSTGRES_HOST_AUTH_METHOD: trust` (TCP logins without a password), a
  disabled Redis check, a later `--appendonly no`, an `entrypoint` override, a wrong or missing
  published port and a template entry that the file never reads. The tests now compare the health
  checks, environments, ports and Redis's command and config exactly, forbid `entrypoint`, keep
  every secret off command lines and health checks, and require `.env.example` to list exactly the
  variables the file reads. Now only the two timing changes pass, and all 15 breakages aimed at the
  new config file fail.
- Fixed (docs): `.env.example` and this entry said that `POSTGRES_USER` and `POSTGRES_DB` apply only
  when the data volume is first created. The health check uses them on every check: in the VM, a
  user or database renamed later kept the service healthy while PostgreSQL logged a FATAL line
  every 10 seconds, and the psql command in `infra/README.md` failed. The template, that README
  and the note above now say to change them only together with a new, empty volume.
- Fixed (docs): `infra/README.md` and this entry validated the file with
  `docker compose config --quiet`, which skips the `app` profile: Compose 5.6.0 exited with code 0
  while the `web` placeholder depended on a service that does not exist. Both now use CI's
  `docker compose --profile '*' config --quiet`.
- Fixed (docs): switching to Valkey is not "a one-line image change" (open item w0.V1.Charlie.2).
  With only the image changed, Valkey 9.1.2 ran its server as root in the VM, because its
  entrypoint drops root privileges only for `valkey-server`; with that first word as well, it ran
  as uid 999 and turned healthy. `docs/DEPENDENCIES.md`, the licence decision and the owner action
  above say so.
- Fixed (docs): "How to verify" quoted 17 infra tests after round 1 had added 4 (open item
  w0.V1.Charlie.3); the counts above now say when they were taken.

How to verify the fixes:

```sh
pnpm exec vitest run --project infra   # "Tests  26 passed (26)" then; 40 since round 3
pnpm test && pnpm typecheck && pnpm lint && pnpm format:check   # all exit with code 0
```

With Docker, run the commands under "How to verify" above: Redis's command holds only the config
file, and the password and the append-only file still apply.

**Integration fixes (wave w0, round 2)**

- `infra/README.md`'s points to carry over into the apps' future images said only that the API's
  production start needs `--conditions=@apex/dist`. Round 2 fixed the same note in
  `docs/ARCHITECTURE.md` (instruction 6) and in docs/DECISIONS.md (instruction 1) after Bravo
  reported it (w0.V1.Bravo.4), but not this copy. It now also names `--no-strip-types`, which
  makes a start without the condition fail instead of running packages/shared's TypeScript
  source. Documentation only.
- The `docker:*` scripts now refuse a Compose older than 2.23.1, which `docker-compose.yml` needs
  since the round-2 review (see instruction 7's integration note).

**Review fixes (wave w0, round 3)**

Delta reviewed this instruction, took it over and checked it again: with the containers running
in three throwaway Debian 13 VMs (Lima 2.2.1, Docker Engine 29.9.2, Compose 5.6.1, every command
as the docs give it), and on the build machine with the Compose 5.6.1 parser and both compose-spec
JSON Schemas (Ajv 8.20.0; valid as written and after interpolation, and a misspelt key rejected).

- Fixed (open items w0.V2.Bravo.1 and w0.V2.Bravo.2, and more of the same kind): the tests read
  only the settings they checked, so others passed. On `main`, 26 of 35 deliberate breakages
  passed every test: extra lines in Redis's config file (`user default on nopass` opens Redis
  without a password), an `env_file`, and new in this round a YAML merge key (`<<`, which the
  `yaml` package keeps as a plain key while Compose merges it), `extends`, a top-level `include`,
  `cap_add`, `pid: host`, volume options, `working_dir`, an optional dependency, logging options
  and a committed `compose.yaml` or `docker-compose.override.yml`, which Compose reads instead of
  or on top of `docker-compose.yml`. In the VM, `<<: {env_file: ...}` with
  `POSTGRES_HOST_AUTH_METHOD=trust` let another container log in to PostgreSQL without a
  password, and `<<: {network_mode: host}` put Redis on every interface of the VM. A list of
  forbidden settings would not help: a merge key gets round it. The tests now validate the whole
  file with strict Zod schemas (exactly the services and settings they check), refuse YAML that
  the parser warns about (such as Compose's `!reset` tag), compare Redis's config file exactly and
  ask git that no other file Compose reads by default is tracked; staging such a file runs every
  test (`vitest.config.ts`, checked by `git-hooks.test.ts`). The check that keeps secrets blank
  in the template and without defaults also covers names with PASS, KEY or CREDENTIAL now. Of 108
  breakages (this round's, round 2's and earlier ones), every one that applies to the file fails a
  test except the health-check interval, unpinned on purpose; 12 written for older versions of the
  file no longer apply, and their equivalents fail. Decision: "The compose tests accept only the
  settings they check".
- Fixed (open item w0.V2.Bravo.3): after `docker compose stop`, a new `REDIS_PASSWORD` in `.env`
  and `docker compose start`, Compose 5 wrote the new password into Redis's config file while the
  health check kept the container's `REDISCLI_AUTH`, so Redis turned unhealthy (reproduced in the
  VM with `main`'s file; Compose reads the compose file for `start` unless given `-p`, which is why
  a first try with `-p` did not show it). The check now reads the password from the config file:
  after the same steps it stays healthy, and `docker compose up -d` recreates the container with
  the new password. `REDISCLI_AUTH` stays: without it, `up -d` kept the old password, because
  Compose does not notice a change in a config's content (tried in the VM). `.env.example` said
  Redis takes its password whenever its container is created; it now says to apply a new one with
  `docker compose up -d`, and infra/README.md says what `restart` and `start` do. A watcher
  running as `nobody` found the password on no command line in 1,511 scans over restarts and health
  checks. (The VMs ran the check before its long line was folded in the YAML; the Compose 5.6.1
  parser reads both forms as the same command.) Decision: "The Redis health check reads the
  password from Redis's config file".
- Fixed (docs): `.env.example` said only that hex passwords need no quoting. In the VM a password
  with a space stopped Redis, which then printed the whole password in its log at every restart (7
  lines in 12 seconds), and a double-quoted value holding `\n` added a line to Redis's config:
  `user default on nopass ~* &* +@all` left Redis open without a password, still healthy. Compose
  also reads `$` as a variable and an unquoted ` #` as a comment, so either silently shortens a
  password. The template now asks for letters and digits only and says why. Nothing enforces it:
  `.env` is the developer's own file.
- Fixed (security updates): the Redis and Alpine images predated Alpine's releases of 2026-10-21
  (OpenSSL 3.5.9 for the advisory of 2026-09-29, a musl fix and new ca-certificates after a
  compromised intermediate CA). `redis:8.10.2-alpine3.23` moved to its rebuild of 2026-10-22 (same
  tag, new digest) and the placeholders to `alpine:3.24.3`. In the VM the Redis rebuild has the
  same entrypoint (identical SHA-256), Redis version (8.10.2, a new build of it) and modules; only
  Alpine's packages changed. The images were a few hours to a day old when pinned, against the
  one-day wait that pnpm applies to npm packages; the security fixes were judged worth it.
- Fixed (docs): `infra/README.md`'s command blocks held `#` comments, which zsh, the default shell
  on macOS, passes to the commands when pasted: `openssl rand -hex 32   # prints ...` printed "too
  many arguments" and no password, and `tee` wrote files named after the comment's words (pasted
  into an interactive zsh started with `zsh -f`). The blocks now hold commands only.
- Recorded: the pinned `pgvector/pgvector` build (2026-10-01, still the newest) lacks Debian
  security updates that the official `postgres:18.6-trixie` (rebuilt 2026-10-21) has (`xz-utils`
  and `liblzma5`, `libpcre2-8-0`). (Corrected in round 4: this also said that it ships build tools
  the official image does not; its build removes them, and only their config files are left.)
  Decision: "The pgvector image lags the official postgres image's security rebuilds"; owner
  action below.

How to verify the fixes:

```sh
pnpm exec vitest run --project infra   # "Tests  40 passed (40)" then; 46 since round 4
pnpm exec vitest run --project tooling git-hooks.test.ts -t "compose"
# "Tests  3 passed" then: staging docker-compose.yml, compose.yaml or docker-compose.override.yml
# ran every test. Since round 4 "Tests  8 passed": docker-compose.yml still runs every test, and
# a staged YAML file runs the infra tests (see the round-4 fixes below)
pnpm test && pnpm typecheck && pnpm lint && pnpm format:check   # all exit with code 0
```

With Docker, from the repository root, with the root `.env` set up as under "How to verify"
above. (Corrected in round 4: this said "after the commands under "How to verify" above", whose
last step removes the containers, so `docker compose start redis` failed with "service "redis"
has no container to start" and nothing was checked. The first line now starts the services.)

```sh
docker compose up -d --wait              # both services report "Healthy"
docker compose stop redis
# put a new password in .env as REDIS_PASSWORD, for example the output of openssl rand -hex 32
docker compose start redis
sleep 30; docker compose ps redis        # "(healthy)": the check uses the password Redis has
docker compose up -d --wait              # recreates redis with the new password
docker compose exec redis redis-cli ping # PONG
```

Owner action: decide whether instruction 102 should build our own PostgreSQL image (the official
`postgres` image plus PGDG's `postgresql-18-pgvector` package) instead of using
`pgvector/pgvector`, which lags the official image's security rebuilds (see the decision above).

**Integration fixes (wave w0, round 3)**

- On 2026-10-22 the owner chose Redis 8 under its AGPLv3 option, used unmodified, and said that
  Valkey is not wanted. docs/DECISIONS.md records it in "Redis 8 under AGPLv3, confirmed by the
  owner; Valkey is not wanted", which supersedes "Redis 8 under its AGPLv3 option, with Valkey as
  the fallback"; the owner action above is marked done, and the `redis` row of
  docs/DEPENDENCIES.md says so. `docker-compose.yml` already pinned Redis 8 and does not change.

**Review fixes (wave w0, round 4)**

Charlie reviewed this instruction, took it over and followed the README and every "How to
verify" step above literally, from a fresh clone: on the build machine, with the Docker Compose
5.6.1 parser for macOS (SHA-256 checked against the release's `checksums.txt`), and with the
containers in a throwaway Debian 13 VM (Lima 2.2.1 and the Debian image checked against their
published checksums; Docker Engine 29.9.2 and Compose 5.6.1 from Docker's signed apt repository).

- Fixed (docs): the Docker steps of the round-3 fixes said to run them "after the commands under
  How to verify above", whose last step removes the containers. Run so in the VM,
  `docker compose start redis` failed with 'service "redis" has no container to start' and
  `docker compose ps redis` listed nothing, so nothing was checked. The block now starts the
  services first, and then gave the documented results.
- Fixed (open item w0.V3.Alpha.1): a committed file that Compose reads by default, in another
  letter case (`Compose.yaml`, `docker-compose.Override.yml`), passed every test and the hook,
  while Compose on macOS used it instead of, or on top of, `docker-compose.yml`. APFS also folds a
  long s (U+017F) to s and a Kelvin sign (U+212A) to k: on the build machine, Compose 5.6.1 used a
  `compose.yaml` spelt with a long s. The test matches the names with the `i` and `u` flags, and a
  seventh pre-commit task runs the infra tests whenever a YAML file is staged, in any letter case
  and any folder, dot folders included; Vitest's rerun triggers see neither, so the trigger glob
  for those names left `vitest.config.ts`. In a clone of this branch, committing `Compose.YAML`,
  `.devcontainer/compose.yaml` or `docker-compose.Override.yml` failed in about a second, and an
  ordinary YAML file went through. Decision: "A staged YAML file runs the compose tests, which
  match file names as macOS does".
- Fixed (tests, open item w0.V3.Alpha.3 and one more case of it): the health-check timings, the
  placeholders' image and commands and the project name had no test of their value, although the
  docs said every setting had one. 14 deliberate breakages passed: a 10-minute interval, time-out
  or start interval, 1,000 retries, no start period, a placeholder image from another registry,
  a placeholder that first runs a downloaded script or never exits, and another project name,
  under which PostgreSQL and Redis start on new, empty volumes. All 14 now fail a test; only the
  images' digests are checked for their form alone.
- Fixed (tests): the template checks read only `NAME=value` lines, but Compose also reads
  `export NAME=value`, `NAME = value`, `NAME: value` and indented lines, and a later line wins.
  With `export POSTGRES_PASSWORD=<value>` appended to `.env.example`, every test passed, and after
  the documented copy to `.env`, Compose gave PostgreSQL that committed value instead of the one
  set above it; `export COMPOSE_PROFILES=app` made a plain `docker compose up` start the
  placeholders. Every other line that is not blank or a comment, and a second line for a name, now
  fail the tests (7 of 7 such breakages), with the line's number but not its text. Decision: "The
  compose tests pin every value but the digests, and read every line of the env template".
- Fixed (security release): Redis 8.10.3 (2026-10-26) fixes a heap buffer overflow on the cluster
  bus, which this file does not use, so it was not exposed; the version policy asks for the latest
  release. The `redis:8.10.3-alpine3.23` build of 2026-10-26 has the same entrypoint (identical
  SHA-256), settings, modules and Alpine 3.23.7 as the 8.10.2 build and adds `zstd-libs`; Redis's
  licence file is unchanged. In the VM, every step under "How to verify" gave the documented
  results with it, the server ran as the `redis` user, and a watcher running as `nobody` found the
  password in none of 23,971 scans of every process's command line during five restarts.
- Fixed (docs): the three commands at the top of `docker-compose.yml` had comments after them.
  Pasted into zsh, `chmod` failed on the comment's words and Compose stopped with
  "no such service: #". The explanations now come first, and a test keeps the commands quoted in
  `docker-compose.yml` and `.env.example` free of comments.
- Fixed (docs): `infra/README.md` did not say that `docker compose --profile app up` does not
  return once the placeholders exit, or that Ctrl+C then stops PostgreSQL and Redis too (seen in
  the VM); it now does, and says what `-d` and `-d --wait` do.
- Fixed (docs, open item w0.V3.Alpha.2): the pinned pgvector image does not ship build tools. Its
  build removes them; dpkg keeps only their config files, and both it and the official
  `postgres:18.6-trixie` have the same 145 installed packages (checked in the VM). Corrected in the
  decision "The pgvector image lags the official postgres image's security rebuilds" and in the
  round-3 note above.
- Checked, no change needed: in the VM, the other steps above and the commands in
  `infra/README.md` gave the documented results: health, versions, pgvector, the refused wrong
  password, the append-only file, Redis's command line, data across `down` and `up`, the
  placeholders and their removal, a plain `down` breaking the next `--profile app up`, `restart`
  keeping the old Redis password while `up -d` recreates the container with the new one, a
  PostgreSQL password changed with `\password`, the connection URLs from the host, and both ports
  refused on the VM's own network address. The file is valid for the Compose 5.6.1 parser and for
  both compose-spec JSON Schemas (the compose-spec repository's and compose-go 2.16.1's, with Ajv
  8.20.0; four deliberately invalid documents were refused). The 137 deliberate breakages of the
  earlier rounds still fail a test wherever they apply to the file (125, eight of them rewritten
  for the new Redis line and header; the other 12 were written for older versions of the file).

How to verify the fixes:

```sh
pnpm exec vitest run --project infra   # "Tests  46 passed (46)"
pnpm exec vitest run --project tooling git-hooks.test.ts -t "compose"   # "Tests  8 passed"
pnpm test && pnpm typecheck && pnpm lint && pnpm format:check          # all exit with code 0
```

Then, from the repository root, check in a scratch clone that the hook refuses a file Compose
reads by default in another letter case or in a dot folder, and lets other YAML files through:

```sh
d=$(mktemp -d) && git clone --quiet . "$d/try" && cd "$d/try" && pnpm install --frozen-lockfile
printf 'services: {}\n' > Compose.YAML && git add Compose.YAML
git commit -m "test: add a compose file"     # rejected: × ... is the only Compose file that ...
git rm --quiet --cached Compose.YAML && rm Compose.YAML
mkdir .devcontainer && printf 'services: {}\n' > .devcontainer/compose.yaml
git add .devcontainer && git commit -m "test: add a dev container"   # rejected the same way
git rm --quiet -r --cached .devcontainer && rm -r .devcontainer
printf 'a: 1\n' > example.yml && git add example.yml
git commit -m "test: add a yaml file"        # passes, after ✔ vitest run --project infra
cd - && rm -rf "$d"
```

With Docker, the steps under "How to verify" above check the new Redis image:
`docker compose exec redis redis-cli INFO server` then shows `redis_version:8.10.3`.

## #4 - Typed environment loader

**What changed**

- `packages/shared/src/env.ts`: `parseEnv(schema, source, options)`, the reusable Zod helper. It
  reads only the variables the schema declares, treats an empty value as not set, collects every
  problem, and throws an `EnvValidationError` whose message names each missing or invalid
  variable and never prints a value. It also exports `envPortSchema` (digits, 0 to 65535) and
  `envHostSchema` (an IP address or a hostname, so a URL or `host:port` is rejected).
- API: `apps/api/src/config.ts` exports `loadConfig(env)`, which returns a typed `ApiConfig`
  (`host`, `port`, `logLevel`) from `API_HOST` (default `127.0.0.1`), `API_PORT` (default `4000`)
  and the new `LOG_LEVEL` (`fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`; default
  `info`). It replaces `loadServerConfig`. `src/server.ts` is the only API file that reads
  `process.env`: it loads the config before anything else, prints the error and exits with code 1
  if a variable is missing or invalid, and passes the log level to the app's logger.
- The API's `dev` and `start` scripts load `apps/api/.env` when it exists (Node's
  `--env-file-if-exists`). Variables set in the shell win, and `pnpm dev` restarts when the file
  changes.
- Web: `apps/web/src/env/` separates server-only variables (`server.ts`, which imports
  `server-only`, so a Client Component that imports it fails the build) from browser-visible
  `NEXT_PUBLIC_` variables (`public.ts`). `server-schema.ts` and `public-schema.ts` declare the two
  groups (a single `schema.ts` until the wave w0 review); both are empty because the web app reads
  no variables yet. `next.config.ts` now exports a function that checks them (`validate.ts`)
  whenever Next.js loads its config: public variables in `next dev` and `next build`, server
  variables in `next dev` and `next start`.
- Templates: `apps/api/.env.example` (the API variables and their defaults) and
  `apps/web/.env.example` (no variables yet: the rules for adding one, and why `WEB_HOST` and
  `WEB_PORT` work only from the shell). The root `.env.example`, for Docker Compose, belongs to
  instruction 3.
- ESLint: `no-restricted-properties` rejects `process.env` in `apps/*/src` and `packages/*/src`,
  except in the three modules that read it.
- `env-files.test.ts`, in a new root `tooling` Vitest project, asks git
  (`git check-ignore --no-index --verbose`) about 22 env-file names in several folders, which must
  be ignored, and the three templates, which must not be, and fails if any env file is committed.
- The API entrypoint test now gives the server process only the API's variables, so the
  developer's shell cannot change the result, and covers invalid variables (it checks the whole
  output, so a printed value or stack trace fails it) and `LOG_LEVEL`.
- README: a "Configuration" section. `.gitignore`: the env rules' comment names the test.

**How to verify**

Run from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm lint && pnpm typecheck   # both exit with code 0
pnpm test                     # every test passes; when #4 was finished: "Test Files  10 passed
                              # (10)" and "Tests  144 passed (144)"
pnpm build                    # web build log includes "Running next.config.ts took ..."
```

The gitignore rules, as git applies them (the test checks many more names; the line numbers move
if `.gitignore` changes above the env rules):

```sh
git check-ignore -v --no-index .env apps/api/.env apps/web/.env.local
# .gitignore:24:.env	.env
# .gitignore:24:.env	apps/api/.env
# .gitignore:25:.env.*	apps/web/.env.local
git check-ignore -v --no-index apps/api/.env.example apps/web/.env.example
# .gitignore:26:!.env.example	apps/api/.env.example    (the "!" rule means: not ignored)
# .gitignore:26:!.env.example	apps/web/.env.example
git check-ignore -v --no-index infra/postgres.env .envrc
# .gitignore:22:*.env	infra/postgres.env
# .gitignore:23:.envrc	.envrc
pnpm exec vitest run env-files.test.ts   # "Tests  30 passed (30)" since round 3 of the review
```

The API refuses invalid settings, names each one and never prints a value (after `pnpm build`):

```sh
API_PORT=99999 LOG_LEVEL=loud pnpm --filter @apex/api start
# .env not found. Continuing without it.        (Node's notice when apps/api/.env is absent)
# Invalid environment variables for the API (values are not shown):
#   - API_PORT: must be a whole number from 0 to 65535
#   - LOG_LEVEL: must be one of fatal, error, warn, info, debug, trace, silent
# Set them in apps/api/.env (see apps/api/.env.example) or in the environment, which overrides the file.
# then pnpm reports "Command failed with exit code 1"
```

The API reads `apps/api/.env`, and the shell wins over it. The first line sets an `apps/api/.env`
that you already have aside, in a new folder `apps/api/.env.backup` (gitignored, like every
`.env.*` name). If that folder already exists, because these lines ran before without the clean-up
below, `mkdir` says "File exists" and the first backup is kept. The next two lines write a copy of
the template that sets port 4010, only while the backup folder exists.

```sh
mkdir apps/api/.env.backup && { [ ! -e apps/api/.env ] || mv apps/api/.env apps/api/.env.backup/; }
[ -d apps/api/.env.backup ] && cp apps/api/.env.example apps/api/.env && chmod 600 apps/api/.env
[ -d apps/api/.env.backup ] && echo "API_PORT=4010" >> apps/api/.env
pnpm --filter @apex/api dev
```

The API logs "Server listening at http://127.0.0.1:4010", and in a second terminal
`curl http://127.0.0.1:4010/health` prints `{"status":"ok"}`. Press Ctrl+C, then run
`LOG_LEVEL=warn pnpm --filter @apex/api dev`: the API still answers on port 4010, but logs nothing
for the start or for requests (those lines are at info level). Press Ctrl+C, then clean up. This
line deletes the copy, puts your own file back if you had one and removes the backup folder; once
that is done, it does nothing, so running it twice is safe:

```sh
[ ! -d apps/api/.env.backup ] || { rm -f apps/api/.env; [ ! -e apps/api/.env.backup/.env ] || mv apps/api/.env.backup/.env apps/api/.env; rmdir apps/api/.env.backup; }
```

The web app's guard and phase checks:
`pnpm exec vitest run --project web --reporter=verbose` lists
`server env module > refuses to load outside React Server Components` (importing
`src/env/server.ts` anywhere but on the server throws) and a `validateWebEnv` test for each
Next.js phase, and ends with `Tests  35 passed (35)` (47 since round 2 of the wave w0 review).

**Dependencies added**

- `server-only` (web): marks `apps/web/src/env/server.ts` as server-only. Next.js handles the
  import itself; the package lets other tools resolve it (Vitest now, Storybook from instruction
  22), where importing the module throws.
- `zod` (web): already used by packages/shared and the API; the web app declares its env schemas
  with it.

**Owner actions**

None for this instruction.

**Notes & limitations**

- The web app reads no variables yet, so its schemas are empty and its checks pass trivially. The
  mechanism was verified with temporary variables, removed afterwards: `next build` without a
  required public variable stopped and named only it; with it, the build succeeded without the
  server's secret and the value was copied into the browser JavaScript; `next start` without the
  secret exited with code 1 naming only it; a Server Component could import `serverEnv` and the
  secret reached no browser file; a Client Component importing `serverEnv` failed the build with
  an import trace. The review found that the build without the secret succeeded only while no
  route imported `serverEnv`, and that `publicEnv` brought the server schema into browser code
  (see "Review fixes (wave w0, round 1)").
- `WEB_HOST` and `WEB_PORT` work only from the shell, for example `WEB_PORT=3010 pnpm dev`:
  Next.js opens the port before it reads `.env` files or its config. Next.js's CLI rejects a
  non-numeric port ("'abc' is not a non-negative number") and exits with code 1, and so does a
  host it cannot resolve ("Failed to start server"). An out-of-range port makes Next.js print
  Node's `ERR_SOCKET_BAD_PORT` as an "Unhandled Rejection", after which `next dev` keeps running
  without serving anything and `next start` exits with code 0 (corrected in round 3 of the wave w0
  review, see below).
- No API variable is required yet, because each has a safe default. The first required ones (such
  as the database URL in Phase 2) will stop the API in the same way when missing; the
  packages/shared tests cover that path.
- `pnpm dev` keeps watching after an environment error ("Failed running 'src/server.ts'. Waiting
  for file changes before restarting..."); saving a fixed `apps/api/.env` restarts it.
  `pnpm start` exits with code 1.
- `next typegen`, which `pnpm typecheck` runs, loads the Next.js config in the build phase, so
  once a required public variable exists, type checks (and CI) need it set too.
- Next.js prints "Failed to load next.config.ts", then the error as
  `Error [EnvValidationError]: ...` with the problems, a short stack trace and the same problems
  as an `issues` list; the API prints only the message. `next dev` and `next start` print "Ready"
  just before that, because Next.js opens the port before it loads its config, then exit with
  code 1.
- `server.ts` passed `LOG_LEVEL` to Fastify's logger through `buildApp`'s `logger` option.
  Instruction 8 (structured logging) replaced that option with `logLevel` and `logFormat`; since
  Phase 0 was merged, `server.ts` passes `LOG_LEVEL` and instruction 8's `LOG_FORMAT` through
  them.
- If instruction 102 switches the web app to Next.js's standalone output, its `server.js` does
  not load `next.config.ts`, so the server-variable check must move to `instrumentation.ts`.

**Review fixes (wave w0, round 1)**

Bravo reviewed this instruction with a security focus, took it over and re-checked it by running
it: every "How to verify" step above (on ports 3020 and 4020), `pnpm build`, hostile values
(values that make a schema's own code throw, and 1 MB values, which the port and host checks
reject in under 3 ms), and real `next build`, `next start` and `next dev` runs with temporary
variables, removed afterwards. Each code fix has a test that fails without it:

- `parseEnv` passed on any error thrown inside a check or a transform, and the API's entrypoint
  rethrew it. `JSON.parse` and `BigInt` quote the value in their messages, and Node.js prints a
  URL error's `input` property, so a schema that parsed JSON or a URL could have printed a
  secret. Such errors are now dropped: the variable is reported as "its check threw an error,
  which is not shown because it may contain the value", next to every other problem.
- Browser code received the server schema. `public.ts` imported `schema.ts`, which also built
  the server schema: with a temporary `INTERNAL_API_URL` (default
  `http://internal-only-host.example:9999`) and `SESSION_SECRET`, and a Client Component using
  `publicEnv`, `.next/static` held both names, their rules and the URL. The schemas now live in
  `public-schema.ts` and `server-schema.ts`, and `validateWebEnv` in `validate.ts`;
  `public.test.ts` fails if `public.ts` loads the server schema (other browser code was not
  covered until round 2). The same build now has none of them in `.next/static`.
- `serverEnv` was parsed when its module loaded, and `next build` loads every route's modules
  while it collects page data, so a build without the server's secret failed ("Failed to collect
  configuration for /probe-dynamic", a route rendered only on request). `server.ts` now exports
  `getServerEnv()`, which reads the variables when it is called. The same build succeeds without
  the secret; `next start` and `next dev` without it still exit with code 1 naming only
  `SESSION_SECRET`; with it in `apps/web/.env`, `next start` serves the route.
- `validateWebEnv` merged the two schemas' shapes, which drops a rule on a whole schema (such as
  "SMTP_PASSWORD is required when SMTP_USER is set"), so `next start` could start with values
  that the app rejects at the first request that reads them. Each group is now checked with its
  own schema.
- No test covered `next.config.ts` running the check: deleting the call left every test passing.
  `src/env/next-config.test.ts` fails if the call is removed, its error is swallowed or the live
  environment is not passed.
- The lint rule that keeps `process.env` in the env modules missed
  `import { env } from "node:process"`, namespace and renamed default imports of `process`,
  `globalThis.process` and `global.process`. ESLint now rejects them too; `env-access.test.ts`
  runs the configured rules on each route, and `eslint.config.mjs` is now a pre-commit rerun
  trigger.
- `.gitignore` did not ignore `*.env` files (Docker's `--env-file`, Compose's `env_file:`) or
  direnv's `.envrc`. It does now; `env-files.test.ts` checks 22 names instead of 17.
- Nothing compared the templates with the schemas: deleting `LOG_FORMAT` from
  `apps/api/.env.example` left every test passing. `config.test.ts` now checks that the API
  template lists exactly the schema's variables, each commented-out value being the default;
  `src/env/env-example.test.ts` checks the web template's names.
- README: the "Configuration" table now lists the root `.env` that Docker Compose reads.

How to verify the fixes:

```sh
pnpm exec vitest run packages/shared/src/env.test.ts       # "Tests  54 passed (54)"
pnpm exec vitest run apps/web/src/env                      # "Tests  33 passed (33)"
pnpm exec vitest run apps/api/src/config.test.ts apps/api/src/server.test.ts  # "Tests  58 passed (58)" (46 before round 2, 54 before round 3)
pnpm exec vitest run env-access.test.ts env-files.test.ts  # "Tests  94 passed (94)" (61 before round 2, 92 before round 3)
```

To repeat the build check by hand: add `SESSION_SECRET: z.string().min(32)` to
`apps/web/src/env/server-schema.ts`, and a page `apps/web/src/app/probe/page.tsx` that exports
`dynamic = "force-dynamic"` and whose component calls `await connection()` (from `next/server`)
and then `getServerEnv()`. Then `pnpm --filter @apex/web build` succeeds without
`SESSION_SECRET`, and `pnpm --filter @apex/web start` exits with code 1 and names it. Remove both
afterwards.

Not changed: `WEB_HOST` and `WEB_PORT` stay shell variables that our loader does not validate
(see "WEB_HOST and WEB_PORT stay shell variables" in DECISIONS).

**Review fixes (wave w0, round 2)**

Alpha reviewed this instruction as a new developer meets it. In fresh clones of `main` and of the
review branch, the README's quick start and configuration steps and every "How to verify" step
above ran as written (on ports 3010 and 4010) and gave the results they describe, apart from the
totals of `pnpm test`, which grow with later instructions (see the note at the top of this log).
So did the manual build check with a temporary `SESSION_SECRET`, the recovery of `pnpm dev` from
a bad `apps/api/.env` (also from a file created while it runs), a temporary required
`NEXT_PUBLIC_` variable (`next build` stops without it and, with it in `apps/web/.env`, copies it
into `.next/static`) and CI's start check. In the root `pnpm dev`, a web env error stops both
apps, because pnpm stops the API when Next.js exits, while an API env error leaves the web app
running and the API waiting for a fixed file. The two open items from the round-1 verification
were reproduced first, with real `pnpm exec eslint` runs and a real `next build`. Each code fix
has a test that fails without it:

- `import()` of `process` or `node:process` got past the env lint rules, because
  `no-restricted-imports` does not check `import()`, while the config's comment said that the
  import bans closed every route. ESLint now rejects it, written as a string or a template
  literal. Code that passes `process` around as a value (`const proc = process`,
  `Reflect.get(process, "env")`) still gets through; DECISIONS says why.
- A Client Component could import `src/env/server-schema.ts`, or `validate.ts`, directly: lint
  and the tests passed, and `next build` put the server schema's names and rules into
  `.next/static`. ESLint now rejects importing either through an `env` folder, statically or
  with `import()`, anywhere in `apps/web/src`.
- The pre-commit hook let an env file into a commit: after `git add --force apps/api/.env`,
  `git commit` went through, because `vitest related` found no test that imports the file, and
  only a later `pnpm test` failed `env-files.test.ts`. Env files are now rerun triggers, so the
  hook runs every test and that test stops the commit; `git-hooks.test.ts` checks four names.
- The error for a bad variable said to set it in `apps/api/.env` "or in the environment", but a
  variable exported by the shell wins over the file: with `LOG_LEVEL=DEBUG` in the shell,
  `LOG_LEVEL=debug` in `apps/api/.env` changed nothing and the same message came back. Both apps'
  messages now end "or in the environment, which overrides the file" (the web app's: "the .env
  files"), and the README shows how to find a value that the shell exports (`printenv`).
- Nothing tested that the API's `dev` and `start` scripts read `apps/api/.env`, or that the shell
  wins over it: with `--env-file-if-exists=.env` removed from both scripts, all 555 tests on
  `main` passed. `apps/api/src/env-file.test.ts` runs each real script in a scratch folder with
  a stand-in entrypoint that prints what it received, with and without the file and with a
  shell variable.
- The templates' copy commands left `apps/api/.env` and `apps/web/.env` readable by every
  account on the machine, although server secrets belong in `apps/web/.env` and the root `.env`
  already gets `chmod 600`. The templates, the README and the step above now add `chmod 600`.
- Docs: `apps/web/.env.example` and the README said that `pnpm build` and `pnpm start` stop on
  any missing or invalid variable, but `pnpm build` checks only the `NEXT_PUBLIC_` ones (the
  manual build check above succeeds without the server's secret) and `pnpm start` only the
  server ones; both now say which command checks what. The README said that the command stops,
  but in `pnpm dev` the API waits for a fixed file; it now says so and explains Node.js's ".env
  not found" notice. The step above that shows the API reading `apps/api/.env` overwrote and
  then deleted a developer's own `apps/api/.env`; it now moves the file aside and back.

How to verify the fixes:

```sh
pnpm exec vitest run env-access.test.ts               # "Tests  64 passed (64)"
pnpm exec vitest run apps/api/src/env-file.test.ts    # "Tests  6 passed (6)"
pnpm exec vitest run git-hooks.test.ts -t "runs every test when"  # "Tests  21 passed | 55 skipped (76)"; 21 of 88 since round 3
mkdir -p apps/web/src/app/probe
printf '"use client";\n\nexport { serverEnvSchema } from "../../env/server-schema";\n' \
  > apps/web/src/app/probe/leak.tsx
pnpm exec eslint apps/web/src/app/probe   # 1 error: "... The server env schema must never reach the browser. ..."
rm -r apps/web/src/app/probe
printf 'export const { env } = await import("node:process");\n' > apps/api/src/probe.ts
pnpm exec eslint apps/api/src/probe.ts    # 1 error: "Use the global process. ..." (no-restricted-syntax)
rm apps/api/src/probe.ts
```

The hook refusing an env file (the commit fails, so nothing else you have staged is committed;
it took as long as `pnpm test` until round 3, and takes a few seconds since):

```sh
printf 'SECRET=x\n' > infra/probe.env && git add --force infra/probe.env
git commit -m "chore: try to commit an env file"   # fails: env-files.test.ts, "are never committed"
git rm --cached --quiet infra/probe.env && rm infra/probe.env
```

**Review fixes (wave w0, round 3)**

Echo reviewed this instruction with a docs-and-decisions focus: every claim about it in the
README, this log, DECISIONS, DEPENDENCIES, ARCHITECTURE and the templates was checked against the
code, the lockfile and real runs. In a fresh clone of `main`, the steps above ran (the API on
port 4050 instead of 4010) and gave the results they describe, apart from the totals of
`pnpm test` (see the note at the top of this log) and the faults below in the steps that set
`apps/api/.env` aside. So did `next start` without a temporary required server variable, the
recovery of `pnpm dev` once a bad `apps/api/.env` was fixed, the ESLint probes, and a temporary
required `NEXT_PUBLIC_` variable, which `pnpm typecheck` needed too. In a fresh clone of the review
branch, the new steps set a file of the developer's aside and put it back intact, also when run
twice, and the hook refused env files force-added in `.apex-probe/`, `.devcontainer/` and
`infra/`, each in one or two seconds. Fixes, each with a test that fails without it unless it says
otherwise:

- The pre-commit hook let an env file in a dot folder into a commit: after
  `git add --force .devcontainer/devcontainer.env`, `git commit` went through in 2 seconds,
  because Vitest's rerun triggers never look inside a folder whose name starts with a dot. A new
  task in `lint-staged.config.ts` runs `env-files.test.ts` whenever a file named like an env file
  (`.env`, `.env.*`, `*.env`, `.envrc`) is staged in any folder; lint-staged's matching enters dot
  folders. The env-file trigger left `vitest.config.ts`, so such a commit now fails in seconds
  instead of after every test. `git-hooks.test.ts` checks six names, three in dot folders, in
  place of the four trigger cases; `env-files.test.ts` checks that its committed-file check
  recognises env files in every folder.
- The steps above that show the API reading `apps/api/.env` lost a developer's own file when the
  first lines ran twice before the clean-up: the second run moved the copy of the template over
  the backup. They also left that copy (with `API_PORT=4010`) behind when the developer had no
  file and the first lines ran twice, and deleted the developer's restored file when the clean-up
  line ran twice. The backup now goes into a folder that `mkdir` creates only on the first run,
  and the clean-up does nothing once that folder is gone. `build-log.test.ts` runs both blocks of
  this log twice, in sh and in zsh, with and without a file of the developer's.
- The README and `apps/web/.env.example` said which command checks which web variables, but not
  that `pnpm typecheck`, and so the pre-commit hook and CI, checks the `NEXT_PUBLIC_` ones: its
  `next typegen` loads the config as `next build` does. Both say so now. Documentation only.
- `env-access.test.ts` failed a full `pnpm test` on the busy machine: its first test loads the
  whole ESLint config and timed out at 5,040 ms against Vitest's 5 s limit. The config now loads
  once, before the tests, with 30 s. Not testable as such; the slowest test now takes about 15 ms.
- The note above on `WEB_PORT` said that an out-of-range port fails. Next.js prints the error, but
  `next dev` keeps running without serving anything and `next start` exits with code 0; the note
  and DECISIONS ("WEB_HOST and WEB_PORT stay shell variables") now say so. Documentation only.
- ARCHITECTURE.md's status columns left instruction 4 out of the web app, the API and
  packages/shared. Documentation only. `eslint.config.mjs` and DECISIONS add
  `process.getBuiltinModule("process")` to the routes that the env lint rules let through.

How to verify the fixes: these two commands report `Tests  7 passed | 81 skipped (88)` and
`Tests  35 passed (35)`.

```sh
pnpm exec vitest run git-hooks.test.ts -t "env file"
pnpm exec vitest run env-files.test.ts build-log.test.ts
```

The hook refusing an env file in a dot folder: the `git commit` below fails within a second or
two, and the failure of `env-files.test.ts` names `.apex-probe/probe.env`. Nothing else you have
staged is committed, and the last line removes the file again.

```sh
mkdir .apex-probe && printf 'SECRET=x\n' > .apex-probe/probe.env
git add --force .apex-probe/probe.env
git commit -m "chore: try to commit an env file in a dot folder"
git rm --cached --quiet .apex-probe/probe.env && rm .apex-probe/probe.env && rmdir .apex-probe
```

**Integration fixes (wave w0, round 3)**

- With the round's other branches merged, `git-hooks.test.ts` has 88 tests (79 on the review
  branch), so the counts above that filter it are updated: `-t "env file"` gives 7 passed of 88,
  and `-t "runs every test when"` 21 of 88.
- The `pnpm test` line under "How to verify" now says that its totals are those from when this
  instruction was finished, as the log's introduction says such counts are: run again at that
  commit (`bc024e2`), `pnpm test` printed exactly `Test Files  10 passed (10)` and
  `Tests  144 passed (144)`. Today every test passes, and there are more of them.

## #5 - GitHub Actions CI

**What changed**

- `.github/workflows/ci.yml`: on every push to `main` and every pull request, one job ("Checks")
  on `ubuntu-26.04` sets up pnpm (the `packageManager` version) and Node.js (`.nvmrc`), restores
  pnpm's package store from the cache, runs `pnpm install --frozen-lockfile`, then
  `pnpm peers check`, `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test` and
  `pnpm build`, fails on warnings (and errors that did not stop the build) in the build output
  and validates `docker-compose.yml` (with every profile, failing on any warning). Every check
  runs even when an earlier one failed.
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
  any warning" covers, on supply-chain safety and on the Node.js version that `scripts/` needs.

**How to verify**

GitHub runs the workflow only once the repository is on GitHub (see Owner actions). Locally,
from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm exec vitest run --project scripts            # "Test Files  6 passed (6)", "Tests  124 passed (124)"
pnpm peers check                                  # "No peer dependency issues found"
pnpm build 2>&1 | tee build.log                   # the route table, then "Done"
node scripts/check-build-warnings.ts build.log    # "Found no warning or error lines ...", status 0
printf 'apps/web build: ⚠ Example warning\n' >> build.log
node scripts/check-build-warnings.ts build.log    # lists the line and exits with status 1
rm build.log
```

To see the check catch real build output (worth repeating after upgrading Next.js, Node.js or
pnpm), add a page that provokes three kinds of problem the build does not stop for: a Turbopack
compile warning (a file path built at run time), a Next.js warning (`themeColor` in `metadata`,
where Next.js wants it in `viewport`) and an error that the page logs while it is prerendered:

```sh
mkdir apps/web/src/app/probe
cat > apps/web/src/app/probe/page.tsx <<'EOF'
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const metadata = { themeColor: "#000000" };

export default function Page() {
  console.error(new Error("probe"));
  const file = join(process.cwd(), process.env["PROBE_FILE"] ?? "package.json");
  return <p>{readFileSync(file, "utf8").length}</p>;
}
EOF
pnpm build 2>&1 | tee build.log                   # still ends with "Done": the build succeeds
node scripts/check-build-warnings.ts build.log    # lists 5 lines (below) and exits with status 1
rm -r apps/web/src/app/probe build.log
```

The check lists `Error: probe`, `⚠ Unsupported metadata themeColor is configured in metadata
export in /probe. ...`, `Turbopack build encountered 2 warnings:` and two `Warning: Dynamic
filesystem access causes tracing of the whole project` lines, each after `apps/web build:`. If the
build prints one of these but the check does not list it, its wording has changed: add the new
form to `scripts/check-build-warnings.ts` and to its tests.

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
  status check to pass, so nothing merges with failing checks. GitHub enforces rulesets (and
  branch protection) on a private repository only on a paid plan: GitHub Pro for a personal
  account, or Team for an organisation. On GitHub Free, CI still runs and reports on every push
  and pull request, but nothing stops a merge or a push to `main` with failing checks, so look at
  the run before merging.
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
  lists the formats). It cannot see plain text that code logs while Next.js prerenders a page,
  even with `console.error` or `console.warn`: Next.js prints the bare text (tested). Console
  output from passing tests is not checked either.
- `vitest related`, which the pre-commit hook (instruction 2) runs, cannot see that
  `scripts/ci-workflow.test.ts` reads the workflows. Since Phase 0 was merged,
  `` `${root}.github/workflows/*` `` is in `forceRerunTriggers` in `vitest.config.ts`, so a commit
  that changes only a workflow runs every test. CI runs them either way.
- `scripts/check-build-warnings.ts`, `scripts/check-docker.ts` and `scripts/check-start.ts` need
  Node.js 24.2 or later (`import.meta.main`). CI and `.nvmrc` install the latest Node.js 24; on
  an older one the tests fail, so the checks cannot pass quietly. `engines` still allows 24.0
  (see docs/DECISIONS.md).
  (Since the wave w0 review, `engines` requires 24.15 and `pnpm install` enforces it.)
- The action SHAs do not update themselves; Dependabot arrives with instruction 106.

**Review fixes (wave w0, round 1)**

Charlie reviewed instructions 5 and 7, took them over from Delta and re-checked them by running
them: every "How to verify" step above in a fresh clone; a simulation of every `run:` step of
`ci.yml` on a fresh clone of the review branch, with Compose 5.1.3 (the runner's version), in
which every step passed (441 tests); actionlint 1.7.12 with shellcheck 0.11.0 and zizmor 1.30.1,
all checksum-verified, without findings; every action SHA against the GitHub API (each is its
latest release and on its default branch); and 26 deliberate breakages of the workflow and the
scripts, each failing a test. Fixes, each with a test where it changed code or a test:

- No test held the workflow's set-up or its step conditions. Renaming a step id (GitHub then
  reads `steps.<id>` as empty and skips every check that names it, while the job passes),
  misspelling `'success'`, removing `cache: pnpm`, the `.nvmrc` input or `cancel-in-progress`,
  setting up Node.js before pnpm, dropping `2>&1` from the Build step and removing the Compose
  step's passwords all left the tests green; `scripts/ci-workflow.test.ts` now fails on each.
- The build-log check said "The build printed no warnings or errors." even when a page had
  logged plain text with `console.error` while it was prerendered, which Next.js prints bare
  (seen in a probe build). It now says "Found no warning or error lines in the build output.",
  and docs/DECISIONS.md lists `console.error` among what the check cannot see; a test with the
  probe build's output pins that limit.
- The set-up test rejected Corepack's integrity hash in `packageManager`
  (`pnpm@12.11.2+sha512.<hex>`), which pnpm/action-setup accepts. It now allows it.
- Owner actions: a ruleset on a private repository is enforced only on a paid GitHub plan.
- Docs: the README said that CI "runs the full checks either way" when hooks are skipped, but CI
  does not check commit messages ("CI does not check commit messages" in docs/DECISIONS.md); the
  README's prerequisites now name Node.js 24.2, which `scripts/` needs (once merged, 24.15: the
  review of instruction 1 raised the minimum for a dependency and made pnpm enforce it);
  docs/DECISIONS.md said that pinning `ubuntu-26.04` keeps the runner image fixed, but GitHub
  updates its software weekly; the decision on "fail on any warning" pointed here for provoking
  real build output, which "How to verify" now shows; and the README's pre-push commands now
  include the Compose check.

**Integration fixes (wave w0, round 1)**

- CI built both apps but started neither (Echo's hand-off from the review of instruction 1). A
  build that succeeds can still fail to start: `next start` checks the web server's environment
  variables only as it starts, and the API's production start runs the compiled code with flags
  of its own. A new step after the build-warning check, "Start the production build", runs
  `scripts/check-start.ts`. It starts both production builds with `pnpm start` on free loopback
  ports, waits up to a minute until the API answers GET /health with `{"status":"ok"}` and the
  web app serves its home page as HTML, then stops them with SIGTERM, and kills them if they have
  not stopped after ten seconds. On failure it says which app did not answer, or how the command
  ended, and prints what the apps printed. `scripts/check-start.test.ts` runs it against a
  stand-in for `pnpm start` (both apps answer; a wrong health body; no web app; the command exits
  early; the apps ignore SIGTERM), and `scripts/ci-workflow.test.ts` checks the step's place and
  condition; six deliberate breakages each failed the tests. Against this Mac's real build it
  passed in 0.4 s, and it reported the API's error with an invalid `LOG_LEVEL` and Next.js's with
  `WEB_HOST=256.0.0.1`. actionlint 1.7.12 with shellcheck 0.11.0 reports nothing. It has not run
  on GitHub yet (see Owner actions).

How to verify, from the repository root:

```sh
pnpm exec vitest run scripts/check-start.test.ts   # "Tests  28 passed (28)" since wave w0 round 3
pnpm build && node scripts/check-start.ts           # "Both apps started: the API answered ..."
LOG_LEVEL=loud node scripts/check-start.ts          # "`pnpm start` exited with code 1 before
                                                    # both apps answered.", then the API's error
```

**Review fixes (wave w0, round 2)**

Bravo reviewed instructions 5 and 7, took them over and re-checked them by running them: the "How
to verify" steps above in a fresh clone; actionlint 1.7.12 with shellcheck 0.11.0 and zizmor
1.30.1 (checksum-verified), without findings; each action's SHA against the GitHub API (still its
latest release, on its default branch); a frozen install of the lockfile for Linux x64, the
runner's platform, which met no install script outside `allowBuilds`; and a simulation of every
step of `ci.yml` (GitHub's shell command, the workflow's `if:` conditions and environment,
`CI=true`, no git identity) on fresh clones with an empty pnpm store, on macOS and in an Ubuntu
26.04 VM (Lima 2.2.1; Ubuntu 26.04 is the release of the `ubuntu-26.04` runner; Node.js 24.21.0,
pnpm 12.11.2, Docker Engine 29.9.1 and Compose 5.1.3, the runner image's version). Fixes:

- In the VM, CI's Test step failed: `workspace.test.ts` (instruction 1) installs copies of the
  workspace offline in /tmp, which Ubuntu 26.04 mounts as a tmpfs, and pnpm, which keeps one store
  per file system, looked for the packages in an empty /tmp/.pnpm-store
  (`ERR_PNPM_NO_OFFLINE_TARBALL`). The test now gives those installs the checkout's own store
  (see "Workspace copies in tests use the checkout's pnpm store" in docs/DECISIONS.md). In the VM
  it then passed, and failed again with the store moved away. Every other step passed in the VM
  and on macOS.
- Interrupted by Ctrl+C, `kill` or a closed terminal, the start check ended at once and left
  `pnpm start`, both apps and pnpm's helpers running, 9 processes each time, and a start check
  test that failed or timed out left its stand-in app running (w0.V1.Echo.2). The check now stops
  the apps first, prints "Interrupted by SIGINT: stopped the apps." (or the signal it got) and
  ends by the same signal; each test kills its stand-in however it ends. Against the real build,
  on macOS and in the VM, no process was left after SIGINT to the check's process group at
  several moments, SIGTERM or SIGHUP, nor after tests that timed out or a killed test run.
- Three more defects of the start check, each now with a test: with `WEB_HOST=0.0.0.0` in the
  shell the production web app listened on every interface during the check, and with
  `API_HOST=::1` the check failed after its full minute (both apps now get 127.0.0.1); without
  `pnpm` on `PATH` it said "`pnpm start` exited with code -2" above an empty section of output
  (now "could not be started (spawn pnpm ENOENT)" and "The apps printed nothing."); and after
  SIGKILL it waited without limit for a process outside the command's process group that held
  the output (now ten seconds at most, after which it says so).
- The start check's comments and its decision said that it fails when the apps do not stop after
  SIGTERM. pnpm 12 passes SIGTERM on to both apps but kills the other one with SIGKILL as soon as
  one has ended: with the compiled API changed to ignore SIGTERM, the check passed, on macOS and
  in the VM. They now say that it shows that the apps start and answer, and that the API's own
  tests check its shutdown.
- The recipe above for provoking real build output made a page log an Error only, although
  docs/DECISIONS.md points to it for provoking a warning (w0.V1.Echo.1). The probe page now also
  provokes a Turbopack compile warning and a Next.js "⚠" warning; run as written, the check
  listed all five lines.
- The test counts in "How to verify" above and in instruction 7 were out of date.

How to verify, from the repository root:

```sh
pnpm exec vitest run scripts/check-start.test.ts workspace.test.ts   # "Tests  33 passed (33)"
pnpm build
node scripts/check-start.ts & sleep 0.2; kill -INT $!; wait $!; echo "status $?"
# "Interrupted by SIGINT: stopped the apps." and "status 130"; if it says "Both apps started",
# it finished before the signal arrived: run the line again
pgrep -fl 'next-server|dist/server.js' || echo "no app left"     # "no app left"
```

The start check's tests named "stops the apps, then ends by SIGINT" (and SIGTERM, SIGHUP) start
it as a terminal does, with a stand-in for `pnpm`, and interrupt it. The workspace test's failure
shows only where /tmp is on another file system than pnpm's store, as on Ubuntu 26.04.

**Review fixes (wave w0, round 3)**

Alpha reviewed instructions 5 and 7 and took them over from Bravo. The review broke the workflow,
the three checks in `scripts/`, the root `docker:*` and `db:*` scripts and `workspace.test.ts` on
purpose, 64 ways, one at a time, and ran their tests: 32 breakages passed every test. Two of those
change nothing that matters: the build-log check also running after a failed build, when the job
has already failed, and the Docker engine's version also being checked on Windows, which these
scripts do not support. Each of the other 30 now fails a test, and every new test was checked by
breaking the code it guards. Fixes:

- The workflow tests let a failed check pass: `continue-on-error: true` on a step or on the job, a
  job condition that skips pull requests, `|| true` after `pnpm lint`, `pnpm typecheck` or
  `pnpm test`, and `pnpm lint --fix` all passed them, as did the Compose step waiting for the
  install, Next.js's telemetry left on, and `NODE_OPTIONS=--no-warnings` or `NODE_NO_WARNINGS`,
  which hide every Node.js warning from the build-log and start checks.
  `scripts/ci-workflow.test.ts` now refuses each.
- The start check's core rules had no test: what counts as a good answer (status 200 from both
  apps, an HTML content type and a whole page from the web app), the time limit on each request,
  the SIGKILL that ends processes left in the command's group, the program's exit status and
  output, the time limits themselves, and how soon the program ends after a pass (a timer that
  kept Node.js running made it end 10 s late). New stand-in modes and tests cover each. Failure
  messages now say exactly what was wrong (a status of 503 used to read "answered with status 503
  and an unexpected body"), problems are listed one per line, and a stop that needed SIGKILL says
  so. The limit for the apps to answer now counts from the start of the command, as documented,
  not from after the first two requests.
- Removing the closing of the output streams, which lets the program end when a process outside
  the command's group still holds them, and reporting only the first of several problems both
  passed every test (w0.V2.Delta.1). A program test now shows that the program ends once it gives
  up on such a process, and stand-ins that answer wrongly and then ignore SIGTERM, or leave such a
  process behind, show that both problems are reported.
- Interrupted while it stopped the apps, the check printed "stopped the apps." even when a process
  might still be running (w0.V2.Delta.3). It now prints the stop problem instead:
  "Interrupted by SIGINT. The apps' output was still open 10 s after SIGKILL: ...".
- CI fails on any warning, but nothing looked at what the apps print as they start: with
  `NODE_ENV=staging`, `next start` printed "⚠ You are using a non-standard "NODE_ENV" value ..."
  twice, and the check passed. It now fails on any line that the build-log check reports in what
  the apps printed until both had answered, and both checks now also report the API's JSON log
  lines at level 40 (a warning) or above, which carry no marker (see "The start check fails on
  warnings and errors that the apps print while they start" in docs/DECISIONS.md).
- Widening the build-log check's exception for "No build cache found" to any line about a cache
  passed every test, although Next.js reports failures to write its caches that way; a test now
  holds it.
- `workspace.test.ts` asked for pnpm's store with every `npm_config_` and `pnpm_config_` variable
  removed, so with the store set by `PNPM_CONFIG_STORE_DIR` its offline installs used another
  store and failed with `ERR_PNPM_NO_OFFLINE_TARBALL` (w0.V2.Delta.2). It now asks with the test's
  own environment. A new test runs the install test in a Vitest of its own, with the store named
  only by that variable and an empty store in pnpm's global configuration; it fails with the old
  query, and on macOS too without `--config.store-dir`, which until now only the Ubuntu runner
  showed to be needed.

Against this Mac's real build (`CI=true pnpm build`), the build-log check found nothing;
`node scripts/check-start.ts` passed in 0.4 s, the API having logged only info lines (level 30)
before both apps answered; with `NODE_ENV=staging` it failed on Next.js's two warnings, where the
check on `main` passed; and interrupted with SIGINT after 0.2 s, it printed "Interrupted by SIGINT:
stopped the apps." and ended with status 130, with no app left. `ci.yml` itself did not change; it
has still not run on GitHub (see Owner actions).

How to verify, from the repository root:

```sh
pnpm exec vitest run --project scripts     # "Test Files  6 passed (6)", "Tests  124 passed (124)"
pnpm exec vitest run workspace.test.ts     # "Tests  5 passed (5)"
pnpm build
node scripts/check-start.ts                # "Both apps started: ..."
NODE_ENV=staging node scripts/check-start.ts; echo "status $?"
# "The apps printed 2 warning or error line(s) while they started, and CI fails on any:", the two
# "⚠ You are using a non-standard "NODE_ENV" value ..." lines, what the apps printed, "status 1"
```

**Integration fixes (wave w0, round 3)**

- The start check's test "fails at once when the command stops before both apps answer, keeping
  its output" gave the apps 2 seconds and expected the whole check to take less, and it failed
  once on a busy machine (2,923 ms; w0.V2.Bravo.4). The review of instruction 3 wrote a patch
  against this review's version of the test, applied after the merge (`fc5cb16`): the apps get 15
  seconds and the check must end within 7.5. Run again at the integration, a check that notices
  the exit only at its limit fails it with "expected 15.252 to be less than 7.5".
- Three full test runs of this round took 934 to 967 s instead of about 35 s, with tests and
  hooks failing on their time limits (5 to 60 seconds) after up to 900 s: one in this review, one
  in the review of instruction 8 and the integration's first. They were not slow. macOS's power log
  (`pmset -g log`) shows the Mac, its lid closed, asleep during each of them ("Maintenance Sleep",
  901 to 902 s, and 32 s more in one), and the time asleep accounts for each run's extra time. No
  time limit can absorb that, so no test changes for it; long runs need a Mac that stays awake. The
  comment in `workspace.test.ts` that put its clean-up's time-out down to swapping now says so.

## #6 - Architecture and decision docs

**What changed**

- `docs/ARCHITECTURE.md` (new): an overview diagram of every component in the playbook, grouped
  by network zone and labelled "built #N" or "planned #N" (built components also have thick
  borders, planned ones dashed); diagrams of the request flow, a Crew Chief chat, the upload and
  print path, and the deployment today and on the home server; tables of the components, network
  zones, trust boundaries and data stores; sections on observability, the code layout, open
  questions for later instructions, and how to keep the document current.
- `docs/DECISIONS.md`: the header now says what belongs in the log, explains each field of the
  entry template and sets the rules: append only, no numeric IDs, check union merges, never edit
  a merged decision, and mark a replaced entry with a `- Superseded by:` line. Every earlier entry
  is unchanged. New entries record the decisions behind instructions 6 and 8.
- `README.md`: the documentation list links the architecture document.

**How to verify**

Render every diagram. This needs network access; the first run downloads mermaid-cli, and
Puppeteer downloads a headless Chrome into `~/.cache/puppeteer`. From the repository root:

```sh
pnpm dlx --allow-build=puppeteer @mermaid-js/mermaid-cli@12.0.0 \
  -i docs/ARCHITECTURE.md -o /tmp/architecture.md
ls /tmp/architecture-*.svg
```

After pnpm's install output, the first command prints `Found 6 mermaid charts in Markdown input`,
a ✅ line for each diagram and one for `/tmp/architecture.md`, and exits with code 0; `ls` lists
`/tmp/architecture-1.svg` to `/tmp/architecture-6.svg`. Open one in a browser to look at it.
GitHub renders the diagrams too, once the repository is there.

Check that the decisions log kept every earlier entry (472e750 is the last commit on main before
the Phase 0 work started), in bash or zsh:

```sh
diff <(git show 472e750:docs/DECISIONS.md | grep '^### ') \
  <(grep '^### ' docs/DECISIONS.md | head -n 18) && echo "every earlier entry is still there"
```

It prints `every earlier entry is still there`: the first 18 headings are still the template's
`### <title>` and the titles of the 17 entries that 472e750 had, in the same order, so no entry was
removed, renamed or moved, and every newer entry comes after them. The rules let a merged entry's
facts be corrected, and some were: each correction says so in the entry, such as "(corrected in the
wave w0 review, ...)". `git diff 472e750 -- docs/DECISIONS.md` shows every change.

```sh
pnpm format:check   # "All matched files use Prettier code style!"
```

**Dependencies added**

None. mermaid-cli was run from a scratch directory outside the repository.

**Owner actions**

None. The "Open questions" section of the architecture document lists choices that later
instructions make; nothing needs deciding now.

**Notes & limitations**

- The status labels describe the repository once all of Phase 0 (instructions 1 to 8) is
  merged. Planned parts are the expected design, not commitments: the instructions that build
  them may refine them and must update the document in the same change.
- Nothing in CI renders the diagrams; the check above is manual. In sequence diagrams a bare `#`
  silently cuts a label while rendering still succeeds, so those diagrams write `#35;` instead.

**Review fixes (wave w0, round 1)**

Delta reviewed this instruction and changed:

- The render check: it used `npx --yes`, which installs the newest version of every package in
  the tool's tree and runs every install script. Run in the review, it installed 204 packages,
  five of them published less than a day before, which the repository's one-day release-age hold
  exists to keep out. `pnpm dlx` (above) applies that hold and runs only Puppeteer's install
  script; it rendered all six diagrams. The decisions log records the change.
- `docs/ARCHITECTURE.md`: no longer claims built route validation (#28 adds it), styled borders
  in sequence diagrams, an installable PWA (the web app's node now says "PWA planned #64"), logs
  with "no secrets", or that every log line is structured and carries a request ID (the web
  app's server output is plain text, and only lines logged during a request carry an ID);
  Cloudflare in the home-server diagram is labelled planned; the observability section adds the
  crash logging and the rules of instruction 8's review (see below). All six diagrams still
  render with the command above.
- `README.md`: the repository layout lists the architecture document.

**Integration fixes (wave w0, round 1)**

- `docs/ARCHITECTURE.md` said that after the build CI runs "a check that fails on any warning it
  printed". That check fails only on the warning and error lines it recognises; plain text that
  a page logs while Next.js prerenders it gets through (Charlie's hand-off from the review of
  instruction 5). The sentence now says the output is checked for warnings and for errors that
  did not stop the build, and points to the DECISIONS entry that lists what the check cannot see.

**Review fixes (wave w0, round 2)**

Charlie reviewed this instruction and changed:

- The check above that the decisions log kept its earlier entries. It used to print the removed
  lines and promise "never a line of an entry", but corrections of fact that the rules allow
  (from the review of instruction 1) had removed three lines inside old entries, so it printed
  them and suggested tampering. It now compares the entry titles, which corrections leave alone.
- `docs/ARCHITECTURE.md`: the list of responses that carry no `x-request-id` left out two that
  Node.js sends itself (instruction 8's notes below give the list). The document now also says
  that the API logs a 404, or a URL that its router rejects, without the raw URL, and that
  writing to `process.stdout` or `process.stderr` directly would skip the logger. Its
  deployment notes named only one of the two start flags that a Dockerfile must keep; they
  name `--no-strip-types` too. All six diagrams still render with the command above.

## #7 - Developer scripts

**What changed**

- Root `package.json` scripts, next to `dev`, `build`, `test` and the others:
  - `docker:up` (`docker compose up --detach --wait`: starts PostgreSQL and Redis and returns
    once both are healthy), `docker:down` (`docker compose --profile '*' down`: removes the
    containers of every profile, the app placeholders too, and keeps the data volumes) and
    `docker:logs` (follows the logs; `pnpm docker:logs postgres` for one service).
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
pnpm exec vitest run --project scripts  # "Tests  124 passed (124)"
```

Without Docker, `pnpm docker:up` prints "Docker is not installed, or the `docker` command is not
on your PATH." with an install link, and exits with status 1. With Docker installed but not
running (Docker Desktop quit), it prints "Docker is installed, but its engine is not running, or
this user cannot reach it." instead.

With Docker running and the root `.env` set up (instruction 3:
`cp .env.example .env && chmod 600 .env`, then set both passwords):

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

- This machine has no Docker, so the tests use a stand-in `docker` command, and CI validates the
  Compose file. The review then ran the scripts against a real engine in a Linux VM (see "Review
  fixes (wave w0, round 1)"); they have not yet run under Docker Desktop or OrbStack.
- `db:migrate` and `db:seed` fail on purpose until instruction 26 replaces them.
- The scripts need a POSIX shell, like the existing ones. The tests pass with `/bin/sh` as bash
  (macOS) and as dash (as on Ubuntu, checked with macOS's `/bin/dash`).
- The Docker check costs each `docker:*` command about 0.05 seconds: measured with a stand-in
  `docker` on the Mac, and with both `docker` commands against a running engine in the VM.

**Review fixes (wave w0, round 1)**

Charlie took this instruction over with instruction 5 (see there). One fix: `docker:down` ran a
plain `docker compose down`, which handles only the services outside a profile, so after
`docker compose --profile app up` it left both placeholders behind and removed their network, and
the next `docker compose --profile app up` failed with "network ... not found" (seen in a Linux
VM by the review of instruction 3). It now runs `docker compose --profile '*' down`; a test fails
if the profile is dropped or the shell expands the asterisk.

The scripts then ran against a real engine, in a throwaway Debian 13 VM (Lima 2.2.1, Docker
Engine 29.9.0, Compose 5.6.0, Node.js 24.21.0 and pnpm 12.11.2, all checksum-verified), as a
developer runs them:

- A user who could not reach the Docker socket got the "engine is not running, or this user
  cannot reach it" message, and so did everyone once the engine was stopped; with the Compose
  plugin moved away, or no `docker` on `PATH`, the scripts printed the message for that case.
  Each exited with status 1 without starting Compose.
- Without the root `.env`, `pnpm docker:up` stopped with Compose's message naming both passwords.
  With it, `pnpm docker:up` returned once both services were healthy: 15 s with the image pulls,
  0.6 s when they were already running.
- `pnpm docker:logs redis` showed only Redis's log and ended on Ctrl+C (SIGINT to the process
  group), with no Compose process left.
- After the placeholders had run, `pnpm docker:down` removed them, both services and the network
  and kept both volumes; `docker compose --profile app up api` then worked, and a Redis value
  written before `pnpm docker:down` was there after the next `pnpm docker:up`.
- In a checkout without `node_modules`, pnpm 12 installs the dependencies before it runs any
  script (its default `verifyDepsBeforeRun: install`), so the first `pnpm docker:up` there ran
  an install first.

**Integration fixes (wave w0, round 1)**

From Alpha's hand-offs from the review of instruction 3:

- On Linux, Docker Engine before 28 lets other machines on the same network reach ports
  published on 127.0.0.1, and nothing enforced the minimum that the docs give. The Docker check
  now reads the engine's version from the `docker version` call it already made and, on Linux
  only, stops the `docker:*` scripts when the major version is below 28 ("Docker Engine is older
  than version 28. ..."). macOS is not checked: Docker Desktop and OrbStack run the engine in a
  virtual machine. Tests in `scripts/check-docker.test.ts` cover old, new and unreadable versions
  on both systems and the command runner's capture of the output; five deliberate breakages each
  failed them. It has not run against a real old engine: the end-to-end check used a stand-in
  `docker` that reports 26.1.5, with Node.js told that it runs on Linux.
- The "How to verify" step above now creates the root `.env` with `chmod 600`, like instruction
  3's own steps since its review.

How to verify, from the repository root:

```sh
pnpm exec vitest run scripts/check-docker.test.ts   # "Tests  21 passed (21)"; 35 since round 3
```

**Review fixes (wave w0, round 2)**

Bravo took this instruction over with instruction 5 (see there). The scripts needed no change; the
test count in "How to verify" above was out of date. They ran again against a real engine, in the
Ubuntu 26.04 VM of instruction 5's review (Docker Engine 29.9.1, Compose 5.1.3, `/bin/sh` is
dash), as a developer runs them: `pnpm docker:up` returned once both services were healthy (20 s
with the image pulls); `pnpm docker:logs redis` ended on Ctrl+C with no Compose process left;
`pnpm docker:down` removed both containers and the network and kept both volumes; and with the
`docker` command moved away, then with the engine stopped, `pnpm docker:up` printed the message
for that case and exited with status 1.

**Integration fixes (wave w0, round 2)**

From Echo's hand-off from the round-2 review of instruction 3:

- Since that review, `docker-compose.yml` gives Redis its settings in a `configs` entry with
  inline `content`, which needs Compose 2.23.1 or later. An older Compose fails every command
  with a message about the file, not the version (2.23.0: "configs.redis-config Additional
  property content is not allowed", status 15). The Docker check now reads Compose's version from
  the `docker compose version` call it already made and, on every system, stops the `docker:*`
  scripts when it is earlier than 2.23.1 ("Docker Compose is older than version 2.23.1, ...").
  Output without a release number is let through, as for the engine. Tests:
  `scripts/check-docker.test.ts` (old, new and unreadable versions, on both systems) and
  `scripts/package-scripts.test.ts` (`pnpm docker:up` with a stand-in `docker` that reports
  2.23.0, then 2.23.1). Eight deliberate breakages (no check, a check on the major version only,
  on Linux only, as text, without the "v"-less form, with minimums 2.23.0 and 2.24.0, and
  unreadable output refused) each failed a test; a ninth, `<=` for `<` in the comparison, cannot
  change the result, because it runs only where the two numbers differ. With the real 2.23.0,
  2.23.1 and 5.1.3 release binaries behind a stand-in `docker` (SHA-256 digests checked against
  the releases' checksums), `node scripts/check-docker.ts` refused 2.23.0 with that message and
  passed the other two, and only 2.23.0 refused the compose file. No real Docker ran it: this
  machine has none.
- The README's prerequisites and its note on the `docker:*` scripts, and infra/README.md, name
  the Compose minimum.

How to verify, from the repository root:

```sh
pnpm exec vitest run scripts/check-docker.test.ts scripts/package-scripts.test.ts
# "Test Files  2 passed (2)" and "Tests  46 passed (46)"; 48 since round 3
```

**Review fixes (wave w0, round 3)**

Alpha took this instruction over with instruction 5 (see there for how it was reviewed). The
scripts needed no change. The Docker check gives each `docker` command 20 seconds, so that an
engine that hangs (Docker Desktop while it starts, for example) cannot hang the `docker:*`
scripts, but no test held that limit: removing it, or setting it to 0 or to an hour, passed every
test. Tests now show that the command runner stops a command that hangs and reports `ETIMEDOUT`
(which the check reports as Compose or the engine not working), and that the runner the scripts
use passes the 20-second limit to `spawnSync`. The test counts in "How to verify" above are
updated.

How to verify, from the repository root:

```sh
pnpm exec vitest run scripts/check-docker.test.ts   # "Tests  35 passed (35)"
```

## #8 - Structured logging with request IDs

**What changed**

- The API logs through Fastify's built-in pino logger, set up in `apps/api/src/lib/logger.ts`:
  one JSON object per line with an ISO 8601 time. `LOG_FORMAT=pretty` prints readable lines for a
  terminal instead, through pino-pretty (a development dependency).
- Request IDs (`apps/api/src/lib/request-id.ts`): a well-formed incoming `x-request-id` (8 to 64
  letters, digits, `-` or `_`) is reused and anything else is replaced by a new UUID. Responses
  send the ID back in `x-request-id`, including the 400 and 414 responses that Fastify's router
  sends for malformed URLs; the notes below list the few that go out before the ID can be added.
- Request context (`apps/api/src/lib/request-context.ts`): an AsyncLocalStorage context entered in
  the app's first `onRequest` hook, so every line logged while a request is handled carries its
  ID as `reqId`, including lines from code that is never handed the request.
- Redaction (`apps/api/src/lib/redact.ts` and the logger): the values of sensitive keys
  (passwords, secrets, API keys, tokens, cookies, authorization headers, session IDs and similar)
  become `[Redacted]` at any depth; URL credentials, query strings and fragments are hidden in
  every string; strings are cut to 8192 characters and request URLs to 256. Request lines hold
  only the method, the shortened URL and the client's address.
- `buildApp` (`apps/api/src/app.ts`) takes `logLevel` (default `silent`, so tests stay quiet),
  `logFormat` (default `json`) and `logDestination` (for tests) instead of Fastify's `logger`
  option. `apps/api/src/config.ts` reads `LOG_FORMAT` (`json` or `pretty`, default `json`). Since
  Phase 0 was merged, the entrypoint passes instruction 4's `LOG_LEVEL` as `logLevel`.
- `eslint.config.mjs`: `console` is an error in `apps/api/src` except `server.ts`, so API code
  cannot log around the logger with it. Writing to `process.stdout` or `process.stderr` directly
  would also skip the logger, and no rule catches that. (Corrected at the round-3 integration: the
  rule reports direct `console` calls only; `globalThis.console.log(...)` and a copy of `console`,
  such as `const { log } = console`, pass it. It catches mistakes, not intent.)
- Tests: unit tests for each module; `apps/api/src/logging.test.ts` for the whole app (every line
  of a request carries the same ID, including a service's line written without the request;
  concurrent requests; a body that arrives in pieces over a real connection; two requests on one
  keep-alive connection; the header sent back; malformed IDs replaced; router errors, 404s and
  500s; redaction of headers, bodies, query strings, cookies and a malformed request's raw bytes;
  the pretty format); and entrypoint tests that run the real server.

**How to verify**

```sh
pnpm install --frozen-lockfile
pnpm --filter @apex/api test   # all pass: "Tests  312 passed (312)" after round 3 of the review
pnpm lint                      # exits with code 0
pnpm typecheck                 # shared, api and web each report "Done"
```

Run the API in terminal 1 and watch its log:

```sh
pnpm --filter @apex/api dev
```

In terminal 2:

```sh
curl -si -H 'x-request-id: owner-check-0001' 'http://127.0.0.1:4000/health?token=secret-value'
curl -si -H 'x-request-id: bad id' http://127.0.0.1:4000/health
curl -si http://127.0.0.1:4000/%zz
```

- The first `curl` shows `x-request-id: owner-check-0001`. In terminal 1, the `incoming request`
  and `request completed` lines both have `"reqId":"owner-check-0001"`, the URL is logged as
  `"/health?[Redacted]"`, and `secret-value` appears nowhere in the log.
- The second shows a new UUID in `x-request-id`; the malformed ID is neither used nor logged.
- The third returns `400 Bad Request` with an `x-request-id` header, and terminal 1 shows an
  `incoming request` line and a `malformed URL` line with that ID.

Press Ctrl+C in terminal 1 (the API logs `"msg":"shutting down"`), then start it with readable
logs and repeat a `curl`:

```sh
LOG_FORMAT=pretty pnpm --filter @apex/api dev
```

Each entry is now a line such as `[00:30:13.189] INFO: incoming request {"reqId":"...", ...}`,
with an error's details on the lines below it. An invalid format stops the API at startup:

```sh
LOG_FORMAT=fancy node apps/api/src/server.ts; echo "exit code $?"
```

It prints an error that names `LOG_FORMAT` and the allowed values (`json`, `pretty`), then
`exit code 1`.

**Dependencies added**

`pino-pretty`, a development dependency of `apps/api`, for `LOG_FORMAT=pretty`. Why, and the
alternatives, are in `docs/DEPENDENCIES.md`. pino itself is Fastify's own dependency.

**Owner actions**

None.

**Notes & limitations**

- Pretty output is opt-in: set `LOG_FORMAT=pretty` in the shell or in `apps/api/.env`. It needs
  the development dependencies, so an install without them can only log JSON; asked for `pretty`
  there, the API refuses to start and says to use `json`.
- `LOG_LEVEL` (instruction 4's environment loader) sets the level; the default is `info`.
- Clients choose their request IDs when well formed, so an ID is a label for finding log lines,
  never something to trust.
- Responses sent before any hook runs carry no `x-request-id`. Fastify writes a 400, 431 or 408
  straight to the connection when Node.js cannot read a request (bytes that are not valid HTTP,
  headers over Node.js's 16 KB limit, headers that arrive too slowly) and logs it at trace level
  without an ID, and sends a 503 for a request arriving on an open connection during shutdown
  (its log line has the ID). Node.js itself answers an HTTP/1.1 request without a `Host` header
  (400) and an `Expect` header other than `100-continue` (417) without calling Fastify, so
  nothing is logged, and closes the connection of a `CONNECT` request without answering.
- Redaction works on key names and URL parts. A secret written into a message's text cannot be
  recognised, so never put one there.
- Request lines record the client's IP address, which is personal data under UK GDPR; the privacy
  policy (#114) must cover logs.
- Redaction parses and re-serialises each line: about 3.3 µs per line instead of 0.5 µs, measured
  on this Mac, which is negligible next to real routes.
- Fastify logs client errors (4xx) at info level with a stack trace, except a 404 and a URL that
  its router rejects, which the API logs without the URL. Instruction 27's global error handler
  should decide how errors are logged.
- Only the API is covered: Next.js's own server output is not structured, and the web app does
  not yet pass request IDs on to the API (with the typed API client, #29).

**Review fixes (wave w0, round 1)**

Delta reviewed this instruction and changed:

- Crashes: Node.js printed an uncaught exception or unhandled promise rejection as plain text,
  unredacted (a connection URL's password in full) and without the request ID. The entrypoint
  now logs it at fatal level through the logger, as one redacted JSON line that carries the ID
  of the request whose code failed, then exits with code 1 as before. Two entrypoint tests check
  this with a route that leaves a timer behind, which throws or leaves a promise rejection
  unhandled after the response has gone.
- `LOG_FORMAT=pretty` without pino-pretty (a production install) crashed with an uncaught
  exception and two stack traces around the message. The API now prints only the message, which
  says to use `LOG_FORMAT=json`, and exits with code 1.
- Redaction also hides `cf-access-jwt-assertion` (the JWT Cloudflare Access adds to admin
  requests, #190), `x-hub-signature-256` (Meta's webhooks, #150; `stripe-signature` already was),
  Node.js's `rawHeaders` list, `pass`, `pwd`, `code_verifier` (#43) and `_csrf`.
- The docs named two responses without `x-request-id`, one of them "the bare 400 that Node.js
  sends". Fastify writes that 400 itself, and also a 431 for headers over 16 KB (a very long URL
  is enough) and a 408 for headers that arrive too slowly. The notes above, `docs/ARCHITECTURE.md`
  and the request ID decision now list them (round 2 found two more, which Node.js sends itself:
  see the notes above).
- Written down, in the code and in `docs/ARCHITECTURE.md` ("Observability"), for the
  instructions that will need it:
  - a timer, socket or connection created while a request is handled keeps that request's
    context, so its later lines carry the request's ID (for example the error handler of a
    database connection that a pool opened for a request): create long-lived clients at startup;
  - the router's 400 and 414 responses never reach `setErrorHandler`, because Fastify answers
    them from a context created with the app, so #27 must apply its error format in
    `sendFrameworkError` too;
  - a route that writes to `reply.raw` itself (a Server-Sent Events stream, #72) must include
    `reply.getHeaders()`, or its response has no `x-request-id`;
  - URL paths are logged as they are, so tokens in links (#39, #41) belong in the query string,
    and raw bodies logged as strings (a webhook body, #91) are free text that redaction cannot
    see into;
  - only Fastify requests may be logged under the key `req`: anything without a `url` makes the
    log call throw (no longer needed since round 3: any value can be logged under `req` or
    `res`);
  - integers beyond 2^53 (BigInt values) come out of the redaction pass rounded: log them as
    strings.

To check the fixes (the second command runs only the four new entrypoint tests):

```sh
pnpm --filter @apex/api exec vitest run src/lib/redact.test.ts src/logging.test.ts
pnpm --filter @apex/api exec vitest run src/server.test.ts -t "pino-pretty|redacted JSON line"
```

The first ends with `Tests  193 passed (193)`, the second with `Tests  4 passed | 23 skipped (27)`
(rounds 2 and 3 added tests to both files).

**Review fixes (wave w0, round 2)**

Charlie reviewed this instruction and changed:

- Redaction hid the credentials of only the first URL in a run of text without spaces, so a list
  such as `redis://:pw1@a:6379,redis://:pw2@b:6379` logged the second password in full. Each URL
  in such a run now gets its own check, still in linear time: a test with a million URLs in one
  run fails if the scan goes back over the text for each of them.
- `LOG_FORMAT=pretty` turned every failure to load pino-pretty into the advice that production
  installs leave it out, and dropped the cause: a broken install (one of pino-pretty's own
  dependencies missing, or an invalid package.json) printed only that line. Now only a pino-pretty
  that Node.js cannot find gets the one-line advice; any other failure is printed as it is, with
  its stack, and the API exits with code 1.
- A URL that the router rejects (400 malformed URL, 414 route parameter too long) was logged with
  its raw path three times, in the message, `err.message` and `err.stack`: 24,940 bytes for a
  16 KB URL, which got around the 256-character cap on logged URLs. That line now says
  "malformed URL" or "route parameter too long" and holds the error's code, under the request ID.
- The notes above, `docs/ARCHITECTURE.md` and the request ID decision said that every response
  carries the ID, or that Fastify sends all those that do not. Node.js itself answers an HTTP/1.1
  request without a `Host` header (400) and an `Expect` header other than `100-continue` (417),
  without calling Fastify or logging anything. Both are listed now, and new tests send the bytes
  of each listed response except the slow 408 and the shutdown 503, and check the header and the
  log.
- Missing tests. Moving the request context hook out of `onRequest` broke no test, although 400
  (invalid JSON) and 415 (unsupported content type) responses then lost `x-request-id`, as
  validation errors from #28 would; two cases cover them now. The rule that makes `console` an
  ESLint error in API code had no test; `api-console.test.ts` fails if it is deleted, narrowed,
  made a warning or loses the entrypoint's exemption. The notes said the rule sends every line
  through the logger, but writing to `process.stdout` or `process.stderr` directly would skip it;
  they say so now.

To check the fixes:

```sh
pnpm --filter @apex/api exec vitest run src/lib/redact.test.ts src/logging.test.ts
pnpm --filter @apex/api exec vitest run src/server.test.ts -t "LOG_FORMAT=pretty"
pnpm exec vitest run api-console.test.ts
```

They end with `Tests  193 passed (193)`, `Tests  4 passed | 23 skipped (27)` and
`Tests  4 passed (4)` (round 3 added tests to the first two files). To see the pino-pretty
messages for yourself, from `apps/api`:

```sh
mv node_modules/pino-pretty /tmp/pino-pretty-link   # as a production install leaves it out
LOG_FORMAT=pretty node src/server.ts; echo "exit code $?"
mv /tmp/pino-pretty-link node_modules/pino-pretty   # put it back
```

The second command prints only "LOG_FORMAT=pretty needs pino-pretty, a development dependency
that production installs leave out. Use LOG_FORMAT=json." and `exit code 1`.

**Review fixes (wave w0, round 3)**

Bravo reviewed this instruction and changed:

- Query strings in request lines (open item w0.V2.Echo.1). The redaction ended a URL at an
  apostrophe, a backtick, a double quote or an angle bracket, and needed a `/` before the `?`.
  Node.js accepts all of those in a request target, so `GET /reset?name=d'arcy&token=...` was
  logged as `/reset?[Redacted]'arcy&token=...` (the same with `` ` ``, `"`, `<` and `>`), and
  `OPTIONS *?token=...` in full. A request URL is now redacted as one URL: its credentials and
  everything after its first `?` or `#` are hidden, whatever they hold. In other strings a URL
  now ends only at whitespace, so a password with an apostrophe
  (`postgres://apex:it's-a-secret@db/apex`) and the raw URL that Fastify quotes when a reply is
  sent twice are hidden too; text glued to a URL without a space is hidden with it.
- Query strings after an `@`. User information ran to the last `@` before the next `/`, so in a
  URL without a path, the `@` of an email address in the query string ended it and took the `?`
  with it: `https://example.com?invite=a@b.com&token=abc` was logged as
  `https://[Redacted]@b.com&token=abc`, in messages and in request lines
  (`GET http://x?email=a@b&token=...`). In that case everything after the `://` is now hidden. A
  `?` or `#` with no `/` before it also ended the search for a later one in the same run of text
  (`why?"/reset?token=abc"`), which the change above to whitespace-only runs made more likely.
  Seeded property tests now check 20,000 random runs of text against these rules.
- A value logged under the key `req` that is not a Fastify request (null, an object without a
  `url`, an outgoing `http.ClientRequest`) made the log call throw a TypeError, which fails a
  request or, from a timer, stops the API. The request serializer now logs only the string fields
  it finds. Fastify's own serializer for the key `res` threw the same way for null:
  `app.log.warn({ res: null }, ...)` in a handler turned its response into a 500. The API now has
  its own, which logs a `statusCode` that is a number and nothing else.
- `LOG_FORMAT=pretty` wrote through `process.stdout`, which on macOS only queues what a full pipe
  cannot take. After a crash, `process.exit()` dropped that queue: with the reader 2 s behind, 325
  of 3,000 lines arrived and the crash line did not. When the reader went away (`| head`), the API
  stopped. Pretty lines are now written synchronously, waiting while the pipe is full and dropped
  once its reader has gone, as pino does for JSON.
- Comments (open item w0.V2.Echo.2): `logger.ts` said that a request ID goes back with every
  response, with `enterRequestContext` covering the rest, and that no unbounded client input
  reaches the log. It now says which responses carry the ID, and that string values are redacted
  and cut, but not object keys or the number of keys and items; `docs/ARCHITECTURE.md`
  ("Observability") says the same. A test read an error body through a type-only cast; it now
  parses it with Zod.
- `api-console.test.ts` timed out in a full `pnpm test` while the machine was busy (5,033 ms
  against Vitest's 5 s default): its first test loads the whole ESLint config. It now allows 30 s.

To check the fixes:

```sh
pnpm --filter @apex/api exec vitest run src/lib/redact.test.ts src/lib/logger.test.ts src/logging.test.ts
pnpm --filter @apex/api exec vitest run src/server.test.ts -t "reader"
```

They end with `Tests  214 passed (214)` and `Tests  4 passed | 23 skipped (27)`. With the API
running as above (`pnpm --filter @apex/api dev`), in terminal 2:

```sh
curl -s -o /dev/null "http://127.0.0.1:4000/reset?name=d'arcy&token=secret-value"
curl -s -o /dev/null -X OPTIONS --request-target '*?token=secret-value' http://127.0.0.1:4000/
curl -s -o /dev/null --request-target 'http://x?email=a@b&token=secret-value' http://127.0.0.1:4000/
```

Terminal 1 logs the three URLs as `"/reset?[Redacted]"`, `"*?[Redacted]"` and
`"http://[Redacted]"`, and `secret-value` appears nowhere.
