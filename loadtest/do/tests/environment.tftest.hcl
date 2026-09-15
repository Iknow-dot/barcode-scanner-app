# Offline: the DigitalOcean provider is mocked, so these runs need no token
# and create nothing. random is real, so generated secrets are real values.
# Every run applies (against the mock) because the env set holds values that
# are unknown until random has produced them.

mock_provider "digitalocean" {}

variables {
  ref = "some-feature-branch"
}

run "app_and_database_names_match_the_sweeper" {
  assert {
    condition     = digitalocean_app.loadtest.spec[0].name == "loadtest-app"
    error_message = "The app must be named loadtest-app: loadtest/do/sweep.py deletes by that exact name."
  }

  assert {
    condition     = digitalocean_database_cluster.loadtest.name == "loadtest-db"
    error_message = "The cluster must be named loadtest-db: loadtest/do/sweep.py deletes by that exact name."
  }
}

run "backend_mirrors_the_live_service" {
  assert {
    condition     = digitalocean_app.loadtest.spec[0].region == "fra"
    error_message = "The app must run in fra, like live."
  }

  assert {
    condition     = contains(digitalocean_app.loadtest.spec[0].features, "buildpack-stack=ubuntu-22")
    error_message = "The app must build on the live app's buildpack stack, ubuntu-22."
  }

  assert {
    condition     = one([for s in digitalocean_app.loadtest.spec[0].service : s.run_command if s.name == "backend"]) == "gunicorn --worker-tmp-dir /dev/shm --worker-class gthread --workers 2 --threads 4 backend.wsgi"
    error_message = "By default the backend must run the live run_command byte for byte."
  }

  assert {
    condition     = one([for s in digitalocean_app.loadtest.spec[0].service : s.source_dir if s.name == "backend"]) == "backend"
    error_message = "The backend builds from backend/, like live."
  }

  assert {
    condition     = one([for s in digitalocean_app.loadtest.spec[0].service : s.environment_slug if s.name == "backend"]) == "python"
    error_message = "The backend must use the Python buildpack, like live."
  }

  assert {
    condition     = one([for s in digitalocean_app.loadtest.spec[0].service : s.instance_size_slug if s.name == "backend"]) == "apps-s-1vcpu-0.5gb"
    error_message = "The backend must run on apps-s-1vcpu-0.5gb, like live."
  }

  assert {
    condition     = one([for s in digitalocean_app.loadtest.spec[0].service : s.instance_count if s.name == "backend"]) == 1
    error_message = "The backend must run exactly one instance, like live."
  }

  assert {
    condition     = one([for s in digitalocean_app.loadtest.spec[0].service : s.github[0].branch if s.name == "backend"]) == "some-feature-branch"
    error_message = "The backend must build var.ref."
  }

  assert {
    condition     = one([for s in digitalocean_app.loadtest.spec[0].service : s.github[0].deploy_on_push if s.name == "backend"]) == false
    error_message = "A push must never redeploy the load-test copy mid-run."
  }
}

run "run_command_is_overridable" {
  variables {
    run_command = "gunicorn --worker-tmp-dir /dev/shm backend.wsgi"
  }

  assert {
    condition     = one([for s in digitalocean_app.loadtest.spec[0].service : s.run_command if s.name == "backend"]) == "gunicorn --worker-tmp-dir /dev/shm backend.wsgi"
    error_message = "var.run_command must reach the backend service."
  }
}

run "backend_settings" {
  assert {
    condition = nonsensitive(
      { for e in one([for s in digitalocean_app.loadtest.spec[0].service : s if s.name == "backend"]).env : e.key => e.value if e.type == "GENERAL" }
      == {
        DATABASE_URL         = "$${db.DATABASE_URL}"
        ALLOWED_HOSTS        = "$${APP_DOMAIN}"
        DEBUG                = "True"
        DATABASE_SSL_REQUIRE = "True"
        PERF_HEADERS_ENABLED = "True"
        LOG_LEVEL            = "WARNING"
      }
    )
    error_message = "The backend's plain settings drifted from the design."
  }

  assert {
    condition = nonsensitive(
      toset([for e in one([for s in digitalocean_app.loadtest.spec[0].service : s if s.name == "backend"]).env : e.key if e.type == "SECRET"])
      == toset(["DJANGO_SECRET_KEY", "FERNET_KEY"])
    )
    error_message = "DJANGO_SECRET_KEY and FERNET_KEY must be SECRET-typed, and nothing else."
  }

  assert {
    condition = nonsensitive(can(regex(
      "^[A-Za-z0-9_-]{43}=$",
      one([for e in one([for s in digitalocean_app.loadtest.spec[0].service : s if s.name == "backend"]).env : e.value if e.key == "FERNET_KEY"])
    )))
    error_message = "FERNET_KEY must be 32 bytes of URL-safe base64, or cryptography.Fernet rejects it."
  }

  assert {
    condition = nonsensitive(
      { for e in one([for s in digitalocean_app.loadtest.spec[0].service : s if s.name == "backend"]).env : e.key => e.scope }
      == {
        DJANGO_SECRET_KEY    = "RUN_AND_BUILD_TIME"
        FERNET_KEY           = "RUN_AND_BUILD_TIME"
        DATABASE_URL         = "RUN_TIME"
        ALLOWED_HOSTS        = "RUN_AND_BUILD_TIME"
        DEBUG                = "RUN_AND_BUILD_TIME"
        DATABASE_SSL_REQUIRE = "RUN_AND_BUILD_TIME"
        PERF_HEADERS_ENABLED = "RUN_AND_BUILD_TIME"
        LOG_LEVEL            = "RUN_AND_BUILD_TIME"
      }
    )
    error_message = "DATABASE_URL must be RUN_TIME: unresolved at build time, the buildpack's automatic collectstatic imports settings and dj_database_url raises on the literal '$${db.DATABASE_URL}'. Every other backend env var must stay RUN_AND_BUILD_TIME."
  }
}

