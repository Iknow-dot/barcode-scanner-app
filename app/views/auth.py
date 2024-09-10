from flask import Blueprint, request, jsonify, current_app
from werkzeug.security import generate_password_hash, check_password_hash
from flask_login import LoginManager, login_user, logout_user, current_user
from app import db, login_manager
from app.models import User, UserRole
import jwt
from datetime import datetime, timedelta, timezone

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

@bp.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    username = data.get('username')
    password = data.get('password')
    ip_address = data.get('ip_address')
    role_name = data.get('role_name')  # Assuming role_name is passed to specify the role

    if not username or not password or not ip_address or not role_name:
        return jsonify({"error": "Username, password, IP address, and role are required"}), 400

    if User.query.filter_by(username=username).first():
        return jsonify({"error": "User already exists"}), 400

    # Fetch or create the role based on role_name
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

    if not username or not password:
        return jsonify({"error": "Username and password are required"}), 400

    user = User.query.filter_by(username=username).first()

    if user and check_password_hash(user.password_hash, password):
        login_user(user)  # Login user for Flask-Login session handling (optional)
        
        # Generate JWT token
        access_token = generate_jwt(user)
        
        return jsonify({
            "message": "Login successful",
            "access_token": access_token
        }), 200

    return jsonify({"error": "Invalid username or password"}), 401

@bp.route('/logout', methods=['POST'])
def logout():
    if current_user.is_authenticated:
        logout_user()  # Logs out the Flask-Login session (optional)
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
        user = User.query.get(payload['sub'])  # 'sub' is used as the subject claim
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
