import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";
import { z } from "zod";

// Static checks of docker-compose.yml and the root .env.example (instruction 3). They read the
// files, so they need no Docker. They guard what must not regress: a plain `docker compose up`
// starts only the infrastructure, nothing is published beyond 127.0.0.1, no password has a
// default or goes on a command line, and .env.example documents exactly the variables the
// compose file reads.

const repoRoot = join(import.meta.dirname, "..");
const composeText = readFileSync(join(repoRoot, "docker-compose.yml"), "utf8");
const envExampleText = readFileSync(join(repoRoot, ".env.example"), "utf8");

// The exact shape of the file: every service, setting and nested key these checks cover, and
// nothing else. Any other setting could change what runs while every check still passes: env_file
// (an environment the checks never see, such as POSTGRES_HOST_AUTH_METHOD=trust), extends or a
// top-level include (settings from another file), a YAML merge key "<<" (which this parser keeps as
// a plain key, while Compose merges it), entrypoint (the images' entrypoints drop root privileges,
// and ["true"] would make a placeholder exit with status 0), network_mode: host (no port
// publishing, so every listening port is open), build (no Dockerfile exists yet), a health check's
// disable, or volume options that put the data elsewhere. Add a setting here only together with a
// test for its value. Ports use the short "IP:host:container" form, volumes "source:target",
// environments the map form and a service's configs the long form.
const healthcheckSchema = z.strictObject({
  test: z.array(z.string()),
  interval: z.string(),
  timeout: z.string(),
  retries: z.number().int().positive(),
  start_period: z.string(),
  start_interval: z.string(),
});
const loggingSchema = z.strictObject({ driver: z.string() });
const placeholderSchema = z.strictObject({
  profiles: z.array(z.string()),
  image: z.string(),
  command: z.array(z.string()),
  depends_on: z.record(z.string(), z.strictObject({ condition: z.string() })),
  restart: z.string(),
});
const composeSchema = z.strictObject({
  name: z.string(),
  services: z.strictObject({
    postgres: z.strictObject({
      image: z.string(),
      restart: z.string(),
      environment: z.record(z.string(), z.string()),
      ports: z.array(z.string()),
      volumes: z.array(z.string()),
      shm_size: z.string(),
      healthcheck: healthcheckSchema,
      logging: loggingSchema,
    }),
    redis: z.strictObject({
      image: z.string(),
      restart: z.string(),
      command: z.array(z.string()),
      configs: z.array(z.strictObject({ source: z.string(), target: z.string() })),
      environment: z.record(z.string(), z.string()),
      ports: z.array(z.string()),
      volumes: z.array(z.string()),
      healthcheck: healthcheckSchema,
      logging: loggingSchema,
    }),
    api: placeholderSchema,
    web: placeholderSchema,
  }),
  volumes: z.strictObject({ "postgres-data": z.null(), "redis-data": z.null() }),
  configs: z.strictObject({ "redis-config": z.strictObject({ content: z.string() }) }),
});

/**
 * The compose file as plain data. A YAML warning, such as a tag this parser does not know (Compose
 * has tags of its own, like !reset), would mean that Compose may read the file differently.
 */
function parseYaml(text: string): unknown {
  const document = parseDocument(text);
  const [problem] = [...document.errors, ...document.warnings];
  if (problem !== undefined) {
    throw new Error(`docker-compose.yml: ${problem.message}`);
  }
  return document.toJS();
}

const rawCompose = parseYaml(composeText);
const parsedCompose = composeSchema.safeParse(rawCompose);
if (!parsedCompose.success) {
  throw new Error(
    "docker-compose.yml does not have the shape that infra/compose.test.ts checks; see the " +
      `comment above its schema.\n${z.prettifyError(parsedCompose.error)}`,
  );
}
const compose = parsedCompose.data;
const { postgres, redis, api, web } = compose.services;

/** True if a port mapping is published on 127.0.0.1 only (not on every interface). */
function isLoopbackOnly(port: string): boolean {
  return port.startsWith("127.0.0.1:");
}

interface Interpolation {
  readonly name: string;
  /** The operator after the name, such as ":-" (default) or ":?" (required), if any. */
  readonly operator: string | undefined;
}

