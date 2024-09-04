# Barcode Scanner App

## Overview

The **Barcode Scanner App** is a web application designed to manage warehouse stock and retrieve product details using barcode scanning. The application supports multiple organizations, warehouses, and user roles with secure authentication and role-based access control.

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

```plaintext
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

# Database Schema

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

Installation & Setup

Clone the Repository:
git clone https://github.com/your-username/barcode-scanner-app.git
cd barcode-scanner-app

Set Up Virtual Environment:
python3 -m venv venv
source venv/bin/activate  # On Windows use `venv\Scripts\activate`

Set Up Virtual Environment:
python3 -m venv venv
source venv/bin/activate  # On Windows use `venv\Scripts\activate`


Install Dependencies:
pip install -r requirements.txt

Set Up Database:

Make sure PostgreSQL is installed and running.
Create a database for the app.
Set up environment variables for database access in a .env file.

Apply Migrations:
flask db upgrade

Run the Application:
flask run

Usage
Visit http://127.0.0.1:5000 in your browser.
Use Postman or similar tools to test API endpoints.
Admin can manage organizations, warehouses, and users through provided endpoints.

Security Considerations
Passwords are hashed using industry-standard algorithms.
HTTPS should be enabled in production.
Strong password policies are enforced.
IP-based access control ensures that users can only log in from authorized IPs.

Future Enhancements
Frontend Development: Build a React-based frontend for a more interactive user experience.
Additional Product Data Integration: Implement real-time integration with more external web services.
Advanced Reporting: Add advanced reporting features for inventory management.

Contributing
Contributions are welcome! Please submit a pull request or open an issue to discuss your ideas.

icense
This project is licensed under the MIT License.


### Key Updates:
- **Overview**: Provides a clear summary of the application’s purpose and features.
- **Features**: Lists the key features currently implemented in the application.
- **Tech Stack**: Specifies the technologies used.
- **Project Structure**: Updated to reflect your project’s current organization.
- **Database Schema**: Updated to include the current structure of your database tables.
- **Installation & Setup**: Provides a step-by-step guide to setting up the application.
- **Usage**: Explains how to access and interact with the application.
- **Security Considerations**: Highlights important security practices in the application.
- **Future Enhancements**: Mentions potential areas for further development.
- **Contributing**: Encourages contributions from the community.

This `README.md` should give users a clear understanding of your application and how to get started with it.

