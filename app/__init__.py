from flask import Flask, send_from_directory, jsonify
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
    app = Flask(__name__, static_folder='../barcode-scanner-frontend/build', static_url_path='/')

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
    from app.auth.views import bp as auth_bp
    from .views import (
        organization,
        warehouse,
        user_roles,
        user,
        product,
        user_warehouse
    )
    app.register_blueprint(auth_bp, url_prefix='/auth')
    app.register_blueprint(organization.bp, url_prefix='/organizations')
    app.register_blueprint(warehouse.bp, url_prefix='/warehouses')
    app.register_blueprint(user_roles.bp, url_prefix='/roles')
    app.register_blueprint(user.bp, url_prefix='/users')
    app.register_blueprint(product.product_bp, url_prefix='/products')
    app.register_blueprint(user_warehouse.user_warehouse_bp, url_prefix='/user-warehouses')

    # Route to serve the React frontend
    @app.route('/', defaults={'path': ''})
    @app.route('/<path:path>')
    def serve_react(path):
        if path != "" and os.path.exists(app.static_folder + '/' + path):
            return send_from_directory(app.static_folder, path)
        else:
            return send_from_directory(app.static_folder, 'index.html')

    return app
