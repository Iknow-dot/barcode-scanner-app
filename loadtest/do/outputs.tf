output "app_url" {
  value = trimsuffix(digitalocean_app.loadtest.live_url, "/")
}

output "fake_1c_control_url" {
  value = "${trimsuffix(digitalocean_app.loadtest.live_url, "/")}/fake-1c/_control"
}

output "django_secret_key" {
  value     = random_password.django_secret_key.result
  sensitive = true
}

output "loadtest_password" {
  value     = random_password.loadtest_password.result
  sensitive = true
}

output "database_password" {
  value     = digitalocean_database_cluster.loadtest.password
  sensitive = true
}
