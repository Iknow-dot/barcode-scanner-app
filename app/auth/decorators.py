from functools import wraps

import jwt
from flask import request, jsonify, current_app

from app.models import User


def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        auth_header = request.headers.get('Authorization')

        if auth_header and 'Bearer' in auth_header:
            token = auth_header.split(" ")[1]

        if not token:
            return jsonify({'message': 'Token is missing!'}), 401

        try:
            data = jwt.decode(token, current_app.config['JWT_SECRET_KEY'], algorithms=['HS256'])
            current_user = User.query.get(data['user_id'])

            if not current_user:
                return jsonify({'message': 'User not found!'}), 404

        except jwt.ExpiredSignatureError:
            return jsonify({'message': 'Token has expired! Please log in again.'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'message': 'Invalid token!'}), 401

        return f(current_user, *args, **kwargs)

    return decorated


def role_required(*roles):
    def wrapper(f):
        @wraps(f)
        def decorated(current_user, *args, **kwargs):
            if current_user.role.role_name not in roles:
                return jsonify({'message': 'You do not have access to this resource!'}), 403
            return f(current_user, *args, **kwargs)

        return decorated

    return wrapper
