import os
from datetime import timedelta
import logging
from logging.handlers import RotatingFileHandler

class Config:
    """Base configuration class with general settings."""
    
    SECRET_KEY = os.getenv('SECRET_KEY')
    if not SECRET_KEY:
        raise ValueError("No SECRET_KEY set for Flask application. Set it in your environment variables.")
    
    POSTGRES_USER = os.getenv('POSTGRES_USER', 'postgres')
    POSTGRES_PASSWORD = os.getenv('POSTGRES_PASSWORD', 'Aa123456#')
    POSTGRES_DB = os.getenv('POSTGRES_DB', 'Barcode_Scanner')
    POSTGRES_HOST = os.getenv('POSTGRES_HOST', 'localhost')
    POSTGRES_PORT = os.getenv('POSTGRES_PORT', 5432)
    SQLALCHEMY_DATABASE_URI = os.getenv('DATABASE_URL') or f'postgresql://{POSTGRES_USER}:{POSTGRES_PASSWORD}@{POSTGRES_HOST}:{POSTGRES_PORT}/{POSTGRES_DB}'
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    
    JWT_SECRET_KEY = os.getenv('JWT_SECRET_KEY')
    REFRESH_JWT_SECRET_KEY = os.getenv('REFRESH_JWT_SECRET_KEY')
    if not JWT_SECRET_KEY:
        raise ValueError("No JWT_SECRET_KEY set. Ensure it's securely set in your environment variables.")
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(minutes=int(os.getenv('JWT_ACCESS_TOKEN_EXPIRES', 240)))
    JWT_REFRESH_TOKEN_EXPIRES = timedelta(days=int(os.getenv('JWT_REFRESH_TOKEN_EXPIRES', 7)))
    
    SESSION_COOKIE_SECURE = True
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = 'Lax'
    REMEMBER_COOKIE_DURATION = timedelta(days=5)
    
    FLASK_ENV = os.getenv('FLASK_ENV', 'production')
    DEBUG = os.getenv('DEBUG', 'False').lower() in ['true', '1', 't']
    
    @staticmethod
    def init_app(app):
        stream_handler = logging.StreamHandler()
        stream_handler.setLevel(logging.DEBUG)
        app.logger.addHandler(stream_handler)
        if not app.debug:
            file_handler = RotatingFileHandler('instance/flask_app.log', maxBytes=10240, backupCount=10)
            file_handler.setFormatter(logging.Formatter(
                '%(asctime)s %(levelname)s: %(message)s '
                '[in %(pathname)s:%(lineno)d]'
            ))
            file_handler.setLevel(logging.INFO)

            app.logger.addHandler(file_handler)

        app.logger.info('Application startup')

class DevelopmentConfig(Config):
    DEBUG = True
    SQLALCHEMY_ECHO = True
    SESSION_COOKIE_SECURE = True
    FLASK_ENV = 'development'

    @staticmethod
    def init_app(app):
        print("Development mode activated!")
        super().init_app(app)

class ProductionConfig(Config):
    DEBUG = False
    SQLALCHEMY_ECHO = True
    SESSION_COOKIE_SECURE = True

    @staticmethod
    def init_app(app):
        print("Production mode activated!")
        super().init_app(app)

class TestingConfig(Config):
    TESTING = True
    SQLALCHEMY_DATABASE_URI = 'sqlite:///:memory:'
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(minutes=5)
    DEBUG = True

    @staticmethod
    def init_app(app):
        print("Testing mode activated!")
        super().init_app(app)

config_by_name = {
    'development': DevelopmentConfig,
    'production': ProductionConfig,
    'testing': TestingConfig
}