run "database_matches_live" {
  assert {
    condition     = digitalocean_database_cluster.loadtest.size == "db-s-1vcpu-1gb" && digitalocean_database_cluster.loadtest.node_count == 1
    error_message = "The cluster must match live: db-s-1vcpu-1gb, one node."
  }

  assert {
    condition     = digitalocean_database_cluster.loadtest.engine == "pg" && digitalocean_database_cluster.loadtest.region == "fra1"
    error_message = "The cluster must be Postgres in fra1."
  }

  assert {
    condition     = digitalocean_app.loadtest.spec[0].database[0].cluster_name == "loadtest-db" && digitalocean_app.loadtest.spec[0].database[0].production == true
    error_message = "The app must attach loadtest-db as a production database, which binds DATABASE_URL and trusts the app."
  }

  assert {
    condition     = digitalocean_app.loadtest.spec[0].database[0].name == "db"
    error_message = "The database component must be named db: DATABASE_URL binds $${db.DATABASE_URL}."
  }
}

run "seed_job_migrates_then_seeds_against_the_fake" {
  assert {
    condition     = digitalocean_app.loadtest.spec[0].job[0].name == "seed" && digitalocean_app.loadtest.spec[0].job[0].kind == "PRE_DEPLOY"
    error_message = "Seeding must be a PRE_DEPLOY job named seed."
  }

  assert {
    condition     = startswith(digitalocean_app.loadtest.spec[0].job[0].run_command, "python manage.py migrate --noinput && python manage.py seed_loadtest ")
    error_message = "The seed job must migrate before seeding."
  }

  assert {
    condition = nonsensitive(
      { for e in digitalocean_app.loadtest.spec[0].job[0].env : e.key => e.type }
      == merge(
        { for e in one([for s in digitalocean_app.loadtest.spec[0].service : s if s.name == "backend"]).env : e.key => e.type },
        { LOADTEST_PASSWORD = "SECRET", FAKE_1C_URL = "GENERAL" },
      )
    )
    error_message = "The seed job must carry every backend setting plus LOADTEST_PASSWORD (SECRET) and FAKE_1C_URL."
  }

  assert {
    condition     = nonsensitive(one([for e in digitalocean_app.loadtest.spec[0].job[0].env : e.value if e.key == "FAKE_1C_URL"])) == "$${fake-1c.PRIVATE_URL}"
    error_message = "The seeded org must call the fake 1C over the app's private network."
  }

  assert {
    condition     = nonsensitive(one([for e in digitalocean_app.loadtest.spec[0].job[0].env : e.scope if e.key == "DATABASE_URL"])) == "RUN_TIME"
    error_message = "The seed job's DATABASE_URL must also be RUN_TIME, for the same reason as the backend service's."
  }
}

run "fake_1c_is_built_and_routed" {
  assert {
    condition     = one([for s in digitalocean_app.loadtest.spec[0].service : s.dockerfile_path if s.name == "fake-1c"]) == "loadtest/fake_1c/Dockerfile"
    error_message = "fake-1c must build from loadtest/fake_1c/Dockerfile."
  }

  assert {
    condition     = one([for s in digitalocean_app.loadtest.spec[0].service : s.http_port if s.name == "fake-1c"]) == 8099
    error_message = "fake-1c must listen on 8099."
  }

  assert {
    condition = {
      for r in digitalocean_app.loadtest.spec[0].ingress[0].rule : r.match[0].path[0].prefix => r.component[0].name
    } == { "/fake-1c" = "fake-1c", "/" = "backend" }
    error_message = "Ingress must send /fake-1c to the fake and everything else to the backend."
  }
}

run "outputs" {
  assert {
    condition     = endswith(output.fake_1c_control_url, "/fake-1c/_control")
    error_message = "The control URL must point at the fake's /_control through its /fake-1c route."
  }

  assert {
    condition     = length(nonsensitive(output.django_secret_key)) == 50
    error_message = "DJANGO_SECRET_KEY must be 50 characters."
  }

  assert {
    condition     = length(nonsensitive(output.database_password)) > 0
    error_message = "database_password must be a non-empty sensitive output: the workflow masks it with ::add-mask:: before ever printing it."
  }
}
