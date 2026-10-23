import { execFile, spawn } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify, stripVTControlCharacters } from "node:util";

import { describe, expect, it, onTestFinished } from "vitest";
import { z } from "zod";

// package.json "engines" names the Node.js versions the repository needs, and `engineStrict` in
// pnpm-workspace.yaml makes pnpm enforce it when it installs, for this workspace and for every
// dependency's own "engines". These tests run pnpm on a copy of the workspace's manifests and
// lockfile, so they change nothing in this checkout.

const repoRoot = fileURLToPath(new URL(".", import.meta.url));

const manifestSchema = z.looseObject({ engines: z.looseObject({ node: z.string() }) });

const manifest = manifestSchema.parse(
  JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8")),
);

/** The environment for pnpm, without the settings that an outer pnpm exports to its scripts. */
function pnpmEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (!/^(npm|pnpm)_config_/i.test(name)) {
      env[name] = value;
    }
  }
  return env;
}

/**
 * The pnpm store that this checkout's own install filled. pnpm keeps one store per file system,
 * and the temporary copies can be on another one: /tmp is a tmpfs on Ubuntu 26.04, the release of
 * the CI runner. There a copy would get the empty /tmp/.pnpm-store, and its offline install would
 * fail with ERR_PNPM_NO_OFFLINE_TARBALL. pnpm is asked with this process's whole environment, as
 * `pnpm install` was, because the store can be set there (PNPM_CONFIG_STORE_DIR); an outer pnpm
 * exports none of the settings that move it.
 */
const storeDir = z
  .string()
  .trim()
  .refine((path) => isAbsolute(path), "`pnpm store path` should print an absolute path")
  .parse((await promisify(execFile)("pnpm", ["store", "path"], { cwd: repoRoot })).stdout);

/**
 * Copies the workspace's pnpm-workspace.yaml, lockfile and every package.json into a temporary
 * folder, with the root package.json's engines.node set to `nodeRange` if one is given.
 */
async function copyWorkspace(nodeRange = manifest.engines.node): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "apex-workspace-")));
  // Removing an installed copy can take longer than Vitest's 10-second limit for hooks on a busy
  // machine (seen while the whole suite ran with the Mac swapping), so it gets the tests' minute.
  onTestFinished(() => rm(dir, { recursive: true, force: true }), 60_000);
  for (const file of ["pnpm-workspace.yaml", "pnpm-lock.yaml"]) {
    await copyFile(join(repoRoot, file), join(dir, file));
  }
  const changed = { ...manifest, engines: { ...manifest.engines, node: nodeRange } };
  await writeFile(join(dir, "package.json"), `${JSON.stringify(changed, null, 2)}\n`);
  for (const folder of ["apps", "packages"]) {
    for (const entry of await readdir(join(repoRoot, folder), { withFileTypes: true })) {
      if (entry.isDirectory()) {
        await mkdir(join(dir, folder, entry.name), { recursive: true });
        await copyFile(
          join(repoRoot, folder, entry.name, "package.json"),
          join(dir, folder, entry.name, "package.json"),
        );
      }
    }
  }
  return dir;
}

/** A line of pnpm's ndjson log. Errors carry a code and a message. */
const logLineSchema = z.looseObject({
  code: z.string().optional(),
  message: z.string().optional(),
});

/** The lines of pnpm's ndjson log that are JSON objects. */
function logLines(output: string): z.infer<typeof logLineSchema>[] {
  return output.split("\n").flatMap((line) => {
    try {
      const parsed = logLineSchema.safeParse(JSON.parse(line));
      return parsed.success ? [parsed.data] : [];
    } catch {
      return [];
    }
  });
}

/** Runs a command; resolves with its exit status and everything it printed, stdout and stderr. */
function run(
  command: string,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const collect = (chunk: string): void => {
      output += chunk;
    };
    child.stdout.setEncoding("utf8").on("data", collect);
    child.stderr.setEncoding("utf8").on("data", collect);
    child.once("error", reject);
    child.once("close", (code) => {
      resolve({ code, output });
    });
  });
}

/**
 * Runs `pnpm install` on the lockfile without the network, install scripts or any write to pnpm's
 * store (which would record the temporary folder there) or to its cache, with pnpm's log as JSON
 * lines (its usual output wraps long messages) and any `extraArgs`. It uses the checkout's store
 * (see storeDir) and pnpmEnv's environment.
 */
