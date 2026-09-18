# iflow on-premise install

Runs the whole application on one Linux server with Docker: PostgreSQL, the API
and the web app, served together on one port. Put HTTPS in front of it.

```
browser ──HTTPS──▶ your reverse proxy ──HTTP──▶ frontend (nginx, HTTP_PORT)
                                                    ├── /api/, /admin/, /django-static/ ──▶ backend (Django)
                                                    └── everything else: the web app
                                                                              backend ──▶ db (PostgreSQL)
```

## Requirements

- Linux server with Docker Engine 24+ and the Compose plugin. 2 vCPU / 4 GB RAM
  is comfortable for a single organization.
- A hostname for the app, and **HTTPS** on it. Browsers only allow the barcode
  camera on HTTPS pages, so plain HTTP is for smoke tests only.
- Outbound internet access to the organization's 1C server, `xdata.rs.ge`,
  `photon.komoot.io`, OpenStreetMap map tiles, and Sentry/PostHog if you enable
  them.
- Pull credentials for the image registry (you receive these with the release).

## Install

```bash
mkdir -p /opt/iflow && cd /opt/iflow
# copy docker-compose.yml and .env.example here
cp .env.example .env
chmod 600 .env
# fill in .env: image tags, PUBLIC_HOSTNAME, and the three secrets
# (the generation commands are next to each one)

docker login <registry>
docker compose pull
docker compose up -d
docker compose logs -f backend      # wait for "Listening at: http://0.0.0.0:8080"
```

Create the first administrator:

```bash
docker compose exec backend python manage.py shell -c "
from users.models import User
User.objects.create_superuser(username='admin', password='CHANGE-ME', role='internal_admin')"
```

Then sign in at `https://<PUBLIC_HOSTNAME>/admin/`, change that password, and
create the organization, its warehouses and users.

## HTTPS

Terminate TLS in a reverse proxy you already run (nginx, Caddy, Traefik, a
load balancer) and forward to `http://<server>:<HTTP_PORT>`. The proxy must:

- pass the original `Host` header;
- set `X-Forwarded-Proto: https`. Without it the app redirects every request to
  HTTPS in a loop;
- set `X-Forwarded-For`, and its address must be listed in `TRUSTED_PROXY_CIDR`.
  Otherwise per-user IP allowlists see the proxy's address for every user.

Smoke test without HTTPS (never in production): set `SECURE_SSL_REDIRECT=False`,
then open `http://<server>:<HTTP_PORT>/api/v1/health/`, which should return
`{"status": "ok"}`. Admin sign-in won't work over plain HTTP, because its
cookies are HTTPS-only.

## 1C integration

Give the organization's 1C administrator:

- the base URL `https://<PUBLIC_HOSTNAME>`, where catalog pushes go to
  `/api/v1/catalog/products/` and order webhooks to `/api/v1/webhooks/orders/complete/`;
- the organization's push token (in the web app: the organization's external
  service settings, where it can also be rotated);
- the integration reference at `https://<PUBLIC_HOSTNAME>/api/integration/redoc/`.

## Upgrade

```bash
cd /opt/iflow
docker compose exec -T db pg_dump -U iflow -Fc iflow > backup-$(date +%F).dump   # always first
# edit .env: set BACKEND_IMAGE and FRONTEND_IMAGE to the new version
docker compose pull
docker compose up -d
```

Database migrations run automatically when the backend starts. Read the release
notes before a MAJOR version: those can require a manual step.

## Backup and restore

Back up two things:

1. **The database:** the `pg_dump` command above, on a schedule, stored off the server.
2. **`.env`:** above all `FERNET_KEY`. Without it, the 1C web-service
   passwords stored in the database cannot be decrypted, and a restored database
   is only half usable.

Restore into a fresh install:

```bash
docker compose up -d db
docker compose exec -T db pg_restore -U iflow -d iflow --clean --if-exists < backup.dump
docker compose up -d
```

## Monitoring

- Health probe: `GET https://<PUBLIC_HOSTNAME>/api/v1/health/` answers 200 when
  the app and database are up, and 503 when the database is not.
- Running version: `https://<PUBLIC_HOSTNAME>/version.json` and the Django admin footer.
- Sentry and PostHog are optional. Leave their variables blank to switch them
  off entirely.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Endless redirects | The reverse proxy doesn't send `X-Forwarded-Proto: https` |
| `400 Bad Request` from the API | `PUBLIC_HOSTNAME` doesn't match the hostname in the browser |
| `502 Bad Gateway` for a minute after start or upgrade | Backend still migrating; watch `docker compose logs backend` |
| Every user's IP is the same | `TRUSTED_PROXY_CIDR` is not set to the reverse proxy's address |
| Camera doesn't start | The page isn't served over HTTPS |