/**
 * The variables a Compose value interpolates: ${NAME}, ${NAME:-default}, ${NAME:?error} and
 * $NAME, including ones nested in a default such as ${A:-${B}}. "$$" is an escaped "$".
 */
function interpolations(value: string): Interpolation[] {
  const pattern = /\$(?:\$|\{([A-Za-z_]\w*)(:?[-?+])?|([A-Za-z_]\w*))/g;
  return [...value.matchAll(pattern)].flatMap(([, braced, operator, bare]) => {
    const name = braced ?? bare;
    return name === undefined ? [] : [{ name, operator }];
  });
}

/** Each ${NAME:-default} whose default is plain text, as [NAME, default]. Skips "$$" escapes. */
function plainDefaults(value: string): [string, string][] {
  const unescaped = value.replaceAll("$$", "");
  return [...unescaped.matchAll(/\$\{([A-Za-z_]\w*):-([^${}]*)\}/g)].map(
    ([, name = "", fallback = ""]) => [name, fallback],
  );
}

/** Every string value in a parsed YAML document (comments are not part of it). */
function stringsIn(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(stringsIn);
  }
  if (typeof value === "object" && value !== null) {
    return Object.values(value).flatMap(stringsIn);
  }
  return [];
}

/** NAME=value lines in an env file, including commented-out ones such as "# NAME=value". */
function envEntries(text: string): Map<string, { value: string; commented: boolean }> {
  const entries = new Map<string, { value: string; commented: boolean }>();
  for (const line of text.split("\n")) {
    const match = /^(#\s*)?([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (match?.[2] !== undefined && match[3] !== undefined) {
      entries.set(match[2], { value: match[3], commented: match[1] !== undefined });
    }
  }
  return entries;
}

/**
 * True for the file names Docker Compose reads without being told: compose.yaml, compose.yml,
 * docker-compose.yaml and docker-compose.yml, and each of them with ".override" before the
 * extension, which Compose merges on top. It prefers compose.yaml to docker-compose.yml. Compose
 * looks each name up in the file system, so on a case-insensitive one, as macOS and Windows use,
 * it also reads "Compose.YAML", and on macOS even a name with a long s (U+017F) for the s or a
 * Kelvin sign (U+212A) for the k: with "u", "i" folds letters the same way.
 */
function isComposeDefaultFile(path: string): boolean {
  return /(?:^|\/)(?:docker-)?compose(?:\.override)?\.ya?ml$/iu.test(path);
}

