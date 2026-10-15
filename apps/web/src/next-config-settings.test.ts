// @vitest-environment node
// next.config.ts runs in Node.js, not in a browser.

import { readFile } from "node:fs/promises";

import { PHASE_PRODUCTION_BUILD } from "next/constants";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import config from "../next.config";

// The environment check that next.config.ts runs has tests of its own (env/next-config.test.ts).
// A stand-in keeps these tests independent of the variables in the shell that runs them.
vi.mock("./env/validate", () => ({ validateWebEnv: vi.fn() }));

const settings = config(PHASE_PRODUCTION_BUILD);

const webPackage = z.object({ scripts: z.object({ typecheck: z.string() }) });

describe("the settings in next.config.ts", () => {
  // `next build` type-checks the files that its tsconfig includes, with `tsc --project`. With
  // tsconfig.json that includes the route types of `next dev`, which go stale when a route is
  // deleted after the dev server stops (tsconfig.typecheck.json says more), and the build fails.
  it("make next build type-check the files that pnpm typecheck checks", async () => {
    const { scripts } = webPackage.parse(
      JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")),
    );
    const project = /--project (\S+)/.exec(scripts.typecheck)?.[1];

    expect(project).toBe("tsconfig.typecheck.json");
    expect(settings.typescript?.tsconfigPath).toBe(project);
  });

  it("turn off the X-Powered-By header, which would name the framework to every client", () => {
    expect(settings.poweredByHeader).toBe(false);
  });

  it("stop next dev from writing an AGENTS.md into the app when an AI agent runs it", () => {
    expect(settings.agentRules).toBe(false);
  });
});
