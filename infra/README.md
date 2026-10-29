# infra/

Deployment and operations files for running Apex Garage on the owner's home server. This folder
is not a pnpm workspace package; it holds configuration, scripts and the tests for them, not
application code.

## Local services (instruction 3)

[`docker-compose.yml`](../docker-compose.yml) at the repository root runs the services the apps
will need. The apps do not use them yet (that starts in Phase 2), so `pnpm dev` works without
Docker.

| Service    | What                                                         | Host address     | Data volume     |
| ---------- | ------------------------------------------------------------ | ---------------- | --------------- |
| `postgres` | PostgreSQL 18.6 with the pgvector 0.8.7 extension available  | `127.0.0.1:5432` | `postgres-data` |
| `redis`    | Redis 8.10.2, password required, append-only file on         | `127.0.0.1:6379` | `redis-data`    |
| `api`      | Placeholder in the `app` profile: prints a reminder, exits 1 | none             | none            |
| `web`      | Placeholder in the `app` profile: prints a reminder, exits 1 | none             | none            |

You need Docker with Compose: Docker Desktop or OrbStack on macOS, Docker Engine on Linux. The file
uses the health-check setting `start_interval` (checks every second while a service starts), which
needs Compose 2.20.2 or later and Docker Engine 25 or later, and writes Redis's config file from its
own text (`configs` with `content`), which needs Compose 2.23.1 or later; any current Docker Desktop
or OrbStack is newer than all of these. On Linux, use Docker Engine 28 or later, from Docker's own
packages: with older engines, machines on the same local network can reach ports published on
`127.0.0.1` (Docker's port-publishing documentation says so), and a distribution's own package can
be older (Debian 13's `docker.io` is version 26.1). The `pnpm docker:*` scripts refuse to run with
a Compose older than 2.23.1 and, on Linux, with an older engine.

### First run

Make a copy of the template that only your user can read, and print two strong passwords:

```sh
cp .env.example .env && chmod 600 .env
openssl rand -hex 32
openssl rand -hex 32
```

Put the two passwords in `.env` as `POSTGRES_PASSWORD` and `REDIS_PASSWORD`, then start the
services and check them:

```sh
docker compose up -d --wait
docker compose ps
```

`up -d` starts only `postgres` and `redis`; `--wait` returns once both are healthy, and
`docker compose ps` shows both as "(healthy)". Every `docker compose` command for this project
needs `.env` (or the two passwords set in the environment), even `ps`, `logs` and `down`. The
command blocks in this document hold commands only, so they can be pasted into zsh, the default
shell on macOS, which does not read `#` comments at its prompt.

### Everyday commands

Run these from the repository root.

| Command                                                                           | What it does                                          |
| --------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `docker compose up -d --wait`                                                     | Starts both services and waits until they are healthy |
| `docker compose ps`                                                               | Shows each service's state and health                 |
| `docker compose logs -f postgres`                                                 | Follows one service's log (Ctrl+C to stop following)  |
| `docker compose stop`                                                             | Stops the services; the data stays                    |
| `docker compose down`                                                             | Removes the containers; the data volumes stay         |
| `docker compose --profile app down`                                               | Also removes the placeholders, if you started them    |
| `docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'` | Opens psql inside the container                       |
| `docker compose exec redis redis-cli`                                             | Opens redis-cli, already authenticated                |
| `docker compose down --volumes`                                                   | Deletes the containers **and all data** (no undo)     |

The services restart on their own (after a crash, or when Docker starts) until you stop them.

### Connecting from the host

From Phase 2 the apps connect with URLs of this form (both passwords are hex, so they need no
escaping):

- PostgreSQL: `postgres://postgres:<POSTGRES_PASSWORD>@127.0.0.1:5432/apex_garage`
- Redis: `redis://:<REDIS_PASSWORD>@127.0.0.1:6379`

Use `127.0.0.1` rather than `localhost`: the ports are published on the IPv4 loopback address
only. If you changed `POSTGRES_USER`, `POSTGRES_DB` or a port in `.env`, use your values.

### A second copy on the same machine

The project name is fixed (`name: apex-garage` in the compose file), so the containers and
volumes have the same names whatever the folder is called. Every checkout on a machine therefore
shares one set: `docker compose up -d` in a second checkout takes over the first one's containers
and data, even with other ports. To run a separate copy, give that checkout's `.env` another
`COMPOSE_PROJECT_NAME` as well as other ports (see `.env.example`).

### Changing a password

- **Redis:** change `REDIS_PASSWORD` in `.env` and run `docker compose up -d`, which recreates
  the container with the new password. Do not rely on `docker compose restart`, which keeps the
  old password, or on `docker compose start` after a `stop`: with Compose 5 it gives Redis the
  new password, but `docker compose exec redis redis-cli` keeps the old one until the container
  is recreated. The health check reads the password from Redis's config file, so it always uses
  the one Redis has.
- **PostgreSQL:** the password is stored in the database when the data volume is first created,
  so changing `.env` alone is not enough. Open psql (see the table above), run `\password`, enter
  the new password twice, then put the same password in `.env`. Alternatively, delete all data
  with `docker compose down --volumes` and start again.

### Changing the PostgreSQL user or database name

`POSTGRES_USER` and `POSTGRES_DB`, like the password, take effect only when the data volume is
first created. The health check uses them on every check, though: if they no longer match the
database, PostgreSQL logs `FATAL: role "..." does not exist` (or `database "..." does not exist`)
every 10 seconds while the service still shows as healthy, and the psql command above fails. To
use other names, set them in `.env` and start with a new, empty volume:
`docker compose down --volumes` deletes all data first.

### Health checks

- `postgres`: `pg_isready` over TCP. On the very first start the image initialises the database
  with a temporary server that listens only on a Unix socket, so the TCP check stays unhealthy
  until the real server is up.
- `redis`: `redis-cli -e ping`, with the password that the check reads from Redis's own config
  file and passes in the `REDISCLI_AUTH` variable, so it always uses the password Redis has (the
  container's own `REDISCLI_AUTH` can be older, see "Changing a password"). `-e` makes a wrong
  password (`WRONGPASS`) or a server still loading its data (`LOADING`) count as unhealthy;
  without it, redis-cli exits successfully on those error replies.

Each check runs every 10 seconds (every second while the service starts, for up to 30 seconds
for PostgreSQL and 10 for Redis) and times out after 5; five failures in a row mark the service
unhealthy.

### Redis's memory warning on Linux

When the Linux kernel that runs the containers has `vm.overcommit_memory` set to 0, the default
on most distributions, Redis logs `WARNING Memory overcommit must be enabled!` as it starts (seen
on Debian 13 in the wave w0 review). Redis starts a child process to write its snapshots and to
rewrite its append-only file, and with that setting the kernel can refuse to start one when
memory is short. A failed snapshot makes Redis refuse writes (`MISCONF` errors) until a later one
succeeds, because Redis's default `stop-writes-on-bgsave-error` is on. The setting belongs to the
host's kernel, and a container cannot change it. On a Linux machine that runs these services, set
it once: the first command keeps the setting after a reboot, the second applies it now.

```sh
echo 'vm.overcommit_memory = 1' | sudo tee /etc/sysctl.d/99-redis.conf
sudo sysctl -w vm.overcommit_memory=1
```

It applies to every process on that machine: the kernel then always grants memory and, if memory
runs out, its out-of-memory killer stops a process instead. Docker Desktop and OrbStack run the
engine in a Linux virtual machine of their own, which this project does not configure; on a
development machine the warning can be ignored. The home server must have the setting (host
hardening, instruction 105).

### App placeholders

The `api` and `web` services are in the `app` profile, so a plain `docker compose up` skips them.
Neither app has a container image yet: run both on the host with `pnpm dev`.
`docker compose --profile app up` starts PostgreSQL and Redis, waits until they are healthy, and
then each placeholder prints that reminder and exits with status 1. They are never restarted.

Remove them with the profile as well: `docker compose --profile app down`. A plain
`docker compose down` only handles the services outside a profile, so it leaves both exited
placeholders behind while it deletes the network they were attached to; the next
`docker compose --profile app up` then fails with "failed to set up container networking: network
... not found". `docker compose --profile app down` clears that up too.

When the apps get real images (at the latest with instruction 102, which hardens every service's
container), the placeholders become builds from the repository root. Points to carry over: the
API's production start needs both flags of its `start` script, `--conditions=@apex/dist`, which
loads the compiled packages/shared, and `--no-strip-types`, which makes a start without that
condition fail instead of running the TypeScript source (see "The production API start refuses
TypeScript source" in `docs/DECISIONS.md`); inside a container it must listen on
`API_HOST=0.0.0.0` while its published port stays on `127.0.0.1`;
and once the API image has a health check, `web` should wait for `service_healthy` instead of
`service_started`.

### Security notes

- Ports are published on `127.0.0.1` only, which keeps other machines out on Docker Desktop,
  OrbStack and Docker Engine 28 or later (see above for older Linux engines, which the
  `pnpm docker:*` scripts refuse). Other containers on the Compose network can still reach the
  services; instruction 103 moves them to an internal network with no published ports.
- Neither password has a default, and `.env` is gitignored. The official Redis image turns
  Redis's protected mode off, so the password is what keeps other clients out.
- `chmod 600 .env` keeps other accounts on the machine from reading the passwords: a plain copy
  is readable by every local user (on macOS every account is in the `staff` group, which can
  open home folders).
- No password is ever a command-line argument: on Linux every user can read any process's
  command line, and the Redis image's entrypoint runs with the container's full command line
  each time the container starts. Redis reads its password from a config file that Compose
  writes into the container (`redis-config` in `docker-compose.yml`), and redis-cli reads it from
  the `REDISCLI_AUTH` variable (the health check sets that variable from the config file).
- The passwords are visible to anyone who can run `docker inspect` on this machine (Docker access
  is root-equivalent anyway). Instruction 104 moves them to Docker secrets or an encrypted file.
- PostgreSQL runs with a superuser for now. A least-privilege role for the API belongs with the
  migrations (instruction 26).
- Every image is pinned to a tag and a digest, so a rebuilt tag cannot change what runs. To
  update one, pick the new tag, read its digest with `docker buildx imagetools inspect <tag>`
  (the `Digest:` line) and change both together. Instruction 106 adds automated update checks.
  The `pgvector/pgvector` image gets new builds only for pgvector and PostgreSQL releases, so it
  can lack Debian security updates that the official `postgres` image already has; see "The
  pgvector image lags the official postgres image's security rebuilds" in `docs/DECISIONS.md`.
- Container logs use Docker's `local` driver, which keeps at most 100 MB per container.

### Checking the file

- `docker compose --profile '*' config --quiet` validates the whole file, as CI does, and prints
  nothing when it is valid. Without `--profile '*'`, Compose skips the services in the `app`
  profile, so a mistake in a placeholder (such as a `depends_on` that names no service) passes
  unnoticed. It needs the two passwords, from `.env` or the environment, for example throwaway
  values: `POSTGRES_PASSWORD=ci REDIS_PASSWORD=ci docker compose --profile '*' config --quiet`.
- `pnpm test` includes `infra/compose.test.ts`, static checks that need no Docker. The file may
  hold only the services and settings the checks know (so no `env_file`, `extends`, `include`,
  `entrypoint`, `network_mode`, YAML merge key and so on), and the repository no other file that
  Compose reads by default, such as a `compose.yaml` or a `docker-compose.override.yml`, in any
  letter case (on macOS, Compose also reads a `Compose.YAML`); the pre-commit hook runs these
  checks whenever a YAML file is staged. Within
  that: only `postgres` and `redis` start by default, ports stay on `127.0.0.1`, passwords have
  no default and stay off command lines, PostgreSQL comes from the pgvector image, Redis's config
  file holds exactly its password and the append-only setting, the health checks, environments,
  ports and dependencies are the ones described here, the placeholders exit with an error,
  images are pinned, and `.env.example` lists exactly the variables the file reads, with the
  right defaults. A new setting needs a test for its value before the checks accept it.

## What comes next

The build playbook (`docs/PLAYBOOK.md`) adds these over time:

| What                                                                                                                        | Instructions     |
| --------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| Container images for the API and web apps, replacing the placeholders in `docker-compose.yml`                               | #102, #103       |
| Database backup and restore scripts (scheduled, encrypted `pg_dump`, restore test, off-site copies, monthly restore drills) | #38, #108        |
| Cloudflare Tunnel configuration and WAF notes, so the home network has no open inbound ports                                | #99, #100        |
| Secrets management (Docker secrets or an encrypted file) and credential rotation                                            | #104             |
| Host hardening: automatic updates, firewall, SSH over Tailscale only, fail2ban, a non-admin service user                    | #105             |
| Power and network resilience: UPS integration, graceful shutdown on low battery, restart on boot                            | #112             |
| Object storage (MinIO) and the storage backup plan                                                                          | #121, #127, #128 |
| Monitoring: Uptime Kuma, Prometheus and Grafana, plus capacity and drive-health alerts                                      | #86, #109, #130  |
| Owner admin console network gate (Cloudflare Access and/or Tailscale)                                                       | #190             |

Ground rules that apply to everything added here:

- No secrets in committed files. Commit templates such as `.env.example` only.
- Ollama, PostgreSQL and Redis are never exposed to the internet (playbook section 2).
- Prefer configuration that can be validated locally, for example
  `docker compose --profile '*' config --quiet`.