function install(
  cwd: string,
  extraArgs: readonly string[] = [],
): Promise<{ code: number | null; output: string }> {
  const args = [
    "install",
    "--frozen-lockfile",
    "--offline",
    "--frozen-store",
    "--ignore-scripts",
    "--reporter=ndjson",
    // Before it installs, pnpm checks every locked version against the one-day release-age hold,
    // which needs each package's registry metadata. Offline, a lockfile that this machine has not
    // checked yet then fails with ERR_PNPM_NO_OFFLINE_META whenever some metadata is not cached.
    // These tests are about engines; real installs keep the hold. A cache folder of the copy's
    // own keeps pnpm's records of the temporary folder out of the machine's cache.
    "--config.minimum-release-age=0",
    `--config.cache-dir=${join(cwd, ".pnpm-cache")}`,
    `--config.store-dir=${storeDir}`,
    ...extraArgs,
  ];
  return run("pnpm", args, { cwd, env: pnpmEnv() });
}

/** The oldest version that a range such as ">=24.15" allows, such as "24.15.0". */
function oldestAllowed(range: string): string {
  if (!/^>=\d+\.\d+$/.test(range)) {
    throw new Error(`engines.node should have the form ">=<major>.<minor>", not "${range}"`);
  }
  return `${range.slice(2)}.0`;
}

describe("the pnpm workspace", { timeout: 60_000 }, () => {
  it("refuses to install on a Node.js version that package.json's engines leaves out", async () => {
    const result = await install(await copyWorkspace(">=99"));

    expect(result.code, result.output).not.toBe(0);
    const error = logLines(result.output).find(
      (line) => line.code === "ERR_PNPM_UNSUPPORTED_ENGINE",
    );
    expect(error?.message, result.output).toContain('wanted: {"node":">=99"}');
  });

  // engineStrict also applies every dependency's own "engines", so a dependency that needs a newer
  // Node.js than package.json says (jsdom 30 needs 24.15) would make the install fail there.
  // pnpm's node-version setting checks the lockfile as that Node.js version would.
  it("installs on the oldest Node.js version that package.json's engines allows", async () => {
    const oldest = oldestAllowed(manifest.engines.node);

    const result = await install(await copyWorkspace(), [`--config.node-version=${oldest}`]);

    expect(result.code, result.output).toBe(0);
  });

  // A developer can set pnpm's store in the environment (PNPM_CONFIG_STORE_DIR), which pnpmEnv
  // leaves out. This runs the test above in a Vitest of its own, with the checkout's store named
  // only there, and an empty store in pnpm's global configuration ($XDG_CONFIG_HOME/pnpm), which
  // pnpm uses otherwise.
  it("installs from the store that PNPM_CONFIG_STORE_DIR names", async () => {
    const configHome = await mkdtemp(join(tmpdir(), "apex-pnpm-config-"));
    onTestFinished(() => rm(configHome, { recursive: true, force: true }));
    await mkdir(join(configHome, "pnpm"));
    const emptyStore = join(configHome, "empty-store");
    await writeFile(
      join(configHome, "pnpm", "config.yaml"),
      `storeDir: ${JSON.stringify(emptyStore)}\n`,
    );
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([name]) => !/^(npm|pnpm)_config_store_dir$/i.test(name)),
    );
    const vitest = join(repoRoot, "node_modules", ".bin", "vitest");
    const args = [
      "run",
      "workspace.test.ts",
      "--project",
      "tooling",
      "-t",
      "installs on the oldest",
    ];

    const result = await run(vitest, args, {
      cwd: repoRoot,
      env: { ...env, XDG_CONFIG_HOME: configHome, PNPM_CONFIG_STORE_DIR: storeDir },
    });

    expect(result.code, result.output).toBe(0);
    expect(stripVTControlCharacters(result.output)).toMatch(/Tests\s+1 passed/u);
  });

  // nvm and CI's setup-node read .nvmrc; fnm, nodenv, mise and others read .node-version. Both
  // name a major version, whose newest release they install.
  it.for([".nvmrc", ".node-version"])(
    "names in %s the major version that package.json's engines asks for",
    async (file) => {
      const major = oldestAllowed(manifest.engines.node).split(".")[0];

      expect((await readFile(join(repoRoot, file), "utf8")).trim()).toBe(major);
    },
  );
});
