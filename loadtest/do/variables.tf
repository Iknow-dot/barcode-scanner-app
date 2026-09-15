variable "ref" {
  description = "Branch App Platform builds the backend and fake 1C from. Must exist on GitHub."
  type        = string
  default     = "djangoRewrite"
}

variable "run_command" {
  description = "Backend run command. The default is byte-for-byte the live app's."
  type        = string
  default     = "gunicorn --worker-tmp-dir /dev/shm --worker-class gthread --workers 2 --threads 4 backend.wsgi"
}

variable "debug" {
  description = "DEBUG for the backend. Mirrors live (True as of 2026-09-09); with False, SECURE_SSL_REDIRECT defaults to True."
  type        = string
  default     = "True"
}

variable "instance_size" {
  description = "App Platform instance size for every component. Matches live."
  type        = string
  default     = "apps-s-1vcpu-0.5gb"
}

variable "db_size" {
  description = "Managed Postgres size. Matches live (1 vCPU, 1 GB, confirmed 2026-09-15)."
  type        = string
  default     = "db-s-1vcpu-1gb"
}

variable "db_version" {
  description = "Postgres major version."
  type        = string
  default     = "17"
}
