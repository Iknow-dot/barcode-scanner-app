from app import db
from sqlalchemy.dialects.postgresql import UUID
import uuid
from werkzeug.security import generate_password_hash, check_password_hash
from flask_login import UserMixin
import jwt
from datetime import datetime, timedelta, timezone
from flask import current_app
from cryptography.fernet import Fernet
import os

class User(db.Model, UserMixin):
    __tablename__ = 'users'
    
    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    username = db.Column(db.String(100), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    role_id = db.Column(UUID(as_uuid=True), db.ForeignKey('user_roles.id'), nullable=False)
    organization_id = db.Column(UUID(as_uuid=True), db.ForeignKey('organizations.id'), nullable=True)
    warehouse_id = db.Column(UUID(as_uuid=True), db.ForeignKey('warehouses.id'), nullable=True)
    ip_address = db.Column(db.String(45), nullable=False)

    role = db.relationship('UserRole', back_populates='users')
    organization = db.relationship('Organization', back_populates='users')
    warehouse = db.relationship('Warehouse', back_populates='users')
    allowed_ips = db.relationship('AllowedIP', backref='user', cascade="all, delete-orphan")

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

    def is_admin(self):
        return self.role.role_name == 'admin'

    def is_system_admin(self):
        return self.role.role_name == 'system_admin'
    
    def has_role(self, role_name):
        return self.role.role_name == role_name
    
    def generate_jwt_token(self):
        """
        Generates a JWT token using the configured expiration time.
        """
        expires_in = current_app.config.get('JWT_ACCESS_TOKEN_EXPIRES', 60)  # Default to 60 minutes
        exp = datetime.now(timezone.utc) + timedelta(minutes=expires_in)
        payload = {
            'user_id': str(self.id),
            'exp': exp,
            'iat': datetime.now(timezone.utc)
        }
        token = jwt.encode(payload, current_app.config['JWT_SECRET_KEY'], algorithm='HS256')
        return token

    @staticmethod
    def verify_jwt_token(token):
        """
        Verifies the JWT token and returns the user ID if valid.
        """
        try:
            payload = jwt.decode(token, current_app.config['JWT_SECRET_KEY'], algorithms=['HS256'])
            return payload.get('user_id')  # Get user_id from payload
        except jwt.ExpiredSignatureError:
            return None  # Token has expired
        except jwt.InvalidTokenError:
            return None  # Token is invalid

    def is_ip_allowed(self, ip_address):
        """
        Checks if the given IP address is allowed for this user.
        """
        return any(ip.ip_address == ip_address for ip in self.allowed_ips)

class Organization(db.Model):
    __tablename__ = 'organizations'
    
    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = db.Column(db.String(100), nullable=False)
    identification_code = db.Column(db.String(50), unique=True, nullable=False)
    web_service_url = db.Column(db.String(255), nullable=False)
    org_username = db.Column(db.String(255), nullable=True)  # Optional if not all organizations use external services
    org_password = db.Column(db.String(255), nullable=True)  # Optional if not all organizations use external services
    employees_count = db.Column(db.Integer, nullable=False)  # Mandatory field

    users = db.relationship('User', back_populates='organization', cascade="all, delete-orphan")
    warehouses = db.relationship('Warehouse', back_populates='organization', cascade="all, delete-orphan")
    
    def encrypt_password(self, password):
        key = os.getenv('FERNET_KEY')  # Fetch the Fernet key from environment variables
        if not key:
            raise ValueError("FERNET_KEY is not set or is invalid")
        cipher_suite = Fernet(key)
        self.org_password = cipher_suite.encrypt(password.encode()).decode()

    def decrypt_password(self):
        key = os.getenv('FERNET_KEY')  # Fetch the Fernet key from environment variables
        if not key:
            raise ValueError("FERNET_KEY is not set or is invalid")
        cipher_suite = Fernet(key)
        decrypted_password = cipher_suite.decrypt(self.org_password.encode())
        return decrypted_password.decode() 

    def set_password(self, password):
        self.org_password = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.org_password, password)
    
    

    def to_dict(self):
        return {
            'id': str(self.id),  # Convert UUID to string for JSON serialization
            'name': self.name,
            'identification_code': self.identification_code,
            'web_service_url': self.web_service_url,
            'org_username': self.org_username,
            # Exclude 'org_password' for security
            'employees_count': self.employees_count
        }
    
class Warehouse(db.Model):
    __tablename__ = 'warehouses'
    
    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id = db.Column(UUID(as_uuid=True), db.ForeignKey('organizations.id'), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    code = db.Column(db.String(255), nullable=False, unique=True)
    
    organization = db.relationship('Organization', back_populates='warehouses')
    users = db.relationship('User', back_populates='warehouse', cascade="all, delete-orphan")

    def to_dict(self):
        return {
            'id': str(self.id),
            'organization_id': str(self.organization_id),
            'name': self.name,
            'code': self.code
        }

class UserRole(db.Model):
    __tablename__ = 'user_roles'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    role_name = db.Column(db.String(100), unique=True, nullable=False)

    users = db.relationship('User', back_populates='role')

    def to_dict(self):
        return {
            'id': str(self.id),
            'role_name': self.role_name
        }

class AllowedIP(db.Model):
    __tablename__ = 'allowed_ips'

    id = db.Column(db.Integer, primary_key=True)
    ip_address = db.Column(db.String(45), nullable=False)  # supports both IPv4 and IPv6 addresses
    user_id = db.Column(UUID(as_uuid=True), db.ForeignKey('users.id'), nullable=False)

    def __repr__(self):
        return f"<AllowedIP {self.ip_address}>"

    def to_dict(self):
        return {
            'id': self.id,
            'ip_address': self.ip_address
        }



class UserWarehouse(db.Model):
    __tablename__ = 'user_warehouses'
    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = db.Column(UUID(as_uuid=True), db.ForeignKey('users.id'), nullable=False)
    warehouse_id = db.Column(UUID(as_uuid=True), db.ForeignKey('warehouses.id'), nullable=False)
