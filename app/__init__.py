# app/__init__.py
from flask import Flask
from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate

db = SQLAlchemy()
migrate = Migrate()

def create_app():
    app = Flask(__name__)
    app.config.from_object('config.Config')
    
    db.init_app(app)
    migrate.init_app(app, db)
    
    # Register the routes blueprint
    from .routes import bp as routes_bp
    app.register_blueprint(routes_bp)
    
    # Register additional blueprints
    from .views import auth, organization, warehouse, user_roles, user
    app.register_blueprint(auth.bp)
    app.register_blueprint(organization.bp)
    app.register_blueprint(warehouse.bp)
    app.register_blueprint(user_roles.bp)
    app.register_blueprint(user.bp)
    
    return app
