# infra/

Deployment and operations files for running Apex Garage on the owner's home server. This folder
is not a pnpm workspace package; it holds configuration and scripts, not application code.

It is empty for now. The build playbook (`docs/PLAYBOOK.md`) adds these over time:

| What                                                                                                                        | Instructions     |
| --------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| Container setup for the API and web apps (the `docker-compose.yml` itself lives at the repository root)                     | #3, #102, #103   |
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
- Prefer configuration that can be validated locally, for example `docker compose config --quiet`.
