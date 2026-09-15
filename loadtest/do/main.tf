locals {
  # loadtest/do/sweep.py deletes and verifies by these exact names; a test
  # there fails if the two ever disagree.
  app_name = "loadtest-app"
  db_name  = "loadtest-db"

  repo = "Iknow-dot/barcode-scanner-app"

  # Fernet needs URL-safe base64; random_bytes emits standard base64.
  fernet_key = replace(replace(random_bytes.fernet_key.base64, "+", "-"), "/", "_")

  # The seed job gets the same settings the backend serves with, plus what
  # only seeding needs.
  #
  # scope: DATABASE_URL must be RUN_TIME. The default env scope is
  # RUN_AND_BUILD_TIME, and the buildpack's automatic collectstatic imports
  # settings at build time; if "$${db.DATABASE_URL}" were resolved then, it
  # is still the literal placeholder string (App Platform only binds it at
  # run time), and dj_database_url raises on the literal rather than falling
  # back to SQLite. Everything else stays RUN_AND_BUILD_TIME because
  # collectstatic needs those settings importable too.
  backend_env = [
    { key = "DJANGO_SECRET_KEY", value = random_password.django_secret_key.result, type = "SECRET", scope = "RUN_AND_BUILD_TIME" },
    { key = "FERNET_KEY", value = local.fernet_key, type = "SECRET", scope = "RUN_AND_BUILD_TIME" },
    { key = "DATABASE_URL", value = "$${db.DATABASE_URL}", type = "GENERAL", scope = "RUN_TIME" },
    { key = "ALLOWED_HOSTS", value = "$${APP_DOMAIN}", type = "GENERAL", scope = "RUN_AND_BUILD_TIME" },
    { key = "DEBUG", value = var.debug, type = "GENERAL", scope = "RUN_AND_BUILD_TIME" },
    { key = "DATABASE_SSL_REQUIRE", value = "True", type = "GENERAL", scope = "RUN_AND_BUILD_TIME" },
    { key = "PERF_HEADERS_ENABLED", value = "True", type = "GENERAL", scope = "RUN_AND_BUILD_TIME" },
    { key = "LOG_LEVEL", value = "WARNING", type = "GENERAL", scope = "RUN_AND_BUILD_TIME" },
  ]

  seed_env = concat(local.backend_env, [
    { key = "LOADTEST_PASSWORD", value = random_password.loadtest_password.result, type = "SECRET", scope = "RUN_AND_BUILD_TIME" },
    { key = "FAKE_1C_URL", value = "$${fake-1c.PRIVATE_URL}", type = "GENERAL", scope = "RUN_AND_BUILD_TIME" },
  ])
}

resource "random_password" "django_secret_key" {
  length  = 50
  special = false
}

resource "random_password" "loadtest_password" {
  length  = 24
  special = false
}

resource "random_bytes" "fernet_key" {
  length = 32
}

resource "digitalocean_database_cluster" "loadtest" {
  name       = local.db_name
  engine     = "pg"
  version    = var.db_version
  size       = var.db_size
  region     = "fra1"
  node_count = 1
}

resource "digitalocean_app" "loadtest" {
  spec {
    name   = local.app_name
    region = "fra"

    # Pins the buildpack stack the live app builds on.
    features = ["buildpack-stack=ubuntu-22"]

    # Attaching the cluster adds the app to its trusted sources and binds
    # ${db.DATABASE_URL}.
    database {
      name         = "db"
      engine       = "PG"
      production   = true
      cluster_name = digitalocean_database_cluster.loadtest.name
    }

    service {
      name               = "backend"
      source_dir         = "backend"
      environment_slug   = "python"
      run_command        = var.run_command
      instance_size_slug = var.instance_size
      instance_count     = 1
      http_port          = 8080

      # No http health_check: App Platform's probe does not send the app
      # domain as Host, so Django would answer 400 DisallowedHost and fail
      # the deploy. The default TCP check applies; the workflow polls
      # /api/v1/health/ over the public URL instead.

      github {
        repo           = local.repo
        branch         = var.ref
        deploy_on_push = false
      }

      dynamic "env" {
        for_each = local.backend_env
        content {
          key   = env.value.key
          value = env.value.value
          type  = env.value.type
          scope = env.value.scope
        }
      }
    }

    service {
      name               = "fake-1c"
      source_dir         = "loadtest/fake_1c"
      dockerfile_path    = "loadtest/fake_1c/Dockerfile"
      instance_size_slug = var.instance_size
      instance_count     = 1
      http_port          = 8099

      github {
        repo           = local.repo
        branch         = var.ref
        deploy_on_push = false
      }
    }

    # Pre-deploy: the backend never serves a request against an unmigrated or
    # unseeded database.
    job {
      name               = "seed"
      kind               = "PRE_DEPLOY"
      source_dir         = "backend"
      environment_slug   = "python"
      instance_size_slug = var.instance_size
      run_command        = "python manage.py migrate --noinput && python manage.py seed_loadtest --password \"$LOADTEST_PASSWORD\" --web-service-url \"$FAKE_1C_URL\""

      github {
        repo           = local.repo
        branch         = var.ref
        deploy_on_push = false
      }

      dynamic "env" {
        for_each = local.seed_env
        content {
          key   = env.value.key
          value = env.value.value
          type  = env.value.type
          scope = env.value.scope
        }
      }
    }

    ingress {
      # Public so the failure scenario can reach /_control; the prefix is
      # trimmed before the request reaches the fake.
      rule {
        component {
          name = "fake-1c"
        }
        match {
          path {
            prefix = "/fake-1c"
          }
        }
      }

      rule {
        component {
          name = "backend"
        }
        match {
          path {
            prefix = "/"
          }
        }
      }
    }
  }
}
