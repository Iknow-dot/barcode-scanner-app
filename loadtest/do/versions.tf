terraform {
  required_version = ">= 1.16.0"

  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

# Reads DIGITALOCEAN_TOKEN from the environment.
provider "digitalocean" {}
