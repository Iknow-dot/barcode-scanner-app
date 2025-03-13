from app import create_app, db
from flask_migrate import Migrate
from flask.cli import FlaskGroup
from flask_cors import CORS  # Import Flask-CORS

# Create an app instance
app = create_app()

# Enable CORS for the app (allowing requests from different origins)
cors = CORS(app, resources={r"/*": {"origins": "*"}})
# Initialize Migrate with app and db
migrate = Migrate(app, db)

# Create a CLI context using FlaskGroup for app management
cli = FlaskGroup(create_app=create_app)


with app.app_context():
    import commands
    commands.register_commands()

if __name__ == "__main__":
    cli()  # Use the Flask CLI to expose commands