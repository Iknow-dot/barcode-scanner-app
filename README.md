# Barcode Scanner App


## Table of Contents
- [Overview](#overview)
- [Run the Application](#run-the-application)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)

## Overview

The **Barcode Scanner App** is a web application designed to manage warehouse stock and retrieve product details using barcode scanning. The application supports multiple organizations, warehouses, and user roles with secure authentication and role-based access control.


## Run the Application locally

**Pre-requisites**
- [Docker](https://docs.docker.com/)

**Steps**
1. Clone the repository:
   ```shell
    git clone
    cd barcode-scanner-app
    ```
2. Run docker-compose
   ```shell
   docker-compose up --build -d
   ```
3. Access the application at http://localhost:5000
4. Access the backend API at http://localhost:8080


## Features

- **Authentication & Authorization**:
  - User authentication with password hashing.
  - Role-based access control with system admin, admin, and user roles.
  - IP-based access restriction.

- **Organization & Warehouse Management**:
  - Register and manage multiple organizations and their respective warehouses.
  - Store and manage data in PostgreSQL.

- **Product Data Integration**:
  - Retrieve product details from an external web service using barcodes or article numbers.
  - Display product information based on the selected warehouse.

- **Barcode Scanning Functionality**:
  - Implemented "Start Scan" feature.
  - Filter and retrieve product data by barcode or article number.

- **API Development**:
  - RESTful API endpoints for managing organizations, warehouses, and users.
  - Secure access to product data via API.

## Tech Stack

- **Backend**: Python with Flask
- **Database**: PostgreSQL
- **Frontend (Optional)**: React
- **Version Control**: GitHub
- **ORM**: SQLAlchemy with Flask-Migrate

## Project Structure

```shell
barcode-scanner/
├── app/
│   ├── __init__.py 
│   ├── models.py
│   ├── routes.py
│   ├── views/
│   │   ├── __init__.py
│   │   ├── auth.py
│   │   ├── organization.py
│   │   ├── warehouse.py
│   │   ├── product.py
│   │   └── user.py
│   ├── templates/
│   │   ├── base.html
│   │   ├── index.html
│   │   ├── login.html
│   │   ├── dashboard.html
│   │   ├── add_organization.html
│   │   ├── add_user.html
│   │   ├── add_warehouse.html
│   │   └── scan_result.html
│   ├── static/
│   │   ├── css/
│   │   │   ├── style.css
│   │   └── js/
│   │       ├── main.js
│   └── config.py
├── migrations/
│   ├── versions/
│   │   ├── .gitkeep
│   └── alembic.ini
├── tests/
│   ├── __init__.py
│   ├── test_auth.py
│   ├── test_organization.py
│   ├── test_warehouse.py
│   ├── test_product.py
│   └── test_user.py
├── venv/
├── instance/
│   ├── config.py
├── requirements.txt
├── run.py
├── .env
├── .gitignore
├── README.md
└── Dockerfile (optional)
```

## Database Schema

Users Table
id (UUID, Primary Key): Unique identifier for each user.
username (VARCHAR, UNIQUE, NOT NULL): Username for login.
password_hash (VARCHAR, NOT NULL): Hashed password for secure authentication.
role_id (UUID, Foreign Key): Links to the user roles table.
organization_id (UUID, Foreign Key, Nullable): Links to the organization.
warehouse_id (UUID, Foreign Key, Nullable): Links to the warehouse.
ip_address (VARCHAR, NOT NULL): IP address for access control.

Organizations Table
id (UUID, Primary Key): Unique identifier for each organization.
name (VARCHAR, NOT NULL): Name of the organization.
identification_code (VARCHAR, UNIQUE, NOT NULL): Unique code for the organization.
web_service_url (VARCHAR, NOT NULL): URL of the external service for product data.

Warehouses Table
id (UUID, Primary Key): Unique identifier for each warehouse.
organization_id (UUID, Foreign Key, NOT NULL): Links to the organization.
name (VARCHAR, NOT NULL): Name of the warehouse.
location (VARCHAR, Nullable): Location of the warehouse.

User Roles Table
id (UUID, Primary Key): Unique identifier for each role.
role_name (VARCHAR, UNIQUE, NOT NULL): Name of the role (e.g., system_admin, admin, user).

### License
This project is licensed under the MIT License.