/** Every path in git's index: the files that are committed or staged. */
function trackedFiles(): string[] {
  const result = spawnSync("git", ["ls-files", "-z"], { cwd: repoRoot, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ls-files failed: ${result.error?.message ?? result.stderr}`);
  }
  return result.stdout.split("\0").filter((path) => path !== "");
}

const composeStrings = stringsIn(rawCompose);
const composeInterpolations = composeStrings.flatMap(interpolations);
const requiredForm = (name: string) => new RegExp(`^\\$\\{${name}:\\?[^}]+\\}$`);
const isSecretName = (name: string) => /PASS|SECRET|TOKEN|KEY|CREDENTIAL/.test(name);

describe("docker-compose.yml", () => {
  it("starts only postgres and redis without a profile; the app placeholders need 'app'", () => {
    // postgres and redis have no `profiles` setting (the schema above allows none), so a plain
    // `docker compose up` starts them.
    expect(api.profiles).toEqual(["app"]);
    expect(web.profiles).toEqual(["app"]);
  });

  it("publishes ports on 127.0.0.1 only", () => {
    const ports = [...postgres.ports, ...redis.ports];
    expect(ports.length).toBeGreaterThan(0);
    for (const port of ports) {
      expect(isLoopbackOnly(port), port).toBe(true);
    }
  });

  it("requires both passwords from .env and never defaults a secret", () => {
    expect(postgres.environment["POSTGRES_PASSWORD"]).toMatch(requiredForm("POSTGRES_PASSWORD"));
    expect(redis.environment["REDISCLI_AUTH"]).toMatch(requiredForm("REDIS_PASSWORD"));

    const secrets = composeInterpolations.filter(({ name }) => isSecretName(name));
    // REDIS_PASSWORD twice: in Redis's config file and in its environment.
    expect(secrets.map(({ name }) => name).sort()).toEqual([
      "POSTGRES_PASSWORD",
      "REDIS_PASSWORD",
      "REDIS_PASSWORD",
    ]);
    for (const { name, operator } of secrets) {
      expect(operator, `${name} must use the required form \${${name}:?message}`).toBe(":?");
    }
  });

  it("gives Redis exactly two settings: the required password and the append-only file", () => {
    // Any other line could weaken it while the rest of these checks pass: `user default on nopass`
    // opens Redis without a password, `dir /tmp` moves its data out of the volume,
    // `appendfsync no` or `appendonly no` gives up the append-only file's guarantee, and an
    // evicting maxmemory-policy breaks the job queues (docs/DECISIONS.md). Without appendonly,
    // Redis keeps only its default snapshots, and a crash can lose up to an hour of writes.
    expect(compose.configs["redis-config"].content).toBe(
      "requirepass ${REDIS_PASSWORD:?set it in .env (see .env.example)}\nappendonly yes\n",
    );
  });

  it("starts redis-server with only its config file, which Compose writes", () => {
    expect(redis.configs).toEqual([
      { source: "redis-config", target: "/usr/local/etc/redis/redis.conf" },
    ]);
    // redis-server first, because the image drops root privileges only when it starts
    // redis-server; nothing after the file, because Redis applies later arguments on top of it
    // (`--requirepass ""`, for example).
    expect(redis.command).toEqual(["redis-server", "/usr/local/etc/redis/redis.conf"]);
  });

  it("keeps every secret off command lines", () => {
    // On a Linux host every user can read any process's command line, and an image's entrypoint
    // runs with the container's full command line each time the container starts (Redis hides its
    // own arguments only later). Secrets go in through the environment or a config file instead.
    for (const [service, definition] of Object.entries(compose.services)) {
      const words = [
        ...("command" in definition ? definition.command : []),
        ...("healthcheck" in definition ? definition.healthcheck.test : []),
      ];
      const secrets = words.flatMap(interpolations).filter(({ name }) => isSecretName(name));
      expect(secrets, service).toEqual([]);
    }
  });

  it("runs PostgreSQL from the pgvector image, with exact releases of both", () => {
    // Instruction 77 needs pgvector, which the official postgres image does not include. The tag
    // names the pgvector release, the PostgreSQL major version and the Debian release.
    expect(postgres.image).toMatch(
      /^pgvector\/pgvector:\d+\.\d+\.\d+-pg\d+-[a-z]+@sha256:[0-9a-f]{64}$/,
    );
    // Docker's default 64 MB /dev/shm is too small for parallel pgvector index builds.
    expect(postgres.shm_size).toBe("256mb");
  });

  it("pins Redis to an exact release", () => {
    expect(redis.image).toMatch(/^redis:\d+\.\d+\.\d+-[\w.]+@sha256:[0-9a-f]{64}$/);
  });

  it("health-checks postgres over TCP and Redis with the password from its own config file", () => {
    // TCP, because a Unix-socket check would pass against the temporary server that runs during
    // first-time initialisation. CMD-SHELL, because a shell must expand the container's
    // POSTGRES_USER and POSTGRES_DB ("$$" is Compose's escape for "$"): in exec form (CMD) the
    // check gets the literal text, and with any other names, such as the default "root",
    // PostgreSQL logs a FATAL line for every check while the service still counts as healthy.
    expect(postgres.healthcheck.test).toEqual([
      "CMD-SHELL",
      'pg_isready --host=127.0.0.1 --username="$${POSTGRES_USER}" --dbname="$${POSTGRES_DB}"',
    ]);
    // The password comes from the file redis-server read, so the check always uses the one Redis
    // has, also after `docker compose start` has written a new one into the file while the
    // container's REDISCLI_AUTH still holds the old one. It goes through REDISCLI_AUTH, not a
    // command line. Without -e, redis-cli exits 0 even on WRONGPASS (wrong password) or LOADING
    // replies.
    expect(redis.healthcheck.test).toEqual([
      "CMD-SHELL",
      "REDISCLI_AUTH=\"$$(sed -n 's/^requirepass //p' /usr/local/etc/redis/redis.conf)\" " +
        "redis-cli -e ping",
    ]);
  });

  it("gives postgres and redis exactly the environment variables they need", () => {
    // The health check reads POSTGRES_USER and POSTGRES_DB from the container's environment, so
    // both must be set there. Anything more could weaken logins: POSTGRES_HOST_AUTH_METHOD=trust,
    // for example, would let every TCP client in without a password.
    const { POSTGRES_PASSWORD: password, ...names } = postgres.environment;
    expect(password).toMatch(requiredForm("POSTGRES_PASSWORD"));
    expect(names).toEqual({
      POSTGRES_USER: "${POSTGRES_USER:-postgres}",
      POSTGRES_DB: "${POSTGRES_DB:-apex_garage}",
    });
    // Redis needs only the password for redis-cli. It must stay: Compose recreates a container
    // when its settings change, and a change in the config file's content alone goes unnoticed,
    // so without this copy `docker compose up -d` would leave Redis on the old password (seen on
    // Compose 5.6.1 in the wave w0 review, round 3). Anything more could change how the image
    // starts Redis: SKIP_DROP_PRIVS=1, for example, keeps the server running as root.
    expect(redis.environment).toEqual({
      REDISCLI_AUTH: "${REDIS_PASSWORD:?set it in .env (see .env.example)}",
    });
  });

  it("publishes each server's own port, on the host port set in .env", () => {
    // A wrong container port would publish a port that nothing listens on.
    expect(postgres.ports).toEqual(["127.0.0.1:${POSTGRES_PORT:-5432}:5432"]);
    expect(redis.ports).toEqual(["127.0.0.1:${REDIS_PORT:-6379}:6379"]);
  });

  it("starts api after postgres and redis are healthy, and web after api has started", () => {
    expect(api.depends_on).toEqual({
      postgres: { condition: "service_healthy" },
      redis: { condition: "service_healthy" },
    });
    // The API placeholder exits at once and has no health check to wait for.
    expect(web.depends_on).toEqual({ api: { condition: "service_started" } });
  });

  it("keeps the app placeholders honest: each exits with an error", () => {
    // A placeholder that exited with status 0 would look as if the app had run. Neither builds
    // anything (the schema above allows no `build`): no Dockerfile exists yet, and instruction 102
    // adds the images.
    for (const [name, placeholder] of Object.entries({ api, web })) {
      expect(placeholder.command.at(-1), name).toMatch(/; exit 1$/);
    }
  });

  it("keeps data in named volumes at the paths the images use", () => {
    // PostgreSQL 18+ images refuse to start with a volume at the old /var/lib/postgresql/data.
    // The named volumes themselves have no options (the schema above allows none), so Docker
    // keeps their data in its own storage.
    expect(postgres.volumes).toEqual(["postgres-data:/var/lib/postgresql"]);
    expect(redis.volumes).toEqual(["redis-data:/data"]);
  });

  it("restarts postgres and redis automatically but never restarts a placeholder", () => {
    expect(postgres.restart).toBe("unless-stopped");
    expect(redis.restart).toBe("unless-stopped");
    // A placeholder exits at once; any other policy would restart it in a loop.
    expect(api.restart).toBe("no");
    expect(web.restart).toBe("no");
  });

  it("rotates the logs of postgres and redis", () => {
    // Docker's default json-file driver never deletes old log lines.
    expect(postgres.logging).toEqual({ driver: "local" });
    expect(redis.logging).toEqual({ driver: "local" });
  });

  it("pins every image to a tag and a digest", () => {
    for (const [name, definition] of Object.entries(compose.services)) {
      expect(definition.image, name).toMatch(/^[\w./-]+:[\w.-]+@sha256:[0-9a-f]{64}$/);
    }
  });

  it("is the only Compose file that Compose reads by default", () => {
    // Compose prefers a compose.yaml to this file and merges a docker-compose.override.yml on top
    // of it, so a committed one would change what runs without any check here seeing it. On
    // macOS, "Compose.yaml" does the same. The pre-commit hook runs this test whenever a YAML
    // file is staged (lint-staged.config.ts).
    expect(trackedFiles().filter(isComposeDefaultFile)).toEqual(["docker-compose.yml"]);
  });
});

describe(".env.example", () => {
  const entries = envEntries(envExampleText);

  it("lists exactly the variables that docker-compose.yml reads, and the project name", () => {
    const names = new Set(composeInterpolations.map(({ name }) => name));
    expect(names.size).toBeGreaterThan(0);
    // COMPOSE_PROJECT_NAME is read by Compose itself, not by the file. Any other entry that the
    // file does not read would be a setting that silently does nothing.
    expect([...entries.keys()].sort()).toEqual([...names, "COMPOSE_PROJECT_NAME"].sort());
  });

  it("shows the optional settings commented out, with the defaults Compose uses", () => {
    const defaults = composeStrings.flatMap(plainDefaults);
    expect(defaults.length).toBeGreaterThan(0);
    for (const [name, fallback] of defaults) {
      expect(entries.get(name), name).toEqual({ value: fallback, commented: true });
    }
    expect(entries.get("COMPOSE_PROJECT_NAME")).toEqual({ value: compose.name, commented: true });
  });

  it("leaves the passwords blank, so no real secret is ever committed", () => {
    expect(entries.get("POSTGRES_PASSWORD")).toEqual({ value: "", commented: false });
    expect(entries.get("REDIS_PASSWORD")).toEqual({ value: "", commented: false });
    for (const [name, { value }] of entries) {
      if (isSecretName(name)) {
        expect(value, name).toBe("");
      }
    }
  });
});

describe("the helpers these checks use", () => {
  it("accept only 127.0.0.1 port bindings", () => {
    expect(isLoopbackOnly("127.0.0.1:5432:5432")).toBe(true);
    expect(isLoopbackOnly("127.0.0.1:${POSTGRES_PORT:-5432}:5432")).toBe(true);
    expect(isLoopbackOnly("5432:5432")).toBe(false);
    expect(isLoopbackOnly("5432")).toBe(false);
    expect(isLoopbackOnly("0.0.0.0:5432:5432")).toBe(false);
    expect(isLoopbackOnly("${BIND:-127.0.0.1}:5432:5432")).toBe(false);
  });

  it("find interpolated variables and their operators, skipping $$ escapes", () => {
    expect(interpolations("${A}")).toEqual([{ name: "A", operator: undefined }]);
    expect(interpolations("x${B:-5432}y")).toEqual([{ name: "B", operator: ":-" }]);
    expect(interpolations("${C:?set it in .env}")).toEqual([{ name: "C", operator: ":?" }]);
    expect(interpolations("${D-x} $E")).toEqual([
      { name: "D", operator: "-" },
      { name: "E", operator: undefined },
    ]);
    expect(interpolations("${F:-${G_PASSWORD}}")).toEqual([
      { name: "F", operator: ":-" },
      { name: "G_PASSWORD", operator: undefined },
    ]);
    expect(interpolations('--username="$${POSTGRES_USER}"')).toEqual([]);
    expect(interpolations("$$${H}")).toEqual([{ name: "H", operator: undefined }]);
    expect(interpolations("no variables")).toEqual([]);
  });

  it("find plain defaults only", () => {
    expect(plainDefaults("127.0.0.1:${PORT:-5432}:5432")).toEqual([["PORT", "5432"]]);
    expect(plainDefaults("${A:-}")).toEqual([["A", ""]]);
    expect(plainDefaults("${B:-${C}} ${D:?x} ${E-1} $${F:-1}")).toEqual([]);
  });

  it("read set and commented-out env entries, but not prose", () => {
    const parsed = envEntries(
      "A=1\n# B=\n#   openssl rand -hex 32\n# Prose = not a variable\nC=\n",
    );
    expect([...parsed]).toEqual([
      ["A", { value: "1", commented: false }],
      ["B", { value: "", commented: true }],
      ["C", { value: "", commented: false }],
    ]);
  });

  it("recognise the file names Compose reads by default, in any folder and any letter case", () => {
    for (const path of [
      "compose.yaml",
      "compose.yml",
      "docker-compose.yaml",
      "docker-compose.yml",
      "compose.override.yaml",
      "docker-compose.override.yml",
      "infra/compose.yaml",
      ".devcontainer/compose.yaml",
      // Names that Compose 5.6.1 read on macOS's case-insensitive file system in the wave w0
      // review (round 4): the one with a long s replaced docker-compose.yml.
      "Compose.yaml",
      "docker-compose.Override.yml",
      "COMPOSE.OVERRIDE.YAML",
      "compoſe.yaml",
      "docKer-compose.override.yml",
    ]) {
      expect(isComposeDefaultFile(path), path).toBe(true);
    }
    for (const path of [
      "compose.prod.yaml",
      "my-compose.yml",
      "compose.json",
      "compose.yaml.bak",
      // macOS does not fold these to "i", and neither does the check.
      "compose.overrıde.yaml",
      "compose.overrİde.yaml",
    ]) {
      expect(isComposeDefaultFile(path), path).toBe(false);
    }
  });

  it("refuse YAML that Compose may read differently, and keep merge keys as plain keys", () => {
    expect(() => parseYaml("ports: !reset []\n")).toThrow(/Unresolved tag: !reset/);
    expect(() => parseYaml("a: 1\na: 2\n")).toThrow(/unique/);
    expect(parseYaml("a: &x {b: 1}\nc: *x\n")).toEqual({ a: { b: 1 }, c: { b: 1 } });
    // Compose would merge this into the service; the schema then rejects the "<<" key.
    expect(parseYaml("postgres:\n  <<: {env_file: [x.env]}\n")).toEqual({
      postgres: { "<<": { env_file: ["x.env"] } },
    });
  });
});

/** True for a plain object, such as a mapping in parsed YAML. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A copy of the parsed compose file with `key` set to `value` in the mapping at `path`, whose
 * steps are keys of mappings or indexes of lists.
 */
function withSetting(path: readonly string[], key: string, value: unknown): unknown {
  const copy = structuredClone(rawCompose);
  let mapping: unknown = copy;
  for (const step of path) {
    if (Array.isArray(mapping)) {
      mapping = mapping.at(Number(step));
    } else {
      mapping = isRecord(mapping) ? mapping[step] : undefined;
    }
  }
  if (!isRecord(mapping)) {
    throw new Error(`docker-compose.yml has no mapping at ${path.join(".")}`);
  }
  mapping[key] = value;
  return copy;
}

describe("the schema of docker-compose.yml", () => {
  it("accepts the file as it is", () => {
    expect(composeSchema.safeParse(rawCompose).success).toBe(true);
  });

  // Each of these passed every other check here, and each changes what runs (the first three were
  // tried on a real Docker Engine in the wave w0 review): an environment from a file, here one
  // that gives PostgreSQL logins without a password; the same through a YAML merge key; host
  // networking, which published Redis on every interface; settings from another file; the image's
  // entrypoint replaced; Redis's working directory, and so its data, moved out of the volume; a
  // second compose file; a disabled health check; api started even without PostgreSQL; logs
  // that are not rotated; the config file unreadable for Redis; a volume that is a host folder.
  it.for<[string, readonly string[], string, unknown]>([
    ["env_file", ["services", "postgres"], "env_file", ["postgres.env"]],
    ["a merge key", ["services", "postgres"], "<<", { env_file: ["postgres.env"] }],
    ["network_mode", ["services", "redis"], "network_mode", "host"],
    ["extends", ["services", "redis"], "extends", { file: "other.yml", service: "redis" }],
    ["entrypoint", ["services", "api"], "entrypoint", ["true"]],
    ["working_dir", ["services", "redis"], "working_dir", "/tmp"],
    ["a top-level include", [], "include", ["other.yml"]],
    ["a disabled health check", ["services", "redis", "healthcheck"], "disable", true],
    ["an optional dependency", ["services", "api", "depends_on", "postgres"], "required", false],
    ["logging options", ["services", "postgres", "logging"], "options", { "max-size": "1g" }],
    ["a config file mode", ["services", "redis", "configs", "0"], "mode", 0o400],
    ["volume options", ["volumes"], "postgres-data", { driver_opts: { o: "bind" } }],
  ])("rejects %s", ([, path, key, value]) => {
    expect(composeSchema.safeParse(withSetting(path, key, value)).success).toBe(false);
  });
});
