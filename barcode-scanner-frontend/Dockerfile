# syntax=docker/dockerfile:1
#
# Targets:
#   production (default) — the release image: nginx serving `npm run build`,
#                          configured at container start (docker/runtime-config.sh).
#   dev                  — the CRA dev server; docker-compose.yml selects it.
#
#   docker build --build-arg APP_VERSION=1.2.0 -t iflow-frontend:1.2.0 .

FROM node:22 AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# Exactly what package-lock.json pins, like CI. Never --legacy-peer-deps: it
# drops optional peers from the lock and breaks `npm ci` (see CLAUDE.md).
RUN npm ci

FROM deps AS dev
COPY . .
EXPOSE 3000
CMD ["npm", "start"]

FROM deps AS build
ARG APP_VERSION=
COPY . .
# .env.production turns source maps off; the check makes sure nothing turns
# them back on, since a map file ships the original source to every browser.
RUN REACT_APP_VERSION="$APP_VERSION" npm run build \
 && if find build -name '*.map' | grep -q .; then echo 'source maps found in build/' >&2; exit 1; fi \
 && printf '{"version": "%s"}\n' "${APP_VERSION:-unreleased}" > build/version.json

FROM nginxinc/nginx-unprivileged:1.29-alpine AS production
ARG APP_VERSION=
LABEL org.opencontainers.image.title="iflow-frontend" \
      org.opencontainers.image.version="$APP_VERSION"
# PORT is the only variable the nginx template may substitute; everything else
# in it is nginx's own $variables.
ENV APP_VERSION="$APP_VERSION" \
    PORT=8080 \
    NGINX_ENVSUBST_FILTER="^PORT\$"
USER root
RUN rm /etc/nginx/conf.d/default.conf \
 && mkdir -p /etc/nginx/runtime.d /usr/share/nginx/runtime \
 && chown 101:101 /etc/nginx/runtime.d /usr/share/nginx/runtime
COPY docker/default.conf.template /etc/nginx/templates/default.conf.template
COPY --chmod=755 docker/runtime-config.sh /docker-entrypoint.d/40-runtime-config.sh
# A checkout with CRLF line endings would break the shell script.
RUN sed -i 's/\r$//' /docker-entrypoint.d/40-runtime-config.sh /etc/nginx/templates/default.conf.template
COPY --from=build /app/build /usr/share/nginx/html
USER 101
EXPOSE 8080
