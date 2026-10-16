import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { z } from "zod";

// Static checks of docker-compose.yml and the root .env.example (instruction 3). They read the
// files, so they need no Docker. They guard what must not regress: a plain `docker compose up`
// starts only the infrastructure, nothing is published beyond 127.0.0.1, no password has a
// default or goes on a command line, and .env.example documents exactly the variables the
// compose file reads.

const repoRoot = join(import.meta.dirname, "..");
const composeText = readFileSync(join(repoRoot, "docker-compose.yml"), "utf8");
const envExampleText = readFileSync(join(repoRoot, ".env.example"), "utf8");

// Only the parts of the Compose format these checks rely on. They expect the map form of
// `environment`, the short "source:target" form of `volumes` and the long form of a service's
// `configs`; ports may use either form.
const portSchema = z.union([z.string(), z.looseObject({ host_ip: z.string().optional() })]);
const serviceSchema = z.looseObject({
  image: z.string(),
  build: z.unknown().optional(),
  profiles: z.array(z.string()).optional(),
  restart: z.string().optional(),
  command: z.array(z.string()).optional(),
  shm_size: z.string().optional(),
  environment: z.record(z.string(), z.string()).optional(),
  ports: z.array(portSchema).optional(),
  volumes: z.array(z.string()).optional(),
  configs: z.array(z.looseObject({ source: z.string(), target: z.string().optional() })).optional(),
  network_mode: z.string().optional(),
  entrypoint: z.unknown().optional(),
  // Every health check sets all of its timings. start_period is also required by Compose
  // whenever start_interval is set.
  healthcheck: z
    .looseObject({
      test: z.array(z.string()),
      interval: z.string(),
      timeout: z.string(),
      retries: z.number().int().positive(),
      start_period: z.string(),
      disable: z.boolean().optional(),
    })
    .optional(),
  depends_on: z.record(z.string(), z.looseObject({ condition: z.string() })).optional(),
  logging: z.looseObject({ driver: z.string() }).optional(),
});
const composeSchema = z.looseObject({
  name: z.string(),
  services: z.record(z.string(), serviceSchema),
  volumes: z.record(z.string(), z.unknown()),
  configs: z.record(z.string(), z.looseObject({ content: z.string().optional() })).optional(),
});

type Port = z.infer<typeof portSchema>;
type Service = z.infer<typeof serviceSchema>;

const rawCompose: unknown = parse(composeText);
const compose = composeSchema.parse(rawCompose);

function service(name: string): Service {
  const found = compose.services[name];
  if (found === undefined) {
    throw new Error(`docker-compose.yml has no "${name}" service`);
  }
  return found;
}

