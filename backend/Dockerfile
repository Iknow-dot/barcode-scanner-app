FROM python:3.13-slim

# Prevent Python from writing .pyc files and enable unbuffered output
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies from the committed lock — the exact versions CI
# tests — into /opt/venv, outside /app (which docker-compose bind-mounts).
COPY --from=ghcr.io/astral-sh/uv:0.7.5 /uv /bin/uv
ENV UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_PYTHON_DOWNLOADS=never \
    UV_LINK_MODE=copy \
    PATH=/opt/venv/bin:$PATH
COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --locked --no-dev

# Copy project files
COPY . .

# Expose port (DigitalOcean App Platform uses 8080 by default)
EXPOSE 8080

# The single definition of how the backend container starts: migrate,
# collect static files (at run time, where the env exists and a failure is
# loud), then serve. DigitalOcean runs this as-is; docker-compose.yml
# overrides it with runserver for development.
CMD ["sh", "-c", "python manage.py migrate --noinput && python manage.py collectstatic --noinput && exec gunicorn --bind 0.0.0.0:8080 --workers 2 --threads 4 --timeout 120 backend.wsgi:application"]
