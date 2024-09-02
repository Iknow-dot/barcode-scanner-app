# app/models.py
import uuid
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy.dialects.postgresql import UUID
from . import db

class Organization(db.Model):
    __tablename__ = 'organizations'
    
    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = db.Column(db.String(255), nullable=False)
    identification_code = db.Column(db.String(100), unique=True, nullable=False)
    web_service_address = db.Column(db.String(255), nullable=False)
    
    warehouses = db.relationship('Warehouse', backref='organization', lazy=True)
    users = db.relationship('User', backref='organization', lazy=True)

class Warehouse(db.Model):
    __tablename__ = 'warehouses'
    
    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id = db.Column(UUID(as_uuid=True), db.ForeignKey('organizations.id'), nullable=False)
    name = db.Column(db.String(255), nullable=False)
    location = db.Column(db.String(255), nullable=True)
    
    stocks = db.relationship('Stock', backref='warehouse', lazy=True)
    users = db.relationship('User', backref='warehouse', lazy=True)

class User(db.Model):
    __tablename__ = 'users'
    
    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id = db.Column(UUID(as_uuid=True), db.ForeignKey('organizations.id'), nullable=False)
    username = db.Column(db.String(255), unique=True, nullable=False)
    password = db.Column(db.String(255), nullable=False)  # Store hashed passwords
    role = db.Column(db.Enum('System Admin', 'Admin', 'User', name='user_roles'), nullable=False)
    warehouse_id = db.Column(UUID(as_uuid=True), db.ForeignKey('warehouses.id'), nullable=True)
    ip_address = db.Column(db.String(100), nullable=True)

class Stock(db.Model):
    __tablename__ = 'stock'
    
    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    warehouse_id = db.Column(UUID(as_uuid=True), db.ForeignKey('warehouses.id'), nullable=False)
    barcode = db.Column(db.String(100), nullable=False)
    quantity = db.Column(db.Integer, nullable=False)
    price = db.Column(db.Numeric(10, 2), nullable=False)