/** True if a port mapping is published on 127.0.0.1 only (not on every interface). */
function isLoopbackOnly(port: Port): boolean {
  return typeof port === "string" ? port.startsWith("127.0.0.1:") : port.host_ip === "127.0.0.1";
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

/**
 * The directives in a Redis config file, each with every value it is given, in order. Names are
 * lowercased, because Redis ignores their case; lines that start with "#" are comments.
 */
function redisDirectives(text: string): Map<string, string[]> {
  const directives = new Map<string, string[]>();
  for (const line of text.split("\n")) {
    const match = /^\s*([^#\s]\S*)\s+(.*?)\s*$/.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) {
      const name = match[1].toLowerCase();
      directives.set(name, [...(directives.get(name) ?? []), match[2]]);
    }
  }
  return directives;
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

const composeStrings = stringsIn(rawCompose);
const composeInterpolations = composeStrings.flatMap(interpolations);
const redisSettings = redisDirectives(compose.configs?.["redis-config"]?.content ?? "");
const requiredForm = (name: string) => new RegExp(`^\\$\\{${name}:\\?[^}]+\\}$`);
const isSecretName = (name: string) => /PASSWORD|SECRET|TOKEN/.test(name);

describe("docker-compose.yml", () => {
  it("starts only postgres and redis without a profile; the app placeholders need 'app'", () => {
    const withoutProfile = Object.entries(compose.services)
      .filter(([, definition]) => definition.profiles === undefined)
      .map(([name]) => name);
    expect(withoutProfile.sort()).toEqual(["postgres", "redis"]);
    expect(service("api").profiles).toEqual(["app"]);
    expect(service("web").profiles).toEqual(["app"]);
  });

  it("publishes ports on 127.0.0.1 only", () => {
    const services = Object.entries(compose.services);
    expect(services.flatMap(([, definition]) => definition.ports ?? []).length).toBeGreaterThan(0);
    for (const [name, definition] of services) {
      // Host networking would bypass port publishing and expose every listening port.
      expect(definition.network_mode, name).not.toBe("host");
      for (const port of definition.ports ?? []) {
        expect(isLoopbackOnly(port), `${name} publishes ${JSON.stringify(port)}`).toBe(true);
      }
    }
  });

  it("requires both passwords from .env and never defaults a secret", () => {
    const postgres = service("postgres");
    expect(postgres.environment?.["POSTGRES_PASSWORD"]).toMatch(requiredForm("POSTGRES_PASSWORD"));

    const requirepass = redisSettings.get("requirepass") ?? [];
    expect(requirepass).toHaveLength(1);
    expect(requirepass[0]).toMatch(requiredForm("REDIS_PASSWORD"));
    expect(service("redis").environment?.["REDISCLI_AUTH"]).toMatch(requiredForm("REDIS_PASSWORD"));

    const secrets = composeInterpolations.filter(({ name }) => isSecretName(name));
    expect(secrets.length).toBeGreaterThan(0);
    for (const { name, operator } of secrets) {
      expect(operator, `${name} must use the required form \${${name}:?message}`).toBe(":?");
    }
  });

  it("starts redis-server with only its config file, which Compose writes", () => {
    const redis = service("redis");
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
    for (const [serviceName, definition] of Object.entries(compose.services)) {
      const words = [...(definition.command ?? []), ...(definition.healthcheck?.test ?? [])];
      const secrets = words.flatMap(interpolations).filter(({ name }) => isSecretName(name));
      expect(secrets, serviceName).toEqual([]);
    }
  });

  it("keeps every image's own entrypoint", () => {
    // The postgres and redis images' entrypoint scripts drop root privileges before they start
    // the server, and an entrypoint such as ["true"] would let a placeholder exit with status 0.
    for (const [name, definition] of Object.entries(compose.services)) {
      expect(definition.entrypoint, name).toBeUndefined();
    }
  });

  it("turns on Redis's append-only file", () => {
    // Without it, Redis keeps only its default snapshots and a crash can lose an hour of writes.
    // Set once only: a later "appendonly no" would turn it off again.
    expect(redisSettings.get("appendonly")).toEqual(["yes"]);
  });

  it("runs PostgreSQL from the pgvector image, with exact releases of both", () => {
    // Instruction 77 needs pgvector, which the official postgres image does not include. The tag
    // names the pgvector release, the PostgreSQL major version and the Debian release.
    expect(service("postgres").image).toMatch(
      /^pgvector\/pgvector:\d+\.\d+\.\d+-pg\d+-[a-z]+@sha256:[0-9a-f]{64}$/,
    );
    // Docker's default 64 MB /dev/shm is too small for parallel pgvector index builds.
    expect(service("postgres").shm_size).toBe("256mb");
  });

  it("pins Redis to an exact release", () => {
    expect(service("redis").image).toMatch(/^redis:\d+\.\d+\.\d+-[\w.]+@sha256:[0-9a-f]{64}$/);
  });

  it("health-checks postgres over TCP and fails the Redis check on error replies", () => {
    // TCP, because a Unix-socket check would pass against the temporary server that runs during
    // first-time initialisation. CMD-SHELL, because a shell must expand the container's
    // POSTGRES_USER and POSTGRES_DB ("$$" is Compose's escape for "$"): in exec form (CMD) the
    // check gets the literal text, and with any other names, such as the default "root",
    // PostgreSQL logs a FATAL line for every check while the service still counts as healthy.
    expect(service("postgres").healthcheck?.test).toEqual([
      "CMD-SHELL",
      'pg_isready --host=127.0.0.1 --username="$${POSTGRES_USER}" --dbname="$${POSTGRES_DB}"',
    ]);
    // Without -e, redis-cli exits 0 even on NOAUTH (wrong password) or LOADING replies.
    expect(service("redis").healthcheck?.test).toEqual(["CMD", "redis-cli", "-e", "ping"]);
    for (const name of ["postgres", "redis"]) {
      expect(service(name).healthcheck?.disable, name).not.toBe(true);
    }
  });

  it("gives postgres and redis exactly the environment variables they need", () => {
    // The health check reads POSTGRES_USER and POSTGRES_DB from the container's environment, so
    // both must be set there. Anything more could weaken logins: POSTGRES_HOST_AUTH_METHOD=trust,
    // for example, would let every TCP client in without a password. Redis needs only the
    // password for redis-cli.
    const { POSTGRES_PASSWORD: password, ...names } = service("postgres").environment ?? {};
    expect(password).toMatch(requiredForm("POSTGRES_PASSWORD"));
    expect(names).toEqual({
      POSTGRES_USER: "${POSTGRES_USER:-postgres}",
      POSTGRES_DB: "${POSTGRES_DB:-apex_garage}",
    });
    expect(Object.keys(service("redis").environment ?? {})).toEqual(["REDISCLI_AUTH"]);
  });

  it("publishes each server's own port, on the host port set in .env", () => {
    // A wrong container port would publish a port that nothing listens on.
    expect(service("postgres").ports).toEqual(["127.0.0.1:${POSTGRES_PORT:-5432}:5432"]);
    expect(service("redis").ports).toEqual(["127.0.0.1:${REDIS_PORT:-6379}:6379"]);
  });

  it("starts api after postgres and redis are healthy, and web after api has started", () => {
    const dependsOn = service("api").depends_on ?? {};
    expect(Object.keys(dependsOn).sort()).toEqual(["postgres", "redis"]);
    expect(dependsOn["postgres"]?.condition).toBe("service_healthy");
    expect(dependsOn["redis"]?.condition).toBe("service_healthy");
    // The API placeholder exits at once and has no health check to wait for.
    expect(service("web").depends_on).toEqual({ api: { condition: "service_started" } });
  });

  it("keeps the app placeholders honest: nothing to build, and each exits with an error", () => {
    for (const name of ["api", "web"]) {
      const placeholder = service(name);
      // No Dockerfile exists yet (instruction 102 adds the images), and a placeholder that
      // exited with status 0 would look as if the app had run.
      expect(placeholder.build, name).toBeUndefined();
      expect(placeholder.command?.at(-1), name).toMatch(/; exit 1$/);
    }
  });

  it("keeps data in named volumes at the paths the images use", () => {
    // PostgreSQL 18+ images refuse to start with a volume at the old /var/lib/postgresql/data.
    expect(service("postgres").volumes).toEqual(["postgres-data:/var/lib/postgresql"]);
    expect(service("redis").volumes).toEqual(["redis-data:/data"]);
    expect(Object.keys(compose.volumes).sort()).toEqual(["postgres-data", "redis-data"]);
  });

  it("restarts postgres and redis automatically but never restarts a placeholder", () => {
    expect(service("postgres").restart).toBe("unless-stopped");
    expect(service("redis").restart).toBe("unless-stopped");
    // A placeholder exits at once; any other policy would restart it in a loop.
    expect(service("api").restart).toBe("no");
    expect(service("web").restart).toBe("no");
  });

  it("rotates the logs of postgres and redis", () => {
    // Docker's default json-file driver never deletes old log lines.
    expect(service("postgres").logging?.driver).toBe("local");
    expect(service("redis").logging?.driver).toBe("local");
  });

  it("pins every image to a tag and a digest", () => {
    for (const [name, definition] of Object.entries(compose.services)) {
      expect(definition.image, name).toMatch(/^[\w./-]+:[\w.-]+@sha256:[0-9a-f]{64}$/);
    }
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
    expect(isLoopbackOnly({ host_ip: "127.0.0.1" })).toBe(true);
    expect(isLoopbackOnly("5432:5432")).toBe(false);
    expect(isLoopbackOnly("5432")).toBe(false);
    expect(isLoopbackOnly("0.0.0.0:5432:5432")).toBe(false);
    expect(isLoopbackOnly("${BIND:-127.0.0.1}:5432:5432")).toBe(false);
    expect(isLoopbackOnly({})).toBe(false);
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

  it("read every value of each Redis directive, whatever its case, but not comments", () => {
    const parsed = redisDirectives(
      "requirepass ${P:?set it}\n# appendonly no\n\nAPPENDONLY yes\n  appendonly   no  \nsave\n",
    );
    expect([...parsed]).toEqual([
      ["requirepass", ["${P:?set it}"]],
      ["appendonly", ["yes", "no"]],
    ]);
  });
});
