from functools import wraps
from flask import request, jsonify, abort, current_app  # Import current_app
from flask_jwt_extended import get_jwt_identity
from .models import User, UserRole, Organization, AllowedIP
import uuid

def role_required(*required_roles):
    """
    Decorator to check if the user has one of the required roles.
    If the user does not have one of the required roles, return 403 (Forbidden).
    """
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            identity = get_jwt_identity()  # Get the current user's identity
            user_id = identity  # Treat identity as the user_id string
            try:
                user = User.query.get(uuid.UUID(user_id))  # Convert user_id to UUID
            except ValueError:
                return jsonify({"error": "Invalid user ID format"}), 400

            if not user:
                return jsonify({"error": "User not found"}), 404

            role = UserRole.query.get(user.role_id)
            if role.role_name not in required_roles:
                return jsonify({"error": "Unauthorized access"}), 403

            return fn(*args, **kwargs)
        return wrapper
    return decorator

def ip_whitelisted(fn):
    """
    Decorator to check if the user's IP address is whitelisted.
    If the user's IP is not whitelisted, return 403 (Forbidden).
    """
    @wraps(fn)
    def wrapper(*args, **kwargs):
        user_id = get_jwt_identity()  # This is a string
        try:
            user = User.query.get(uuid.UUID(user_id))  # Convert user_id to UUID
        except ValueError:
            return jsonify({"error": "Invalid user ID format"}), 400

        if not user:
            return jsonify({"error": "User not found"}), 404

        ip_address = request.remote_addr  # Get the user's current IP address
        allowed_ip = AllowedIP.query.filter_by(user_id=user.id, ip_address=ip_address).first()

        if not allowed_ip:
            current_app.logger.warning(f"IP access denied for {ip_address} - User ID: {user.id}")
            return jsonify({"error": "Access denied: IP address not allowed"}), 403

        return fn(*args, **kwargs)
    return wrapper


def organization_exists(fn):
    """
    Decorator to check if the organization exists.
    If the organization does not exist, return 404 (Not Found).
    """
    @wraps(fn)
    def wrapper(org_id, *args, **kwargs):
        try:
            org_uuid = uuid.UUID(org_id)  # Convert the org_id to UUID
        except ValueError:
            abort(400, description="Invalid UUID format for organization ID")

        organization = Organization.query.get(org_uuid)
        if not organization:
            abort(404, description="Organization not found")

        # Pass the organization object to the wrapped function
        return fn(organization, *args, **kwargs)
    return wrapper
