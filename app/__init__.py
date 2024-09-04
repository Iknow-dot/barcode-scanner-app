# app/__init__.py
from flask import Flask
from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
from flask_login import LoginManager
from config import Config

db = SQLAlchemy()
migrate = Migrate()
login_manager = LoginManager()
login_manager.login_view = 'auth.login'  # Specify the login route for unauthorized access

def create_app():
    app = Flask(__name__)
    app.config.from_object(Config)
    
    db.init_app(app)
    migrate.init_app(app, db)
    login_manager.init_app(app)
    
    # Register the main routes blueprint
    from .routes import bp as routes_bp
    app.register_blueprint(routes_bp)
    
    # Register additional blueprints in an order that avoids conflicts
    from .views import auth, organization, warehouse, user_roles, user
    app.register_blueprint(auth.bp)
    app.register_blueprint(organization.bp)
    app.register_blueprint(warehouse.bp)
    app.register_blueprint(user_roles.bp)
    app.register_blueprint(user.bp)
    
    return app
