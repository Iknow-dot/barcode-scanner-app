import os
from datetime import timedelta

class Config:
    """Base configuration class with general settings."""
    
    # General application settings
    SECRET_KEY = os.getenv('SECRET_KEY')  # Ensure to set this in your environment for production
    if not SECRET_KEY:
        raise ValueError("No SECRET_KEY set for Flask application. Set it in your environment variables.")
    
    SQLALCHEMY_DATABASE_URI = os.getenv('DATABASE_URL')  # Ensure this is set in the environment
    if not SQLALCHEMY_DATABASE_URI:
        raise ValueError("No DATABASE_URL set for SQLAlchemy. Set it in your environment variables.")
    
    SQLALCHEMY_TRACK_MODIFICATIONS = False  # Disable modification tracking for performance improvement
    
    # JWT Configuration
    JWT_SECRET_KEY = os.getenv('JWT_SECRET_KEY')  # Set this for encoding JWT tokens
    if not JWT_SECRET_KEY:
        raise ValueError("No JWT_SECRET_KEY set. Ensure it's securely set in your environment variables.")
    
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(minutes=int(os.getenv('JWT_ACCESS_TOKEN_EXPIRES', 30)))  # Default to 30 minutes
    JWT_REFRESH_TOKEN_EXPIRES = timedelta(days=int(os.getenv('JWT_REFRESH_TOKEN_EXPIRES', 7)))  # Default to 7 days
    
    # Security and session management
    SESSION_COOKIE_SECURE = True  # Enforce cookies to be sent over HTTPS
    SESSION_COOKIE_HTTPONLY = True  # Prevent JavaScript access to cookies
    SESSION_COOKIE_SAMESITE = 'Lax'  # Prevent CSRF attacks, can be set to 'Strict' for higher security
    REMEMBER_COOKIE_DURATION = timedelta(days=5)  # Duration for "Remember Me" functionality
    
    # Environment settings
    FLASK_ENV = os.getenv('FLASK_ENV', 'production')  # Default to 'production'
    DEBUG = os.getenv('DEBUG', 'False').lower() == 'true'  # Set debug mode based on environment variable
    
    @staticmethod
    def init_app(app):
        """Initialization method for configuring app-specific settings."""
        pass


class DevelopmentConfig(Config):
    """Development configuration."""
    
    DEBUG = True  # Enable debug mode in development
    SQLALCHEMY_ECHO = True  # Enable to see SQL queries in the logs
    SESSION_COOKIE_SECURE = False  # In development, HTTPS may not be used
    FLASK_ENV = 'development'  # Set environment explicitly for development

    @staticmethod
    def init_app(app):
        print("Development mode activated!")


class ProductionConfig(Config):
    """Production configuration."""
    
    DEBUG = False  # Disable debug mode in production
    SQLALCHEMY_ECHO = False  # Disable SQL query logging for better performance
    SESSION_COOKIE_SECURE = True  # Enforce HTTPS cookies in production
    
    @staticmethod
    def init_app(app):
        print("Production mode activated! Be sure to set SECRET_KEY and JWT_SECRET_KEY securely.")


class TestingConfig(Config):
    """Testing configuration."""
    
    TESTING = True  # Enable testing mode
    SQLALCHEMY_DATABASE_URI = 'sqlite:///:memory:'  # Use in-memory SQLite database for tests
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(minutes=5)  # Short token expiration during testing
    DEBUG = True  # Enable debug mode for testing
    
    @staticmethod
    def init_app(app):
        print("Testing mode activated!")


# Configuration mapping for environment-specific configurations
config_by_name = {
    'development': DevelopmentConfig,
    'production': ProductionConfig,
    'testing': TestingConfig
}
