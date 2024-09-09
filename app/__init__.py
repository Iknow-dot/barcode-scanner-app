from flask import Flask
from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
from flask_login import LoginManager
from dotenv import load_dotenv
import os

# Load environment variables from .env file
load_dotenv()

# Initialize extensions
db = SQLAlchemy()
migrate = Migrate()
login_manager = LoginManager()
login_manager.login_view = 'auth.login'

def create_app():
    # Create the Flask app instance
    app = Flask(__name__)
    app.config.from_object('config.Config')  # Load configuration from config.py

    # Initialize extensions with the app
    db.init_app(app)
    migrate.init_app(app, db)
    login_manager.init_app(app)

    # Register blueprints
    from .routes import bp as routes_bp
    app.register_blueprint(routes_bp)

    from .views import auth, organization, warehouse, user_roles, user
    app.register_blueprint(auth.bp)
    app.register_blueprint(organization.bp)
    app.register_blueprint(warehouse.bp)
    app.register_blueprint(user_roles.bp)
    app.register_blueprint(user.bp)

    return app
