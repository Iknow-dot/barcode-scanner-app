from app import db
from sqlalchemy.dialects.postgresql import UUID
import uuid
from werkzeug.security import generate_password_hash, check_password_hash

class User(db.Model):
    __tablename__ = 'users'
    
    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    username = db.Column(db.String(100), unique=True, nullable=False)
    password_hash = db.Column(db.String(128), nullable=False)
    role_id = db.Column(UUID(as_uuid=True), db.ForeignKey('user_roles.id'), nullable=False)
    organization_id = db.Column(UUID(as_uuid=True), db.ForeignKey('organizations.id'), nullable=True)
    warehouse_id = db.Column(UUID(as_uuid=True), db.ForeignKey('warehouses.id'), nullable=True)
    ip_address = db.Column(db.String(45), nullable=False)

    role = db.relationship('UserRole', back_populates='users')
    organization = db.relationship('Organization', back_populates='users')
    warehouse = db.relationship('Warehouse', back_populates='users')

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

class Organization(db.Model):
    __tablename__ = 'organizations'
    
    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = db.Column(db.String(100), nullable=False)
    identification_code = db.Column(db.String(50), unique=True, nullable=False)
    web_service_url = db.Column(db.String(255), nullable=False)
    
    users = db.relationship('User', back_populates='organization')
    warehouses = db.relationship('Warehouse', back_populates='organization')

class Warehouse(db.Model):
    __tablename__ = 'warehouses'
    
    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id = db.Column(UUID(as_uuid=True), db.ForeignKey('organizations.id'), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    location = db.Column(db.String(255), nullable=True)
    
    organization = db.relationship('Organization', back_populates='warehouses')
    users = db.relationship('User', back_populates='warehouse')

class UserRole(db.Model):
    __tablename__ = 'user_roles'

    id = db.Column(db.UUID(as_uuid=True), primary_key=True)
    role_name = db.Column(db.String(100), unique=True, nullable=False)

    users = db.relationship('User', back_populates='role')