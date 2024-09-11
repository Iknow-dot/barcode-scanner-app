from flask import Blueprint, request, jsonify, current_app
from werkzeug.security import generate_password_hash, check_password_hash
from flask_login import LoginManager, login_user, logout_user, current_user
from app import db, login_manager
from app.models import User, UserRole
import jwt
from datetime import datetime, timedelta, timezone
import re  # For password validation
from ipaddress import ip_address, AddressValueError  # For IP validation

bp = Blueprint('auth', __name__)

@login_manager.user_loader
def load_user(user_id):
    return User.query.get(user_id)  # Ensure user_id matches the type used in your database

# Utility function to generate JWT token
def generate_jwt(user):
    expires_in = current_app.config['JWT_ACCESS_TOKEN_EXPIRES']
    
    if isinstance(expires_in, timedelta):
        expires_in = expires_in.total_seconds() / 60  # Convert timedelta to minutes
    
    exp = datetime.now(timezone.utc) + timedelta(minutes=int(expires_in))
    
    token = jwt.encode({
        'sub': str(user.id),
        'exp': exp
    }, current_app.config['JWT_SECRET_KEY'], algorithm='HS256')
    
    return token

# Password validation function
def is_password_strong(password):
    if len(password) < 8:
        return False
    if not re.search(r"[A-Za-z]", password):  # At least one letter
        return False
    if not re.search(r"\d", password):  # At least one number
        return False
    if not re.search(r"[!@#$%^&*(),.?\":{}|<>]", password):  # At least one special character
        return False
    return True

# IP address validation
def is_valid_ip(ip):
    try:
        ip_address(ip)
        return True
    except AddressValueError:
        return False

@bp.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    username = data.get('username')
    password = data.get('password')
    ip_address = data.get('ip_address')
    role_name = data.get('role_name')

    # Check required fields
    if not username or not password or not ip_address or not role_name:
        return jsonify({"error": "Username, password, IP address, and role are required"}), 400

    # Validate password strength
    if not is_password_strong(password):
        return jsonify({"error": "Password must be at least 8 characters long, contain letters, numbers, and special characters"}), 400

    # Validate IP address
    if not is_valid_ip(ip_address):
        return jsonify({"error": "Invalid IP address format"}), 400

    # Check if user already exists
    if User.query.filter_by(username=username).first():
        return jsonify({"error": "User already exists"}), 400

    # Fetch role or return an error if it does not exist
    role = UserRole.query.filter_by(role_name=role_name).first()
    if not role:
        return jsonify({"error": "Invalid role specified"}), 400

    hashed_password = generate_password_hash(password, method='pbkdf2:sha256')
    new_user = User(username=username, password_hash=hashed_password, ip_address=ip_address, role_id=role.id)

    db.session.add(new_user)
    db.session.commit()

    return jsonify({"message": "User registered successfully"}), 201

@bp.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    username = data.get('username')
    password = data.get('password')

    # Validate input
    if not username or not password:
        return jsonify({"error": "Username and password are required"}), 400

    user = User.query.filter_by(username=username).first()

    if user and check_password_hash(user.password_hash, password):
        login_user(user)  # Flask-Login session handling (optional)
        
        # Generate JWT token
        access_token = generate_jwt(user)
        
        return jsonify({
            "message": "Login successful",
            "access_token": access_token
        }), 200

    # Track invalid login attempt
    return jsonify({"error": "Invalid username or password"}), 401

@bp.route('/logout', methods=['POST'])
def logout():
    if current_user.is_authenticated:
        logout_user()  # Flask-Login session handling (optional)
        return jsonify({"message": "Logout successful"}), 200
    return jsonify({"error": "User is not logged in"}), 400

@bp.route('/token/refresh', methods=['POST'])
def refresh_token():
    auth_header = request.headers.get('Authorization')
    
    if not auth_header:
        return jsonify({"error": "Authorization header missing"}), 401

    token = auth_header.split(" ")[1] if " " in auth_header else auth_header
    
    try:
        payload = jwt.decode(token, current_app.config['JWT_SECRET_KEY'], algorithms=['HS256'])
        user = User.query.get(payload['sub'])  # 'sub' is the user id
        
        if not user:
            return jsonify({"error": "Invalid token, user not found"}), 401

        # Generate a new token
        new_token = generate_jwt(user)
        
        return jsonify({
            "access_token": new_token
        }), 200
    
    except jwt.ExpiredSignatureError:
        return jsonify({"error": "Token expired, please log in again"}), 401
    
    except jwt.InvalidTokenError:
        return jsonify({"error": "Invalid token"}), 401
