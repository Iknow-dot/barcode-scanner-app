# Releasing

Releases are numbered and immutable. A release is a git tag; the tag drives
everything else. The live DigitalOcean app is **not** part of this flow: it
still deploys every push to `djangoRewrite`.

## Version numbers

`vMAJOR.MINOR.PATCH`, following [SemVer](https://semver.org). The tag is the only
source of truth. The `version` fields in `backend/pyproject.toml` and
`barcode-scanner-frontend/package.json` are not release numbers; ignore them.

| Bump | When | Example |
|---|---|---|
| **MAJOR** | Upgrading needs a manual step from whoever runs the install, or breaks a contract someone else depends on | renamed or new *required* env var, a change to the 1C wire contract (`core/serializers/catalog_ingest.py`), a removed endpoint |
| **MINOR** | New behaviour that upgrades by swapping images | a feature, a new *optional* env var, an additive migration |
| **PATCH** | Fixes only | a bug fix, a dependency security update |

Pre-releases for trying a build on one install first: `v1.3.0-rc.1`. They are
published the same way and marked as pre-releases on GitHub.

Installs may skip releases (e.g. 1.1.0 → 1.4.0). Migrations run in sequence on
start, so that works as long as every step in between upgrades by image swap
alone, which is exactly what MINOR and PATCH promise. Anything else is a MAJOR,
and its release notes must say what to do.

## Cutting a release

1. Make sure the commit you are releasing is green in CI.
2. Tag it and push the tag:

   ```bash
   git tag -a v1.4.0 -m "iflow 1.4.0"
   git push origin v1.4.0
   ```

3. `.github/workflows/release.yml` then:
   - rejects the tag unless it matches `vMAJOR.MINOR.PATCH[-suffix]`;
   - runs the backend and frontend test suites against the tagged commit;
   - builds `iflow-backend:<version>` and `iflow-frontend:<version>` with
     `APP_VERSION=<version>` baked in, and pushes them if a registry is
     configured (below);
   - publishes a GitHub release with notes generated from the merged PRs and
     commits since the previous tag.

A tag is never moved or reused. If a release is bad, fix forward with the next
PATCH.

## Registry configuration

Pushing is opt-in, so the workflow is safe to run before a registry is chosen.
In the GitHub repository settings:

| Name | Kind | Value |
|---|---|---|
| `IMAGE_NAMESPACE` | variable | Registry host plus path, e.g. `registry.digitalocean.com/<registry>` or `ghcr.io/<org>`. Unset: images are built but not pushed. |
| `REGISTRY_USERNAME` | secret | Push credentials. Not needed for `ghcr.io`, where the workflow token is used. |
| `REGISTRY_PASSWORD` | secret | As above. |

Give each customer install its own **read-only** pull credential, so access can
be revoked per customer without touching anyone else.

## Where the version shows up

| Place | How |
|---|---|
| Backend | `APP_VERSION` env var → `settings.APP_VERSION`; shown in the Django admin footer |
| Frontend | `GET /version.json` |
| Sentry | Both SDKs use it as the release when `SENTRY_RELEASE` / `REACT_APP_SENTRY_RELEASE` is unset |
| Images | `org.opencontainers.image.version` and `.revision` labels |

## Installing a release

See `deploy/onprem/README.md`.
