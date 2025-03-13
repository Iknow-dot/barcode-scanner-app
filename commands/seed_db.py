from flask import current_app as app
from app.models import db, User, UserRole


@app.cli.command("seed-db")
def seed_db():
    """Populate the database with initial data."""
    roles = [
        "system_admin",
        "admin",
        "user"
    ]

    if UserRole.query.first():
        print("Database already seeded.")
        return
    for role in roles:
        db.session.add(UserRole(role_name=role))

    db.session.commit()

    print("Database seeded successfully!")
