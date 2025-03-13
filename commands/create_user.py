from getpass import getpass
import click
from flask import current_app as app

@app.cli.command("create-user")
def create_user():
    """Create an admin user."""
    from app.models import User, UserRole
    from app import db

    print("Select Role:")
    roles = UserRole.query.all()
    for role in roles:
        print(f"{role.id}: {role.role_name}")


    while True:
        role_name = input("Enter role name: ")
        role = UserRole.query.filter_by(role_name=role_name).first()

        if role:
            break

        print(f"Role '{role_name}' does not exist.")

    while True:
        username = input("Enter username: ")

        if not User.query.filter_by(username=username).first():
            break

        print(f"Username '{username}' already exists. Please try again.")


    while True:
        password = getpass("Enter password: ")
        password_confirm = getpass("Confirm password: ")
        if password == password_confirm:
            break

        print("Passwords do not match. Please try again.")

    user = User(username=username, role_id=role.id)
    user.set_password(password)
    db.session.add(user)
    db.session.commit()
    click.echo(f"Admin user '{username}' created successfully.")
