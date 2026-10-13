import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { z } from "zod";

// Static checks of docker-compose.yml and the root .env.example (instruction 3). They read the
// files, so they need no Docker. They guard what must not regress: a plain `docker compose up`
// starts only the infrastructure, nothing is published beyond 127.0.0.1, no password has a
// default, and every variable the compose file reads is documented in .env.example.

const repoRoot = join(import.meta.dirname, "..");
const composeText = readFileSync(join(repoRoot, "docker-compose.yml"), "utf8");
const envExampleText = readFileSync(join(repoRoot, ".env.example"), "utf8");

// Only the parts of the Compose format these checks rely on. They expect the map form of
// `environment` and the short "source:target" form of `volumes`; ports may use either form.
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
  network_mode: z.string().optional(),
  // Every health check sets all of its timings. start_period is also required by Compose
  // whenever start_interval is set.
  healthcheck: z
    .looseObject({
      test: z.array(z.string()),
      interval: z.string(),
      timeout: z.string(),
      retries: z.number().int().positive(),
      start_period: z.string(),
    })
    .optional(),
  depends_on: z.record(z.string(), z.looseObject({ condition: z.string() })).optional(),
  logging: z.looseObject({ driver: z.string() }).optional(),
});
const composeSchema = z.looseObject({
  name: z.string(),
  services: z.record(z.string(), serviceSchema),
  volumes: z.record(z.string(), z.unknown()),
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
const requiredForm = (name: string) => new RegExp(`^\\$\\{${name}:\\?[^}]+\\}$`);

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

    const redis = service("redis");
    const command = redis.command ?? [];
    const passwordArgument = command[command.indexOf("--requirepass") + 1];
    expect(command).toContain("--requirepass");
    expect(passwordArgument).toMatch(requiredForm("REDIS_PASSWORD"));
    expect(redis.environment?.["REDISCLI_AUTH"]).toMatch(requiredForm("REDIS_PASSWORD"));

    const secrets = composeInterpolations.filter(({ name }) => /PASSWORD|SECRET|TOKEN/.test(name));
    expect(secrets.length).toBeGreaterThan(0);
    for (const { name, operator } of secrets) {
      expect(operator, `${name} must use the required form \${${name}:?message}`).toBe(":?");
    }
  });

  it("keeps redis-server as the first word, so the image drops root privileges", () => {
    expect(service("redis").command?.[0]).toBe("redis-server");
  });

  it("turns on Redis's append-only file", () => {
    // Without it, Redis keeps only its default snapshots and a crash can lose an hour of writes.
    const command = service("redis").command ?? [];
    expect(command[command.indexOf("--appendonly") + 1]).toBe("yes");
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
    const postgresCheck = service("postgres").healthcheck?.test.join(" ");
    expect(postgresCheck).toContain("pg_isready");
    // A Unix-socket check would pass against the temporary server that runs during first-time
    // initialisation; TCP waits for the real server.
    expect(postgresCheck).toContain("--host=127.0.0.1");
    // The configured names ("$$" is Compose's escape, so the container's shell expands them). With
    // any other names, such as the default "root", PostgreSQL logs a FATAL line for every check.
    expect(postgresCheck).toContain('--username="$${POSTGRES_USER}"');
    expect(postgresCheck).toContain('--dbname="$${POSTGRES_DB}"');

    // Without -e, redis-cli exits 0 even on NOAUTH (wrong password) or LOADING replies.
    expect(service("redis").healthcheck?.test).toEqual(["CMD", "redis-cli", "-e", "ping"]);
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

  it("lists every variable that docker-compose.yml reads", () => {
    const names = new Set(composeInterpolations.map(({ name }) => name));
    expect(names.size).toBeGreaterThan(0);
    for (const name of names) {
      expect(entries.has(name), `${name} is missing from .env.example`).toBe(true);
    }
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
      if (/PASSWORD|SECRET|TOKEN/.test(name)) {
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
});
