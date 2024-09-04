import os

class Config:
    SECRET_KEY = os.getenv('SECRET_KEY', 'your_secret_key')
    SQLALCHEMY_DATABASE_URI = os.getenv('DATABASE_URL', 'postgresql://postgres:Aa123456#@localhost:5432/barcode_scanner')
    SQLALCHEMY_TRACK_MODIFICATIONS = False