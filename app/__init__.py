from flask import Flask
from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
from flask_login import LoginManager
from flask_jwt_extended import JWTManager
from dotenv import load_dotenv
import os

# Load environment variables from the .env file
load_dotenv()

# Initialize extensions
db = SQLAlchemy()
migrate = Migrate()
login_manager = LoginManager()
login_manager.login_view = 'auth.login'  # Redirect users to login if not authenticated
jwt = JWTManager()  # Initialize JWT Manager

def create_app():
    # Create the Flask app instance
    app = Flask(__name__)

    # Load configuration from config.py based on the environment
    env = os.getenv('FLASK_ENV', 'development')  # Default to 'development' if not set
    if env == 'production':
        app.config.from_object('config.ProductionConfig')
    elif env == 'development':
        app.config.from_object('config.DevelopmentConfig')
    elif env == 'testing':
        app.config.from_object('config.TestingConfig')
    else:
        raise ValueError(f"Unknown FLASK_ENV: {env}")

    # Initialize extensions with the app
    db.init_app(app)
    migrate.init_app(app, db)
    login_manager.init_app(app)
    jwt.init_app(app)

    # Register blueprints
    from .routes import bp as routes_bp
    app.register_blueprint(routes_bp)

    # Import and register views (blueprints)
    from .views import auth, organization, warehouse, user_roles, user
    app.register_blueprint(auth.bp, url_prefix='/auth')
    app.register_blueprint(organization.bp, url_prefix='/organization')
    app.register_blueprint(warehouse.bp, url_prefix='/warehouse')
    app.register_blueprint(user_roles.bp, url_prefix='/roles')
    app.register_blueprint(user.bp, url_prefix='/user')

    return app
