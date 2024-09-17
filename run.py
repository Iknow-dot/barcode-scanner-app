from app import create_app, db
from flask_migrate import Migrate
from flask.cli import FlaskGroup

# Create an app instance
app = create_app()

# Initialize Migrate with app and db
migrate = Migrate(app, db)

# Create a CLI context using FlaskGroup for app management
cli = FlaskGroup(create_app=create_app)

if __name__ == "__main__":
    cli()  # Use the Flask CLI to expose commands
