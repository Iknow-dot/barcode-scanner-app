from flask import Blueprint, request, jsonify, current_app, Response
from werkzeug.security import generate_password_hash, check_password_hash
from flask_login import login_user, logout_user, current_user
from app import db, login_manager
from app.auth.utils import generate_jwt, is_password_strong, is_valid_ip
from app.models import User, UserRole
import jwt

bp = Blueprint('auth', __name__)


@bp.route("/debug/headers", methods=["GET"])
def debug_headers():
    return dict(request.headers)

@bp.route("/ip", methods=["GET"])
def get_ip_view() -> Response:
    ip = request.headers.get("X-Forwarded-For", request.remote_addr)
    if ip:
        ip = ip.split(",")[0].strip()
    return jsonify({"ip": ip})


@login_manager.user_loader
def load_user(user_id):
    return User.query.get(user_id)


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
        return jsonify({
            "error": "Password must be at least 8 characters long, contain letters, numbers, and special characters"}), 400

    # Validate IP address format
    if not is_valid_ip(ip_address):
        return jsonify({"error": "Invalid IP address format"}), 400

    # Check if user already exists
    if User.query.filter_by(username=username).first():
        return jsonify({"error": "User already exists"}), 400

    # Fetch role or return an error if it does not exist
    role = UserRole.query.filter_by(role_name=role_name).first()
    if not role:
        return jsonify({"error": "Invalid role specified"}), 400

    # Create a new user
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
        current_app.logger.error("Login failed: Username and password are required")
        return jsonify({"error": "Username and password are required"}), 400

    try:
        user = User.query.filter_by(username=username).first()

        # Check if user exists and password is correct
        if user and check_password_hash(user.password_hash, password):
            login_user(user)  # Optional Flask-Login session handling

            # Generate JWT token
            access_token = generate_jwt(user)

            current_app.logger.info(f"User {user.username} logged in successfully.")

            return jsonify({
                "message": "Login successful",
                "access_token": access_token,
                "role": user.role.role_name,  # Include the user's role in the response
                "organization_id": str(user.organization_id)  # Include the organization_id in the response
            }), 200
        else:
            current_app.logger.error(f"Login failed: Invalid credentials for username: {username}")
            return jsonify({"error": "Invalid credentials"}), 401
    except Exception as e:
        current_app.logger.error(f"Unexpected error during login: {e}")
        return jsonify({"error": "An error occurred during login. Please try again."}), 500


@bp.route('/logout', methods=['POST'])
def logout():
    # Since we are using JWT, logout is essentially handled on the client side by removing the token.
    # If Flask-Login is still managing user sessions, we can log out the user from Flask-Login.
    if current_user.is_authenticated:
        logout_user()  # Optional if using Flask-Login for session management
    return jsonify({"message": "Logout successful. Please clear your JWT token on the client side."}), 200


@bp.route('/token/refresh', methods=['POST'])
def refresh_token():
    auth_header = request.headers.get('Authorization')

    if not auth_header or "Bearer" not in auth_header:
        return jsonify({"error": "Authorization header missing or malformed"}), 401

    token = auth_header.split(" ")[1] if " " in auth_header else auth_header

    try:
        payload = jwt.decode(token, current_app.config['JWT_SECRET_KEY'], algorithms=['HS256'])
        user_id = payload['sub']  # 'sub' is supposed to be the user ID
        user = User.query.get(user_id)

        if not user:
            return jsonify({"error": "User not found. Please login again."}), 401

        # Generate a new token
        new_token = generate_jwt(user)

        return jsonify({
            "access_token": new_token
        }), 200

    except jwt.ExpiredSignatureError:
        return jsonify({"error": "Token expired, please log in again"}), 401

    except jwt.InvalidTokenError:
        return jsonify({"error": "Invalid token"}), 401
