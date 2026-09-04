<div align="center">
    <img src="./assets/logo.svg" alt="Quad4 Forge" width="192" align="center" />
    <h1 align="center">Quad4 Forge</h1>
    <p align="center">Charcoal. Code. Forge.</p>
</div>

**Quad4 Forge** is a fork of [Forgejo](https://forgejo.org/) for self-hosted Git and devops, with Quad4 branding, a charcoal/ember dark theme, embedded [ALTCHA](https://altcha.org/), optional Sentry/GlitchTip DSN hooks, and a hardened Docker stack fronted by [RavenGuard](https://github.com/Quad4-Software/ravenguard).

Upstream Forgejo remains free software under GPLv3+. This fork tracks Forgejo and adds Quad4 packaging, theme, and deploy defaults.

## Quick start (Compose)

```bash
cp .env.example .env
# set FORGE_DB_PASSWORD, ALTCHA_HMAC_KEY, RG_CHALLENGE_SECRET (min 16 chars)
docker compose up -d --build
curl -fsS http://localhost:8080/api/healthz
```

Topology: `Client -> RavenGuard (:8080) -> forge (:3000)`. SSH stays on forge (`:2222` by default). Forge HTTP is not published on the host.

| File | Role |
|------|------|
| `docker-compose.yml` | Local hardened stack (postgres + Valkey + forge + RavenGuard) |
| `docker-compose.coolify.yml` | Coolify deploy (domain on RavenGuard only) |
| `.env.example` | Required env template |
| `deploy/ravenguard/` | Proxy config, blocklists, seccomp |
| `Dockerfile.rootless` | Multi-stage rootless image (UID 1000) |

Valkey serves Forge cache, sessions, and queues over the Redis protocol (`redis://valkey:6379/...`).

Images: `ghcr.io/quad4-software/forge-rootless:dev|latest`, `ghcr.io/quad4-software/ravenguard:edge`.

## Coolify

Coolify can attach one public HTTP domain/port to a compose service. Assign the domain to **ravenguard** (container port **8080**) via `SERVICE_URL_RAVENGUARD_8080`. Do not put Coolify URL magic on `forge`.

Forge still reads `SERVICE_URL_RAVENGUARD_8080` / `SERVICE_FQDN_RAVENGUARD` for `ROOT_URL` and `DOMAIN` so generated links match the public edge URL. Forge HTTP stays on the internal network. SSH can use an optional host port.

Use `docker-compose.coolify.yml` and `deploy/ravenguard/ravenguard.coolify.toml` (`trust.mode = behind_proxy`).

## Fork layout

| Remote / branch | Purpose |
|-----------------|---------|
| `origin` | `git@github.com:Quad4-Software/forge.git` |
| `upstream` | Forgejo (fetch only) |
| `master` | Quad4 customizations (default) |
| `forgejo` | Clean upstream tip |

Sync: `contrib/quad4/sync-upstream.sh` or the weekly `sync-upstream` workflow.

Branding: theme `quad4-dark` (`web_src/css/themes/theme-quad4-dark.css`), logo masters under `contrib/quad4/brand/`, rebuild with `contrib/quad4/rebuild-brand.sh`. See `contrib/quad4/NOTES`.

## Features beyond stock Forgejo

- **Theme**: charcoal + ember orange, default `quad4-dark`
- **ALTCHA**: `CAPTCHA_TYPE=altcha`, embedded challenge at `/altcha/challenge`
- **Sentry**: optional `[sentry]` DSN / frontend DSN (no GlitchTip in compose)
- **Edge**: RavenGuard standalone edge (not hub `proxy` mode), forge-tuned body limits for Git HTTP/LFS
- **Cache**: Valkey for Forge cache, sessions, and queues (`redis://valkey:6379`)
- **Hardening**: `no-new-privileges`, `cap_drop: ALL`, non-root users, healthchecks, resource limits

## Upstream Forgejo

Forgejo (/for'dʒe.jo/) is an independent community forge. Docs: [forgejo.org/docs](https://forgejo.org/docs/latest/). Matrix: [#forgejo-chat:matrix.org](https://matrix.to/#/#forgejo-chat:matrix.org).

## License

Distributed under the [GPL version 3.0](LICENSE) or any later version, same as Forgejo v9+. Pre-v9 Forgejo was MIT. Keep fork changes GPLv3+ compatible.

Contribution guide for upstream Forgejo: [CONTRIBUTING.md](CONTRIBUTING.md).
