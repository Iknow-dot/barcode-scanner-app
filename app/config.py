# config.py
import os

class Config:
    SQLALCHEMY_DATABASE_URI = os.getenv(
        'DATABASE_URL', 'postgresql://postgres:Aa123456#@localhost:5432/barcode_scanner'
    )
    SQLALCHEMY_TRACK_MODIFICATIONS = False
