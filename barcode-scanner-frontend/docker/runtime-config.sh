#!/bin/sh
# Container start-up hook, run by the nginx image's /docker-entrypoint.sh
# before nginx starts.
#
# 1. Writes /config.js, the frontend's runtime configuration, from an explicit
#    allowlist of environment variables. The file is public, so nothing outside
#    that list may ever reach it.
# 2. BACKEND_UPSTREAM (e.g. http://backend:8080): proxy the API, the Django
#    admin and Django's static files to it, so the whole app is one origin.
# 3. TRUSTED_PROXY_CIDR (comma-separated): take the client IP from
#    X-Forwarded-For for requests arriving from that network, i.e. a TLS
#    terminator in front of this container. Without it the IP allowlist would
#    see that proxy's address for every user.
set -eu

CONFIG_JS=/usr/share/nginx/runtime/config.js
SNIPPETS=/etc/nginx/runtime.d

fail() {
    echo "runtime-config: $*" >&2
    exit 1
}

# JSON string literal: escape backslash and double quote, escape "<" so a value
# can never close the <script>, drop line breaks.
json_string() {
    printf '"%s"' "$(printf '%s' "$1" | tr -d '\r\n' | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/</\\u003c/g')"
}

{
    echo 'window.__APP_CONFIG__ = {'
    for name in \
        REACT_APP_API_BASE_URL \
        REACT_APP_SENTRY_DSN \
        REACT_APP_SENTRY_ENVIRONMENT \
        REACT_APP_SENTRY_RELEASE \
        REACT_APP_SENTRY_TRACES_SAMPLE_RATE \
        REACT_APP_PUBLIC_POSTHOG_KEY \
        REACT_APP_PUBLIC_POSTHOG_HOST
    do
        eval "value=\${$name:-}"
        if [ -n "$value" ]; then
            echo "  \"$name\": $(json_string "$value"),"
        fi
    done
    # Single-origin install: the API lives wherever the page was loaded from.
    if [ -z "${REACT_APP_API_BASE_URL:-}" ] && [ -n "${BACKEND_UPSTREAM:-}" ]; then
        echo '  "REACT_APP_API_BASE_URL": window.location.origin,'
    fi
    echo '};'
} > "$CONFIG_JS"

rm -f "$SNIPPETS"/*.server.conf

if [ -n "${BACKEND_UPSTREAM:-}" ]; then
    echo "$BACKEND_UPSTREAM" | grep -Eq '^https?://[A-Za-z0-9._-]+(:[0-9]+)?$' \
        || fail "BACKEND_UPSTREAM must look like http://host:port (no path), got: $BACKEND_UPSTREAM"

    # Resolve the upstream per request (cached 10 s) rather than once at
    # start-up: recreating only the backend container gives it a new IP, and a
    # hostname resolved at start-up would keep proxying to the old one.
    resolver=$(awk '/^nameserver/ { print $2; exit }' /etc/resolv.conf)
    [ -n "$resolver" ] || fail "no nameserver in /etc/resolv.conf"
    case "$resolver" in *:*) resolver="[$resolver]" ;; esac

    # /django-static/ must match the backend's STATIC_URL: CRA already owns
    # /static/ on this origin. A variable proxy_pass with no URI part forwards
    # the original request URI unchanged.
    sed -e "s#__BACKEND_UPSTREAM__#$BACKEND_UPSTREAM#g" -e "s#__RESOLVER__#$resolver#g" \
        > "$SNIPPETS/backend-proxy.server.conf" <<'EOF'
resolver __RESOLVER__ valid=10s;
set $backend_upstream __BACKEND_UPSTREAM__;

proxy_http_version 1.1;
proxy_set_header Host $http_host;
proxy_set_header X-Forwarded-For $remote_addr;
proxy_set_header X-Forwarded-Proto $forwarded_proto;
# Above Django's own 2.5 MB request cap, so Django is what answers a large push.
client_max_body_size 10m;

location /api/ {
    proxy_pass $backend_upstream;
}

location /admin/ {
    proxy_pass $backend_upstream;
}

location /django-static/ {
    proxy_pass $backend_upstream;
}
EOF
fi

if [ -n "${TRUSTED_PROXY_CIDR:-}" ]; then
    echo "$TRUSTED_PROXY_CIDR" | grep -Eq '^[0-9A-Fa-f:./,]+$' \
        || fail "TRUSTED_PROXY_CIDR must be a comma-separated list of IPs/CIDRs, got: $TRUSTED_PROXY_CIDR"
    {
        echo "$TRUSTED_PROXY_CIDR" | tr ',' '\n' | sed -e '/^$/d' -e 's/.*/set_real_ip_from &;/'
        echo 'real_ip_header X-Forwarded-For;'
        echo 'real_ip_recursive on;'
    } > "$SNIPPETS/trusted-proxy.server.conf"
fi
