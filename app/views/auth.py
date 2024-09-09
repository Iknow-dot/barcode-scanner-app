from flask import Blueprint, request, jsonify
from werkzeug.security import generate_password_hash, check_password_hash
from flask_login import LoginManager, login_user, logout_user, current_user
from app import db, login_manager
from app.models import User, UserRole  # Import UserRole if needed

bp = Blueprint('auth', __name__)

@login_manager.user_loader
def load_user(user_id):
    return User.query.get(user_id)  # Ensure user_id matches the type used in your database

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
        login_user(user)
        return jsonify({"message": "Login successful"}), 200

    return jsonify({"error": "Invalid username or password"}), 401

@bp.route('/logout', methods=['POST'])
def logout():
    if current_user.is_authenticated:
        logout_user()
        return jsonify({"message": "Logout successful"}), 200
    return jsonify({"error": "User is not logged in"}), 400
